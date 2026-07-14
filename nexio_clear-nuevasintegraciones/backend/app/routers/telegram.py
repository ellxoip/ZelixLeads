"""
Integración Telegram — Bot API oficial.

Reutiliza la infraestructura de mensajería del CRM (WhatsAppConfig con
api_provider="telegram", WhatsAppMessage, broadcaster, push y agentes IA),
de modo que los chats de Telegram aparecen en las mismas bandejas, leads
y pipelines que el resto de los canales.

Modos de recepción:
  - Webhook:  si TELEGRAM_WEBHOOK_BASE está definido (URL pública https),
              se registra <base>/api/webhooks/telegram/{config_id}.
  - Polling:  sin URL pública (desarrollo local), un task de long-polling
              por bot consume getUpdates.
"""
import asyncio
import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from ..database import get_db, SessionLocal
from .. import models
from ..auth import get_current_user
from ..broadcaster import wa_broadcaster
from ..utils import telegram_api as tg

logger = logging.getLogger("telegram")

router = APIRouter(prefix="/api/telegram", tags=["telegram"])
webhook_router = APIRouter(prefix="/api/webhooks", tags=["webhooks-telegram"])

TELEGRAM_WEBHOOK_BASE = (os.getenv("TELEGRAM_WEBHOOK_BASE") or "").rstrip("/")

UPLOADS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../uploads"))
TG_MEDIA_DIR = os.path.join(UPLOADS_DIR, "telegram_media")

ADMIN_ROLES = ("superadmin", "subadmin", "tecnico", "agendadora")


# ── Long-polling ─────────────────────────────────────────────────────────────

_polling_tasks: dict[int, asyncio.Task] = {}


def polling_active(config_id: int) -> bool:
    task = _polling_tasks.get(config_id)
    return bool(task and not task.done())


def start_polling(config_id: int) -> None:
    if polling_active(config_id):
        return
    _polling_tasks[config_id] = asyncio.get_event_loop().create_task(_poll_loop(config_id))
    logger.info("Telegram polling iniciado para config %s", config_id)


def stop_polling(config_id: int) -> None:
    task = _polling_tasks.pop(config_id, None)
    if task and not task.done():
        task.cancel()
        logger.info("Telegram polling detenido para config %s", config_id)


async def _poll_loop(config_id: int) -> None:
    offset: int | None = None
    while True:
        db = SessionLocal()
        try:
            cfg = db.query(models.WhatsAppConfig).filter(
                models.WhatsAppConfig.id == config_id,
                models.WhatsAppConfig.api_provider == "telegram",
                models.WhatsAppConfig.is_active == True,  # noqa: E712
            ).first()
            token = cfg.api_token if cfg else None
        finally:
            db.close()
        if not token:
            logger.info("Telegram polling: config %s inactiva — saliendo", config_id)
            return

        updates = await tg.get_updates(token, offset)
        if updates is None:
            await asyncio.sleep(5)  # error de red/API — backoff
            continue
        for update in updates:
            offset = update["update_id"] + 1
            db = SessionLocal()
            try:
                await process_update(db, config_id, update)
            except Exception as exc:
                logger.exception("Telegram update error (config %s): %s", config_id, exc)
            finally:
                db.close()


async def start_all_polling() -> None:
    """Arranca polling para todos los bots activos sin webhook (startup)."""
    if TELEGRAM_WEBHOOK_BASE:
        return
    db = SessionLocal()
    try:
        cfgs = db.query(models.WhatsAppConfig).filter(
            models.WhatsAppConfig.api_provider == "telegram",
            models.WhatsAppConfig.is_active == True,  # noqa: E712
        ).all()
        ids = [c.id for c in cfgs]
    finally:
        db.close()
    for cid in ids:
        start_polling(cid)


# ── Procesamiento de updates (webhook y polling comparten esto) ──────────────

def _display_name(sender: dict, chat: dict) -> str:
    parts = [sender.get("first_name") or "", sender.get("last_name") or ""]
    name = " ".join(p for p in parts if p).strip()
    if not name:
        name = sender.get("username") or chat.get("username") or ""
    return name or f"Telegram {chat.get('id')}"


