from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, case
from typing import List, Optional
import asyncio
import httpx
import json
import os
import uuid
import mimetypes
from datetime import datetime, timezone
from ..database import get_db
from .. import models, schemas
from ..auth import get_current_user, get_visible_group_ids, require_roles, SECRET_KEY, ALGORITHM
from ..broadcaster import wa_broadcaster

UPLOADS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../uploads"))
MEDIA_DIR = os.path.join(UPLOADS_DIR, "whatsapp_media")

router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp"])


QR_SERVICE_URL = os.getenv("QR_SERVICE_URL", "http://localhost:3005")


async def send_whatsapp_api(config: models.WhatsAppConfig, phone: str, message: str) -> dict:
    """Send via Meta WhatsApp Cloud API, QR session, or log only."""
    if config.api_provider == "meta" and config.api_token and config.phone_number_id:
        phone_clean = phone.replace("+", "").replace(" ", "").replace("-", "")
        url = f"https://graph.facebook.com/v18.0/{config.phone_number_id}/messages"
        payload = {
            "messaging_product": "whatsapp",
            "to": phone_clean,
            "type": "text",
            "text": {"body": message}
        }
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=payload, headers={"Authorization": f"Bearer {config.api_token}"})
            if resp.status_code == 200:
                return {"status": "sent", "message_id": resp.json().get("messages", [{}])[0].get("id")}

    if config.api_provider == "telegram" and config.api_token:
        from ..utils.telegram_api import send_text
        mid = await send_text(config.api_token, phone, message)
        if mid:
            return {"status": "sent", "message_id": mid}
        return {"status": "failed", "message_id": None}

    if config.api_provider == "qr":
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{QR_SERVICE_URL}/sessions/{config.id}/send",
                    json={"to": phone, "message": message},
                    timeout=10,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    return {"status": "sent", "message_id": data.get("message_id")}
                else:
                    print(f"[WA] QR send failed {resp.status_code}: {resp.text}")
        except Exception as e:
            print(f"[WA] QR send exception: {e}")

    return {"status": "logged", "message_id": None}


async def upload_media_to_meta(config: models.WhatsAppConfig, file_path: str, mime_type: str) -> Optional[str]:
    """Upload a local file to Meta media API and return the media_id."""
    if config.api_provider != "meta" or not config.api_token or not config.phone_number_id:
        return None
    url = f"https://graph.facebook.com/v18.0/{config.phone_number_id}/media"
    with open(file_path, "rb") as f:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                url,
                headers={"Authorization": f"Bearer {config.api_token}"},
                data={"messaging_product": "whatsapp"},
                files={"file": (os.path.basename(file_path), f, mime_type)},
            )
            if resp.status_code == 200:
                return resp.json().get("id")
    return None


async def send_whatsapp_media_api(config: models.WhatsAppConfig, phone: str, media_id: str, mime_type: str, caption: str = "") -> dict:
    """Send a media message via Meta WhatsApp Cloud API."""
    if not config.api_token or not config.phone_number_id:
        return {"status": "logged", "message_id": None}
    phone_clean = phone.replace("+", "").replace(" ", "").replace("-", "")
    url = f"https://graph.facebook.com/v18.0/{config.phone_number_id}/messages"
    if mime_type.startswith("image/"):
        msg_type = "image"
        media_key = "image"
    elif mime_type.startswith("audio/"):
        msg_type = "audio"
        media_key = "audio"
    elif mime_type.startswith("video/"):
        msg_type = "video"
        media_key = "video"
    else:
        msg_type = "document"
        media_key = "document"
    payload: dict = {
        "messaging_product": "whatsapp",
        "to": phone_clean,
        "type": msg_type,
        media_key: {"id": media_id},
    }
    if caption and msg_type in ("image", "video", "document"):
        payload[media_key]["caption"] = caption
    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json=payload, headers={"Authorization": f"Bearer {config.api_token}"})
        if resp.status_code == 200:
            return {"status": "sent", "message_id": resp.json().get("messages", [{}])[0].get("id")}
    return {"status": "logged", "message_id": None}


def _qr_session_connected(cfg: models.WhatsAppConfig) -> bool | None:
    """
    Salud de la sesión QR de una config: True conectada, False explícitamente
    caída, None desconocido (servicio no responde / provider no-qr). Solo un
    False explícito descarta la config — si el servicio QR no contesta, no se
    castiga a la config (mejor intentar el envío que no enviar nada).
    """
    if cfg.api_provider != "qr":
        return None
    try:
        with httpx.Client(timeout=3) as client:
            resp = client.get(f"{QR_SERVICE_URL}/sessions/{cfg.id}/status")
        if resp.status_code == 200:
            return resp.json().get("status") == "connected"
        return False
    except Exception:
        return None


