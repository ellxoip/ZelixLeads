"""
Google Calendar OAuth2 integration.
Uses httpx (already in requirements) — no extra Google SDK needed.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session
from datetime import datetime, timezone, timedelta
from typing import Optional
import httpx
import logging

logger = logging.getLogger("nexio.google")

from ..database import get_db
from .. import models
from ..auth import get_current_user

router = APIRouter(prefix="/api/google", tags=["google"])

GOOGLE_AUTH_URL    = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL   = "https://oauth2.googleapis.com/token"
GOOGLE_CALENDAR    = "https://www.googleapis.com/calendar/v3"
GOOGLE_USERINFO    = "https://www.googleapis.com/oauth2/v2/userinfo"
SCOPES = " ".join([
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/userinfo.email",
])

SCOPES_GMAIL = " ".join([
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/userinfo.email",
])


# ── Helpers ─────────────────────────────────────────────────

def _get_setting(db: Session, key: str) -> Optional[str]:
    s = db.query(models.AppSetting).filter(models.AppSetting.key == key).first()
    return s.value if s else None


def _get_credentials(db: Session):
    client_id     = _get_setting(db, "google_client_id")
    client_secret = _get_setting(db, "google_client_secret")
    redirect_uri  = _get_setting(db, "google_redirect_uri")
    if not client_id or not client_secret or not redirect_uri:
        raise HTTPException(
            status_code=503,
            detail="Google Calendar no configurado. El técnico debe ingresar las credenciales OAuth2.",
        )
    return client_id, client_secret, redirect_uri


async def _refresh_access_token(token: models.GoogleCalendarToken, db: Session):
    """Refresh the access token if it's expired or about to expire."""
    now = datetime.now(timezone.utc)
    expiry = token.token_expiry
    if expiry and token.access_token:
        # Add timezone info if missing (SQLite stores without tz)
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        if expiry > now + timedelta(minutes=5):
            return True  # still valid — usable even sin refresh_token
    if not token.refresh_token:
        return False

    client_id, client_secret, _ = _get_credentials(db)
    async with httpx.AsyncClient() as client:
        resp = await client.post(GOOGLE_TOKEN_URL, data={
            "grant_type":    "refresh_token",
            "refresh_token": token.refresh_token,
            "client_id":     client_id,
            "client_secret": client_secret,
        })
    if resp.status_code != 200:
        return False
    data = resp.json()
    token.access_token = data["access_token"]
    token.token_expiry = datetime.now(timezone.utc) + timedelta(seconds=data.get("expires_in", 3600))
    db.commit()
    return True


# ── Routes ─────────────────────────────────────────────────

