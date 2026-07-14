from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_
from typing import List, Optional
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import os as _os
import re as _re
from ..database import get_db
from .. import models, schemas
from ..auth import get_current_user, get_visible_group_ids
from ..utils.notifications import create_notification
from ..broadcaster import wa_broadcaster

router = APIRouter(prefix="/api/calendar", tags=["calendar"])
_TZ_CHILE = ZoneInfo("America/Santiago")

# ── Limpieza de notas ────────────────────────────────────────────────────────
# Bloque de "accesos" que se pegaba en las notas al agendar. Ya no debe quedar
# en la reunión: esas notificaciones le llegan al cliente por WhatsApp en su
# propio flujo. Se elimina frase por frase (tolerante a bullets, espacios,
# mayúsculas y tildes) al crear o actualizar el evento.
_ACCESOS_PHRASES = [
    r"Se\s+le\s+enviar[áa]n?\s+por\s+WhatsApp\s+las\s+notificaciones\s+con\s+los\s+siguientes\s+accesos\s*:?",
    r"Enlace\s+con\s+su\s+Orden\s+de\s+trabajo\s*\.?",
    r"Enlace\s+para\s+crear\s+su\s+contrase[ñn]a\s*\.?",
    r"Enlace\s+directo\s+a\s+su\s+panel\s+de\s+abogados\s+para\s+revisar\s+sus\s+casos\s*\.?",
]
_ACCESOS_RES = [
    _re.compile(r"(?:^[ \t]*[•·\-\*]?[ \t]*)?" + p, _re.IGNORECASE | _re.MULTILINE)
    for p in _ACCESOS_PHRASES
]


def _clean_event_notes(notes: Optional[str]) -> Optional[str]:
    if not notes:
        return notes
    cleaned = notes
    for rx in _ACCESOS_RES:
        cleaned = rx.sub("", cleaned)
    cleaned = _re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned or None