async def _extract_media(token: str, msg: dict) -> tuple[str, str | None, str]:
    """Devuelve (message_type, media_url, fallback_content) del mensaje."""
    if msg.get("photo"):
        file_id = msg["photo"][-1]["file_id"]  # mayor resolución
        fname = await tg.download_file(token, file_id, TG_MEDIA_DIR)
        return "image", (f"/uploads/telegram_media/{fname}" if fname else None), "📷 Foto"
    if msg.get("document"):
        doc = msg["document"]
        fname = await tg.download_file(token, doc["file_id"], TG_MEDIA_DIR)
        return "pdf" if (doc.get("mime_type") == "application/pdf") else "document", \
            (f"/uploads/telegram_media/{fname}" if fname else None), doc.get("file_name") or "📎 Documento"
    if msg.get("voice"):
        fname = await tg.download_file(token, msg["voice"]["file_id"], TG_MEDIA_DIR)
        return "audio", (f"/uploads/telegram_media/{fname}" if fname else None), "🎤 Nota de voz"
    if msg.get("audio"):
        fname = await tg.download_file(token, msg["audio"]["file_id"], TG_MEDIA_DIR)
        return "audio", (f"/uploads/telegram_media/{fname}" if fname else None), "🎵 Audio"
    if msg.get("video"):
        fname = await tg.download_file(token, msg["video"]["file_id"], TG_MEDIA_DIR)
        return "video", (f"/uploads/telegram_media/{fname}" if fname else None), "🎬 Video"
    if msg.get("sticker"):
        return "text", None, msg["sticker"].get("emoji") or "🩵 Sticker"
    return "text", None, ""