@router.get("/status")
def google_status(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    token = db.query(models.GoogleCalendarToken).filter(
        models.GoogleCalendarToken.user_id == current_user.id
    ).first()
    configured = bool(_get_setting(db, "google_client_id"))
    return {
        "configured": configured,
        "connected": bool(token),
        "google_email": token.google_email if token else None,
        "calendar_id": token.google_calendar_id if token else None,
    }


@router.get("/auth-url")
def get_auth_url(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    client_id, _, redirect_uri = _get_credentials(db)
    params = (
        f"?client_id={client_id}"
        f"&redirect_uri={redirect_uri}"
        f"&response_type=code"
        f"&scope={SCOPES.replace(' ', '%20')}"
        f"&access_type=offline"
        f"&prompt=consent"
        f"&state={current_user.id}"
    )
    return {"url": GOOGLE_AUTH_URL + params}


@router.get("/callback")
async def google_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Google redirects here after user approves. Stores tokens and closes popup."""
    if error or not code or not state:
        return HTMLResponse(_popup_html(success=False, message=error or "Autenticación cancelada"))

    try:
        user_id = int(state)
    except (ValueError, TypeError):
        return HTMLResponse(_popup_html(success=False, message="Estado inválido"))

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        return HTMLResponse(_popup_html(success=False, message="Usuario no encontrado"))

    client_id, client_secret, redirect_uri = _get_credentials(db)

    # Exchange code for tokens
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(GOOGLE_TOKEN_URL, data={
            "code":          code,
            "client_id":     client_id,
            "client_secret": client_secret,
            "redirect_uri":  redirect_uri,
            "grant_type":    "authorization_code",
        })

    if token_resp.status_code != 200:
        return HTMLResponse(_popup_html(success=False, message="Error al obtener tokens de Google"))

    token_data = token_resp.json()
    access_token  = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expires_in    = token_data.get("expires_in", 3600)
    expiry        = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

    # Fetch user email from Google
    google_email = None
    async with httpx.AsyncClient() as client:
        info_resp = await client.get(
            GOOGLE_USERINFO,
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if info_resp.status_code == 200:
        google_email = info_resp.json().get("email")

    # Upsert token record
    existing = db.query(models.GoogleCalendarToken).filter(
        models.GoogleCalendarToken.user_id == user_id
    ).first()
    if existing:
        existing.access_token  = access_token
        if refresh_token:
            existing.refresh_token = refresh_token
        existing.token_expiry  = expiry
        existing.google_email  = google_email
    else:
        db.add(models.GoogleCalendarToken(
            user_id=user_id,
            access_token=access_token,
            refresh_token=refresh_token,
            token_expiry=expiry,
            google_email=google_email,
        ))
    db.commit()

    return HTMLResponse(_popup_html(success=True, message=google_email or "Conectado"))


@router.delete("/disconnect")
def disconnect_google(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    token = db.query(models.GoogleCalendarToken).filter(
        models.GoogleCalendarToken.user_id == current_user.id
    ).first()
    if token:
        db.delete(token)
        db.commit()
    return {"ok": True}


@router.get("/gmail/auth-url")
def get_gmail_auth_url(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    client_id, _, redirect_uri = _get_credentials(db)
    # Use same redirect_uri but different scope + state prefix
    gmail_redirect = redirect_uri.replace("/callback", "/gmail-callback")
    params = (
        f"?client_id={client_id}"
        f"&redirect_uri={gmail_redirect}"
        f"&response_type=code"
        f"&scope={SCOPES_GMAIL.replace(' ', '%20')}"
        f"&access_type=offline"
        f"&prompt=consent"
        f"&state={current_user.id}"
    )
    return {"url": GOOGLE_AUTH_URL + params}


@router.get("/gmail/status")
def gmail_status(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    token = db.query(models.GoogleCalendarToken).filter(
        models.GoogleCalendarToken.user_id == current_user.id,
    ).first()
    configured = bool(_get_setting(db, "google_client_id"))
    connected = bool(token and token.gmail_access_token)
    return {
        "configured": configured,
        "connected": connected,
        "gmail_email": token.gmail_email if connected else None,
    }


@router.get("/gmail-callback")
async def gmail_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    db: Session = Depends(get_db),
):
    if error or not code or not state:
        return HTMLResponse(_popup_html(success=False, message=error or "Autenticación cancelada", type="gmail"))
    try:
        user_id = int(state)
    except (ValueError, TypeError):
        return HTMLResponse(_popup_html(success=False, message="Estado inválido", type="gmail"))

    client_id, client_secret, redirect_uri = _get_credentials(db)
    gmail_redirect = redirect_uri.replace("/callback", "/gmail-callback")

    async with httpx.AsyncClient() as client:
        token_resp = await client.post(GOOGLE_TOKEN_URL, data={
            "code": code, "client_id": client_id, "client_secret": client_secret,
            "redirect_uri": gmail_redirect, "grant_type": "authorization_code",
        })
    if token_resp.status_code != 200:
        return HTMLResponse(_popup_html(success=False, message="Error al obtener tokens", type="gmail"))

    token_data = token_resp.json()
    access_token  = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expiry = datetime.now(timezone.utc) + timedelta(seconds=token_data.get("expires_in", 3600))

    google_email = None
    async with httpx.AsyncClient() as client:
        info_resp = await client.get(GOOGLE_USERINFO, headers={"Authorization": f"Bearer {access_token}"})
    if info_resp.status_code == 200:
        google_email = info_resp.json().get("email")

    existing = db.query(models.GoogleCalendarToken).filter(
        models.GoogleCalendarToken.user_id == user_id,
    ).first()
    if existing:
        existing.gmail_access_token = access_token
        if refresh_token:
            existing.gmail_refresh_token = refresh_token
        existing.gmail_token_expiry = expiry
        existing.gmail_email = google_email
    else:
        db.add(models.GoogleCalendarToken(
            user_id=user_id, access_token="",
            gmail_access_token=access_token,
            gmail_refresh_token=refresh_token or "",
            gmail_token_expiry=expiry, gmail_email=google_email,
        ))
    db.commit()
    return HTMLResponse(_popup_html(success=True, message=google_email or "Gmail conectado", type="gmail"))


@router.delete("/gmail/disconnect")
def disconnect_gmail(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    token = db.query(models.GoogleCalendarToken).filter(
        models.GoogleCalendarToken.user_id == current_user.id,
    ).first()
    if token:
        token.gmail_access_token = None
        token.gmail_refresh_token = None
        token.gmail_token_expiry = None
        token.gmail_email = None
        db.commit()
    return {"ok": True}


@router.get("/events")
async def list_google_events(
    time_min: Optional[str] = None,
    time_max: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Fetch events from the user's Google Calendar."""
    token = db.query(models.GoogleCalendarToken).filter(
        models.GoogleCalendarToken.user_id == current_user.id
    ).first()
    if not token:
        return []

    ok = await _refresh_access_token(token, db)
    if not ok:
        return []

    params: dict = {"singleEvents": "true", "orderBy": "startTime", "maxResults": "250"}
    if time_min:
        params["timeMin"] = time_min
    if time_max:
        params["timeMax"] = time_max

    cal_id = token.google_calendar_id or "primary"
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{GOOGLE_CALENDAR}/calendars/{cal_id}/events",
            headers={"Authorization": f"Bearer {token.access_token}"},
            params=params,
        )
    if resp.status_code != 200:
        return []

    items = resp.json().get("items", [])
    events = []
    for item in items:
        start = item.get("start", {})
        end   = item.get("end", {})
        events.append({
            "id":        item.get("id"),
            "title":     item.get("summary", "Sin título"),
            "start":     start.get("dateTime") or start.get("date"),
            "end":       end.get("dateTime")   or end.get("date"),
            "allDay":    "date" in start and "dateTime" not in start,
            "htmlLink":  item.get("htmlLink"),
            "source":    "google",
        })
    return events


@router.post("/sync-event/{event_id}")
async def sync_event_to_google(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Push a single CRM event to Google Calendar."""
    event = db.query(models.CalendarEvent).filter(models.CalendarEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Evento no encontrado")

    token = db.query(models.GoogleCalendarToken).filter(
        models.GoogleCalendarToken.user_id == current_user.id
    ).first()
    if not token:
        raise HTTPException(status_code=400, detail="Google Calendar no conectado")

    ok = await _refresh_access_token(token, db)
    if not ok:
        raise HTTPException(status_code=400, detail="Token de Google expirado, vuelve a conectar")

    payload = _crm_event_to_google(event)
    cal_id  = token.google_calendar_id or "primary"

    async with httpx.AsyncClient() as client:
        if event.google_event_id:
            # Update existing
            resp = await client.put(
                f"{GOOGLE_CALENDAR}/calendars/{cal_id}/events/{event.google_event_id}",
                headers={"Authorization": f"Bearer {token.access_token}"},
                json=payload,
            )
        else:
            # Create new
            resp = await client.post(
                f"{GOOGLE_CALENDAR}/calendars/{cal_id}/events",
                headers={"Authorization": f"Bearer {token.access_token}"},
                json=payload,
            )

    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Error al sincronizar con Google Calendar")

    google_event_id = resp.json().get("id")
    event.google_event_id = google_event_id
    db.commit()
    return {"ok": True, "google_event_id": google_event_id}


@router.post("/sync-all")
async def sync_all_events(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Sync ALL CRM events for current user to Google Calendar."""
    token = db.query(models.GoogleCalendarToken).filter(
        models.GoogleCalendarToken.user_id == current_user.id
    ).first()
    if not token:
        raise HTTPException(status_code=400, detail="Google Calendar no conectado")

    ok = await _refresh_access_token(token, db)
    if not ok:
        raise HTTPException(status_code=400, detail="Token de Google expirado")

    events = db.query(models.CalendarEvent).filter(
        (models.CalendarEvent.created_by == current_user.id) |
        (models.CalendarEvent.assigned_to == current_user.id)
    ).all()

    cal_id  = token.google_calendar_id or "primary"
    synced, failed = 0, 0

    async with httpx.AsyncClient() as client:
        for event in events:
            payload = _crm_event_to_google(event)
            try:
                if event.google_event_id:
                    resp = await client.put(
                        f"{GOOGLE_CALENDAR}/calendars/{cal_id}/events/{event.google_event_id}",
                        headers={"Authorization": f"Bearer {token.access_token}"},
                        json=payload,
                    )
                else:
                    resp = await client.post(
                        f"{GOOGLE_CALENDAR}/calendars/{cal_id}/events",
                        headers={"Authorization": f"Bearer {token.access_token}"},
                        json=payload,
                    )
                if resp.status_code in (200, 201):
                    event.google_event_id = resp.json().get("id")
                    synced += 1
                else:
                    failed += 1
            except Exception:
                failed += 1

    db.commit()
    return {"synced": synced, "failed": failed, "total": len(events)}


# ── Internal helpers ────────────────────────────────────────

GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"


async def send_email_via_gmail(db: Session, to: str, subject: str, body_text: str) -> bool:
    """
    Fallback de correo de sistema: envía por Gmail API usando CUALQUIER cuenta
    Gmail conectada en Nexio (sección Correo). Devuelve False si no hay ninguna
    cuenta conectada o el envío falla — nunca levanta excepción.
    """
    import base64
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    token = db.query(models.GoogleCalendarToken).filter(
        models.GoogleCalendarToken.gmail_access_token != None  # noqa: E711
    ).first()
    if not token:
        return False

    try:
        access = token.gmail_access_token
        client_id     = _get_setting(db, "google_client_id")
        client_secret = _get_setting(db, "google_client_secret")
        if token.gmail_refresh_token and client_id and client_secret:
            async with httpx.AsyncClient() as client:
                resp = await client.post(GOOGLE_TOKEN_URL, data={
                    "grant_type": "refresh_token",
                    "refresh_token": token.gmail_refresh_token,
                    "client_id": client_id,
                    "client_secret": client_secret,
                })
            if resp.status_code == 200:
                data = resp.json()
                access = data["access_token"]
                token.gmail_access_token = access
                token.gmail_token_expiry = datetime.now(timezone.utc) + timedelta(seconds=data.get("expires_in", 3600))
                db.commit()

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = token.gmail_email or "me"
        msg["To"] = to
        html_body = body_text.replace("\n", "<br>")
        msg.attach(MIMEText(body_text, "plain", "utf-8"))
        msg.attach(MIMEText(f"<div style='font-family:sans-serif;line-height:1.6;font-size:14px'>{html_body}</div>", "html", "utf-8"))
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                GMAIL_SEND_URL,
                headers={"Authorization": f"Bearer {access}", "Content-Type": "application/json"},
                json={"raw": raw},
            )
        return resp.status_code in (200, 201)
    except Exception:
        return False


async def push_event_with_invite(
    db: Session,
    event: models.CalendarEvent,
    owner_user_id: int,
    attendee_email: str | None,
) -> bool:
    """
    Push del evento al Google Calendar de `owner_user_id`, con el cliente como
    invitado (attendee) y sendUpdates=all: Google le envía por correo la
    invitación con fecha, hora y título. Devuelve False si ese usuario no
    tiene Google conectado o el push falla (el caller puede probar otro user).
    """
    token = db.query(models.GoogleCalendarToken).filter(
        models.GoogleCalendarToken.user_id == owner_user_id
    ).first()
    if not token:
        return False
    if not await _refresh_access_token(token, db):
        logger.warning(
            "[gcal] user %s: no se pudo refrescar el token de Calendar (refresh_token %s)",
            owner_user_id, "presente" if token.refresh_token else "AUSENTE",
        )
        return False

    payload = _crm_event_to_google(event)
    if event.lead_id:
        await _enrich_payload_for_lead(db, event, payload)
    attendees = []
    if attendee_email:
        attendees.append({"email": attendee_email})
    # El vendedor asignado también va como invitado: Google le entrega la
    # invitación con el botón de Meet en SU calendario/correo, aunque el
    # evento se haya creado desde la cuenta de otra persona (fallback).
    if event.assigned_to:
        _vend = db.query(models.User).filter(models.User.id == event.assigned_to).first()
        _v_email = (_vend.email or "").strip() if _vend else ""
        if "@" in _v_email and _v_email.lower() != (token.google_email or "").lower() \
                and all(a["email"].lower() != _v_email.lower() for a in attendees):
            attendees.append({"email": _v_email})
    if attendees:
        payload["attendees"] = attendees
    cal_id = token.google_calendar_id or "primary"
    params = {"sendUpdates": "all"} if attendees else {}

    # Google Meet: pedir la videollamada al crear el evento (o al actualizar uno
    # que aún no la tiene). conferenceDataVersion=1 es obligatorio o Google
    # ignora la solicitud silenciosamente. Si el evento ya tiene Meet, no se
    # manda el param (default 0) para que Google preserve la conferencia.
    if not event.meet_link:
        payload["conferenceData"] = {
            "createRequest": {
                "requestId": f"nexio-meet-{event.id}",
                "conferenceSolutionKey": {"type": "hangoutsMeet"},
            }
        }
        params["conferenceDataVersion"] = 1

    async with httpx.AsyncClient() as client:
        if event.google_event_id:
            resp = await client.put(
                f"{GOOGLE_CALENDAR}/calendars/{cal_id}/events/{event.google_event_id}",
                headers={"Authorization": f"Bearer {token.access_token}"},
                params=params, json=payload,
            )
        else:
            resp = await client.post(
                f"{GOOGLE_CALENDAR}/calendars/{cal_id}/events",
                headers={"Authorization": f"Bearer {token.access_token}"},
                params=params, json=payload,
            )

    if resp.status_code not in (200, 201):
        logger.warning(
            "[gcal] user %s: push del evento %s falló — HTTP %s %s",
            owner_user_id, event.id, resp.status_code, resp.text[:300],
        )
        return False
    data = resp.json()
    event.google_event_id = data.get("id")
    meet = data.get("hangoutLink") or next(
        (
            ep.get("uri")
            for ep in (data.get("conferenceData") or {}).get("entryPoints", [])
            if ep.get("entryPointType") == "video"
        ),
        None,
    )
    if meet:
        event.meet_link = meet
    db.commit()
    return True


def _crm_event_to_google(event: models.CalendarEvent) -> dict:
    def _iso(dt: datetime) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()

    desc = event.notes or ""
    if event.lead_id:
        desc = f"Lead #{event.lead_id} — {desc}" if desc else f"Lead #{event.lead_id}"

    color_map = {
        "#3B82F6": "7",   # blue → peacock
        "#10B981": "2",   # green → sage
        "#F59E0B": "5",   # amber → banana
        "#EF4444": "11",  # red → tomato
        "#8B5CF6": "3",   # violet → grape
        "#6B7280": "8",   # gray → graphite
    }

    return {
        "summary":     event.title,
        "description": desc,
        "start":       {"dateTime": _iso(event.start_time), "timeZone": "America/Santiago"},
        "end":         {"dateTime": _iso(event.end_time),   "timeZone": "America/Santiago"},
        "colorId":     color_map.get(event.color, "7"),
    }


async def generate_meeting_summary(db: Session, lead: models.Lead) -> str | None:
    """
    Genera un resumen breve (2-4 frases, español) de la conversación del cliente
    por WhatsApp, reutilizando el agente IA del lead (misma clave/modelo OpenAI).
    Best-effort: devuelve None si no hay agente, ni clave, ni conversación, o si
    OpenAI falla — nunca lanza excepción para no romper el agendamiento.
    """
    try:
        agent = None
        if lead.ai_agent_id:
            agent = db.query(models.AIAgent).filter(
                models.AIAgent.id == lead.ai_agent_id
            ).first()
        if agent is None:
            # Fallback: cualquier agente activo del mismo grupo con clave configurada.
            agent = (
                db.query(models.AIAgent)
                .filter(
                    models.AIAgent.group_id == lead.group_id,
                    models.AIAgent.openai_api_key.isnot(None),
                )
                .first()
            )
        if agent is None or not (agent.openai_api_key or "").strip():
            return None

        history = (
            db.query(models.WhatsAppMessage)
            .filter(models.WhatsAppMessage.contact_id == lead.contact_id)
            .order_by(models.WhatsAppMessage.created_at.desc())
            .limit(40)
            .all()
        )
        history = list(reversed(history))
        transcript_lines = [
            f"{'Cliente' if m.direction == 'in' else 'Agente'}: {m.content.strip()}"
            for m in history
            if (m.content or "").strip()
        ]
        if not transcript_lines:
            return None
        transcript = "\n".join(transcript_lines)

        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=agent.openai_api_key)
        resp = await client.chat.completions.create(
            model=agent.openai_model or "gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Resume en español, en 2 a 4 frases, la siguiente conversación "
                        "entre un cliente y un agente. Indica qué necesita o pidió el "
                        "cliente, qué ofreció el agente y en qué estado quedó la gestión. "
                        "Tono neutral y profesional, en tercera persona. Sin encabezados "
                        "ni viñetas, solo el párrafo del resumen."
                    ),
                },
                {"role": "user", "content": transcript},
            ],
            max_tokens=250,
            temperature=0.3,
        )
        summary = (resp.choices[0].message.content or "").strip()
        return summary or None
    except Exception:
        logger.warning("[gcal] no se pudo generar resumen IA para lead %s",
                       getattr(lead, "id", "?"), exc_info=True)
        return None