@router.get("/slots")
def calendar_slots(
    user_id: int,
    date: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Bloques ocupados de un vendedor en un día (hora local Chile).

    Ligero: 1 query acotada por el rango UTC del día local + user_id (sargable,
    sin N+1). Devuelve intervalos `busy` en HH:MM local para pintar la barra.
    """
    try:
        day = datetime.strptime(date, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="date debe tener formato YYYY-MM-DD")

    start_local = datetime(day.year, day.month, day.day, 0, 0, tzinfo=_TZ_CHILE)
    end_local = start_local + timedelta(days=1)
    start_utc = start_local.astimezone(timezone.utc)
    end_utc = end_local.astimezone(timezone.utc)

    evs = db.query(models.CalendarEvent).filter(
        or_(
            models.CalendarEvent.assigned_to == user_id,
            models.CalendarEvent.created_by == user_id,
        ),
        models.CalendarEvent.start_time < end_utc,
        models.CalendarEvent.end_time > start_utc,
    ).all()

    def _hhmm(dt):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(_TZ_CHILE).strftime("%H:%M")

    busy = [{"start": _hhmm(e.start_time), "end": _hhmm(e.end_time), "title": e.title} for e in evs]
    return {
        "user_id": user_id,
        "date": date,
        "tz": "America/Santiago",
        "day_start": "08:00",
        "day_end": "20:00",
        "slot_minutes": 30,
        "busy": busy,
    }


@router.get("", response_model=List[schemas.CalendarEventOut])
def list_events(
    start: Optional[str] = None,
    end: Optional[str] = None,
    user_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    q = db.query(models.CalendarEvent)

    if current_user.role in ("superadmin", "subadmin"):
        gids = get_visible_group_ids(db, current_user)
        if gids is not None:
            q = q.join(models.Lead, models.CalendarEvent.lead_id == models.Lead.id, isouter=True).filter(
                models.Lead.group_id.in_(gids)
            )
        if user_id:
            q = q.filter(
                (models.CalendarEvent.created_by == user_id) |
                (models.CalendarEvent.assigned_to == user_id)
            )
    elif current_user.role == "tecnico":
        if user_id:
            q = q.filter(
                (models.CalendarEvent.created_by == user_id) |
                (models.CalendarEvent.assigned_to == user_id)
            )
    elif current_user.role == "agendadora":
        if user_id:
            # Viewing a specific vendor's calendar (availability check)
            q = q.filter(
                (models.CalendarEvent.created_by == user_id) |
                (models.CalendarEvent.assigned_to == user_id)
            )
        else:
            vendedor_ids = [
                u.id for u in db.query(models.User).filter(
                    models.User.group_id == current_user.group_id,
                    models.User.role.in_(["vendedor", "verificador", "subadmin"]),
                ).all()
            ]
            q = q.filter(
                (models.CalendarEvent.created_by == current_user.id) |
                (models.CalendarEvent.assigned_to.in_(vendedor_ids)) |
                (models.CalendarEvent.created_by.in_(vendedor_ids))
            )
    else:
        q = q.filter(
            (models.CalendarEvent.created_by == current_user.id) |
            (models.CalendarEvent.assigned_to == current_user.id)
        )

    if start:
        q = q.filter(models.CalendarEvent.start_time >= start)
    if end:
        q = q.filter(models.CalendarEvent.end_time <= end)
    return q.order_by(models.CalendarEvent.start_time).all()


@router.get("/group-vendors")
def get_group_vendors(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in ("agendadora", "superadmin", "subadmin") or not current_user.group_id:
        return []
    my_group = db.query(models.Group).filter(models.Group.id == current_user.group_id).first()
    if not my_group:
        return []
    # For root-level users (superadmin/subadmin in the negocio group), include all sub-groups
    if my_group.negocio_id is None and current_user.role in ("superadmin", "subadmin"):
        sub_gids = [g.id for g in db.query(models.Group).filter(models.Group.negocio_id == my_group.id).all()]
        group_ids = [my_group.id] + sub_gids
    else:
        group_ids = [current_user.group_id]
    users = db.query(models.User).filter(
        models.User.group_id.in_(group_ids),
        models.User.role.in_(["vendedor", "verificador", "subadmin"]),
        models.User.is_active == True,
    ).all()
    return [{"id": u.id, "name": u.name, "role": u.role} for u in users]


@router.get("/agendadora-followup")
def get_agendadora_followup(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Return leads that currently need rescheduling (last_vendor_outcome is set).
    Only shows the most recent failed event per lead."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=60)

    # Only fetch events for leads that STILL have last_vendor_outcome set.
    # Once a new reunion is scheduled, last_vendor_outcome is cleared and
    # the lead disappears from this list automatically.
    events = (
        db.query(models.CalendarEvent)
        .join(models.Lead, models.CalendarEvent.lead_id == models.Lead.id)
        .options(
            joinedload(models.CalendarEvent.lead)
                .joinedload(models.Lead.contact),
            joinedload(models.CalendarEvent.lead)
                .joinedload(models.Lead.vendedor),
            joinedload(models.CalendarEvent.lead)
                .joinedload(models.Lead.history),
        )
        .filter(
            models.CalendarEvent.created_by == current_user.id,
            models.CalendarEvent.vendor_status.in_(["sin_exito", "no_show"]),
            models.CalendarEvent.start_time >= cutoff,
            models.Lead.last_vendor_outcome != None,
        )
        .order_by(models.CalendarEvent.start_time.desc())
        .all()
    )

    # Deduplicate: only the most recent event per lead
    seen_leads: set[int] = set()
    result = []
    for ev in events:
        if not ev.lead_id or ev.lead_id in seen_leads:
            continue
        seen_leads.add(ev.lead_id)

        # Get the most recent outcome note from lead history (sin_exito/no_show don't move stage)
        outcome_note = None
        if ev.lead and ev.lead.history:
            relevant = [
                h for h in ev.lead.history
                if h.result == "failed" and h.notes
                and h.from_stage == h.to_stage  # outcome without stage move
            ]
            if relevant:
                latest = sorted(relevant, key=lambda h: h.created_at, reverse=True)[0]
                outcome_note = latest.notes

        result.append({
            "id": ev.id,
            "title": ev.title,
            "start_time": ev.start_time.isoformat(),
            "vendor_status": ev.vendor_status,
            "lead_id": ev.lead_id,
            "contact_name": ev.lead.contact.name if ev.lead and ev.lead.contact else None,
            "contact_phone": ev.lead.contact.phone if ev.lead and ev.lead.contact else None,
            "vendor_id": ev.lead.vendedor_id if ev.lead else None,
            "vendor_name": ev.lead.vendedor.name if ev.lead and ev.lead.vendedor else None,
            "outcome_note": outcome_note,
            "lead_stage": ev.lead.current_stage if ev.lead else None,
        })

    return result


@router.get("/vendor-pipeline")
def get_vendor_pipeline(
    period: Optional[str] = None,  # "day" | "week" | "month"
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Return events grouped by vendor_status for the current vendedor's pipeline."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

    # Period filter — same semantics as /leads/stats/dashboard
    _today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    period_start = period_end = None
    if date_from or date_to:
        period_start = datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc) if date_from else None
        if date_to:
            period_end = datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc) + timedelta(days=1)
    elif period == "day":
        period_start = _today_start
    elif period == "week":
        period_start = _today_start - timedelta(days=_today_start.weekday())
    elif period == "month":
        period_start = _today_start.replace(day=1)

    q = db.query(models.CalendarEvent).options(
        joinedload(models.CalendarEvent.lead).joinedload(models.Lead.contact),
        joinedload(models.CalendarEvent.lead).joinedload(models.Lead.work_orders),
        joinedload(models.CalendarEvent.creator),
    ).filter(
        or_(
            models.CalendarEvent.assigned_to == current_user.id,
            models.CalendarEvent.created_by == current_user.id,
            models.CalendarEvent.lead.has(models.Lead.vendedor_id == current_user.id),
        )
    )
    if period_start is not None:
        q = q.filter(models.CalendarEvent.start_time >= period_start)
    if period_end is not None:
        q = q.filter(models.CalendarEvent.start_time < period_end)
    q = q.order_by(models.CalendarEvent.start_time.desc())

    events = q.all()

    # Also include leads in cierre / pago_comprometido / pago_pendiente / pagado_reunion
    leads_q = db.query(models.Lead).options(
        joinedload(models.Lead.contact),
        joinedload(models.Lead.work_orders),
    ).filter(
        models.Lead.vendedor_id == current_user.id,
        models.Lead.current_stage.in_(["cierre", "pago_pendiente", "pago_comprometido", "pagado_reunion"]),
    )
    if period_start is not None:
        leads_q = leads_q.filter(models.Lead.updated_at >= period_start)
    if period_end is not None:
        leads_q = leads_q.filter(models.Lead.updated_at < period_end)
    leads_q = leads_q.order_by(models.Lead.updated_at.desc()).all()

    # Leads vencidos pasan al panel del Asistente de Seguimiento (caída dinámica,
    # misma regla que seguimiento_asistente): el vendedor ya no los gestiona.
    from .seguimiento_asistente import (
        _get_dias_gracia, RESOLVED_STATUSES, PAGO_STAGES, stage_entry_dates, lead_fecha_base,
    )
    _today = datetime.now(timezone.utc).date()
    _dias_gracia = _get_dias_gracia(db)
    _seg_candidates = [l for l in leads_q if l.current_stage in PAGO_STAGES]
    _seg_candidates += [
        ev.lead for ev in events
        if ev.lead and ev.lead.current_stage in PAGO_STAGES and ev.lead.id not in {l.id for l in _seg_candidates}
    ]
    _entry_dates = stage_entry_dates(db, _seg_candidates)

    def _en_seguimiento(lead: models.Lead) -> bool:
        if lead.seguimiento_status in RESOLVED_STATUSES:
            return False
        if lead.current_stage == "altamente_interesado":
            if not lead.payment_commitment_date:
                return False
            return (_today - lead.payment_commitment_date).days >= _dias_gracia
        if lead.current_stage in PAGO_STAGES:
            base = lead_fecha_base(lead, _entry_dates)
            return base is not None and (_today - base).days >= _dias_gracia
        return False

    leads_q = [l for l in leads_q if not _en_seguimiento(l)]

    cierre_leads = []
    pago_pendiente_leads = []
    pago_leads = []
    pagado_reunion_leads = []
    for lead in leads_q:
        entry = {
            "lead_id": lead.id,
            "contact_name": lead.contact.name if lead.contact else None,
            "contact_phone": lead.contact.phone if lead.contact else None,
            "honorarios": lead.honorarios,
            "num_cuotas": lead.num_cuotas,
            "monto_cuota": lead.monto_cuota,
            "cuota_inicial": lead.cuota_inicial,
            "has_ot": bool(lead.work_orders),
            "current_stage": lead.current_stage,
            "payment_commitment_date": lead.payment_commitment_date.isoformat() if lead.payment_commitment_date else None,
        }
        if lead.current_stage == "cierre":
            cierre_leads.append(entry)
        elif lead.current_stage == "pago_pendiente":
            pago_pendiente_leads.append(entry)
        elif lead.current_stage == "pago_comprometido":
            pago_leads.append(entry)
        else:
            pagado_reunion_leads.append(entry)

    result = {
        "espera_cliente": [], "sin_exito": [], "altamente_interesado": [],
        "no_show": [], "historial": [], "con_exito_pagada": [],
        "cierre": cierre_leads, "pago_pendiente": pago_pendiente_leads,
        "pago_comprometido": pago_leads, "pagado_reunion": pagado_reunion_leads,
    }

    def _contact_key(value: str | None):
        if not value:
            return None
        digits = "".join(ch for ch in value if ch.isdigit())
        return digits or None

    seen_active_keys: set[tuple[str, int | str]] = set()
    for ev in events:
        if ev.lead and _en_seguimiento(ev.lead):
            continue
        status = ev.vendor_status or "espera_cliente"

        start = ev.start_time
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        is_old = start < cutoff
        is_resolved = status in ("sin_exito", "altamente_interesado", "no_show", "con_exito_pagada")

        entry = {
            "id": ev.id,
            "title": ev.title,
            "start_time": ev.start_time.isoformat(),
            "end_time": ev.end_time.isoformat(),
            "event_type": ev.event_type,
            "notes": ev.notes,
            "color": ev.color,
            "vendor_status": ev.vendor_status,
            "lead_id": ev.lead_id,
            "contact_name": ev.lead.contact.name if ev.lead and ev.lead.contact else None,
            "contact_phone": ev.lead.contact.phone if ev.lead and ev.lead.contact else None,
            "creator_name": ev.creator.name if ev.creator else None,
            "honorarios": ev.lead.honorarios if ev.lead else None,
            "has_ot": bool(ev.lead.work_orders) if ev.lead else False,
        }

        # Lead ya avanzó más allá de la reunión (tiene tarjeta propia de lead
        # o ya pagó/confirmó): su evento va a historial, no a columnas activas.
        if ev.lead and ev.lead.current_stage in (
            "cierre", "pago_comprometido", "pago_pendiente", "pagado_reunion", "pagado_confirmado",
        ):
            result["historial"].append(entry)
            continue

        dedupe_keys: list[tuple[str, int | str]] = []
        if ev.lead_id:
            dedupe_keys.append(("lead", ev.lead_id))
        contact_key = _contact_key(entry["contact_phone"])
        if contact_key:
            dedupe_keys.append(("phone", contact_key))

        # The vendor pipeline represents the current state of each lead/contact.
        # Events are ordered newest first, so older attempts for the same case go
        # to history instead of appearing as duplicate cards in another column.
        if dedupe_keys and any(key in seen_active_keys for key in dedupe_keys):
            result["historial"].append(entry)
            continue
        seen_active_keys.update(dedupe_keys)

        if is_resolved and is_old:
            result["historial"].append(entry)
        elif status in result:
            result[status].append(entry)

    # If a lead/contact has a new active event in espera_cliente, move its old
    # resolved events (no_show/sin_exito) to historial so they don't duplicate.
    active_lead_ids = {e["lead_id"] for e in result["espera_cliente"] if e.get("lead_id")}
    active_contact_keys = {
        key for key in (_contact_key(e.get("contact_phone")) for e in result["espera_cliente"])
        if key
    }
    for bucket in ("no_show", "sin_exito"):
        keep, archive = [], []
        for e in result[bucket]:
            contact_key = _contact_key(e.get("contact_phone"))
            has_active_reunion = (
                e.get("lead_id") in active_lead_ids
                or (contact_key is not None and contact_key in active_contact_keys)
            )
            if has_active_reunion:
                archive.append(e)
            else:
                keep.append(e)
        result[bucket] = keep
        result["historial"].extend(archive)

    return result


@router.post("", response_model=schemas.CalendarEventOut)
def create_event(
    data: schemas.CalendarEventCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    # ── EXCLUSIVIDAD DE CATEGORÍA: alerta al agendar ─────────────────────────
    # No permitir agendar una reunión para un cliente que YA tiene otro caso
    # activo en la misma categoría (área). Bloquea el duplicado en el momento
    # del agendamiento, en vez de dejarlo avanzar y frenarlo recién en el pago.
    if data.event_type == "reunion" and data.lead_id:
        from .leads import find_category_conflict, _norm_rut
        _lead = db.query(models.Lead).options(
            joinedload(models.Lead.contact)
        ).filter(models.Lead.id == data.lead_id).first()
        if _lead and _lead.area_id:
            _c = _lead.contact
            _rut = _norm_rut(_c.rut_persona or _c.rut_empresa) if _c else None
            _dup = find_category_conflict(
                db, exclude_lead_id=_lead.id, area_id=_lead.area_id, rut_norm=_rut,
            )
            if _dup:
                _cat = _lead.area.name if _lead.area else "esta categoría"
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"No se puede agendar: este cliente ya tiene un caso activo en la "
                        f"categoría {_cat}. Resuelve o descarta ese caso antes de agendar uno "
                        f"nuevo en la misma categoría, o elige una categoría diferente."
                    ),
                )

    _payload = data.model_dump()
    _payload["notes"] = _clean_event_notes(_payload.get("notes"))
    event = models.CalendarEvent(**_payload, created_by=current_user.id)
    db.add(event)
    db.commit()
    db.refresh(event)

    if data.assigned_to and data.assigned_to != current_user.id:
        try:
            _st = event.start_time
            if _st:
                if _st.tzinfo is None:
                    _st = _st.replace(tzinfo=timezone.utc)
                _st = _st.astimezone(_TZ_CHILE)
            start_fmt = _st.strftime("%d/%m %H:%M") if _st else ""
            create_notification(
                db=db,
                user_id=data.assigned_to,
                title="Nueva reunión agendada",
                message=f"{current_user.name} agendó: {event.title} — {start_fmt}",
                lead_id=event.lead_id,
                event_id=event.id,
                notification_type="calendario",
            )
            db.commit()
        except Exception:
            pass

    # When a reunion event is created for a lead, clear any pending outcome flag
    # so the lead reappears in the pipeline kanban.
    if data.event_type == "reunion" and data.lead_id:
        lead = db.query(models.Lead).filter(models.Lead.id == data.lead_id).first()
        if lead and lead.last_vendor_outcome in ("sin_exito", "no_show"):
            lead.last_vendor_outcome = None
            db.commit()

    # When a 'reunion' event is assigned to a vendedor and linked to a lead,
    # update lead.vendedor_id and push/re-push to AT Informa if the lead is
    # already in a reunion stage (new leads are handled by move-stage).
    if (
        data.event_type == "reunion"
        and data.lead_id
        and data.assigned_to
    ):
        _sync_reunion_event_to_at(db, event, data.assigned_to, current_user)

    # Invitación por correo al cliente. Cadena de fallback, best-effort:
    #   1. Google Calendar del vendedor asignado (cliente como invitado)
    #   2. Google Calendar del creador del evento
    #   3. CUALQUIER cuenta con Google Calendar conectado (fallback de sistema)
    #   4. Correo directo vía Gmail API (cualquier cuenta Gmail conectada)
    if data.lead_id:
        try:
            import asyncio as _asyncio
            import logging as _logging
            from .google_calendar import push_event_with_invite, send_email_via_gmail
            _log = _logging.getLogger(__name__)
            _lead = db.query(models.Lead).options(
                joinedload(models.Lead.contact)
            ).filter(models.Lead.id == data.lead_id).first()
            _client_email = (_lead.contact.email or "").strip() if _lead and _lead.contact else ""
            _client_phone = (_lead.contact.phone or "").strip() if _lead and _lead.contact else ""
            if _client_email or _client_phone:
                _candidates = [u for u in (data.assigned_to, current_user.id) if u]
                for _tok in db.query(models.GoogleCalendarToken).all():
                    if _tok.user_id not in _candidates:
                        _candidates.append(_tok.user_id)
                _sent = False
                for _uid in _candidates:
                    if _asyncio.run(push_event_with_invite(db, event, _uid, _client_email or None)):
                        _log.info(
                            "[calendar] evento %s pusheado a Google (calendario user %s, invitado: %s)",
                            event.id, _uid, _client_email or "sin email",
                        )
                        _sent = True
                        break
                # WhatsApp con el link de Meet (best-effort, no rompe el agendamiento)
                if event.meet_link and _client_phone:
                    _send_meet_link_wa(db, event, _lead)
                if not _sent and _client_email:
                    _st = event.start_time
                    if _st and _st.tzinfo is None:
                        _st = _st.replace(tzinfo=timezone.utc)
                    _st_cl = _st.astimezone(_TZ_CHILE) if _st else None
                    _vend = db.query(models.User).filter(models.User.id == data.assigned_to).first() if data.assigned_to else None
                    _body = (
                        f"Estimado/a {_lead.contact.name if _lead.contact else 'cliente'}:\n\n"
                        f"Su reunión ha sido agendada con éxito.\n\n"
                        f"Motivo: {event.title}\n"
                        + (f"Fecha: {_st_cl.strftime('%d/%m/%Y')}\nHora: {_st_cl.strftime('%H:%M')} (hora de Chile)\n" if _st_cl else "")
                        + (f"Profesional: {_vend.name}\n" if _vend else "")
                        + "\nAtentamente,\nAbogados Tributarios Chile"
                    )
                    if _asyncio.run(send_email_via_gmail(db, _client_email, f"Reunión agendada — {event.title}", _body)):
                        _log.info("[calendar] correo de reunión enviado vía Gmail a %s (evento %s)", _client_email, event.id)
                    else:
                        _log.warning(
                            "[calendar] evento %s: sin Google Calendar ni Gmail conectados — "
                            "no se pudo avisar al cliente %s", event.id, _client_email,
                        )
        except Exception:
            import logging as _logging
            _logging.getLogger(__name__).warning(
                "[calendar] fallo enviando invitación al cliente para evento %s", event.id, exc_info=True,
            )

    wa_broadcaster.broadcast_sync("calendar_update", {"action": "create", "event_id": event.id, "lead_id": event.lead_id})
    return event


def _send_meet_link_wa(db: Session, event: models.CalendarEvent, lead: models.Lead):
    """
    WhatsApp al cliente con el enlace de Google Meet de su reunión (best-effort).
    Reutiliza _dispatch_payment_link_wa, que ya resuelve la config WA activa
    (área → grupo → cualquiera) y registra el mensaje saliente — nunca levanta
    excepción, así que no puede romper el agendamiento.
    """
    from .leads import _dispatch_payment_link_wa

    contact = lead.contact
    if not contact or not (contact.phone or "").strip():
        return

    _st = event.start_time
    if _st and _st.tzinfo is None:
        _st = _st.replace(tzinfo=timezone.utc)
    _st_cl = _st.astimezone(_TZ_CHILE) if _st else None

    vendedor = None
    if event.assigned_to:
        vendedor = db.query(models.User).filter(models.User.id == event.assigned_to).first()

    nombre = contact.name.split()[0] if contact.name else "estimado cliente"
    message = (
        f"¡Hola {nombre}! ✅ Tu reunión con Abogados Tributarios quedó agendada.\n\n"
        + (f"📅 *Fecha:* {_st_cl.strftime('%d/%m/%Y')}\n🕐 *Hora:* {_st_cl.strftime('%H:%M')} (hora de Chile)\n" if _st_cl else "")
        + (f"👤 *Profesional:* {vendedor.name}\n" if vendedor else "")
        + f"\nConéctate por Google Meet aquí:\n🔗 {event.meet_link}\n\n"
        f"_Te recomendamos conectarte 5 minutos antes._\n"
        f"Saludos, Abogados Tributarios."
    )
    _dispatch_payment_link_wa(lead, contact, event.meet_link, db, custom_message=message)
    _send_meet_video_wa(db, lead, contact)


# Video de bienvenida que acompaña al enlace de Meet (asset del repo).
_MEET_VIDEO_ASSET = _os.path.abspath(_os.path.join(_os.path.dirname(__file__), "../assets/video_reunion_meet.mp4"))


def _send_meet_video_wa(db: Session, lead: models.Lead, contact: models.Contact):
    """
    Envía el video de bienvenida por WhatsApp después del mensaje del Meet
    (best-effort). El asset se copia una vez a uploads/whatsapp_media para que
    el chat de Nexio pueda mostrarlo, y se registra como mensaje saliente.
    """
    try:
        import asyncio as _asyncio
        import shutil as _shutil
        from .leads import _resolve_wa_config
        from .whatsapp import MEDIA_DIR, send_whatsapp_media_file

        if not _os.path.exists(_MEET_VIDEO_ASSET):
            return
        cfg = _resolve_wa_config(lead, db)
        if not cfg:
            return

        _os.makedirs(MEDIA_DIR, exist_ok=True)
        local_path = _os.path.join(MEDIA_DIR, "video_reunion_meet.mp4")
        if not _os.path.exists(local_path):
            _shutil.copyfile(_MEET_VIDEO_ASSET, local_path)

        result = _asyncio.run(send_whatsapp_media_file(
            cfg, contact.phone, local_path, "video/mp4",
        ))
        db.add(models.WhatsAppMessage(
            contact_id=contact.id,
            lead_id=lead.id,
            whatsapp_config_id=cfg.id,
            direction="out",
            message_type="video",
            content="Video de bienvenida — reunión Google Meet",
            status=result.get("status", "logged"),
            message_id=result.get("message_id"),
            media_url="/uploads/whatsapp_media/video_reunion_meet.mp4",
        ))
        db.commit()
    except Exception:
        import logging as _logging
        _logging.getLogger(__name__).warning(
            "[calendar] no se pudo enviar el video de la reunión al lead %s", lead.id, exc_info=True,
        )


def _sync_reunion_event_to_at(db: Session, event, assigned_to_id: int, current_user):
    """
    When a reunion event is created and assigned to a vendedor:
    - Ensure lead.vendedor_id matches the assigned abogado.
    - If the lead is already in reunion/recuperacion_reunion, re-push to AT Informa.
      (Leads in 'lead'/'recuperacion_lead' are handled by the move-stage → _fire_integrations path.)
    """
    import asyncio, logging
    from ..utils import at_informa as ati
    log = logging.getLogger(__name__)

    lead = db.query(models.Lead).options(
        joinedload(models.Lead.contact),
        joinedload(models.Lead.agendadora),
        joinedload(models.Lead.area),
    ).filter(models.Lead.id == event.lead_id).first()

    if not lead:
        return

    # Update lead's vendedor to the assigned abogado (if different)
    if lead.vendedor_id != assigned_to_id:
        lead.vendedor_id = assigned_to_id
        db.add(models.LeadHistory(
            lead_id    = lead.id,
            from_stage = lead.current_stage,
            to_stage   = lead.current_stage,
            result     = "manual",
            notes      = f"Abogado reasignado a {current_user.name} al agendar reunión",
            created_by = current_user.id,
        ))
        db.commit()
        db.refresh(lead)

    # Only re-push if lead is already in a reunion stage
    # (fresh leads get pushed via move-stage → _fire_integrations)
    REUNION_STAGES = {"reunion", "recuperacion_reunion"}
    if lead.current_stage not in REUNION_STAGES:
        return

    vendedor = db.query(models.User).filter(models.User.id == assigned_to_id).first()
    if not vendedor or not vendedor.at_informa_user_id:
        log.warning("Cannot push to AT Informa: vendedor %s has no at_informa_user_id", assigned_to_id)
        return

    contact    = lead.contact
    agendadora = lead.agendadora
    area       = lead.area

    meeting_at_iso   = event.start_time.isoformat() if event.start_time else None
    meeting_duration = 60
    if event.end_time and event.start_time:
        meeting_duration = max(15, int((event.end_time - event.start_time).total_seconds() / 60))

    try:
        result = asyncio.run(ati.push_reunion_lead(
            crm_lead_id      = lead.id,
            full_name        = contact.name if contact else "Cliente",
            email            = contact.email or f"lead_{lead.id}@crm.local",
            phone            = contact.phone if contact else "",
            category         = area.name.upper() if area else "TRIBUTARIO",
            service_desc     = lead.service_description,
            honorarios       = lead.honorarios or 0,
            vendedor_email   = vendedor.email,
            agendadora_name  = agendadora.name if agendadora else None,
            at_vendedor_id   = vendedor.at_informa_user_id,
            meeting_at       = meeting_at_iso,
            meeting_duration = meeting_duration,
        ))
        at_id = result.get("leadId") or result.get("caseId")
        if at_id:
            lead.at_informa_case_id = at_id
            db.commit()
        log.info("AT Informa re-notified for lead %s → vendedor %s (at_id: %s)", lead.id, vendedor.email, at_id)
    except Exception as exc:
        log.warning("AT Informa re-push failed for lead %s: %s", lead.id, exc)


@router.get("/{event_id}", response_model=schemas.CalendarEventOut)
def get_event(event_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    event = db.query(models.CalendarEvent).filter(models.CalendarEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Evento no encontrado")
    return event


@router.put("/{event_id}", response_model=schemas.CalendarEventOut)
def update_event(
    event_id: int,
    data: schemas.CalendarEventUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    event = db.query(models.CalendarEvent).filter(models.CalendarEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Evento no encontrado")
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "notes":
            value = _clean_event_notes(value)
        setattr(event, field, value)
    db.commit()
    db.refresh(event)
    wa_broadcaster.broadcast_sync("calendar_update", {"action": "update", "event_id": event.id, "lead_id": event.lead_id})
    return event


@router.patch("/{event_id}/vendor-status")
def update_vendor_status(
    event_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Vendedor updates their event outcome status."""
    if current_user.role not in ("vendedor", "agendadora", "superadmin", "subadmin"):
        raise HTTPException(status_code=403, detail="Sin permiso para actualizar este estado")
    valid = {"espera_cliente", "sin_exito", "altamente_interesado", "no_show", "con_exito_pagada"}
    status = data.get("vendor_status")
    outcome_notes = (data.get("notes") or "").strip()
    if status not in valid:
        raise HTTPException(status_code=400, detail="Estado inválido")

    event = db.query(models.CalendarEvent).options(
        joinedload(models.CalendarEvent.lead).joinedload(models.Lead.contact),
        joinedload(models.CalendarEvent.lead).joinedload(models.Lead.agendadora),
    ).filter(models.CalendarEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Evento no encontrado")

    event.vendor_status = status

    # Stage transitions triggered by vendor outcome
    EXITOSO_STAGES = {"lead", "recuperacion_lead", "reunion", "recuperacion_reunion"}

    if event.lead_id:
        lead = db.query(models.Lead).options(
            joinedload(models.Lead.contact),
            joinedload(models.Lead.agendadora),
        ).filter(models.Lead.id == event.lead_id).first()

        if lead:
            contact_name = lead.contact.name if lead.contact else "cliente"
            old_stage = lead.current_stage
            new_stage = None
            history_result = None
            history_notes = None

            if status == "altamente_interesado" and old_stage in EXITOSO_STAGES:
                # "Con éxito sin pago" → advance to altamente_interesado
                new_stage = "altamente_interesado"
                lead.last_vendor_outcome = None
                history_result = "success"
                history_notes = f"Con éxito sin pago — {current_user.name}"
                if outcome_notes:
                    history_notes += f": {outcome_notes}"

            elif status == "con_exito_pagada" and old_stage in EXITOSO_STAGES:
                # "Con éxito pagada" → advance to pagado_reunion
                new_stage = "pagado_reunion"
                lead.last_vendor_outcome = None
                history_result = "success"
                history_notes = f"Pagó en reunión — {current_user.name}"
                if outcome_notes:
                    history_notes += f": {outcome_notes}"

            elif status == "sin_exito":
                # "Se conectó y no cerró" → recuperacion_reunion
                new_stage = "recuperacion_reunion"
                lead.last_vendor_outcome = "sin_exito"
                history_result = "failed"
                history_notes = f"Se conectó y no cerró — {current_user.name}"
                if outcome_notes:
                    history_notes += f": {outcome_notes}"

            elif status == "no_show":
                # "No se conectó" → stays in place, flags for re-scheduling (seguimiento)
                lead.last_vendor_outcome = "no_show"
                history_notes = f"Cliente no se conectó — {current_user.name}"
                if outcome_notes:
                    history_notes += f": {outcome_notes}"
                db.add(models.LeadHistory(
                    lead_id=lead.id,
                    from_stage=old_stage,
                    to_stage=old_stage,
                    result="failed",
                    notes=history_notes,
                    created_by=current_user.id,
                ))

            if new_stage:
                lead.current_stage = new_stage
                db.add(models.LeadHistory(
                    lead_id=lead.id,
                    from_stage=old_stage,
                    to_stage=new_stage,
                    result=history_result,
                    notes=history_notes,
                    created_by=current_user.id,
                ))

            # Notify agendadora for all outcomes
            if lead.agendadora_id:
                if status == "altamente_interesado":
                    create_notification(
                        db, lead.agendadora_id,
                        "Reunión exitosa — sin pago",
                        f"{current_user.name}: {contact_name} avanzó a Altamente Interesado.",
                        lead_id=lead.id,
                        notification_type="etapa",
                    )
                elif status == "con_exito_pagada":
                    create_notification(
                        db, lead.agendadora_id,
                        "Cliente pagó en la reunión",
                        f"{current_user.name}: {contact_name} pagó en reunión — confirma cuando estén listos los grupos.",
                        lead_id=lead.id,
                        notification_type="etapa",
                    )
                elif status == "sin_exito":
                    create_notification(
                        db, lead.agendadora_id,
                        "Reunión sin éxito — reagendar",
                        f"{current_user.name}: {contact_name} no cerró. Lead pasó a Recuperación.",
                        lead_id=lead.id,
                        notification_type="etapa",
                    )
                elif status == "no_show":
                    create_notification(
                        db, lead.agendadora_id,
                        "Cliente no se conectó — reagendar",
                        f"{current_user.name}: {contact_name} no se conectó. Coordina nueva fecha.",
                        lead_id=lead.id,
                        notification_type="etapa",
                    )

    db.commit()
    wa_broadcaster.broadcast_sync("calendar_update", {"action": "vendor_status", "event_id": event_id})
    wa_broadcaster.broadcast_sync("lead_update", {"action": "stage_change", "lead_id": event.lead_id}) if event.lead_id else None
    return {"ok": True, "vendor_status": status}


@router.delete("/{event_id}")
def delete_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    event = db.query(models.CalendarEvent).filter(models.CalendarEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Evento no encontrado")
    lead_id = event.lead_id
    was_reunion = event.event_type == "reunion"
    db.delete(event)
    db.flush()

    # ── Anti-limbo: no dejar un lead varado en la etapa 'reunion' sin reunión ──
    # Un lead en 'reunion' solo avanza cuando el vendedor registra el resultado, y
    # ese registro cuelga de un evento de calendario. Si se borra la última reunión
    # del lead, ya no hay dónde registrar el resultado → el lead quedaría atascado
    # sin salida. Lo devolvemos a 'lead' para que se pueda reagendar limpiamente.
    reverted = False
    if was_reunion and lead_id:
        lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
        if lead and lead.current_stage == "reunion":
            remaining = db.query(models.CalendarEvent).filter(
                models.CalendarEvent.lead_id == lead_id,
                models.CalendarEvent.event_type == "reunion",
            ).count()
            if remaining == 0:
                db.add(models.LeadHistory(
                    lead_id=lead.id,
                    from_stage="reunion",
                    to_stage="lead",
                    result="reverted",
                    notes="Reunión eliminada: el lead vuelve a 'Lead' para reagendar y no quedar atascado en Reunión.",
                    created_by=current_user.id,
                ))
                lead.current_stage = "lead"
                lead.last_vendor_outcome = None
                reverted = True

    db.commit()
    wa_broadcaster.broadcast_sync("calendar_update", {"action": "delete", "event_id": event_id, "lead_id": lead_id})
    if reverted:
        wa_broadcaster.broadcast_sync("lead_update", {"action": "stage_change", "lead_id": lead_id})
    return {"ok": True, "lead_reverted": reverted}
