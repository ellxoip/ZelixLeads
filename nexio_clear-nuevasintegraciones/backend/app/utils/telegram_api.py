"""
Cliente mínimo de la Bot API de Telegram (https://core.telegram.org/bots/api).

Los contactos de Telegram se guardan en Contact.phone como "tg:<chat_id>"
para convivir con el resto del CRM (que indexa por teléfono). Los message_id
se guardan como "tg:<chat_id>:<message_id>" para deduplicar.
"""
import hashlib
import logging
import os
import uuid

import httpx

logger = logging.getLogger("telegram")

API_BASE = "https://api.telegram.org"


def chat_id_from_phone(phone: str) -> str | None:
    """Extrae el chat_id de un phone 'tg:<chat_id>' (tolera '+' inicial)."""
    p = (phone or "").strip().lstrip("+")
    if p.startswith("tg:"):
        return p[3:]
    return None


def phone_from_chat_id(chat_id) -> str:
    return f"tg:{chat_id}"


def webhook_secret(token: str) -> str:
    """Secreto determinístico por bot para validar X-Telegram-Bot-Api-Secret-Token."""
    return hashlib.sha256(f"zelix-tg:{token}".encode()).hexdigest()[:48]


async def tg_call(token: str, method: str, payload: dict | None = None, timeout: float = 25) -> dict | list | None:
    """POST genérico a la Bot API. Devuelve result o None si falla."""
    url = f"{API_BASE}/bot{token}/{method}"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, json=payload or {})
            data = resp.json()
    except Exception as exc:
        logger.warning("Telegram %s error: %s", method, exc)
        return None
    if not data.get("ok"):
        logger.warning("Telegram %s failed: %s", method, data.get("description"))
        return None
    return data.get("result")


async def get_me(token: str) -> dict | None:
    return await tg_call(token, "getMe")


async def set_webhook(token: str, url: str) -> bool:
    res = await tg_call(token, "setWebhook", {
        "url": url,
        "secret_token": webhook_secret(token),
        "allowed_updates": ["message"],
    })
    return bool(res)


async def delete_webhook(token: str) -> bool:
    return bool(await tg_call(token, "deleteWebhook"))


async def get_webhook_info(token: str) -> dict | None:
    return await tg_call(token, "getWebhookInfo")


async def send_text(token: str, phone: str, text: str) -> str | None:
    """Envía texto a un contacto tg:<chat_id>. Devuelve message_id normalizado."""
    chat_id = chat_id_from_phone(phone)
    if not chat_id or not text:
        return None
    result = await tg_call(token, "sendMessage", {"chat_id": chat_id, "text": text})
    if not result:
        return None
    return f"tg:{result['chat']['id']}:{result['message_id']}"


async def send_media_file(token: str, phone: str, local_path: str, mime_type: str, caption: str = "") -> str | None:
    """Envía un archivo local (foto/documento) vía multipart."""
    chat_id = chat_id_from_phone(phone)
    if not chat_id or not os.path.exists(local_path):
        return None
    if mime_type.startswith("image/"):
        method, field = "sendPhoto", "photo"
    elif mime_type.startswith("video/"):
        method, field = "sendVideo", "video"
    elif mime_type.startswith("audio/"):
        method, field = "sendAudio", "audio"
    else:
        method, field = "sendDocument", "document"
    url = f"{API_BASE}/bot{token}/{method}"
    data = {"chat_id": str(chat_id)}
    if caption:
        data["caption"] = caption[:1024]
    try:
        with open(local_path, "rb") as f:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    url, data=data,
                    files={field: (os.path.basename(local_path), f, mime_type)},
                )
        payload = resp.json()
        if not payload.get("ok"):
            logger.warning("Telegram %s failed: %s", method, payload.get("description"))
            return None
        result = payload["result"]
        return f"tg:{result['chat']['id']}:{result['message_id']}"
    except Exception as exc:
        logger.warning("Telegram %s error: %s", method, exc)
        return None


async def get_updates(token: str, offset: int | None = None, timeout: int = 25) -> list | None:
    """Long-poll de updates. None = error de red/API (backoff en el caller)."""
    payload: dict = {"timeout": timeout, "allowed_updates": ["message"]}
    if offset is not None:
        payload["offset"] = offset
    return await tg_call(token, "getUpdates", payload, timeout=timeout + 15)


async def download_file(token: str, file_id: str, dest_dir: str) -> str | None:
    """Descarga un archivo de Telegram a dest_dir. Devuelve el nombre local."""
    info = await tg_call(token, "getFile", {"file_id": file_id})
    if not info or not info.get("file_path"):
        return None
    file_path = info["file_path"]
    ext = os.path.splitext(file_path)[1] or ".bin"
    filename = f"{uuid.uuid4().hex}{ext}"
    os.makedirs(dest_dir, exist_ok=True)
    url = f"{API_BASE}/file/bot{token}/{file_path}"
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return None
            with open(os.path.join(dest_dir, filename), "wb") as f:
                f.write(resp.content)
        return filename
    except Exception as exc:
        logger.warning("Telegram download error: %s", exc)
        return None
