"""Meta WhatsApp Business API webhook receiver."""
import os
import uuid
import logging
import httpx
from typing import Optional
from fastapi import APIRouter, Request, Query, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from ..database import SessionLocal
from .. import models
from ..broadcaster import wa_broadcaster

UPLOADS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../uploads"))
MEDIA_DIR = os.path.join(UPLOADS_DIR, "whatsapp_media")

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/webhook", tags=["webhook"])

VERIFY_TOKEN = os.getenv("WHATSAPP_VERIFY_TOKEN", "crm_abogados_tributarios_2024")


def _normalize_phone(phone: str) -> str:
    """Strip non-digits and ensure leading +."""
    digits = "".join(c for c in phone if c.isdigit())
    return f"+{digits}"


def _get_or_create_contact(db: Session, phone: str, name: str, config: models.WhatsAppConfig) -> models.Contact:
    normalized = _normalize_phone(phone)
    contact = db.query(models.Contact).filter(models.Contact.phone == normalized).first()
    if contact:
        return contact

    # Find a system user to be the creator (first superadmin, fallback to any user)
    creator = (
        db.query(models.User).filter(models.User.role == "superadmin").first()
        or db.query(models.User).first()
    )
    if not creator:
        raise ValueError("No users in DB to assign as contact creator")

    contact = models.Contact(
        name=name or normalized,
        phone=normalized,
        group_id=config.group_id,
        created_by=creator.id,
    )
    db.add(contact)
    db.flush()
    return contact


def _get_active_lead(db: Session, contact_id: int, config_id: int | None = None) -> models.Lead | None:
    """Return the most recent non-closed lead for a contact.

    When config_id is provided, prefer the lead whose area is linked to that
    WhatsApp config (via junction table or legacy FK), so routing is correct
    when one contact has leads across multiple areas.
    """
    base = (
        db.query(models.Lead)
        .filter(
            models.Lead.contact_id == contact_id,
            models.Lead.current_stage.notin_(["pagado_confirmado"]),
        )
    )
    if config_id:
        from sqlalchemy import exists
        # Prefer a lead whose area uses this config via junction table
        preferred = (
            base.join(models.Lead.area)
            .filter(
                exists().where(
                    (models.area_phone_numbers.c.area_id == models.Area.id) &
                    (models.area_phone_numbers.c.whatsapp_config_id == config_id)
                )
            )
            .order_by(models.Lead.created_at.desc())
            .first()
        )
        if preferred:
            return preferred
        # Fallback: legacy FK match
        preferred_legacy = (
            base.join(models.Lead.area)
            .filter(models.Area.whatsapp_config_id == config_id)
            .order_by(models.Lead.created_at.desc())
            .first()
        )
        if preferred_legacy:
            return preferred_legacy
    # No config match — return most recent active lead
    return base.order_by(models.Lead.created_at.desc()).first()


def _notify_agendadoras(db: Session, config: models.WhatsAppConfig, contact: models.Contact, preview: str):
    """Send in-app notification + push to all agendadoras of the group."""
    from ..utils.notifications import create_notification
    agendadoras = (
        db.query(models.User)
        .filter(
            models.User.group_id == config.group_id,
            models.User.role == "agendadora",
            models.User.is_active == True,
        )
        .all()
    )
    for agend in agendadoras:
        create_notification(
            db,
            user_id=agend.id,
            title=f"Nuevo mensaje de {contact.name}",
            message=preview[:120],
            notification_type="general",
        )


async def _download_meta_media(media_id: str, api_token: str) -> Optional[str]:
    """Download media from Meta API, save locally, return relative URL or None."""
    try:
        os.makedirs(MEDIA_DIR, exist_ok=True)
        async with httpx.AsyncClient() as client:
            # Step 1: get download URL
            info_resp = await client.get(
                f"https://graph.facebook.com/v18.0/{media_id}",
                headers={"Authorization": f"Bearer {api_token}"},
            )
            if info_resp.status_code != 200:
                return None
            info = info_resp.json()
            download_url = info.get("url")
            mime_type = info.get("mime_type", "application/octet-stream")
            if not download_url:
                return None

            # Step 2: download binary
            dl_resp = await client.get(download_url, headers={"Authorization": f"Bearer {api_token}"})
            if dl_resp.status_code != 200:
                return None

            # Determine extension from mime
            ext_map = {
                "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
                "audio/ogg": ".ogg", "audio/mpeg": ".mp3", "audio/mp4": ".m4a",
                "video/mp4": ".mp4",
                "application/pdf": ".pdf",
            }
            ext = ext_map.get(mime_type, "")
            filename = f"{uuid.uuid4().hex}{ext}"
            local_path = os.path.join(MEDIA_DIR, filename)
            with open(local_path, "wb") as f:
                f.write(dl_resp.content)
            return f"/uploads/whatsapp_media/{filename}"
    except Exception as e:
        logger.warning(f"Failed to download Meta media {media_id}: {e}")
        return None