async def process_update(db: Session, config_id: int, update: dict) -> dict:
    """Procesa un update de Telegram: contacto + lead + mensaje + realtime."""
    msg = update.get("message")
    if not msg:
        return {"ok": True, "skipped": "no_message"}

    chat = msg.get("chat") or {}
    if chat.get("type") != "private":
        return {"ok": True, "skipped": "non_private_chat"}

    cfg = db.query(models.WhatsAppConfig).options(
        joinedload(models.WhatsAppConfig.areas),
    ).filter(
        models.WhatsAppConfig.id == config_id,
        models.WhatsAppConfig.api_provider == "telegram",
    ).first()
    if not cfg:
        return {"ok": False, "error": "config not found"}

    sender = msg.get("from") or {}
    chat_id = chat.get("id")
    phone = tg.phone_from_chat_id(chat_id)
    message_id = f"tg:{chat_id}:{msg.get('message_id')}"
    content = msg.get("text") or msg.get("caption") or ""

    # Deduplicación (webhook + polling pueden solaparse)
    existing = db.query(models.WhatsAppMessage).filter(
        models.WhatsAppMessage.message_id == message_id
    ).first()
    if existing:
        return {"ok": True, "duplicate": True}

    message_type, media_url, fallback = "text", None, ""
    if not content or any(k in msg for k in ("photo", "document", "voice", "audio", "video", "sticker")):
        message_type, media_url, fallback = await _extract_media(cfg.api_token, msg)
    if not content:
        content = fallback
    if not content and not media_url:
        return {"ok": True, "skipped": "empty_message"}

    system_user = db.query(models.User).filter(
        models.User.role.in_(["superadmin", "subadmin", "tecnico"])
    ).first()

    # Contacto por chat_id (phone tg:<id>)
    contact = db.query(models.Contact).filter(
        models.Contact.phone == phone,
        models.Contact.group_id == cfg.group_id,
    ).first()
    if not contact:
        contact = db.query(models.Contact).filter(models.Contact.phone == phone).first()
    if not contact:
        if not system_user:
            return {"ok": False, "error": "no system user"}
        contact = models.Contact(
            name=_display_name(sender, chat),
            phone=phone,
            group_id=cfg.group_id,
            created_by=system_user.id,
            notes=f"Telegram @{sender.get('username')}" if sender.get("username") else "Contacto Telegram",
        )
        db.add(contact)
        db.flush()

    # Lead activo del contacto
    active_lead = (
        db.query(models.Lead)
        .filter(
            models.Lead.contact_id == contact.id,
            models.Lead.current_stage.notin_(["pagado_confirmado"]),
        )
        .order_by(models.Lead.created_at.desc())
        .first()
    )

    # ¿Lo atenderá un agente IA? (misma lógica que WhatsApp QR)
    will_be_handled_by_ai = False
    if not active_lead and cfg.group_id:
        from ..utils.agent_engine import _within_hours
        agent = (
            db.query(models.AIAgent)
            .join(
                models.ai_agent_configs,
                models.ai_agent_configs.c.agent_id == models.AIAgent.id,
            )
            .filter(
                models.ai_agent_configs.c.whatsapp_config_id == cfg.id,
                models.AIAgent.is_active == True,  # noqa: E712
            )
            .first()
        )
        if agent and _within_hours(agent.business_hours_start, agent.business_hours_end):
            state = db.query(models.AIAgentContactState).filter_by(
                agent_id=agent.id, contact_id=contact.id
            ).first()
            if not state or state.state not in ("paused", "handed_off"):
                will_be_handled_by_ai = True

    # Autocrear lead si no existe (y la IA no lo va a atender)
    if not active_lead and cfg.group_id and not will_be_handled_by_ai:
        area_id = cfg.areas[0].id if cfg.areas else None
        if not area_id:
            first_area = db.query(models.Area).filter(
                models.Area.group_id == cfg.group_id
            ).first()
            if first_area:
                area_id = first_area.id

        agendadora_id = cfg.owner_user_id
        if not agendadora_id:
            ag = db.query(models.User).filter(
                models.User.group_id == cfg.group_id,
                models.User.role == "agendadora",
                models.User.is_active == True,  # noqa: E712
            ).first()
            if ag:
                agendadora_id = ag.id

        vendedor = db.query(models.User).filter(
            models.User.group_id == cfg.group_id,
            models.User.role == "vendedor",
            models.User.is_active == True,  # noqa: E712
        ).first()
        vendedor_id = vendedor.id if vendedor else agendadora_id

        if area_id and agendadora_id and vendedor_id:
            active_lead = models.Lead(
                contact_id=contact.id,
                area_id=area_id,
                group_id=cfg.group_id,
                agendadora_id=agendadora_id,
                vendedor_id=vendedor_id,
                current_stage="lead",
                source="telegram",
            )
            db.add(active_lead)
            db.flush()

    db_msg = models.WhatsAppMessage(
        contact_id=contact.id,
        lead_id=active_lead.id if active_lead else None,
        whatsapp_config_id=cfg.id,
        direction="in",
        message_type=message_type,
        content=content,
        media_url=media_url,
        status="received",
        message_id=message_id,
        is_read=False,
    )
    db.add(db_msg)

    if active_lead:
        active_lead.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(db_msg)

    await wa_broadcaster.broadcast("new_message", {
        "contact_id": contact.id,
        "message": {
            "id": db_msg.id,
            "contact_id": db_msg.contact_id,
            "lead_id": db_msg.lead_id,
            "whatsapp_config_id": db_msg.whatsapp_config_id,
            "direction": db_msg.direction,
            "message_type": db_msg.message_type,
            "content": db_msg.content,
            "media_url": db_msg.media_url,
            "status": db_msg.status,
            "is_read": db_msg.is_read,
            "created_at": db_msg.created_at.isoformat() if db_msg.created_at else None,
        },
    })

    # Push a la agendadora/dueña del bot
    try:
        from ..routers.push import send_push_to_user
        contact_label = contact.name if contact.name and contact.name != contact.phone else contact.phone
        preview = content[:100] if content else "📎 Archivo recibido"
        lead_url = f"/leads?chat={active_lead.id}" if active_lead else "/leads"
        notify_ids = set()
        if active_lead and active_lead.agendadora_id:
            notify_ids.add(active_lead.agendadora_id)
        if cfg.owner_user_id:
            notify_ids.add(cfg.owner_user_id)
        for uid in notify_ids:
            send_push_to_user(db, uid, f"Telegram · {contact_label}", preview, lead_url)
    except Exception as push_exc:
        logger.warning("Telegram push failed: %s", push_exc)

    # Agente IA en background (mismo flujo que WhatsApp)
    try:
        from .whatsapp_qr import _run_agent_bg
        asyncio.create_task(
            _run_agent_bg(cfg.id, contact.id, active_lead.id if active_lead else None, db_msg.id)
        )
    except Exception as agent_exc:
        logger.warning("Telegram agent task failed: %s", agent_exc)

    return {"ok": True}


# ── Webhook ──────────────────────────────────────────────────────────────────

@webhook_router.post("/telegram/{config_id}")
async def telegram_webhook(
    config_id: int,
    update: dict,
    db: Session = Depends(get_db),
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
):
    cfg = db.query(models.WhatsAppConfig).filter(
        models.WhatsAppConfig.id == config_id,
        models.WhatsAppConfig.api_provider == "telegram",
        models.WhatsAppConfig.is_active == True,  # noqa: E712
    ).first()
    if not cfg:
        raise HTTPException(404, "Bot no encontrado")
    if x_telegram_bot_api_secret_token != tg.webhook_secret(cfg.api_token or ""):
        raise HTTPException(403, "Secret inválido")
    return await process_update(db, config_id, update)