async def _enrich_payload_for_lead(db: Session, event: models.CalendarEvent, payload: dict) -> None:
    """
    Sobrescribe summary/description del payload de Google con datos del lead:
      Título:  {nombre} / {service_description} / {teléfono}
      Cuerpo:  👤 nombre (#lead) · 📞 teléfono · 📋 servicio · notas · 📝 Resumen IA
    Cachea el resumen en event.ai_summary para no regenerarlo en re-pushes.
    """
    from sqlalchemy.orm import joinedload
    lead = (
        db.query(models.Lead)
        .options(joinedload(models.Lead.contact))
        .filter(models.Lead.id == event.lead_id)
        .first()
    )
    if lead is None:
        return
    contact = lead.contact
    nombre  = (contact.name if contact else "") or f"Lead #{lead.id}"
    telefono = (contact.phone if contact else "") or ""
    servicio = (lead.service_description or "").strip()

    title_parts = [p for p in (nombre, servicio, telefono) if p]
    if title_parts:
        payload["summary"] = " / ".join(title_parts)

    lines = [f"👤 {nombre} (#{lead.id})"]
    if telefono:
        lines.append(f"📞 {telefono}")
    if servicio:
        lines.append(f"📋 {servicio}")
    if (event.notes or "").strip():
        lines.append("")
        lines.append(event.notes.strip())

    # Resumen IA (cacheado). Solo se genera la primera vez.
    if not (event.ai_summary or "").strip():
        summary = await generate_meeting_summary(db, lead)
        if summary:
            event.ai_summary = summary
            db.commit()
    if (event.ai_summary or "").strip():
        lines.append("")
        lines.append("📝 Resumen:")
        lines.append(event.ai_summary.strip())

    payload["description"] = "\n".join(lines)


