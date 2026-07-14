"""
WhatsApp QR session management — tecnico-only routes that proxy to the Node.js QR service,
plus the incoming webhook that the Node service calls when messages/events arrive.
"""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from typing import Optional
import asyncio
import httpx
import logging
import os
from datetime import datetime, timezone
from ..database import get_db
from .. import models
from ..auth import require_tecnico
from ..broadcaster import wa_broadcaster

logger = logging.getLogger(__name__)

QR_SERVICE_URL = os.getenv("QR_SERVICE_URL", "http://localhost:3005")
QR_SERVICE_TIMEOUT = 10  # seconds

router = APIRouter(prefix="/api/tecnico/whatsapp/qr", tags=["whatsapp-qr"])
webhook_router = APIRouter(prefix="/api/webhooks", tags=["webhooks-qr"])


# ── Helpers ─────────────────────────────────────────────────────────────────

def _is_real_phone(phone: str) -> bool:
    """Return True only for numeric phone numbers — reject system addresses like status@broadcast."""
    digits = phone.lstrip("+")
    return digits.isdigit() and len(digits) >= 7


async def _node_get(path: str) -> dict:
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{QR_SERVICE_URL}{path}", timeout=QR_SERVICE_TIMEOUT)
        return r.json()


async def _node_post(path: str, data: dict = {}) -> dict:
    async with httpx.AsyncClient() as client:
        r = await client.post(f"{QR_SERVICE_URL}{path}", json=data, timeout=QR_SERVICE_TIMEOUT)
        return r.json()


async def _node_delete(path: str) -> dict:
    async with httpx.AsyncClient() as client:
        r = await client.delete(f"{QR_SERVICE_URL}{path}", timeout=QR_SERVICE_TIMEOUT)
        return r.json()


def _qr_cfg_out(cfg: models.WhatsAppConfig) -> dict:
    return {
        "id": cfg.id,
        "name": cfg.name,
        "phone_number": cfg.phone_number,
        "api_provider": cfg.api_provider,
        "is_active": cfg.is_active,
        "group_id": cfg.group_id,
        "group_name": cfg.group.name if cfg.group else None,
    }


# ── Tecnico routes ───────────────────────────────────────────────────────────

@router.post("")
async def create_qr_session(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_tecnico),
):
    """Create a new WhatsApp QR config entry and start the QR session."""
    cfg = models.WhatsAppConfig(
        name="Nueva sesión QR",
        phone_number="pending",
        api_provider="qr",
        is_active=False,
        group_id=None,
    )
    db.add(cfg)
    db.commit()
    db.refresh(cfg)

    try:
        await _node_post(f"/sessions/{cfg.id}/start")
    except Exception as e:
        db.delete(cfg)
        db.commit()
        raise HTTPException(status_code=503, detail=f"No se pudo iniciar el servicio QR: {e}")

    return _qr_cfg_out(cfg)