@router.get("/whatsapp", response_class=PlainTextResponse)
def verify_webhook(
    hub_mode: str = Query(alias="hub.mode", default=""),
    hub_challenge: str = Query(alias="hub.challenge", default=""),
    hub_verify_token: str = Query(alias="hub.verify_token", default=""),
):
    if hub_mode == "subscribe" and hub_verify_token == VERIFY_TOKEN:
        logger.info("Webhook verified successfully")
        return hub_challenge
    logger.warning("Webhook verification failed: token mismatch")
    raise HTTPException(status_code=403, detail="Invalid verify token")


@router.post("/whatsapp", status_code=200)
async def receive_message(request: Request):
    """Process incoming WhatsApp messages from Meta Cloud API."""
    try:
        body = await request.json()
    except Exception:
        return {"status": "ignored"}

    if body.get("object") != "whatsapp_business_account":
        return {"status": "ignored"}

    db: Session = SessionLocal()
    try:
        for entry in body.get("entry", []):
            for change in entry.get("changes", []):
                if change.get("field") != "messages":
                    continue

                value = change.get("value", {})
                metadata = value.get("metadata", {})
                phone_number_id = metadata.get("phone_number_id", "")

                # Match our WhatsApp config by phone_number_id
                config = (
                    db.query(models.WhatsAppConfig)
                    .filter(models.WhatsAppConfig.phone_number_id == phone_number_id)
                    .first()
                )
                # Fallback: match by display_phone_number
                if not config:
                    display_phone = _normalize_phone(metadata.get("display_phone_number", ""))
                    config = (
                        db.query(models.WhatsAppConfig)
                        .filter(models.WhatsAppConfig.phone_number == display_phone)
                        .first()
                    )
                if not config:
                    logger.warning(f"No config found for phone_number_id={phone_number_id}")
                    continue

                contacts_map = {
                    c["wa_id"]: c["profile"]["name"]
                    for c in value.get("contacts", [])
                    if "wa_id" in c
                }

                for msg in value.get("messages", []):
                    msg_type = msg.get("type", "text")
                    wamid = msg.get("id", "")
                    from_phone = msg.get("from", "")

                    # Deduplicate
                    if wamid and db.query(models.WhatsAppMessage).filter(
                        models.WhatsAppMessage.message_id == wamid
                    ).first():
                        continue

                    # Extract content and media
                    media_url: Optional[str] = None
                    if msg_type == "text":
                        content = msg.get("text", {}).get("body", "")
                    elif msg_type == "image":
                        img_data = msg.get("image", {})
                        caption = img_data.get("caption", "")
                        content = caption or "[Imagen]"
                        if config.api_token and img_data.get("id"):
                            media_url = await _download_meta_media(img_data["id"], config.api_token)
                    elif msg_type == "audio":
                        audio_data = msg.get("audio", {})
                        content = "[Audio]"
                        if config.api_token and audio_data.get("id"):
                            media_url = await _download_meta_media(audio_data["id"], config.api_token)
                    elif msg_type == "video":
                        video_data = msg.get("video", {})
                        content = video_data.get("caption", "[Video]") or "[Video]"
                        if config.api_token and video_data.get("id"):
                            media_url = await _download_meta_media(video_data["id"], config.api_token)
                    elif msg_type == "document":
                        doc_data = msg.get("document", {})
                        content = f"[Documento: {doc_data.get('filename', '')}]"
                        if config.api_token and doc_data.get("id"):
                            media_url = await _download_meta_media(doc_data["id"], config.api_token)
                    elif msg_type == "sticker":
                        content = "[Sticker]"
                        sticker_data = msg.get("sticker", {})
                        if config.api_token and sticker_data.get("id"):
                            media_url = await _download_meta_media(sticker_data["id"], config.api_token)
                    else:
                        content = f"[{msg_type}]"

                    if not content:
                        continue

                    sender_name = contacts_map.get(from_phone, from_phone)
                    contact = _get_or_create_contact(db, from_phone, sender_name, config)
                    active_lead = _get_active_lead(db, contact.id, config_id=config.id)

                    message = models.WhatsAppMessage(
                        lead_id=active_lead.id if active_lead else None,
                        contact_id=contact.id,
                        whatsapp_config_id=config.id,
                        direction="in",
                        message_type=msg_type,
                        content=content,
                        status="received",
                        message_id=wamid or None,
                        is_read=False,
                        media_url=media_url,
                    )
                    if active_lead:
                        active_lead.updated_at = datetime.now(timezone.utc)
                    db.add(message)
                    db.flush()

                    _notify_agendadoras(db, config, contact, content)

        db.commit()
        await wa_broadcaster.broadcast("refresh", {})
    except Exception as e:
        db.rollback()
        logger.error(f"Webhook processing error: {e}")
    finally:
        db.close()

    # Always return 200 to Meta to avoid retries
    return {"status": "ok"}