def resolve_wa_config(db: Session, contact_id: int | None = None,
                      area_id: int | None = None, group_id: int | None = None):
    """
    Resolución CENTRAL de config WhatsApp para envíos automáticos, en orden:
      1. La config del último mensaje confirmado del contacto (la sesión por
         la que realmente conversa — sent/delivered/read/received).
      2. Configs activas del área.
      3. Configs activas del grupo.
      4. Cualquier config activa.
    Recorre los candidatos SIN repetir y descarta los que tengan la sesión QR
    explícitamente caída. Si todos están caídos devuelve el primero igual
    (best-effort) y solo devuelve None si no hay ninguna config activa.
    """
    candidates: list[models.WhatsAppConfig] = []
    seen: set[int] = set()

    def _add(cfg):
        if cfg is not None and cfg.id not in seen and cfg.is_active:
            seen.add(cfg.id)
            candidates.append(cfg)

    if contact_id:
        last_ok = (
            db.query(models.WhatsAppMessage)
            .filter(
                models.WhatsAppMessage.contact_id == contact_id,
                models.WhatsAppMessage.whatsapp_config_id.isnot(None),
                models.WhatsAppMessage.status.in_(("sent", "delivered", "read", "received")),
            )
            .order_by(models.WhatsAppMessage.id.desc())
            .first()
        )
        if last_ok:
            _add(db.query(models.WhatsAppConfig).filter(
                models.WhatsAppConfig.id == last_ok.whatsapp_config_id
            ).first())

    if area_id:
        from sqlalchemy.orm import joinedload as _jl
        area = db.query(models.Area).options(
            _jl(models.Area.phone_configs)
        ).filter(models.Area.id == area_id).first()
        if area:
            for c in area.phone_configs:
                _add(c)

    if group_id:
        for c in db.query(models.WhatsAppConfig).filter(
            models.WhatsAppConfig.group_id == group_id,
            models.WhatsAppConfig.is_active == True,  # noqa: E712
        ).all():
            _add(c)

    for c in db.query(models.WhatsAppConfig).filter(
        models.WhatsAppConfig.is_active == True,  # noqa: E712
    ).all():
        _add(c)

    if not candidates:
        return None
    for cfg in candidates:
        if _qr_session_connected(cfg) is not False:
            return cfg
    return candidates[0]  # todos caídos: best-effort con el de mayor prioridad


async def send_whatsapp_media_file(config: models.WhatsAppConfig, phone: str, local_path: str, mime_type: str, caption: str = "") -> dict:
    """Send a local media file via the config's provider (meta o qr). Devuelve
    {"status", "message_id"} — "logged" si el provider no soporta media o falla."""
    result = {"status": "logged", "message_id": None}
    if config.api_provider == "telegram" and config.api_token:
        from ..utils.telegram_api import send_media_file
        mid = await send_media_file(config.api_token, phone, local_path, mime_type, caption)
        if mid:
            result = {"status": "sent", "message_id": mid}
    elif config.api_provider == "meta" and config.api_token and config.phone_number_id:
        media_id = await upload_media_to_meta(config, local_path, mime_type)
        if media_id:
            result = await send_whatsapp_media_api(config, phone, media_id, mime_type, caption)
    elif config.api_provider == "qr":
        import base64 as _b64
        with open(local_path, "rb") as f:
            file_b64 = _b64.b64encode(f.read()).decode()
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{QR_SERVICE_URL}/sessions/{config.id}/send-file",
                    json={
                        "to": phone,
                        "mimeType": mime_type,
                        "base64": file_b64,
                        "filename": os.path.basename(local_path),
                        "caption": caption,
                    },
                    timeout=30,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    result = {"status": "sent", "message_id": data.get("message_id")}
        except Exception:
            pass
    return result


