"""Buscador Global 360 — endpoint unificado (Sub-paso A.1).

GET /api/search?q=...  → resultados categorizados, scoped por rol en el motor
de la base de datos (reutiliza _visible_leads de leads.py) y con límites
estrictos por categoría. El frontend renderiza al vuelo y dispara `action`.
"""
from __future__ import annotations

from typing import Any, Callable

from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..auth import get_current_user
from .. import models
from ..search_utils import norm_text, phone_digits, phone_suffix
from .leads import _visible_leads  # ← REUTILIZA la seguridad por rol existente

router = APIRouter(prefix="/api/search", tags=["search"])

PER_TYPE = 6      # tope de resultados por categoría
MIN_CHARS = 2     # guarda anti-saturación: no consultar con < 2 chars útiles

# Módulos navegables por rol (acción "navigate"). Estático, sin tocar la DB.
_MODULES: list[dict[str, Any]] = [
    {"label": "Dashboard",  "to": "/",          "roles": {"superadmin", "subadmin", "agendadora", "verificador", "vendedor"}},
    {"label": "Leads",      "to": "/leads",     "roles": {"superadmin", "subadmin", "agendadora"}},
    {"label": "Pipeline",   "to": "/pipeline",  "roles": {"superadmin", "subadmin", "agendadora"}},
    {"label": "Mi Pipeline","to": "/mi-pipeline","roles": {"vendedor"}},
    {"label": "Contactos",  "to": "/contactos", "roles": {"superadmin", "subadmin", "agendadora"}},
    {"label": "Calendario", "to": "/calendario","roles": {"superadmin", "subadmin", "agendadora"}},
    {"label": "Agenda",     "to": "/agenda",    "roles": {"vendedor"}},
    {"label": "WhatsApp",   "to": "/whatsapp",  "roles": {"agendadora"}},
    {"label": "Verificar Pagos", "to": "/pagos","roles": {"verificador"}},
    {"label": "Cobranza",   "to": "/cobrador",  "roles": {"cobrador"}},
]


def _group(gtype: str, label: str, rows: list, has_more: bool,
           to_item: Callable[[Any], dict]) -> dict[str, Any]:
    return {"type": gtype, "label": label, "has_more": has_more,
            "items": [to_item(r) for r in rows]}


def _search_modules(role: str, qn: str) -> dict[str, Any]:
    hits = [m for m in _MODULES if role in m["roles"] and qn in norm_text(m["label"])]
    return _group(
        "module", "Módulos", hits[:PER_TYPE], len(hits) > PER_TYPE,
        lambda m: {"title": m["label"], "subtitle": "Ir al módulo",
                   "action": {"kind": "navigate", "to": m["to"]}},
    )


@router.get("")
def global_search(
    q: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> dict[str, Any]:
    qn = norm_text(q)
    # Guarda de rendimiento: nada de tocar la DB con queries triviales.
    if len(qn) < MIN_CHARS:
        return {"q": q, "groups": []}

    digits = phone_digits(q)
    groups: list[dict[str, Any]] = []

    # ── LEADS (scoped por rol en el motor vía _visible_leads) ──────────────
    base = db.query(models.Lead).options(
        selectinload(models.Lead.contact),
        selectinload(models.Lead.area),
    )
    lead_q = _visible_leads(base, current_user, db).join(models.Lead.contact)

    conds = [
        models.Contact.search_name.like(f"%{qn}%"),
        models.Contact.rut_persona.ilike(f"%{q.strip()}%"),
    ]
    if digits:
        # Sufijo: tolerante a prefijo país (+569… vs 9…)
        conds.append(models.Contact.phone_norm.like(f"%{phone_suffix(digits)}%"))

    leads = (
        lead_q.filter(or_(*conds))
              .order_by(models.Lead.updated_at.desc())
              .limit(PER_TYPE + 1)   # +1 → calcula has_more sin traer de más
              .all()
    )
    if leads:
        groups.append(_group(
            "lead", "Leads", leads[:PER_TYPE], len(leads) > PER_TYPE,
            lambda l: {
                "id": l.id,
                "title": (l.contact.name if l.contact else "—"),
                "subtitle": (l.area.name if l.area else "Sin área"),
                "badge": {"label": l.current_stage, "stage": l.current_stage},
                "action": {"kind": "drawer", "leadId": l.id},
            },
        ))

    # Subquery de leads visibles — base de scoping seguro para tareas/historial.
    visible_lead_ids = select(
        _visible_leads(db.query(models.Lead.id), current_user, db).subquery().c.id
    )

    # ── TAREAS / COMPROMISOS (CalendarEvent por título o nota) ─────────────
    # Visible si: el evento cuelga de un lead visible, o el usuario lo creó / le
    # fue asignado. Nunca filtra en cliente; jamás filtra eventos ajenos.
    like = f"%{q.strip()}%"
    event_scope = or_(
        models.CalendarEvent.lead_id.in_(visible_lead_ids),
        models.CalendarEvent.created_by == current_user.id,
        models.CalendarEvent.assigned_to == current_user.id,
    )
    tasks = (
        db.query(models.CalendarEvent)
          .filter(event_scope,
                  or_(models.CalendarEvent.title.ilike(like),
                      models.CalendarEvent.notes.ilike(like)))
          .order_by(models.CalendarEvent.start_time.desc())
          .limit(PER_TYPE + 1).all()
    )
    if tasks:
        groups.append(_group(
            "task", "Tareas", tasks[:PER_TYPE], len(tasks) > PER_TYPE,
            lambda e: {
                "id": e.id,
                "title": e.title,
                "subtitle": (e.event_type or "tarea").capitalize(),
                # Si pertenece a un lead → Drawer (Fase 2); si no → al Calendario.
                "action": {"kind": "drawer", "leadId": e.lead_id} if e.lead_id
                          else {"kind": "navigate", "to": "/calendario"},
            },
        ))

    # ── HISTORIAL / NOTAS (LeadHistory.notes de leads visibles) ────────────
    hist = (
        _visible_leads(
            db.query(models.LeadHistory).join(
                models.Lead, models.LeadHistory.lead_id == models.Lead.id
            ).options(selectinload(models.LeadHistory.lead).selectinload(models.Lead.contact)),
            current_user, db,
        )
        .filter(models.LeadHistory.notes.ilike(like))
        .order_by(models.LeadHistory.created_at.desc())
        .limit(PER_TYPE + 1).all()
    )
    if hist:
        groups.append(_group(
            "history", "Historial", hist[:PER_TYPE], len(hist) > PER_TYPE,
            lambda h: {
                "id": h.id,
                "title": (h.lead.contact.name if h.lead and h.lead.contact else f"Lead #{h.lead_id}"),
                "subtitle": (h.notes or "")[:90],
                "action": {"kind": "drawer", "leadId": h.lead_id},
            },
        ))

    # ── MÓDULOS (estático, filtrado por rol) ──────────────────────────────
    mod_group = _search_modules(current_user.role, qn)
    if mod_group["items"]:
        groups.append(mod_group)

    return {"q": q, "groups": groups}