@router.post("/{config_id}/start")
async def start_qr_session(
    config_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_tecnico),
):
    """(Re)start QR session for an existing config — triggers a new QR code."""
    cfg = db.query(models.WhatsAppConfig).filter(
        models.WhatsAppConfig.id == config_id,
        models.WhatsAppConfig.api_provider == "qr",
    ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Configuración QR no encontrada")

    try:
        result = await _node_post(f"/sessions/{config_id}/start")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Servicio QR no disponible: {e}")

    return result


@router.get("/{config_id}/status")
async def get_qr_status(
    config_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_tecnico),
):
    """Get live connection status from the Node QR service."""
    cfg = db.query(models.WhatsAppConfig).filter(
        models.WhatsAppConfig.id == config_id,
        models.WhatsAppConfig.api_provider == "qr",
    ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Configuración QR no encontrada")

    try:
        node_status = await _node_get(f"/sessions/{config_id}/status")
    except Exception:
        node_status = {"status": "service_unavailable", "phone": None}

    return {**node_status, "config": _qr_cfg_out(cfg)}


@router.get("/{config_id}/qr-image")
async def get_qr_image(
    config_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_tecnico),
):
    """Get the current QR code image (base64 data URL) from the Node service."""
    cfg = db.query(models.WhatsAppConfig).filter(
        models.WhatsAppConfig.id == config_id,
        models.WhatsAppConfig.api_provider == "qr",
    ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Configuración QR no encontrada")

    try:
        data = await _node_get(f"/sessions/{config_id}/qr")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Servicio QR no disponible: {e}")

    if "error" in data:
        raise HTTPException(status_code=404, detail=data.get("error", "QR no disponible"))

    return data


@router.delete("/{config_id}")
async def delete_qr_session(
    config_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_tecnico),
):
    """Disconnect the WhatsApp QR session and remove the config."""
    cfg = db.query(models.WhatsAppConfig).filter(
        models.WhatsAppConfig.id == config_id,
        models.WhatsAppConfig.api_provider == "qr",
    ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Configuración QR no encontrada")

    try:
        await _node_delete(f"/sessions/{config_id}")
    except Exception:
        pass  # best-effort

    db.delete(cfg)
    db.commit()
    return {"ok": True}


@router.patch("/{config_id}/rename")
async def rename_qr_session(
    config_id: int,
    body: dict,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_tecnico),
):
    cfg = db.query(models.WhatsAppConfig).filter(
        models.WhatsAppConfig.id == config_id,
        models.WhatsAppConfig.api_provider == "qr",
    ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Configuración QR no encontrada")
    name = (body.get("name") or "").strip()
    if name:
        cfg.name = name
        db.commit()
    return _qr_cfg_out(cfg)


@router.post("/{config_id}/sync-chats")
async def sync_chats(
    config_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_tecnico),
):
    """Ask the Node QR service to re-push all cached chats to the CRM."""
    cfg = db.query(models.WhatsAppConfig).filter(
        models.WhatsAppConfig.id == config_id,
        models.WhatsAppConfig.api_provider == "qr",
    ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Configuración QR no encontrada")
    try:
        result = await _node_post(f"/sessions/{config_id}/sync-chats")
        return {"ok": True, "pushed": result.get("pushed", 0)}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Error al sincronizar: {e}")


# ── Webhooks from Node service ────────────────────────────────────────────────

@webhook_router.post("/qr-connected")
async def qr_connected(body: dict, db: Session = Depends(get_db)):
    """Called by Node service when a WhatsApp account connects via QR."""
    session_id = body.get("session_id")
    phone = body.get("phone", "")
    if not session_id:
        return {"ok": False}

    cfg = db.query(models.WhatsAppConfig).filter(
        models.WhatsAppConfig.id == int(session_id),
        models.WhatsAppConfig.api_provider == "qr",
    ).first()
    if cfg:
        cfg.phone_number = f"+{phone}" if phone and not phone.startswith("+") else phone
        cfg.name = f"WhatsApp +{phone}" if phone else cfg.name
        cfg.is_active = True
        db.commit()

    return {"ok": True}


@webhook_router.post("/qr-history")
async def qr_history(body: dict, db: Session = Depends(get_db)):
    """Bulk import of historical messages synced when a QR session connects."""
    session_id = body.get("session_id")
    raw_messages = body.get("messages", [])
    if not session_id or not raw_messages:
        return {"ok": False}

    cfg = db.query(models.WhatsAppConfig).filter(
        models.WhatsAppConfig.id == int(session_id),
        models.WhatsAppConfig.api_provider == "qr",
    ).first()
    if not cfg:
        return {"ok": False, "error": "config not found"}

    system_user = db.query(models.User).filter(
        models.User.role.in_(["superadmin", "subadmin", "tecnico"])
    ).first()

    # Resolve lead-creation context for this session (same as qr-incoming)
    area_id = None
    agendadora_id = cfg.owner_user_id
    vendedor_id = None
    if cfg.group_id:
        from sqlalchemy.orm import joinedload as _jl
        cfg_with_areas = db.query(models.WhatsAppConfig).options(
            _jl(models.WhatsAppConfig.areas)
        ).filter(models.WhatsAppConfig.id == cfg.id).first()
        if cfg_with_areas and cfg_with_areas.areas:
            area_id = cfg_with_areas.areas[0].id
        if not area_id:
            first_area = db.query(models.Area).filter(
                models.Area.group_id == cfg.group_id
            ).first()
            if first_area:
                area_id = first_area.id
        if not agendadora_id:
            ag = db.query(models.User).filter(
                models.User.group_id == cfg.group_id,
                models.User.role == "agendadora",
                models.User.is_active == True,
            ).first()
            if ag:
                agendadora_id = ag.id
        vendedor = db.query(models.User).filter(
            models.User.group_id == cfg.group_id,
            models.User.role == "vendedor",
            models.User.is_active == True,
        ).first()
        vendedor_id = vendedor.id if vendedor else agendadora_id

    can_create_lead = bool(area_id and agendadora_id and vendedor_id and cfg.group_id)

    # Pre-fetch existing message_ids to deduplicate without N queries
    incoming_ids = [m["message_id"] for m in raw_messages if m.get("message_id")]
    existing_ids = set(
        row[0] for row in
        db.query(models.WhatsAppMessage.message_id)
        .filter(models.WhatsAppMessage.message_id.in_(incoming_ids))
        .all()
    )

    # Track leads created in this batch to avoid duplicates within the same import
    batch_leads: dict[int, models.Lead] = {}

    imported = 0
    for item in raw_messages:
        from_phone = (item.get("from_phone") or "").strip()
        if not from_phone:
            continue
        if not from_phone.startswith("+"):
            from_phone = "+" + from_phone
        if not _is_real_phone(from_phone):
            continue

        message_id = item.get("message_id")
        if message_id and message_id in existing_ids:
            continue

        content = item.get("content", "") or ""
        message_type = item.get("message_type", "text")
        is_from_me = item.get("is_from_me", False)
        timestamp = item.get("timestamp")

        msg_time = None
        if timestamp:
            try:
                from datetime import timezone as tz
                msg_time = datetime.fromtimestamp(int(timestamp), tz=tz.utc)
            except Exception:
                pass

        # Find or create contact
        contact = db.query(models.Contact).filter(
            models.Contact.phone == from_phone
        ).first()
        if not contact:
            if not system_user:
                continue
            contact = models.Contact(
                name=from_phone,
                phone=from_phone,
                group_id=cfg.group_id,
                created_by=system_user.id,
            )
            db.add(contact)
            db.flush()

        # Find active lead; if none and this is an incoming message, auto-create one
        if contact.id in batch_leads:
            active_lead = batch_leads[contact.id]
        else:
            active_lead = (
                db.query(models.Lead)
                .filter(
                    models.Lead.contact_id == contact.id,
                    models.Lead.current_stage.notin_(["pagado_confirmado"]),
                )
                .order_by(models.Lead.created_at.desc())
                .first()
            )

        if not active_lead and not is_from_me and can_create_lead:
            active_lead = models.Lead(
                contact_id=contact.id,
                area_id=area_id,
                group_id=cfg.group_id,
                agendadora_id=agendadora_id,
                vendedor_id=vendedor_id,
                current_stage="lead",
                source="whatsapp",
            )
            db.add(active_lead)
            db.flush()

        if active_lead:
            batch_leads[contact.id] = active_lead

        msg = models.WhatsAppMessage(
            contact_id=contact.id,
            lead_id=active_lead.id if active_lead else None,
            whatsapp_config_id=cfg.id,
            direction="out" if is_from_me else "in",
            message_type=message_type,
            content=content,
            status="received" if not is_from_me else "sent",
            message_id=message_id,
            is_read=True,  # historical messages pre-read
            created_at=msg_time,
        )
        db.add(msg)
        if message_id:
            existing_ids.add(message_id)
        imported += 1

        if imported % 100 == 0:
            db.flush()

    db.commit()
    # Notify all connected SSE clients to refresh conversations and leads list
    if imported > 0:
        await wa_broadcaster.broadcast("refresh", {"imported": imported})
    return {"ok": True, "imported": imported}


@webhook_router.post("/qr-contact-pic")
async def qr_contact_pic(body: dict, db: Session = Depends(get_db)):
    """Update a contact's WhatsApp profile picture URL."""
    phone = (body.get("phone") or "").strip()
    avatar_url = (body.get("avatar_url") or "").strip()
    if not phone or not avatar_url:
        return {"ok": False}
    if not phone.startswith("+"):
        phone = "+" + phone
    contact = db.query(models.Contact).filter(models.Contact.phone == phone).first()
    if contact and contact.avatar_url != avatar_url:
        contact.avatar_url = avatar_url
        db.commit()
    return {"ok": True}


@webhook_router.post("/qr-chats")
async def qr_chats(body: dict, db: Session = Depends(get_db)):
    """Called by Node service with the full chat list from chats.upsert.
    Creates contacts for every direct conversation so they appear in the WhatsApp sidebar."""
    session_id = body.get("session_id")
    chats = body.get("chats", [])
    if not session_id or not chats:
        return {"ok": False}

    cfg = db.query(models.WhatsAppConfig).filter(
        models.WhatsAppConfig.id == int(session_id),
        models.WhatsAppConfig.api_provider == "qr",
    ).first()
    if not cfg:
        return {"ok": False, "error": "config not found"}

    system_user = db.query(models.User).filter(
        models.User.role.in_(["superadmin", "subadmin", "tecnico"])
    ).first()
    if not system_user:
        return {"ok": False, "error": "no system user"}

    created_contacts = 0
    created_stubs = 0

    for chat in chats:
        phone = (chat.get("phone") or "").strip()
        if not phone:
            continue
        if not phone.startswith("+"):
            phone = "+" + phone
        if not _is_real_phone(phone):
            continue

        # Find or create contact
        contact = db.query(models.Contact).filter(models.Contact.phone == phone).first()
        if not contact:
            name = chat.get("name") or phone
            contact = models.Contact(
                name=name,
                phone=phone,
                group_id=cfg.group_id,
                created_by=system_user.id,
            )
            db.add(contact)
            db.flush()
            created_contacts += 1
        elif chat.get("name") and contact.name == contact.phone:
            # Update name if we now have a real name and it was just the phone before
            contact.name = chat["name"]

        # Add a stub message so the contact appears in the conversations list
        has_msg = db.query(models.WhatsAppMessage).filter(
            models.WhatsAppMessage.contact_id == contact.id
        ).first()
        if not has_msg:
            stub = models.WhatsAppMessage(
                contact_id=contact.id,
                whatsapp_config_id=cfg.id,
                direction="in",
                message_type="text",
                content="",
                status="received",
                is_read=True,
            )
            db.add(stub)
            created_stubs += 1

    db.commit()
    logger.info("qr-chats: %d contacts created, %d stubs added from %d chats", created_contacts, created_stubs, len(chats))
    return {"ok": True, "created_contacts": created_contacts, "total": len(chats)}


@webhook_router.post("/qr-disconnected")
async def qr_disconnected(body: dict, db: Session = Depends(get_db)):
    """Called by Node service when a session disconnects or logs out."""
    session_id = body.get("session_id")
    if not session_id:
        return {"ok": False}

    cfg = db.query(models.WhatsAppConfig).filter(
        models.WhatsAppConfig.id == int(session_id),
        models.WhatsAppConfig.api_provider == "qr",
    ).first()
    if cfg:
        cfg.is_active = False
        if body.get("reason") == "logged_out":
            cfg.phone_number = "pending"
            cfg.name = "Sesión QR desconectada"
        db.commit()

    return {"ok": True}


@webhook_router.post("/qr-incoming")
async def qr_incoming(body: dict, db: Session = Depends(get_db)):
    """Called by Node service for every incoming message received via QR session.
    Also handles outgoing messages sent from the linked phone (is_from_me=True)."""
    session_id = body.get("session_id")
    from_phone = (body.get("from_phone") or "").strip()
    content = body.get("content", "")
    message_type = body.get("message_type", "text")
    media_url = body.get("media_url")
    message_id = body.get("message_id")
    is_from_me = bool(body.get("is_from_me", False))

    # Rewrite localhost Node media URLs to relative paths served via nginx proxy
    if media_url and "localhost:3005" in media_url:
        from urllib.parse import urlparse
        media_url = urlparse(media_url).path  # e.g. /media/13/file.jpg

    if not session_id or not from_phone:
        return {"ok": False}

    # Skip empty protocol messages (reactions, ephemeral notices, etc.)
    if not content and not media_url:
        return {"ok": True, "skipped": "empty_message"}

    # Normalize phone: ensure it starts with +
    if from_phone and not from_phone.startswith("+"):
        from_phone = "+" + from_phone

    # Reject system addresses (status@broadcast, etc.)
    if not _is_real_phone(from_phone):
        return {"ok": False, "skipped": "system_address"}

    from sqlalchemy.orm import joinedload
    cfg = db.query(models.WhatsAppConfig).options(
        joinedload(models.WhatsAppConfig.areas),
    ).filter(
        models.WhatsAppConfig.id == int(session_id),
        models.WhatsAppConfig.api_provider == "qr",
    ).first()
    if not cfg:
        return {"ok": False, "error": "config not found"}

    # Deduplicate by message_id
    if message_id:
        existing = db.query(models.WhatsAppMessage).filter(
            models.WhatsAppMessage.message_id == message_id
        ).first()
        if existing:
            return {"ok": True, "duplicate": True}

    # Find system user for contact creation
    system_user = db.query(models.User).filter(
        models.User.role.in_(["superadmin", "subadmin", "tecnico"])
    ).first()

    # Find or create contact
    contact = db.query(models.Contact).filter(
        models.Contact.phone == from_phone,
        models.Contact.group_id == cfg.group_id,
    ).first()
    if not contact:
        contact = db.query(models.Contact).filter(
            models.Contact.phone == from_phone
        ).first()
    if not contact:
        if not system_user:
            return {"ok": False, "error": "no system user"}
        contact = models.Contact(
            name=from_phone,
            phone=from_phone,
            group_id=cfg.group_id,
            created_by=system_user.id,
        )
        db.add(contact)
        db.flush()

    # Find active lead for this contact
    active_lead = (
        db.query(models.Lead)
        .filter(
            models.Lead.contact_id == contact.id,
            models.Lead.current_stage.notin_(["pagado_confirmado"]),
        )
        .order_by(models.Lead.created_at.desc())
        .first()
    )

    # Determine if an AI Agent will handle this conversation
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
                models.AIAgent.is_active == True,
            )
            .first()
        )
        if agent and _within_hours(agent.business_hours_start, agent.business_hours_end):
            state = db.query(models.AIAgentContactState).filter_by(agent_id=agent.id, contact_id=contact.id).first()
            if not state or state.state not in ("paused", "handed_off"):
                will_be_handled_by_ai = True

    # Auto-create lead if none exists and we have enough context (AND AI won't handle it)
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
                models.User.is_active == True,
            ).first()
            if ag:
                agendadora_id = ag.id

        vendedor = db.query(models.User).filter(
            models.User.group_id == cfg.group_id,
            models.User.role == "vendedor",
            models.User.is_active == True,
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
                source="whatsapp",
            )
            db.add(active_lead)
            db.flush()

    msg = models.WhatsAppMessage(
        contact_id=contact.id,
        lead_id=active_lead.id if active_lead else None,
        whatsapp_config_id=cfg.id,
        direction="out" if is_from_me else "in",
        message_type=message_type,
        content=content,
        media_url=media_url,
        status="sent" if is_from_me else "received",
        message_id=message_id,
        is_read=is_from_me,
    )
    db.add(msg)

    if active_lead:
        active_lead.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(msg)

    await wa_broadcaster.broadcast("new_message", {
        "contact_id": contact.id,
        "message": {
            "id": msg.id,
            "contact_id": msg.contact_id,
            "lead_id": msg.lead_id,
            "whatsapp_config_id": msg.whatsapp_config_id,
            "direction": msg.direction,
            "message_type": msg.message_type,
            "content": msg.content,
            "media_url": msg.media_url,
            "status": msg.status,
            "is_read": msg.is_read,
            "created_at": msg.created_at.isoformat() if msg.created_at else None,
        },
    })

    # Push notification to agendadora/owner on every incoming message
    if not is_from_me:
        try:
            from ..routers.push import send_push_to_user
            from py_vapid import Vapid
            from ..routers.push import _ensure_vapid_keys
            # Determine contact display name
            if contact.name and contact.name != contact.phone:
                contact_label = contact.name
            else:
                # Format phone nicely: +56912345678 → +569 1234 5678
                p = contact.phone or ""
                contact_label = p

            preview = content[:100] if content else "📎 Archivo recibido"
            lead_url = f"/leads?chat={active_lead.id}" if active_lead else "/leads"
            title = f"Mensaje de {contact_label}"
            body = preview

            # Notify agendadora assigned to lead, or config owner
            notify_ids = set()
            if active_lead and active_lead.agendadora_id:
                notify_ids.add(active_lead.agendadora_id)
            if cfg.owner_user_id:
                notify_ids.add(cfg.owner_user_id)
            for uid in notify_ids:
                send_push_to_user(db, uid, title, body, lead_url)
        except Exception as _push_exc:
            logger.warning("Push send failed: %s", _push_exc)

        # Fire AI agent in background
        try:
            asyncio.create_task(
                _run_agent_bg(int(session_id), contact.id, active_lead.id if active_lead else None, msg.id)
            )
        except Exception as _agent_exc:
            logger.warning("Could not schedule agent task: %s", _agent_exc)

    return {"ok": True}