# ── Gestión de bots ──────────────────────────────────────────────────────────

class TelegramBotIn(BaseModel):
    name: str
    token: str
    group_id: int | None = None


def _require_admin(user: models.User) -> None:
    if user.role not in ADMIN_ROLES:
        raise HTTPException(403, "Sin permisos para gestionar bots de Telegram")


def _bot_out(cfg: models.WhatsAppConfig) -> dict:
    return {
        "id": cfg.id,
        "name": cfg.name,
        "username": cfg.phone_number,        # @usuario del bot
        "bot_id": cfg.phone_number_id,
        "group_id": cfg.group_id,
        "is_active": cfg.is_active,
        "mode": "webhook" if TELEGRAM_WEBHOOK_BASE else "polling",
        "connected": bool(TELEGRAM_WEBHOOK_BASE) or polling_active(cfg.id),
        "created_at": cfg.created_at.isoformat() if cfg.created_at else None,
    }


@router.get("/bots")
def list_bots(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    _require_admin(current_user)
    q = db.query(models.WhatsAppConfig).filter(
        models.WhatsAppConfig.api_provider == "telegram",
        models.WhatsAppConfig.is_active == True,  # noqa: E712
    )
    if current_user.role == "agendadora" and current_user.group_id:
        q = q.filter(models.WhatsAppConfig.group_id == current_user.group_id)
    return [_bot_out(c) for c in q.order_by(models.WhatsAppConfig.id.desc()).all()]


@router.post("/bots")
async def create_bot(
    data: TelegramBotIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _require_admin(current_user)
    token = data.token.strip()
    if not token or ":" not in token:
        raise HTTPException(400, "Token inválido — cópialo tal cual desde @BotFather")

    me = await tg.get_me(token)
    if not me:
        raise HTTPException(400, "Telegram rechazó el token. Verifica que sea correcto.")

    existing = db.query(models.WhatsAppConfig).filter(
        models.WhatsAppConfig.api_provider == "telegram",
        models.WhatsAppConfig.phone_number_id == str(me["id"]),
        models.WhatsAppConfig.is_active == True,  # noqa: E712
    ).first()
    if existing:
        raise HTTPException(409, f"El bot @{me.get('username')} ya está conectado")

    group_id = data.group_id or current_user.group_id
    cfg = models.WhatsAppConfig(
        name=data.name.strip() or me.get("first_name") or f"@{me.get('username')}",
        phone_number=f"@{me.get('username')}",
        api_token=token,
        api_provider="telegram",
        phone_number_id=str(me["id"]),
        group_id=group_id,
        owner_user_id=current_user.id if current_user.role == "agendadora" else None,
        is_active=True,
    )
    db.add(cfg)
    db.commit()
    db.refresh(cfg)

    if TELEGRAM_WEBHOOK_BASE:
        ok = await tg.set_webhook(token, f"{TELEGRAM_WEBHOOK_BASE}/api/webhooks/telegram/{cfg.id}")
        if not ok:
            logger.warning("No se pudo registrar webhook para bot %s", cfg.id)
    else:
        await tg.delete_webhook(token)  # getUpdates requiere no tener webhook
        start_polling(cfg.id)

    return _bot_out(cfg)


@router.get("/bots/{config_id}/status")
async def bot_status(
    config_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _require_admin(current_user)
    cfg = db.query(models.WhatsAppConfig).filter(
        models.WhatsAppConfig.id == config_id,
        models.WhatsAppConfig.api_provider == "telegram",
    ).first()
    if not cfg:
        raise HTTPException(404, "Bot no encontrado")
    me = await tg.get_me(cfg.api_token or "")
    info = await tg.get_webhook_info(cfg.api_token or "") if TELEGRAM_WEBHOOK_BASE else None
    return {
        **_bot_out(cfg),
        "token_valid": bool(me),
        "webhook": (info or {}).get("url") if info else None,
        "pending_updates": (info or {}).get("pending_update_count") if info else None,
    }


@router.delete("/bots/{config_id}")
async def delete_bot(
    config_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _require_admin(current_user)
    cfg = db.query(models.WhatsAppConfig).filter(
        models.WhatsAppConfig.id == config_id,
        models.WhatsAppConfig.api_provider == "telegram",
    ).first()
    if not cfg:
        raise HTTPException(404, "Bot no encontrado")
    stop_polling(cfg.id)
    if cfg.api_token:
        await tg.delete_webhook(cfg.api_token)
    # Desactivación suave: los mensajes históricos conservan su config
    cfg.is_active = False
    db.commit()
    return {"ok": True}