@router.post("/send-media")
async def send_media_message(
    contact_id: int = Form(...),
    whatsapp_config_id: int = Form(...),
    lead_id: Optional[int] = Form(None),
    caption: str = Form(""),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    contact = db.query(models.Contact).filter(models.Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contacto no encontrado")

    config = db.query(models.WhatsAppConfig).filter(models.WhatsAppConfig.id == whatsapp_config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Configuración WhatsApp no encontrada")

    # Save file locally
    os.makedirs(MEDIA_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename or "")[1] or mimetypes.guess_extension(file.content_type or "") or ""
    filename = f"{uuid.uuid4().hex}{ext}"
    local_path = os.path.join(MEDIA_DIR, filename)
    content = await file.read()
    with open(local_path, "wb") as f:
        f.write(content)

    media_url = f"/uploads/whatsapp_media/{filename}"
    mime_type = file.content_type or "application/octet-stream"

    # Determine message_type
    if mime_type.startswith("image/"):
        message_type = "image"
    elif mime_type.startswith("audio/"):
        message_type = "audio"
    elif mime_type.startswith("video/"):
        message_type = "video"
    else:
        message_type = "document"

    # Send via the appropriate provider
    result = {"status": "logged", "message_id": None}
    if config.api_provider == "meta" and config.api_token and config.phone_number_id:
        media_id = await upload_media_to_meta(config, local_path, mime_type)
        if media_id:
            result = await send_whatsapp_media_api(config, contact.phone, media_id, mime_type, caption)
    elif config.api_provider == "qr":
        import base64 as _b64
        with open(local_path, "rb") as f:
            file_b64 = _b64.b64encode(f.read()).decode()
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{QR_SERVICE_URL}/sessions/{config.id}/send-file",
                    json={
                        "to": contact.phone,
                        "mimeType": mime_type,
                        "base64": file_b64,
                        "filename": file.filename or f"archivo{ext}",
                        "caption": caption,
                    },
                    timeout=30,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    result = {"status": "sent", "message_id": data.get("message_id")}
        except Exception:
            result = {"status": "logged", "message_id": None}

    msg = models.WhatsAppMessage(
        lead_id=lead_id,
        contact_id=contact_id,
        whatsapp_config_id=whatsapp_config_id,
        direction="out",
        message_type=message_type,
        content=caption or file.filename or message_type,
        status=result["status"],
        sent_by=current_user.id,
        message_id=result.get("message_id"),
        media_url=media_url,
    )
    if lead_id:
        active_lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
        if active_lead:
            active_lead.updated_at = datetime.now(timezone.utc)
    db.add(msg)
    db.commit()
    db.refresh(msg)

    return schemas.WhatsAppMessageOut.model_validate(msg)


@router.get("/stream")
async def whatsapp_sse(token: str = Query(...)):
    """SSE stream — pushes new_message and status_update events in real time."""
    import jwt as _jwt
    from ..database import SessionLocal
    try:
        payload = _jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Token inválido")
        _db = SessionLocal()
        try:
            user = _db.query(models.User).filter(models.User.id == int(user_id)).first()
        finally:
            _db.close()
        if not user or not user.is_active:
            raise HTTPException(status_code=401, detail="Usuario inactivo")
    except _jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Token inválido")

    q = wa_broadcaster.subscribe()

    async def generator():
        try:
            yield f"data: {json.dumps({'type': 'connected'})}\n\n"
            while True:
                try:
                    payload_str = await asyncio.wait_for(q.get(), timeout=20)
                    yield f"data: {payload_str}\n\n"
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'type': 'keepalive'})}\n\n"
        except (asyncio.CancelledError, GeneratorExit):
            pass
        finally:
            wa_broadcaster.unsubscribe(q)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/messages", response_model=List[schemas.WhatsAppMessageOut])