async def _run_agent_bg(config_id: int, contact_id: int, lead_id: int | None, msg_id: int) -> None:
    """Background task: run the AI agent with a fresh DB session."""
    from ..utils.agent_engine import maybe_run_agent
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        contact = db.query(models.Contact).get(contact_id)
        lead = db.query(models.Lead).get(lead_id) if lead_id else None
        incoming = db.query(models.WhatsAppMessage).get(msg_id)
        if contact and incoming:
            await maybe_run_agent(db, config_id, contact, lead, incoming)
    except Exception as exc:
        logger.error("Agent background task error: %s", exc)
    finally:
        db.close()


@webhook_router.post("/qr-update-media")
async def qr_update_media(body: dict, db: Session = Depends(get_db)):
    """Called by Node service after async media download completes.
    Updates media_url on the message and broadcasts a refresh so clients reload it."""
    message_id = body.get("message_id")
    media_url = body.get("media_url")
    if not message_id or not media_url:
        return {"ok": False}

    # Rewrite localhost Node media URLs to relative paths
    if media_url and "localhost:3005" in media_url:
        from urllib.parse import urlparse
        media_url = urlparse(media_url).path

    msg = db.query(models.WhatsAppMessage).filter(
        models.WhatsAppMessage.message_id == message_id,
    ).first()
    if not msg:
        return {"ok": False, "error": "message not found"}

    msg.media_url = media_url
    db.commit()
    db.refresh(msg)

    await wa_broadcaster.broadcast("new_message", {
        "contact_id": msg.contact_id,
        "message": {
            "id": msg.id,
            "contact_id": msg.contact_id,
            "lead_id": msg.lead_id,
            "whatsapp_config_id": msg.whatsapp_config_id,
            "direction": msg.direction,
            "message_type": msg.message_type,
            "content": msg.content,
            "media_url": msg.media_url,
            "status": msg.status,
            "is_read": msg.is_read,
            "created_at": msg.created_at.isoformat() if msg.created_at else None,
        },
    })
    return {"ok": True}