def _popup_html(success: bool, message: str, type: str = "calendar") -> str:
    title = "Gmail" if type == "gmail" else "Google Calendar"
    msg_key = "googleGmail" if type == "gmail" else "googleCalendar"
    if success:
        status_html = f"""
        <div class="icon success">✓</div>
        <h2>¡{title} conectado!</h2>
        <p class="email">{message}</p>
        <p class="sub">Esta ventana se cerrará automáticamente.</p>
        """
        script = """
        if (window.opener) {
          window.opener.postMessage({ %s: 'connected', email: '%s' }, '*');
        }
        setTimeout(() => window.close(), 2000);
        """ % (msg_key, message)
    else:
        status_html = f"""
        <div class="icon error">✗</div>
        <h2>Error de conexión</h2>
        <p class="sub">{message}</p>
        <button onclick="window.close()">Cerrar</button>
        """
        script = """
        if (window.opener) {
          window.opener.postMessage({ %s: 'error' }, '*');
        }
        """ % msg_key

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Google Calendar</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            display: flex; align-items: center; justify-content: center;
            min-height: 100vh; background: #f8fafc; }}
    .card {{ background: white; border-radius: 16px; padding: 40px;
             text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,.08);
             max-width: 360px; width: 100%; }}
    .icon {{ width: 64px; height: 64px; border-radius: 50%;
             font-size: 28px; display: flex; align-items: center;
             justify-content: center; margin: 0 auto 20px; }}
    .icon.success {{ background: #ecfdf5; color: #10b981; }}
    .icon.error   {{ background: #fef2f2; color: #ef4444; }}
    h2  {{ font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 8px; }}
    .email {{ font-size: 14px; color: #64748b; margin-bottom: 8px; }}
    .sub {{ font-size: 13px; color: #94a3b8; margin-top: 12px; }}
    button {{ margin-top: 20px; padding: 10px 24px; border-radius: 8px;
              background: #0f172a; color: white; border: none; cursor: pointer;
              font-size: 14px; font-weight: 600; }}
  </style>
</head>
<body>
  <div class="card">
    {status_html}
  </div>
  <script>{script}</script>
</body>
</html>"""