def list_messages(
    lead_id: Optional[int] = None,
    contact_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    from sqlalchemy import or_
    from ..models import Lead

    # Resolve contact_id from lead_id when needed
    resolved_contact_id = contact_id
    if lead_id and not contact_id:
        lead = db.query(Lead).filter(Lead.id == lead_id).first()
        if lead:
            resolved_contact_id = lead.contact_id

    # Collect all lead_ids for this contact so we catch messages stored only by lead_id
    contact_lead_ids: list[int] = []
    if resolved_contact_id:
        contact_lead_ids = [
            r.id for r in db.query(Lead.id).filter(Lead.contact_id == resolved_contact_id).all()
        ]

    q = db.query(models.WhatsAppMessage)
    if resolved_contact_id and contact_lead_ids:
        q = q.filter(or_(
            models.WhatsAppMessage.contact_id == resolved_contact_id,
            models.WhatsAppMessage.lead_id.in_(contact_lead_ids),
        ))
    elif resolved_contact_id:
        q = q.filter(models.WhatsAppMessage.contact_id == resolved_contact_id)
    elif lead_id:
        q = q.filter(models.WhatsAppMessage.lead_id == lead_id)

    return q.order_by(models.WhatsAppMessage.created_at.desc()).limit(200).all()


@router.post("/send", response_model=schemas.WhatsAppMessageOut)
async def send_message(
    data: schemas.WhatsAppSendMessage,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    contact = db.query(models.Contact).filter(models.Contact.id == data.contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contacto no encontrado")

    config = db.query(models.WhatsAppConfig).filter(models.WhatsAppConfig.id == data.whatsapp_config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Configuración WhatsApp no encontrada")

    result = await send_whatsapp_api(config, contact.phone, data.message)

    msg = models.WhatsAppMessage(
        lead_id=data.lead_id,
        contact_id=data.contact_id,
        whatsapp_config_id=data.whatsapp_config_id,
        direction="out",
        message_type=data.message_type,
        content=data.message,
        status=result["status"],
        sent_by=current_user.id,
        message_id=result.get("message_id"),
    )
    if data.lead_id:
        active_lead = db.query(models.Lead).filter(models.Lead.id == data.lead_id).first()
        if active_lead:
            active_lead.updated_at = datetime.now(timezone.utc)
    db.add(msg)
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

    return msg


@router.get("/configs")
async def list_all_configs(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    q = db.query(models.WhatsAppConfig).filter(models.WhatsAppConfig.is_active == True)
    if current_user.role not in ("superadmin", "subadmin", "tecnico"):
        q = q.filter((models.WhatsAppConfig.group_id == current_user.group_id) | (models.WhatsAppConfig.group_id == None))
    configs = q.all()

    result = []
    for c in configs:
        # For QR-based configs, verify the session is actually connected in the Node service.
        # This handles the case where the QR service restarts or disconnects without updating
        # is_active in the DB — so conversations don't show for disconnected sessions.
        # Skip manual/placeholder configs with no real token (they can't send/receive)
        if c.api_provider == "manual" and not (c.api_token and c.phone_number_id):
            continue

        # For QR-based configs, verify the session is actually connected in the Node service.
        # This handles the case where the QR service restarts or disconnects without updating
        # is_active in the DB — so conversations don't show for disconnected sessions.
        if c.api_provider == "qr":
            try:
                async with httpx.AsyncClient() as client:
                    r = await client.get(f"{QR_SERVICE_URL}/sessions/{c.id}/status", timeout=3)
                    live_status = r.json().get("status", "")
                if live_status != "connected":
                    continue  # Skip: QR not connected — hide from configs list
            except Exception:
                continue  # QR service unreachable — treat as disconnected

        result.append({
            "id": c.id,
            "name": c.name,
            "phone_number": c.phone_number,
            "phone_number_id": c.phone_number_id,
            "api_provider": c.api_provider,
            "group_id": c.group_id,
            "group_name": c.group.name if c.group else None,
            "is_active": c.is_active,
        })
    return result


@router.get("/available")
def get_available_configs(
    exclude_area_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """All active WA configs — a number can be shared across multiple areas."""
    q = db.query(models.WhatsAppConfig).filter(models.WhatsAppConfig.is_active == True)
    return [
        {
            "id": c.id,
            "phone_number": c.phone_number,
            "api_provider": c.api_provider,
            "name": c.name,
            "group_id": c.group_id,
            "group_name": c.group.name if c.group else None,
        }
        for c in q.all()
    ]


@router.get("/unread-by-contact")
def unread_by_contact(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Return {contact_id: unread_count} for contacts with unread incoming messages."""
    gids = get_visible_group_ids(db, current_user)
    q = (
        db.query(
            models.WhatsAppMessage.contact_id,
            func.count(models.WhatsAppMessage.id).label("cnt"),
        )
        .filter(
            models.WhatsAppMessage.direction == "in",
            models.WhatsAppMessage.is_read == False,
        )
    )
    if gids is not None:
        q = q.join(models.Contact, models.WhatsAppMessage.contact_id == models.Contact.id, isouter=True).filter(
            models.Contact.group_id.in_(gids)
        )
    rows = q.group_by(models.WhatsAppMessage.contact_id).all()
    return {str(row.contact_id): row.cnt for row in rows}


@router.get("/conversations")
def get_conversations(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Return one entry per contact with last message preview and unread count.
    Only shows conversations whose messages are linked to an existing WhatsApp config.
    When a config is deleted/disconnected, its conversations disappear automatically.
    """
    # Subquery: latest message timestamp per contact — only for messages with an existing config
    latest_subq = (
        db.query(
            models.WhatsAppMessage.contact_id,
            func.max(models.WhatsAppMessage.created_at).label("last_at"),
        )
        .join(models.WhatsAppConfig, models.WhatsAppMessage.whatsapp_config_id == models.WhatsAppConfig.id)
        .group_by(models.WhatsAppMessage.contact_id)
        .subquery()
    )

    # Subquery: unread count per contact — only for messages with an existing config
    unread_subq = (
        db.query(
            models.WhatsAppMessage.contact_id,
            func.count(models.WhatsAppMessage.id).label("unread"),
        )
        .join(models.WhatsAppConfig, models.WhatsAppMessage.whatsapp_config_id == models.WhatsAppConfig.id)
        .filter(
            models.WhatsAppMessage.direction == "in",
            models.WhatsAppMessage.is_read == False,
        )
        .group_by(models.WhatsAppMessage.contact_id)
        .subquery()
    )

    rows = (
        db.query(models.Contact, latest_subq.c.last_at, unread_subq.c.unread)
        .join(latest_subq, models.Contact.id == latest_subq.c.contact_id)
        .outerjoin(unread_subq, models.Contact.id == unread_subq.c.contact_id)
        .order_by(latest_subq.c.last_at.desc())
        .all()
    )

    gids = get_visible_group_ids(db, current_user)
    result = []
    for contact, last_at, unread in rows:
        # Filter by group
        if gids is not None and contact.group_id not in gids:
            continue

        last_msg = (
            db.query(models.WhatsAppMessage)
            .join(models.WhatsAppConfig, models.WhatsAppMessage.whatsapp_config_id == models.WhatsAppConfig.id)
            .filter(models.WhatsAppMessage.contact_id == contact.id)
            .order_by(models.WhatsAppMessage.created_at.desc())
            .first()
        )
        active_lead = (
            db.query(models.Lead)
            .filter(
                models.Lead.contact_id == contact.id,
                models.Lead.current_stage.notin_(["pagado_confirmado"]),
            )
            .order_by(models.Lead.created_at.desc())
            .first()
        )
        result.append({
            "contact": {
                "id": contact.id,
                "name": contact.name,
                "phone": contact.phone,
                "avatar_url": contact.avatar_url,
            },
            "last_message": last_msg.content if last_msg else "",
            "last_message_at": last_at.isoformat() if last_at else None,
            "last_direction": last_msg.direction if last_msg else "out",
            "unread_count": unread or 0,
            "lead_id": active_lead.id if active_lead else None,
            "whatsapp_config_id": last_msg.whatsapp_config_id if last_msg else None,
        })

    return result


@router.post("/messages/{message_id}/retry", response_model=schemas.WhatsAppMessageOut)
async def retry_message(
    message_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Re-send a 'logged' (unsent) outgoing message via the QR service."""
    msg = db.query(models.WhatsAppMessage).filter(
        models.WhatsAppMessage.id == message_id,
        models.WhatsAppMessage.direction == "out",
        models.WhatsAppMessage.status == "logged",
    ).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Mensaje no encontrado o no está en estado 'logged'")

    contact = db.query(models.Contact).filter(models.Contact.id == msg.contact_id).first()
    config = db.query(models.WhatsAppConfig).filter(models.WhatsAppConfig.id == msg.whatsapp_config_id).first()
    if not contact or not config:
        raise HTTPException(status_code=404, detail="Contacto o configuración no encontrada")

    result = await send_whatsapp_api(config, contact.phone, msg.content)
    if result["status"] != "logged":
        msg.status = result["status"]
        msg.message_id = result.get("message_id")
        db.commit()
        db.refresh(msg)

    return msg


@router.delete("/messages/{message_id}")
def delete_message(
    message_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    msg = db.query(models.WhatsAppMessage).filter(models.WhatsAppMessage.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Mensaje no encontrado")
    db.delete(msg)
    db.commit()
    return {"status": "deleted"}


@router.patch("/messages/{message_id}")
def edit_message(
    message_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    msg = db.query(models.WhatsAppMessage).filter(models.WhatsAppMessage.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Mensaje no encontrado")
    if msg.direction != "out":
        raise HTTPException(status_code=403, detail="Solo puedes editar mensajes enviados")
    new_content = (body.get("content") or "").strip()
    if not new_content:
        raise HTTPException(status_code=400, detail="Contenido vacío")
    msg.content = new_content
    db.commit()
    db.refresh(msg)
    return schemas.WhatsAppMessageOut.model_validate(msg)


@router.post("/messages/{contact_id}/read")
async def mark_messages_read(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Mark all incoming messages from a contact as read and send blue ticks via QR."""
    # Get unread incoming messages with their message_ids and config info
    unread_msgs = db.query(models.WhatsAppMessage).filter(
        models.WhatsAppMessage.contact_id == contact_id,
        models.WhatsAppMessage.direction == "in",
        models.WhatsAppMessage.is_read == False,
    ).all()

    if not unread_msgs:
        return {"status": "ok", "read": 0}

    # Mark as read in DB
    for m in unread_msgs:
        m.is_read = True
    db.commit()

    # Send read receipts via QR service for each config used
    # Group message_ids by whatsapp_config_id
    from collections import defaultdict
    by_config: dict = defaultdict(list)
    for m in unread_msgs:
        if m.message_id and m.whatsapp_config_id:
            by_config[m.whatsapp_config_id].append(m.message_id)

    # Get contact phone
    contact = db.query(models.Contact).filter(models.Contact.id == contact_id).first()
    if contact and contact.phone:
        phone = contact.phone.replace("+", "").replace(" ", "").replace("-", "")
        for config_id, msg_ids in by_config.items():
            config = db.query(models.WhatsAppConfig).filter(
                models.WhatsAppConfig.id == config_id,
                models.WhatsAppConfig.api_provider == "qr",
            ).first()
            if not config:
                continue
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    await client.post(
                        f"{QR_SERVICE_URL}/sessions/{config.id}/mark-read",
                        json={"to": phone, "message_ids": msg_ids},
                    )
            except Exception as e:
                print(f"[WA] mark-read QR error config={config_id}: {e}")

    return {"status": "ok", "read": len(unread_msgs)}


@router.post("/sync-chats/{config_id}")
async def sync_chats(
    config_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Ask QR service to re-push all cached chats to the CRM."""
    cfg = db.query(models.WhatsAppConfig).filter(
        models.WhatsAppConfig.id == config_id,
        models.WhatsAppConfig.api_provider == "qr",
    ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Config no encontrada")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{QR_SERVICE_URL}/sessions/{config_id}/sync-chats")
            data = resp.json()
        return {"ok": True, "pushed": data.get("pushed", 0)}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/typing")
async def send_typing(
    data: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Send composing/paused presence to a contact so they see 'Escribiendo...'"""
    config_id = data.get("config_id")
    contact_id = data.get("contact_id")
    typing = data.get("typing", True)
    if not config_id or not contact_id:
        raise HTTPException(status_code=400, detail="config_id y contact_id requeridos")
    cfg = db.query(models.WhatsAppConfig).filter(
        models.WhatsAppConfig.id == config_id,
        models.WhatsAppConfig.api_provider == "qr",
    ).first()
    if not cfg:
        return {"ok": False}
    contact = db.query(models.Contact).filter(models.Contact.id == contact_id).first()
    if not contact:
        return {"ok": False}
    phone = contact.phone.lstrip("+")
    jid = f"{phone}@s.whatsapp.net"
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(
                f"{QR_SERVICE_URL}/sessions/{config_id}/presence",
                json={"jid": jid, "type": "composing" if typing else "paused"},
            )
        return {"ok": True}
    except Exception:
        return {"ok": False}


@router.post("/sync-full-history/{config_id}")
async def sync_full_history(
    config_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin")),
):
    """Full history sync: re-import all messages from the QR service msgStore (up to 6 months)
    and push all known contacts. Broadcasts a refresh event when done."""
    cfg = db.query(models.WhatsAppConfig).filter(
        models.WhatsAppConfig.id == config_id,
        models.WhatsAppConfig.api_provider == "qr",
    ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Config no encontrada")
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            # 1) Push contact stubs (chats.upsert cache)
            chats_resp = await client.post(f"{QR_SERVICE_URL}/sessions/{config_id}/sync-chats")
            chats_data = chats_resp.json()
            # 2) Re-import all messages from in-memory msgStore
            msgs_resp = await client.post(f"{QR_SERVICE_URL}/sessions/{config_id}/sync-msgstore")
            msgs_data = msgs_resp.json()
        # Fire a final refresh so all clients update immediately
        await wa_broadcaster.broadcast("refresh", {})
        return {
            "ok": True,
            "contacts_pushed": chats_data.get("pushed", 0),
            "messages_pushed": msgs_data.get("pushed", 0),
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