@webhook_router.post("/qr-status-update")
async def qr_status_update(body: dict, db: Session = Depends(get_db)):
    """Called by Node service when a sent message is delivered or read."""
    message_id = body.get("message_id")
    status = body.get("status")  # 'sent' | 'delivered' | 'read'
    if not message_id or status not in ("sent", "delivered", "read"):
        return {"ok": False}

    msg = db.query(models.WhatsAppMessage).filter(
        models.WhatsAppMessage.message_id == message_id,
        models.WhatsAppMessage.direction == "out",
    ).first()
    if not msg:
        print(f"[WH] qr-status-update: message_id={message_id} NOT FOUND in DB")
        return {"ok": False, "error": "message not found"}

    # Only advance status, never go backwards (read > delivered > sent > logged)
    order = {"logged": 0, "sent": 1, "delivered": 2, "read": 3}
    current_order = order.get(msg.status or "logged", 0)
    new_order = order.get(status, 0)
    print(f"[WH] qr-status-update: message_id={message_id} {msg.status} -> {status} (current={current_order} new={new_order})")
    if new_order > current_order:
        msg.status = status
        db.commit()
        print(f"[WH] qr-status-update: UPDATED to {status}")
        await wa_broadcaster.broadcast("status_update", {
            "message_id": message_id,
            "db_id": msg.id,
            "contact_id": msg.contact_id,
            "status": status,
        })

    return {"ok": True}


@webhook_router.post("/qr-incoming-call")
async def qr_incoming_call(body: dict, db: Session = Depends(get_db)):
    """Called by Node service when someone calls the QR WhatsApp number."""
    from_phone = (body.get("from_phone") or "").strip()
    call_id = body.get("call_id", "")
    session_id = body.get("session_id", "")
    is_video = bool(body.get("is_video", False))

    if not from_phone:
        return {"ok": False}

    # Normalize phone
    if from_phone and not from_phone.startswith("+"):
        from_phone = "+" + from_phone

    # Find contact name
    contact = db.query(models.Contact).filter(models.Contact.phone == from_phone).first()
    contact_name = contact.name if contact else from_phone
    contact_id = contact.id if contact else None

    await wa_broadcaster.broadcast("incoming_call", {
        "call_id": call_id,
        "session_id": session_id,
        "from_phone": from_phone,
        "contact_name": contact_name,
        "contact_id": contact_id,
        "is_video": is_video,
    })
    return {"ok": True}


@webhook_router.post("/qr-call-ended")
async def qr_call_ended(body: dict):
    """Called when a call times out, is rejected, or accepted."""
    call_id = body.get("call_id", "")
    status = body.get("status", "ended")
    await wa_broadcaster.broadcast("call_ended", {"call_id": call_id, "status": status})
    return {"ok": True}


@router.post("/reject-call")
async def reject_call(body: dict, current_user: models.User = Depends(require_tecnico)):
    """Reject an incoming WhatsApp call via the QR service."""
    session_id = body.get("session_id")
    call_id = body.get("call_id")
    from_phone = body.get("from_phone", "").lstrip("+")
    async with httpx.AsyncClient() as client:
        await client.post(
            f"{QR_SERVICE_URL}/sessions/{session_id}/reject-call",
            json={"callId": call_id, "from": from_phone},
            timeout=5,
        )
    return {"ok": True}
