from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy import func, or_
from typing import List, Optional
from datetime import datetime, timezone, timedelta
import asyncio
import logging
import json
import os
import httpx
from ..database import get_db
from .. import models, schemas
from ..auth import get_current_user, get_visible_group_ids
from ..plans import enforce_limit, _get_negocio
from ..utils.notifications import create_notification
from ..broadcaster import wa_broadcaster
from ..utils import at_informa as ati
from ..utils import legal_finance as lf
from ..utils import pagacuotas as pc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/leads", tags=["leads"])

STAGE_FLOW = {
    "lead":                          {"success": "reunion",             "failed": "recuperacion_lead"},
    "reunion":                       {"success": "altamente_interesado","failed": "recuperacion_reunion"},
    "altamente_interesado":          {"success": "cierre",              "failed": "recuperacion_reunion"},
    "cierre":                        {"success": "pago_pendiente",      "failed": "recuperacion_cierre"},
    "pago_pendiente":                {"success": "pagado_confirmado",   "failed": "recuperacion_pago"},
    "pago_comprometido":             {"success": "pagado_confirmado",   "failed": "recuperacion_pago"},
    "pagado_reunion":                {"success": "pagado_confirmado",   "failed": "recuperacion_cierre"},
    "pagado_confirmado":             {"success": "pagado_confirmado",   "failed": "recuperacion_cierre"},
    "recuperacion_lead":             {"success": "reunion",             "failed": "recuperacion_lead"},
    "recuperacion_reunion":          {"success": "altamente_interesado","failed": "recuperacion_reunion"},
    "recuperacion_cierre":           {"success": "pago_comprometido",   "failed": "recuperacion_cierre"},
    "recuperacion_pago":             {"success": "pago_comprometido",   "failed": "recuperacion_pago"},
}


def _visible_leads(q, current_user, db=None):
    if current_user.role == "verificador":
        return q.filter(models.Lead.current_stage.in_([
            "cierre", "pago_comprometido", "pagado_confirmado", "recuperacion_cierre", "recuperacion_pago",
        ]))
    if current_user.role == "agendadora":
        return q.filter(models.Lead.agendadora_id == current_user.id)
    if current_user.role == "vendedor":
        return q.filter(models.Lead.vendedor_id == current_user.id)
    # superadmin, subadmin, tecnico — scope to their negocio
    if db is not None:
        gids = get_visible_group_ids(db, current_user)
        if gids is not None:
            q = q.filter(models.Lead.group_id.in_(gids))
    return q


@router.get("", response_model=List[schemas.LeadOut])
def list_leads(
    stage: Optional[str] = None,
    group_id: Optional[int] = None,
    area_id: Optional[int] = None,
    area_name: Optional[str] = None,
    agendadora_id: Optional[int] = None,
    vendedor_id: Optional[int] = None,
    search: Optional[str] = None,
    created_from: Optional[str] = None,
    created_to: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    q = db.query(models.Lead).options(
        selectinload(models.Lead.contact),
        selectinload(models.Lead.agendadora),
        selectinload(models.Lead.vendedor),
        selectinload(models.Lead.area).selectinload(models.Area.phone_configs),
        selectinload(models.Lead.group),
        selectinload(models.Lead.payment_verification),
    )
    q = _visible_leads(q, current_user, db)
    if stage:
        q = q.filter(models.Lead.current_stage == stage)
    if group_id:
        q = q.filter(models.Lead.group_id == group_id)
    if area_name:
        q = q.join(models.Area, models.Lead.area_id == models.Area.id).filter(models.Area.name == area_name)
    elif area_id:
        q = q.filter(models.Lead.area_id == area_id)
    if agendadora_id:
        q = q.filter(models.Lead.agendadora_id == agendadora_id)
    if vendedor_id:
        q = q.filter(models.Lead.vendedor_id == vendedor_id)
    if search:
        from sqlalchemy import or_
        from ..models import Contact
        q = q.join(models.Lead.contact).filter(
            or_(
                Contact.name.ilike(f"%{search}%"),
                Contact.phone.ilike(f"%{search}%"),
                Contact.rut_persona.ilike(f"%{search}%"),
            )
        )
    if created_from:
        q = q.filter(models.Lead.created_at >= datetime.fromisoformat(created_from).replace(tzinfo=timezone.utc))
    if created_to:
        end = datetime.fromisoformat(created_to).replace(tzinfo=timezone.utc) + timedelta(days=1)
        q = q.filter(models.Lead.created_at < end)
    limit = min(limit, 500)
    from sqlalchemy import func as _func_leads
    _rec = _func_leads.coalesce(models.Lead.updated_at, models.Lead.created_at)
    leads = q.order_by(_rec.desc()).offset(offset).limit(limit).all()
    
    # Calculate unread counts dynamically for these leads
    lead_ids = [l.id for l in leads]
    if lead_ids:
        from sqlalchemy import func
        unread_counts = db.query(
            models.WhatsAppMessage.lead_id, 
            func.count(models.WhatsAppMessage.id)
        ).filter(
            models.WhatsAppMessage.lead_id.in_(lead_ids),
            models.WhatsAppMessage.direction == "in",
            models.WhatsAppMessage.is_read == False
        ).group_by(models.WhatsAppMessage.lead_id).all()
        
        count_map = {row[0]: row[1] for row in unread_counts}
        for l in leads:
            l.unread_count = count_map.get(l.id, 0)

        # Bulk: which leads have a reunion scheduled
        reunion_ids = set(
            r[0] for r in db.query(models.CalendarEvent.lead_id).filter(
                models.CalendarEvent.lead_id.in_(lead_ids),
                models.CalendarEvent.event_type == "reunion",
            ).distinct().all()
            if r[0] is not None
        )
        for l in leads:
            l.has_reunion_scheduled = l.id in reunion_ids
    else:
        for l in leads:
            l.unread_count = 0
            l.has_reunion_scheduled = False

    return leads


@router.get("/count")
def count_leads(
    stage: Optional[str] = None,
    group_id: Optional[int] = None,
    area_id: Optional[int] = None,
    area_name: Optional[str] = None,
    agendadora_id: Optional[int] = None,
    vendedor_id: Optional[int] = None,
    search: Optional[str] = None,
    exclude_ai: Optional[bool] = None,
    created_from: Optional[str] = None,
    created_to: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    q = db.query(func.count(models.Lead.id))
    q = _visible_leads(q, current_user, db)
    if stage:
        q = q.filter(models.Lead.current_stage == stage)
    if group_id:
        q = q.filter(models.Lead.group_id == group_id)
    if area_name:
        q = q.join(models.Area, models.Lead.area_id == models.Area.id).filter(models.Area.name == area_name)
    elif area_id:
        q = q.filter(models.Lead.area_id == area_id)
    if agendadora_id:
        q = q.filter(models.Lead.agendadora_id == agendadora_id)
    if vendedor_id:
        q = q.filter(models.Lead.vendedor_id == vendedor_id)
    if exclude_ai:
        q = q.filter(models.Lead.ai_agent_id.is_(None))
    if search:
        from sqlalchemy import or_
        from ..models import Contact
        q = q.join(models.Lead.contact).filter(
            or_(
                Contact.name.ilike(f"%{search}%"),
                Contact.phone.ilike(f"%{search}%"),
                Contact.rut_persona.ilike(f"%{search}%"),
            )
        )
    if created_from:
        q = q.filter(models.Lead.created_at >= datetime.fromisoformat(created_from).replace(tzinfo=timezone.utc))
    if created_to:
        end = datetime.fromisoformat(created_to).replace(tzinfo=timezone.utc) + timedelta(days=1)
        q = q.filter(models.Lead.created_at < end)
    return {"total": q.scalar()}


PIPELINE_STAGES = [
    "lead", "reunion", "altamente_interesado", "cierre",
    "pago_pendiente", "pago_comprometido", "pagado_confirmado",
    "recuperacion_lead", "recuperacion_reunion", "recuperacion_cierre", "recuperacion_pago",
    "papelera",
]
PIPELINE_COL_LIMIT = 10

_INACTIVE_STAGES = ["lead", "reunion", "altamente_interesado", "cierre", "pago_pendiente", "pago_comprometido"]


@router.get("/inactive-leads")
def get_inactive_leads(
    days: int = 10,
    group_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Leads in active stages with no activity for `days` days. Used for the inactivity warning popup."""
    from sqlalchemy import func as _func
    from datetime import datetime, timezone, timedelta
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    q = (
        db.query(models.Lead)
        .options(
            selectinload(models.Lead.contact),
            selectinload(models.Lead.agendadora),
            selectinload(models.Lead.area),
        )
        .filter(
            models.Lead.current_stage.in_(_INACTIVE_STAGES),
            _func.coalesce(models.Lead.updated_at, models.Lead.created_at) < cutoff,
            models.Lead.deleted_at.is_(None),
        )
    )
    q = _visible_leads(q, current_user, db)
    if group_id:
        q = q.filter(models.Lead.group_id == group_id)
    leads = q.order_by(
        _func.coalesce(models.Lead.updated_at, models.Lead.created_at).asc()
    ).limit(100).all()
    from ..schemas import LeadOut
    return [LeadOut.model_validate(l) for l in leads]


@router.get("/agent-queue")
def agent_queue(
    group_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Leads auto-created by AI agents that need agendadora attention."""
    q = db.query(models.Lead).options(
        joinedload(models.Lead.contact),
        joinedload(models.Lead.agendadora),
        joinedload(models.Lead.vendedor),
        joinedload(models.Lead.area),
        joinedload(models.Lead.group),
    ).filter(
        models.Lead.ai_agent_id.isnot(None),
        models.Lead.current_stage == 'lead',
    )
    q = _visible_leads(q, current_user, db)
    if group_id:
        q = q.filter(models.Lead.group_id == group_id)
    leads = q.order_by(models.Lead.created_at.desc()).limit(50).all()
    for l in leads:
        l.unread_count = 0
    return {
        "count": q.count(),
        "leads": [schemas.LeadOut.model_validate(l) for l in leads],
    }


@router.patch("/{lead_id}/dismiss-agent")
def dismiss_agent(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Mark an AI-handled lead as attended — removes it from the agent queue."""
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    lead.ai_agent_id = None
    db.commit()
    return {"ok": True}


@router.get("/pipeline-summary")
def pipeline_summary(
    group_id: Optional[int] = None,
    area_id: Optional[int] = None,
    area_name: Optional[str] = None,
    agendadora_id: Optional[int] = None,
    created_from: Optional[str] = None,
    created_to: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Kanban board: per-stage counts + top PIPELINE_COL_LIMIT leads per stage.
    Optimizado: 3 queries totales en lugar de 24+ (window function + selectinload batched).
    """
    from sqlalchemy import func as _func

    def _apply_filters(q):
        if group_id:
            q = q.filter(models.Lead.group_id == group_id)
        if area_name:
            q = q.join(models.Area, models.Lead.area_id == models.Area.id).filter(
                models.Area.name == area_name
            )
        elif area_id:
            q = q.filter(models.Lead.area_id == area_id)
        if agendadora_id:
            q = q.filter(models.Lead.agendadora_id == agendadora_id)
        if created_from:
            q = q.filter(models.Lead.created_at >= datetime.fromisoformat(created_from).replace(tzinfo=timezone.utc))
        if created_to:
            end = datetime.fromisoformat(created_to).replace(tzinfo=timezone.utc) + timedelta(days=1)
            q = q.filter(models.Lead.created_at < end)
        return q

    # ── QUERY 1: todos los counts de una vez con GROUP BY ─────────────────────
    _recovery_stages = {"recuperacion_lead", "recuperacion_reunion", "recuperacion_cierre", "recuperacion_pago"}

    # Leads de pago vencidos (≥ gracia días desde compromiso o entrada a la etapa)
    # caen al panel del Asistente de Seguimiento — fuera del kanban.
    from .seguimiento_asistente import _get_dias_gracia as _seg_gracia
    _seg_cutoff = datetime.now(timezone.utc).date() - timedelta(days=_seg_gracia(db))
    _hist_entry = (
        db.query(_func.max(models.LeadHistory.created_at))
        .filter(
            models.LeadHistory.lead_id == models.Lead.id,
            models.LeadHistory.to_stage == models.Lead.current_stage,
        )
        .correlate(models.Lead)
        .scalar_subquery()
    )
    _seg_fecha_base = _func.coalesce(
        models.Lead.payment_commitment_date,
        _func.date(_hist_entry),
        _func.date(_func.coalesce(models.Lead.updated_at, models.Lead.created_at)),
    )
    _pago_en_seguimiento = (
        models.Lead.current_stage.in_(["pago_pendiente", "pago_comprometido"])
        & (_seg_fecha_base <= _seg_cutoff)
        & (models.Lead.seguimiento_status.is_(None) | models.Lead.seguimiento_status.notin_(["pagado", "perdido"]))
    )

    count_q = db.query(models.Lead.current_stage, _func.count(models.Lead.id))
    count_q = _visible_leads(count_q, current_user, db)
    count_q = _apply_filters(count_q)
    # Excluir no_show/sin_exito y seguimiento del conteo (mismo criterio que la vista de tarjetas)
    count_q = count_q.filter(
        models.Lead.current_stage.in_(list(_recovery_stages)) |
        (
            (models.Lead.last_vendor_outcome.is_(None)) |
            (models.Lead.last_vendor_outcome.notin_(["sin_exito", "no_show"]))
        )
    ).filter(
        models.Lead.current_stage.in_(list(_recovery_stages)) |
        ~(
            (models.Lead.current_stage == "altamente_interesado") &
            (models.Lead.payment_commitment_date.isnot(None))
        )
    ).filter(~_pago_en_seguimiento)
    count_map: dict[str, int] = dict(count_q.group_by(models.Lead.current_stage).all())

    papelera_count = count_map.pop("papelera", 0)

    # ── QUERY 2: window function — top N leads por stage en una sola query ────
    # COALESCE(updated_at, created_at) DESC → leads recientes/nuevos siempre primero
    _recency = _func.coalesce(models.Lead.updated_at, models.Lead.created_at)
    rn_col = _func.row_number().over(
        partition_by=models.Lead.current_stage,
        order_by=_recency.desc(),
    ).label("rn")

    # Subquery con los IDs que queremos
    stages_to_show = [s for s in PIPELINE_STAGES if s != "papelera"]
    # reunion incluye pagado_reunion; papelera se busca por separado (sin filtro sin_exito)
    stages_kanban = stages_to_show + ["pagado_reunion"]

    # Main kanban stages: exclude sin_exito (go to Seguimiento tab instead)
    # Recovery stages: ALWAYS show regardless of last_vendor_outcome
    main_kanban_stages = [s for s in stages_kanban if s not in _recovery_stages]
    inner_kanban_main = (
        db.query(models.Lead.id, models.Lead.current_stage, rn_col)
        .filter(models.Lead.current_stage.in_(main_kanban_stages))
    )
    inner_kanban_main = _visible_leads(inner_kanban_main, current_user, db)
    inner_kanban_main = _apply_filters(inner_kanban_main)
    inner_kanban_main = inner_kanban_main.filter(
        (models.Lead.last_vendor_outcome.is_(None)) |
        (models.Lead.last_vendor_outcome.notin_(["sin_exito", "no_show"]))
    ).filter(
        # Leads en seguimiento (altamente_interesado con fecha compromiso) solo se ven en panel seguimiento
        ~(
            (models.Lead.current_stage == "altamente_interesado") &
            (models.Lead.payment_commitment_date.isnot(None))
        )
    ).filter(~_pago_en_seguimiento)

    rn_rec = _func.row_number().over(
        partition_by=models.Lead.current_stage,
        order_by=_recency.desc(),
    ).label("rn")
    inner_kanban_rec = (
        db.query(models.Lead.id, models.Lead.current_stage, rn_rec)
        .filter(models.Lead.current_stage.in_(list(_recovery_stages)))
    )
    inner_kanban_rec = _visible_leads(inner_kanban_rec, current_user, db)
    inner_kanban_rec = _apply_filters(inner_kanban_rec)

    sub_kanban_main = inner_kanban_main.subquery()
    sub_kanban_rec  = inner_kanban_rec.subquery()

    # Papelera stages (sin filtro sin_exito)
    rn_papelera = _func.row_number().over(
        partition_by=models.Lead.current_stage,
        order_by=_recency.desc(),
    ).label("rn")
    inner_papelera = (
        db.query(models.Lead.id, models.Lead.current_stage, rn_papelera)
        .filter(models.Lead.current_stage == "papelera")
    )
    inner_papelera = _visible_leads(inner_papelera, current_user, db)
    inner_papelera = _apply_filters(inner_papelera)
    sub_papelera = inner_papelera.subquery()

    top_id_rows_main = (
        db.query(sub_kanban_main.c.id, sub_kanban_main.c.current_stage)
        .filter(sub_kanban_main.c.rn <= PIPELINE_COL_LIMIT)
        .all()
    )
    top_id_rows_rec = (
        db.query(sub_kanban_rec.c.id, sub_kanban_rec.c.current_stage)
        .filter(sub_kanban_rec.c.rn <= PIPELINE_COL_LIMIT)
        .all()
    )
    top_id_rows = top_id_rows_main + top_id_rows_rec
    papelera_id_rows = (
        db.query(sub_papelera.c.id, sub_papelera.c.current_stage)
        .filter(sub_papelera.c.rn <= 50)
        .all()
    )
    top_ids = [r[0] for r in top_id_rows] + [r[0] for r in papelera_id_rows]

    # Mapear stage para cada ID (para pagado_reunion → reunion slot)
    id_to_stage = {r[0]: r[1] for r in top_id_rows}
    id_to_stage.update({r[0]: r[1] for r in papelera_id_rows})

    # ── QUERY 3: cargar leads con selectinload (N relaciones en batch, no JOINs) ──
    all_leads: list[models.Lead] = []
    if top_ids:
        all_leads = (
            db.query(models.Lead)
            .options(
                selectinload(models.Lead.contact),
                selectinload(models.Lead.agendadora),
                selectinload(models.Lead.vendedor),
                selectinload(models.Lead.area).selectinload(models.Area.phone_configs),
                selectinload(models.Lead.group),
                selectinload(models.Lead.payment_verification),
            )
            .filter(models.Lead.id.in_(top_ids))
            .all()
        )

    # ── Bulk unread counts (1 query) ──────────────────────────────────────────
    if all_leads:
        unread_rows = db.query(
            models.WhatsAppMessage.lead_id,
            _func.count(models.WhatsAppMessage.id),
        ).filter(
            models.WhatsAppMessage.lead_id.in_(top_ids),
            models.WhatsAppMessage.direction == "in",
            models.WhatsAppMessage.is_read == False,
        ).group_by(models.WhatsAppMessage.lead_id).all()
        unread_map = {r[0]: r[1] for r in unread_rows}

        reunion_ids = set(
            r[0]
            for r in db.query(models.CalendarEvent.lead_id)
            .filter(
                models.CalendarEvent.lead_id.in_(top_ids),
                models.CalendarEvent.event_type == "reunion",
            )
            .distinct()
            .all()
            if r[0] is not None
        )
        for lead in all_leads:
            lead.unread_count = unread_map.get(lead.id, 0)
            lead.has_reunion_scheduled = lead.id in reunion_ids

    # ── Armar respuesta por stage ─────────────────────────────────────────────
    from collections import defaultdict
    from ..schemas import LeadOut

    stage_leads: dict[str, list] = defaultdict(list)
    for lead in all_leads:
        # pagado_reunion aparece en la columna pago_pendiente (con badge "Validando Pago Reunión")
        slot = "pago_pendiente" if lead.current_stage == "pagado_reunion" else lead.current_stage
        stage_leads[slot].append(LeadOut.model_validate(lead))

    serialized: dict = {}
    for stage in stages_to_show:
        base_count = count_map.get(stage, 0)
        if stage == "pago_pendiente":
            base_count += count_map.get("pagado_reunion", 0)
        serialized[stage] = {
            "count": base_count,
            "leads": stage_leads.get(stage, []),
        }
    # Papelera: leads reales cargados
    serialized["papelera"] = {
        "count": papelera_count,
        "leads": stage_leads.get("papelera", []),
    }
    serialized["_papelera_count"] = papelera_count
    return serialized


@router.post("", response_model=schemas.LeadOut)
def create_lead(
    data: schemas.LeadCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    # Plan limit: count active (non-cerrado) leads in the negocio
    negocio = _get_negocio(db, data.group_id)
    if negocio:
        all_group_ids_q = db.query(models.Group.id).filter(
            (models.Group.id == negocio.id) | (models.Group.negocio_id == negocio.id)
        ).subquery()
        active_count = db.query(models.Lead).filter(
            models.Lead.group_id.in_(all_group_ids_q),
            models.Lead.current_stage != "cerrado",
        ).count()
        enforce_limit(db, data.group_id, "max_leads", active_count)

    lead = models.Lead(**data.model_dump(), current_stage="lead")
    db.add(lead)
    db.flush()
    history = models.LeadHistory(
        lead_id=lead.id,
        from_stage=None,
        to_stage="lead",
        result="pending",
        notes="Lead creado",
        created_by=current_user.id,
    )
    db.add(history)
    db.commit()
    db.refresh(lead)

    # Reload with relations for notifications
    full_lead = db.query(models.Lead).options(
        joinedload(models.Lead.contact),
        joinedload(models.Lead.agendadora),
        joinedload(models.Lead.vendedor),
        joinedload(models.Lead.area).joinedload(models.Area.phone_configs),
        joinedload(models.Lead.group),
        joinedload(models.Lead.payment_verification),
    ).filter(models.Lead.id == lead.id).first()

    contact_name = full_lead.contact.name if full_lead.contact else "nuevo cliente"
    area_name = full_lead.area.name if full_lead.area else ""

    # Notify agendadora (unless they created it themselves)
    if data.agendadora_id and data.agendadora_id != current_user.id:
        try:
            create_notification(
                db, data.agendadora_id,
                "Nuevo lead asignado",
                f"Se te asignó un nuevo lead: {contact_name} — Área: {area_name}",
                lead_id=lead.id,
                notification_type="lead_nuevo",
            )
            db.commit()
        except Exception:
            pass

    # Notify vendedor — only when NOT created manually by an agendadora
    # (agendadora manual leads notify the vendor only when a reunion is scheduled)
    if data.vendedor_id and data.vendedor_id != current_user.id and data.vendedor_id != data.agendadora_id \
            and current_user.role != "agendadora":
        try:
            create_notification(
                db, data.vendedor_id,
                "Nuevo lead en tu pipeline",
                f"Nuevo cliente: {contact_name} — Área: {area_name}",
                lead_id=lead.id,
                notification_type="lead_nuevo",
            )
            db.commit()
        except Exception:
            pass

    wa_broadcaster.broadcast_sync("lead_update", {"action": "create", "lead_id": full_lead.id})
    return full_lead


# ── EXPORT CSV ─────────────────────────────────────────────
@router.get("/export/csv")
def export_leads_csv(
    group_id: Optional[int] = None,
    stage: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    import csv, io
    from sqlalchemy import or_
    from sqlalchemy.orm import joinedload as jl

    q = db.query(models.Lead).options(
        jl(models.Lead.contact),
        jl(models.Lead.area),
        jl(models.Lead.group),
        jl(models.Lead.agendadora),
        jl(models.Lead.vendedor),
    )

    if current_user.role == "agendadora":
        q = q.filter(models.Lead.agendadora_id == current_user.id)
    elif current_user.role == "vendedor":
        q = q.filter(models.Lead.vendedor_id == current_user.id)
    elif current_user.role == "verificador":
        q = q.filter(models.Lead.current_stage.in_(
            ["cierre", "pago_comprometido", "pagado_confirmado", "recuperacion_cierre", "recuperacion_pago"]
        ))
    else:
        # superadmin, subadmin, tecnico — scope to their negocio
        gids = get_visible_group_ids(db, current_user)
        if gids is not None:
            q = q.filter(models.Lead.group_id.in_(gids))
        elif group_id:  # tecnico filtering by specific group
            q = q.filter(models.Lead.group_id == group_id)

    if stage:
        q = q.filter(models.Lead.current_stage == stage)

    if search:
        q = q.join(models.Contact, models.Lead.contact_id == models.Contact.id, isouter=True).filter(
            or_(
                models.Contact.name.ilike(f"%{search}%"),
                models.Contact.phone.ilike(f"%{search}%"),
                models.Contact.rut_persona.ilike(f"%{search}%"),
            )
        )

    leads = q.order_by(models.Lead.updated_at.desc().nullslast()).all()

    STAGE_LABELS_ES = {
        "lead": "Lead",
        "reunion": "Reunión",
        "altamente_interesado": "Altamente Interesado",
        "cierre": "Cierre",
        "pago_comprometido": "Pago Comprometido",
        "pagado_confirmado": "Pago Confirmado",
        "recuperacion_lead": "Recuperación Lead",
        "recuperacion_reunion": "Recuperación Reunión",
        "recuperacion_cierre": "Recuperación Cierre",
        "recuperacion_pago": "Recuperación Pago",
    }

    now = datetime.now()
    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")

    writer.writerow([
        "Nombre", "Teléfono", "Correo", "RUT", "Empresa",
        "Grupo", "Área", "Etapa", "Honorarios ($)",
        "Días sin actividad", "Prioridad",
        "Agendador/a", "Vendedor", "Fecha creación",
    ])

    for lead in leads:
        c = lead.contact
        updated = lead.updated_at or lead.created_at
        days_since = max(0, (now - updated.replace(tzinfo=None)).days) if updated else 0
        writer.writerow([
            c.name if c else "",
            c.phone if c else "",
            c.email if c else "",
            c.rut_persona if c else "",
            c.razon_social if c else "",
            lead.group.name if lead.group else "",
            lead.area.name if lead.area else "",
            STAGE_LABELS_ES.get(lead.current_stage, lead.current_stage),
            f"{lead.honorarios:,.0f}".replace(",", ".") if lead.honorarios else "0",
            days_since,
            {"low": "Baja", "normal": "Normal", "high": "Alta"}.get(lead.priority or "", "Normal"),
            lead.agendadora.name if lead.agendadora else "",
            lead.vendedor.name if lead.vendedor else "",
            lead.created_at.strftime("%d/%m/%Y") if lead.created_at else "",
        ])

    # BOM for Excel UTF-8
    content = "﻿" + output.getvalue()
    filename = f"clientes_{now.strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        io.BytesIO(content.encode("utf-8")),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _check_lead_access(lead: models.Lead, current_user: models.User, db=None):
    """Verify the current user is allowed to read/write this specific lead."""
    if current_user.role == "tecnico":
        return
    if current_user.role in ("superadmin", "subadmin"):
        if db is not None:
            gids = get_visible_group_ids(db, current_user)
            if gids is not None and lead.group_id not in gids:
                raise HTTPException(status_code=403, detail="Sin permiso para este lead")
        elif current_user.group_id and lead.group_id != current_user.group_id:
            raise HTTPException(status_code=403, detail="Sin permiso para este lead")
        return
    if current_user.role == "verificador":
        allowed = {"cierre", "pago_comprometido", "pagado_confirmado", "recuperacion_cierre", "recuperacion_pago"}
        if lead.current_stage not in allowed:
            raise HTTPException(status_code=403, detail="Sin permiso para este lead")
        return
    if current_user.role in ("agendadora", "vendedor"):
        if lead.agendadora_id != current_user.id and lead.vendedor_id != current_user.id:
            raise HTTPException(status_code=403, detail="Sin permiso para este lead")
        return
    raise HTTPException(status_code=403, detail="Sin permiso para este lead")


@router.get("/{lead_id}", response_model=schemas.LeadOut)
def get_lead(lead_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    lead = db.query(models.Lead).options(
        joinedload(models.Lead.contact),
        joinedload(models.Lead.agendadora),
        joinedload(models.Lead.vendedor),
        joinedload(models.Lead.area).joinedload(models.Area.phone_configs),
        joinedload(models.Lead.group),
        joinedload(models.Lead.payment_verification),
    ).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    _check_lead_access(lead, current_user, db)
    lead.has_reunion_scheduled = db.query(models.CalendarEvent).filter(
        models.CalendarEvent.lead_id == lead_id,
        models.CalendarEvent.event_type == "reunion",
    ).count() > 0
    return lead


@router.put("/{lead_id}", response_model=schemas.LeadOut)
def update_lead(
    lead_id: int,
    data: schemas.LeadUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    _check_lead_access(lead, current_user, db)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(lead, field, value)
    db.commit()
    db.refresh(lead)
    wa_broadcaster.broadcast_sync("lead_update", {"action": "update", "lead_id": lead_id})
    return db.query(models.Lead).options(
        joinedload(models.Lead.contact),
        joinedload(models.Lead.agendadora),
        joinedload(models.Lead.vendedor),
        joinedload(models.Lead.area).joinedload(models.Area.phone_configs),
        joinedload(models.Lead.group),
        joinedload(models.Lead.payment_verification),
    ).filter(models.Lead.id == lead_id).first()


def _resolve_wa_config(lead: models.Lead, db):
    """Active WhatsApp config for a lead — delega en el resolver central
    (conversación real del contacto → área → grupo → cualquiera activa,
    saltando sesiones QR explícitamente caídas). Ver whatsapp.resolve_wa_config."""
    from .whatsapp import resolve_wa_config
    return resolve_wa_config(
        db,
        contact_id=lead.contact_id,
        area_id=lead.area_id,
        group_id=lead.group_id,
    )


def _dispatch_payment_link_wa(lead: models.Lead, contact: models.Contact, payment_link: str, db, custom_message: str | None = None):
    """Send the PagaCuotas payment link to the client via WhatsApp (best-effort)."""
    try:
        cfg = _resolve_wa_config(lead, db)
        if not cfg:
            logger.warning("No hay ninguna config WA activa — no se envió el link de pago al lead %s", lead.id)
            return

        if custom_message:
            message = custom_message
        else:
            nombre = contact.name.split()[0] if contact.name else "estimado cliente"
            monto = int(lead.monto_cuota or lead.cuota_inicial or lead.honorarios or 0)
            message = (
                f"Hola {nombre}, tu acuerdo de pago en Abogados Tributarios fue registrado exitosamente. ✅\n\n"
                f"💳 *Monto por cuota:* ${monto:,}\n"
                f"📋 *Cuotas:* {lead.num_cuotas or 1}\n\n"
                f"Usa este enlace personal para entrar a tu Portal PagaCuotas:\n"
                f"🔗 {payment_link}\n\n"
                f"_Este enlace es tuyo y puedes usarlo para revisar tu caso y pagar._\n"
                f"Saludos, Abogados Tributarios."
            ).replace(",", ".")

        from ..routers.whatsapp import send_whatsapp_api

        msg_result = asyncio.run(send_whatsapp_api(cfg, contact.phone, message))

        msg = models.WhatsAppMessage(
            contact_id=contact.id,
            lead_id=lead.id,
            whatsapp_config_id=cfg.id,
            direction="out",
            message_type="text",
            content=message,
            status=msg_result.get("status", "logged"),
            message_id=msg_result.get("message_id"),
        )
        db.add(msg)
        db.commit()
        logger.info("Link de pago enviado por WA a %s para lead %s", contact.phone, lead.id)
    except Exception as exc:
        logger.warning("No se pudo enviar link de pago WA para lead %s: %s", lead.id, exc)


def _get_negocio_tipo(lead: models.Lead, db) -> str:
    """Return the tipo of the lead's root negocio group."""
    if not lead.group_id or not db:
        return "abogados"
    g = db.query(models.Group).filter(models.Group.id == lead.group_id).first()
    if not g:
        return "abogados"
    root_id = g.negocio_id if g.negocio_id else g.id
    root = db.query(models.Group).filter(models.Group.id == root_id).first()
    return (root.tipo if root and root.tipo else "abogados")


def _fire_integrations(lead: models.Lead, new_stage: str, db=None):
    """Fire-and-forget: push stage transitions to AT Informa and Legal Finance."""
    # Only fire for abogados-type negocios
    if _get_negocio_tipo(lead, db) != "abogados":
        return

    contact    = lead.contact
    vendedor   = lead.vendedor
    agendadora = lead.agendadora
    area       = lead.area
    category   = area.name if area else "TRIBUTARIO"

    # ── AT Informa: reunion stage ─────────────────────────────────────────
    if new_stage == "reunion":
        try:
            # Look up the scheduled reunion event for meeting time
            meeting_at_iso = None
            meeting_duration = 60
            if db:
                event = (
                    db.query(models.CalendarEvent)
                    .filter(
                        models.CalendarEvent.lead_id == lead.id,
                        models.CalendarEvent.event_type == "reunion",
                        models.CalendarEvent.is_completed == False,
                    )
                    .order_by(models.CalendarEvent.start_time.desc())
                    .first()
                )
                if event:
                    meeting_at_iso = event.start_time.isoformat()
                    if event.end_time:
                        meeting_duration = max(15, int((event.end_time - event.start_time).total_seconds() / 60))

            result = asyncio.run(ati.push_reunion_lead(
                crm_lead_id      = lead.id,
                full_name        = contact.name if contact else "Cliente",
                email            = contact.email or f"lead_{lead.id}@crm.local",
                phone            = contact.phone if contact else "",
                category         = category,
                service_desc     = lead.service_description,
                honorarios       = lead.honorarios or 0,
                vendedor_email   = vendedor.email if vendedor else None,
                agendadora_name  = agendadora.name if agendadora else None,
                at_vendedor_id   = vendedor.at_informa_user_id if vendedor else None,
                meeting_at       = meeting_at_iso,
                meeting_duration = meeting_duration,
            ))
            # Store AT Informa lead/case ID on the lead for traceability
            at_id = result.get("leadId") or result.get("caseId")
            if db and at_id:
                lead.at_informa_case_id = at_id
                db.commit()
            logger.info("AT Informa notified: lead %s → reunion (at_id: %s)", lead.id, at_id)
        except Exception as exc:
            logger.warning("AT Informa push failed (non-critical) for lead %s: %s", lead.id, exc)

    # ── Legal Finance: pago_pendiente / pago_comprometido / pagado_reunion ──
    # pagado_reunion (pago rápido en reunión) también debe crear el contrato en
    # el contable: así finanzas genera las credenciales y las envía al cliente
    # automáticamente, igual que en pago_pendiente/comprometido.
    elif new_stage in ("pago_comprometido", "pago_pendiente", "pagado_reunion"):
        try:
            rut = (
                (contact.rut_persona or contact.rut_empresa) if contact else None
            ) or f"SIN-RUT-{lead.id}"

            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

            result = asyncio.run(lf.push_pago_comprometido(
                crm_lead_id   = lead.id,
                rut           = rut,
                nombre        = contact.name if contact else "Cliente",
                email         = contact.email if contact else None,
                phone         = contact.phone if contact else None,
                honorarios    = float(lead.honorarios or 0),
                cuota_inicial = _derive_cuota_inicial(lead),
                num_cuotas    = int(lead.num_cuotas or 1),
                tipo_servicio = lead.service_description or category,
                fecha_ingreso = today,
            ))
            # Store Legal Finance contract ID on the lead
            if db and result and result.get("contratoId"):
                lead.legal_finance_contrato_id = int(result["contratoId"])
                db.commit()
            logger.info(
                "Legal Finance notified: lead %s → pago_comprometido (contrato: %s)",
                lead.id, result.get("contratoId"),
            )
        except httpx.HTTPStatusError as exc:
            body_preview = ""
            try:
                body_preview = exc.response.text[:500]
            except Exception:
                pass
            logger.error(
                "Legal Finance push REJECTED for lead %s — HTTP %s: %s",
                lead.id, exc.response.status_code, body_preview,
            )
        except Exception as exc:
            logger.warning("Legal Finance push failed (non-critical) for lead %s: %s", lead.id, exc)

    # ── PagaCuotas: pago_pendiente / pago_comprometido / pagado_reunion stage ───
    if new_stage in ("pago_comprometido", "pago_pendiente", "pagado_reunion"):
        try:
            rut = (
                (contact.rut_persona or contact.rut_empresa) if contact else None
            ) or f"SIN-RUT-{lead.id}"

            area_name = lead.area.name if lead.area else "Sin categoría"
            vendedor_name = lead.vendedor.name if lead.vendedor else None

            result = asyncio.run(pc.crear_cliente(
                db            = db,
                crm_lead_id   = lead.id,
                rut           = rut,
                nombre        = contact.name if contact else "Cliente",
                razon_social  = getattr(contact, "razon_social", None) if contact else None,
                email         = contact.email if contact else None,
                phone         = contact.phone if contact else None,
                honorarios    = float(lead.honorarios or 0),
                cuota_inicial = float(lead.cuota_inicial or 0),
                num_cuotas    = int(lead.num_cuotas or 1),
                monto_cuota   = float(lead.monto_cuota or 0),
                tipo_servicio = lead.service_description or area_name,
                area_name     = area_name,
                vendedor_name = vendedor_name,
            ))
            if db:
                lead.pagacuotas_cliente_id = str(result.get("id", ""))
                lead.pagacuotas_status = "created"
                lead.pagacuotas_link = result.get("payment_link")
                db.commit()

            # Send payment link via WhatsApp — use message from pagaCuotas if available
            payment_link = result.get("payment_link")
            wa_info = result.get("whatsapp", {})
            if payment_link and contact and contact.phone:
                _dispatch_payment_link_wa(
                    lead, contact, payment_link, db,
                    custom_message=wa_info.get("message"),
                )

            logger.info(
                "PagaCuotas: cliente registrado para lead %s → %s",
                lead.id, payment_link,
            )
        except Exception as exc:
            logger.warning("PagaCuotas push failed (non-critical) for lead %s: %s", lead.id, exc)
            if db:
                lead.pagacuotas_status = "failed"
                db.commit()

        # Empuje a hive-service-control: movido a
        # `legal_finance_integration._handle_portal_credentials_ready`.
        # Necesita `password_plain` (que solo aparece cuando fc/PagaCuotas
        # generan las credenciales y NEXIO recibe el callback
        # `pagacuotas_ready`). Antes este push se intentaba acá sin
        # password y devolvía 422.

    # ── AT INFORMA (hive-service-control): pagado_confirmado ──────────────
    # La OT nace en AT INFORMA cuando el pipeline llega a "Pago Confirmado"
    # (el lead queda apto como cliente y con el pago al día). Para entonces el
    # caso ya existe en control (creado por la vía PagaCuotas/credenciales), así
    # que empujamos su OT vigente por el endpoint work-orders — no requiere
    # password y resuelve el caso por crm_lead_id/rut/case_code. Best-effort: si
    # el caso aún no aterrizó es no-op y la OT viajará al reintentar. Cubre los
    # movimientos manuales del pipeline; el camino por webhook de LF lo cubre
    # `legal_finance_integration._handle_payment_confirmed`.
    if new_stage == "pagado_confirmado" and db:
        try:
            from .work_orders import select_integration_work_order, _sync_ot_to_service_control
            wo = select_integration_work_order(db, lead.id)
            if wo:
                _sync_ot_to_service_control(wo, db)
                logger.info("OT de lead %s empujada a control (pago confirmado)", lead.id)
        except Exception as exc:
            logger.warning(
                "Sync OT a control (pago confirmado) falló para lead %s: %s", lead.id, exc,
            )


def _require_financials_for_pago_comprometido(lead: models.Lead) -> None:
    """
    Valida que el lead tenga los datos financieros necesarios antes de avanzar
    a Pago Comprometido. Se acepta puerta A (cuota_inicial) o puerta B (monto_cuota).
    """
    honorarios = float(lead.honorarios or 0)
    cuota_inicial = float(lead.cuota_inicial or 0)
    num_cuotas = int(lead.num_cuotas or 0)
    monto_cuota = float(lead.monto_cuota or 0)

    if honorarios <= 0:
        raise HTTPException(
            status_code=400,
            detail="El lead debe tener Total (honorarios) definido para avanzar a esta etapa.",
        )
    if num_cuotas < 1:
        raise HTTPException(
            status_code=400,
            detail="El lead debe tener N° de cuotas (>= 1) para avanzar a esta etapa.",
        )
    if cuota_inicial > 0 or monto_cuota > 0:
        return
    raise HTTPException(
        status_code=400,
        detail=(
            "El lead necesita 'cuota inicial' O 'monto cuota' para avanzar. "
            "Llena uno de los dos para que el sistema contable pueda crear el contrato."
        ),
    )


def _derive_cuota_inicial(lead: models.Lead) -> float:
    """
    Puerta A: cuota_inicial directa.
    Puerta B: deriva cuota_inicial como honorarios - num_cuotas * monto_cuota.
    """
    honorarios = float(lead.honorarios or 0)
    cuota_inicial = float(lead.cuota_inicial or 0)
    num_cuotas = int(lead.num_cuotas or 1)
    monto_cuota = float(lead.monto_cuota or 0)
    if cuota_inicial > 0:
        return cuota_inicial
    if monto_cuota > 0 and num_cuotas >= 1:
        derived = honorarios - (num_cuotas * monto_cuota)
        return max(0.0, round(derived, 2))
    return 0.0


@router.post("/{lead_id}/advance", response_model=schemas.LeadOut)
def advance_lead(
    lead_id: int,
    data: schemas.LeadStageUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    lead = db.query(models.Lead).options(
        joinedload(models.Lead.contact),
        joinedload(models.Lead.agendadora),
        joinedload(models.Lead.vendedor),
        joinedload(models.Lead.area).joinedload(models.Area.phone_configs),
        joinedload(models.Lead.group),
        joinedload(models.Lead.payment_verification),
    ).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    current = lead.current_stage
    if current not in STAGE_FLOW:
        raise HTTPException(status_code=400, detail=f"La etapa '{current}' no puede avanzar")

    new_stage = STAGE_FLOW[current].get(data.result)
    if not new_stage:
        raise HTTPException(status_code=400, detail="Resultado inválido")

    if new_stage == "pagado_confirmado" and current_user.role != "verificador":
        raise HTTPException(status_code=403, detail="Solo el Verificador de Pagos puede confirmar el pago")

    # ── RUT obligatorio para pasar a Cierre ──────────────────────────────────
    if new_stage == "cierre":
        contact = lead.contact
        rut = (contact.rut_persona or contact.rut_empresa) if contact else None
        if not rut or not rut.strip():
            raise HTTPException(
                status_code=400,
                detail="El cliente debe tener RUT registrado antes de pasar a Cierre. Sin RUT no se puede generar la Orden de Trabajo.",
            )

    if new_stage in ("pago_comprometido", "pago_pendiente", "pagado_reunion"):
        _require_financials_for_pago_comprometido(lead)

    old_stage = current
    lead.current_stage = new_stage

    history = models.LeadHistory(
        lead_id=lead.id,
        from_stage=old_stage,
        to_stage=new_stage,
        result=data.result,
        notes=data.notes,
        created_by=current_user.id,
    )
    db.add(history)

    # Si llegó a pago_comprometido o pagado_reunion → crear/resetear PaymentVerification y notificar al verificador
    if new_stage in ("pago_comprometido", "pagado_reunion"):
        dante_users = db.query(models.User).filter(
            models.User.role == "verificador",
            models.User.is_active == True
        ).all()
        dante_id = dante_users[0].id if dante_users else current_user.id
        existing_pv = db.query(models.PaymentVerification).filter(
            models.PaymentVerification.lead_id == lead_id
        ).first()
        if existing_pv:
            existing_pv.status = "pendiente"
            existing_pv.confirmed_at = None
        else:
            db.add(models.PaymentVerification(
                lead_id=lead_id,
                assigned_to=dante_id,
                status="pendiente"
            ))
        # Always notify Dante
        if dante_id:
            contact_name_pv = lead.contact.name if lead.contact else "cliente"
            create_notification(
                db, dante_id,
                "Pago comprometido — requiere verificación",
                f"El lead de {contact_name_pv} está en 'Pago Comprometido' y requiere confirmación.",
                lead_id=lead_id,
                notification_type="pago"
            )

    # Notify the other team member about the stage change
    contact_name = lead.contact.name if lead.contact else "cliente"
    stage_labels = {
        "reunion": "Reunión", "altamente_interesado": "Altamente Interesado",
        "cierre": "Cierre", "pago_comprometido": "Pago Comprometido",
        "pagado_confirmado": "Pago Confirmado",
        "recuperacion_lead": "Recuperación Lead", "recuperacion_reunion": "Recuperación Reunión",
        "recuperacion_cierre": "Recuperación Cierre", "recuperacion_pago": "Recuperación Pago",
    }
    new_label = stage_labels.get(new_stage, new_stage)
    if data.result == "success":
        # Notify both team members (except the one who made the change)
        for uid in {lead.agendadora_id, lead.vendedor_id} - {current_user.id, None}:
            try:
                create_notification(
                    db, uid,
                    f"Lead avanzó: {new_label}",
                    f"{current_user.name} avanzó a {contact_name} → {new_label}",
                    lead_id=lead_id,
                    notification_type="etapa",
                )
            except Exception:
                pass

    db.commit()
    db.refresh(lead)
    _fire_integrations(lead, new_stage, db)
    wa_broadcaster.broadcast_sync("lead_update", {"action": "stage_change", "lead_id": lead_id, "stage": new_stage})
    return db.query(models.Lead).options(
        joinedload(models.Lead.contact),
        joinedload(models.Lead.agendadora),
        joinedload(models.Lead.vendedor),
        joinedload(models.Lead.area).joinedload(models.Area.phone_configs),
        joinedload(models.Lead.group),
        joinedload(models.Lead.payment_verification),
    ).filter(models.Lead.id == lead_id).first()


# ── Normalización determinista de RUT ────────────────────────────────────────
# "12.345.678-9", "12345678-9" y "12345678 9" deben colisionar como el MISMO
# cliente en los candados. Se limpia igual en Python (entrada) y en SQL (filas
# existentes) para que ninguna variación de formato evada la exclusividad.
def _norm_rut(rut: str | None) -> str | None:
    if not rut:
        return None
    return rut.replace(".", "").replace("-", "").replace(" ", "").strip().upper() or None


def _norm_rut_sql(col):
    return func.upper(func.replace(func.replace(func.replace(col, ".", ""), "-", ""), " ", ""))


# Etapas que "ocupan" una categoría (área) para un RUT: desde que se agenda la
# reunión hasta que el pago queda confirmado. Mientras un lead del cliente esté
# en alguna de estas etapas para un área, no puede haber un SEGUNDO lead del
# mismo RUT+área avanzando en paralelo. Se valida ya en el agendamiento (no solo
# al cobrar) para que el duplicado se detecte apenas se intenta agendar.
ACTIVE_CATEGORY_STAGES = (
    "reunion", "altamente_interesado", "cierre",
    "pago_pendiente", "pago_comprometido", "pagado_reunion", "pagado_confirmado",
)


def find_category_conflict(db, *, exclude_lead_id, area_id, rut_norm, lock=False):
    """Otro lead activo del mismo RUT que ya ocupa esta categoría (área), o None.

    Compara el RUT normalizado en SQL ("12.345.678-9" ≡ "123456789"). `lock=True`
    aplica FOR UPDATE sobre el lead rival para serializar avances concurrentes del
    mismo cliente. Devuelve el lead rival (no solo su id) para poder mostrar datos.
    """
    if not (rut_norm and area_id):
        return None
    q = db.query(models.Lead).join(
        models.Contact, models.Lead.contact_id == models.Contact.id
    ).filter(
        models.Lead.id != exclude_lead_id,
        models.Lead.area_id == area_id,
        models.Lead.current_stage.in_(ACTIVE_CATEGORY_STAGES),
        models.Lead.deleted_at.is_(None),
        or_(
            _norm_rut_sql(models.Contact.rut_persona) == rut_norm,
            _norm_rut_sql(models.Contact.rut_empresa) == rut_norm,
        ),
    )
    if lock:
        q = q.with_for_update(of=models.Lead)
    return q.first()


@router.post("/{lead_id}/move-stage", response_model=schemas.LeadOut)
def move_lead_stage(
    lead_id: int,
    data: schemas.LeadMoveStage,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Manually move a lead to any stage."""
    valid_stages = [
        "lead", "reunion", "altamente_interesado", "cierre",
        "pago_pendiente", "pago_comprometido", "pagado_reunion", "pagado_confirmado",
        "recuperacion_lead", "recuperacion_reunion", "recuperacion_cierre", "recuperacion_pago",
        "papelera",
    ]
    if data.stage not in valid_stages:
        raise HTTPException(status_code=400, detail="Etapa inválida")

    # Only dante can confirm payment
    if data.stage == "pagado_confirmado" and current_user.role != "verificador":
        raise HTTPException(status_code=403, detail="Solo el Verificador de Pagos puede confirmar el pago")

    # Dante can only move to pagado_confirmado
    if current_user.role == "verificador" and data.stage != "pagado_confirmado":
        raise HTTPException(status_code=403, detail="Sin permiso para esta etapa")

    # Lock pesimista sobre la fila del lead: serializa transiciones concurrentes
    # (doble clic ultra-rápido, dos operadoras sobre el mismo RUT). El segundo
    # request espera el commit del primero y ve el current_stage ya actualizado.
    # `of=models.Lead` es obligatorio: joinedload(contact) es LEFT OUTER JOIN y
    # Postgres no permite FOR UPDATE sobre el lado nullable del join.
    lead = db.query(models.Lead).options(
        joinedload(models.Lead.contact)
    ).filter(models.Lead.id == lead_id).with_for_update(of=models.Lead).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    if current_user.role in ("agendadora", "vendedor"):
        if lead.agendadora_id != current_user.id and lead.vendedor_id != current_user.id:
            raise HTTPException(status_code=403, detail="Sin permiso para este lead")

    # ── MÁQUINA DE ESTADOS: bloqueo ESTRICTO de regresiones inválidas ─────────
    # Una vez que el lead tiene una OT vinculada o un contrato de pago activo
    # (PagaCuotas / Legal Finance), retroceder a etapas pre-financieras
    # desincroniza las integraciones → se bloquea con HTTP 400 y se audita el
    # intento. Las etapas de recuperación (recuperacion_*) y papelera NO se
    # bloquean (flujos legítimos). No aplica si el lead ya estaba en esa etapa.
    _PRE_FINANCIAL_STAGES = {"lead", "reunion", "altamente_interesado"}
    if data.stage in _PRE_FINANCIAL_STAGES and data.stage != lead.current_stage:
        _has_ot = db.query(models.WorkOrder.id).filter(
            models.WorkOrder.lead_id == lead_id
        ).first() is not None
        _has_contract = bool(lead.pagacuotas_cliente_id) or bool(lead.legal_finance_contrato_id)
        if _has_ot or _has_contract:
            _motivo = "un contrato de pago activo" if _has_contract else "una Orden de Trabajo vinculada"
            db.add(models.LeadHistory(
                lead_id=lead.id,
                from_stage=lead.current_stage,
                to_stage=data.stage,
                result="blocked",
                notes=f"Regresión bloqueada por máquina de estados: el cliente ya posee {_motivo}.",
                created_by=current_user.id,
            ))
            db.commit()
            raise HTTPException(
                status_code=400,
                detail=f"No se puede retroceder el estado: el cliente ya posee {_motivo}.",
            )

    # ── EXCLUSIVIDAD DE CATEGORÍA POR RUT ────────────────────────────────────
    # Política: un mismo cliente (RUT) NO puede tener 2 casos de la MISMA categoría
    # (área de servicio) avanzando en paralelo. Distintas categorías SÍ coexisten.
    # Se valida desde que el lead pasa a Reunión (agendamiento) hasta el pago, para
    # que el duplicado se detecte al agendar y no se descubra recién al cobrar.
    if data.stage in ACTIVE_CATEGORY_STAGES:
        _contact = lead.contact
        _rut_norm = _norm_rut(_contact.rut_persona or _contact.rut_empresa) if _contact else None
        _dup = find_category_conflict(
            db, exclude_lead_id=lead.id, area_id=lead.area_id, rut_norm=_rut_norm, lock=True,
        )
        if _dup:
            _cat = lead.area.name if lead.area else "esta categoría"
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Acción Bloqueada: este cliente ya tiene un caso activo en la categoría "
                    f"{_cat} (agendado o en proceso). Resuelve o descarta ese caso antes de "
                    f"avanzar este, o elige una categoría diferente."
                ),
            )

    # ── COMPLETITUD DE DATOS OBLIGATORIA ────────────────────────────────────────
    # Antes de avanzar más allá de 'lead' (incluido agendar reunión), el contacto
    # debe tener Nombre+Apellido, RUT (persona o empresa) y Correo. Sin estos
    # datos no se pueden generar documentos ni integrar pagos.
    _STAGES_REQUIRING_FULL_DATA = {
        "reunion",
        "altamente_interesado", "cierre",
        "pago_pendiente", "pago_comprometido", "pagado_reunion", "pagado_confirmado",
        "recuperacion_lead", "recuperacion_reunion", "recuperacion_cierre", "recuperacion_pago",
    }
    if data.stage in _STAGES_REQUIRING_FULL_DATA:
        _c = lead.contact
        _name_ok  = bool(_c) and len((_c.name or "").split()) >= 2
        _rut_ok   = bool(_c) and bool((_c.rut_persona or "").strip() or (_c.rut_empresa or "").strip())
        _email_ok = bool(_c) and bool((_c.email or "").strip())
        if not (_name_ok and _rut_ok and _email_ok):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Acción Bloqueada: Para avanzar este lead es obligatorio introducir "
                    "Nombre, Apellido, RUT y Correo en la sección Datos del Cliente."
                ),
            )

    # Agendadoras cannot move to 'reunion' or any recuperación stage unless a reunion event exists
    # Skip this check if the lead has already passed the reunion stage (cierre or beyond)
    # o si YA está en 'reunion': en ese caso mandarlo a recuperación es una salida
    # legítima (p. ej. la reunión se canceló) y no debe exigir un evento vigente,
    # o el lead quedaría atrapado sin forma de destrabarse.
    _past_reunion_stages = {
        "reunion",
        "altamente_interesado", "cierre", "pago_comprometido",
        "pagado_confirmado", "recuperacion_cierre", "recuperacion_pago",
    }
    if current_user.role == "agendadora" and (
        data.stage == "reunion" or data.stage.startswith("recuperacion")
    ) and lead.current_stage not in _past_reunion_stages:
        event_count = db.query(models.CalendarEvent).filter(
            models.CalendarEvent.lead_id == lead_id,
            models.CalendarEvent.event_type == "reunion",
        ).count()
        if event_count == 0:
            raise HTTPException(
                status_code=403,
                detail="Debes agendar una reunión para este lead antes de moverlo a Reunión o Recuperación"
            )

    # Agendadoras cannot advance a lead forward while it is in 'reunion' — only the vendor can.
    # Sí pueden retrocederlo, mandarlo a recuperación o descartarlo a papelera: son las
    # salidas que evitan que el lead quede atascado si la reunión se cae o el vendedor no responde.
    if current_user.role == "agendadora" and lead.current_stage == "reunion":
        allowed_from_reunion = {
            "lead", "recuperacion_lead", "recuperacion_reunion",
            "recuperacion_cierre", "recuperacion_pago", "papelera",
        }
        if data.stage not in allowed_from_reunion:
            raise HTTPException(
                status_code=403,
                detail="Solo el vendedor puede avanzar este lead desde Reunión"
            )

    # Agendadoras cannot move to pago_comprometido if the vendor hasn't created an OT
    if current_user.role == "agendadora" and data.stage == "pago_comprometido":
        ot_count = db.query(models.WorkOrder).filter(models.WorkOrder.lead_id == lead_id).count()
        if ot_count == 0:
            raise HTTPException(
                status_code=403,
                detail="El vendedor debe crear la Orden de Trabajo (OT) antes de mover a Pago Comprometido"
            )

    # ── RUT obligatorio para pasar a Cierre ──────────────────────────────────
    if data.stage == "cierre":
        contact = lead.contact
        rut = (contact.rut_persona or contact.rut_empresa) if contact else None
        if not rut or not rut.strip():
            raise HTTPException(
                status_code=400,
                detail="El cliente debe tener RUT registrado antes de pasar a Cierre. Sin RUT no se puede generar la Orden de Trabajo.",
            )

    if data.stage in ("pago_comprometido", "pago_pendiente"):
        _require_financials_for_pago_comprometido(lead)

    # Pago Comprometido exige fecha específica de pago; pago_pendiente la acepta opcional
    if data.stage in ("pago_comprometido", "pago_pendiente") and data.payment_commitment_date:
        lead.payment_commitment_date = data.payment_commitment_date
    if data.stage == "pago_comprometido" and not lead.payment_commitment_date:
        raise HTTPException(
            status_code=400,
            detail="Debes indicar la fecha comprometida de pago para mover a Pago Comprometido",
        )

    old_stage = lead.current_stage
    lead.current_stage = data.stage

    # papelera: set deleted_at on entry, clear on restore
    if data.stage == "papelera":
        lead.deleted_at = datetime.now(timezone.utc)
    elif old_stage == "papelera":
        lead.deleted_at = None

    db.add(models.LeadHistory(
        lead_id=lead.id,
        from_stage=old_stage,
        to_stage=data.stage,
        result="manual",
        notes=data.notes or "Movido manualmente",
        created_by=current_user.id,
    ))

    # Notify vendedor when lead reaches cierre with no OT — always, regardless of who moved it
    if data.stage == "cierre" and lead.vendedor_id:
        ot_count = db.query(models.WorkOrder).filter(models.WorkOrder.lead_id == lead_id).count()
        if ot_count == 0:
            contact_name_ot = lead.contact.name if lead.contact else "cliente"
            create_notification(
                db, lead.vendedor_id,
                "Lead en Cierre — OT requerida para avanzar",
                f"El lead de {contact_name_ot} está en Cierre y necesita una Orden de Trabajo antes de poder pasar a Pago Comprometido.",
                lead_id=lead_id,
                notification_type="etapa"
            )
    # Also notify when agendadora moves to altamente_interesado and no OT
    elif data.stage == "altamente_interesado":
        ot_count = db.query(models.WorkOrder).filter(models.WorkOrder.lead_id == lead_id).count()
        if ot_count == 0 and lead.vendedor_id and lead.vendedor_id != current_user.id:
            contact_name_ot = lead.contact.name if lead.contact else "cliente"
            create_notification(
                db, lead.vendedor_id,
                "OT pendiente — acción requerida",
                f"El lead de {contact_name_ot} está Altamente Interesado y aún no tiene Orden de Trabajo creada.",
                lead_id=lead_id,
                notification_type="etapa"
            )

    if data.stage == "pago_comprometido":
        dante_users = db.query(models.User).filter(
            models.User.role == "verificador",
            models.User.is_active == True
        ).all()
        dante_id = dante_users[0].id if dante_users else current_user.id
        existing_pv = db.query(models.PaymentVerification).filter(
            models.PaymentVerification.lead_id == lead_id
        ).first()
        if existing_pv:
            existing_pv.status = "pendiente"
            existing_pv.confirmed_at = None
        else:
            db.add(models.PaymentVerification(
                lead_id=lead_id,
                assigned_to=dante_id,
                status="pendiente"
            ))
        contact_name_mv = lead.contact.name if lead.contact else "cliente"
        # Always notify Dante
        if dante_id:
            create_notification(
                db, dante_id,
                "Pago comprometido — requiere verificación",
                f"El lead de {contact_name_mv} está en 'Pago Comprometido' y requiere confirmación.",
                lead_id=lead_id,
                notification_type="pago"
            )
        # Notify vendedor when agendadora moves to pago_comprometido
        if current_user.role == "agendadora" and lead.vendedor_id and lead.vendedor_id != current_user.id:
            create_notification(
                db, lead.vendedor_id,
                "Lead movido a Pago Comprometido",
                f"{current_user.name} movió el lead de {contact_name_mv} a Pago Comprometido.",
                lead_id=lead_id,
                notification_type="etapa"
            )

    if data.stage == "pagado_confirmado":
        existing = db.query(models.PaymentVerification).filter(
            models.PaymentVerification.lead_id == lead_id
        ).first()
        if existing:
            existing.status = "pago_exitoso"
            existing.confirmed_at = datetime.now(timezone.utc)
        else:
            db.add(models.PaymentVerification(
                lead_id=lead_id,
                assigned_to=current_user.id,
                status="pago_exitoso",
                confirmed_at=datetime.now(timezone.utc),
            ))

    db.commit()
    db.refresh(lead)
    _fire_integrations(lead, data.stage, db)
    wa_broadcaster.broadcast_sync("lead_update", {"action": "stage_change", "lead_id": lead_id, "stage": data.stage})
    return db.query(models.Lead).options(
        joinedload(models.Lead.contact),
        joinedload(models.Lead.agendadora),
        joinedload(models.Lead.vendedor),
        joinedload(models.Lead.area).joinedload(models.Area.phone_configs),
        joinedload(models.Lead.group),
        joinedload(models.Lead.payment_verification),
    ).filter(models.Lead.id == lead_id).first()


@router.post("/{lead_id}/request-ot")
def request_ot(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """La agendadora solicita al vendedor que cree la OT.

    NO crea ninguna Orden de Trabajo (política de roles: solo el vendedor la genera
    durante/después de la reunión). Solo dispara una alerta interna + Web Push al
    vendedor asignado vía create_notification (que ya implementa SSE y push nativos).
    """
    lead = db.query(models.Lead).options(
        joinedload(models.Lead.contact)
    ).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    # Acceso: solo quien gestiona el lead (agendadora/vendedor dueños) o admin.
    if current_user.role in ("agendadora", "vendedor"):
        if lead.agendadora_id != current_user.id and lead.vendedor_id != current_user.id:
            raise HTTPException(status_code=403, detail="Sin permiso para este lead")

    if not lead.vendedor_id:
        raise HTTPException(status_code=400, detail="Este lead no tiene vendedor asignado")

    contact_name = lead.contact.name if lead.contact else "cliente"
    create_notification(
        db, lead.vendedor_id,
        "Solicitud de OT — acción urgente",
        f"{current_user.name} solicita la Orden de Trabajo para {contact_name} "
        f"para destrabar el Pago Comprometido.",
        lead_id=lead_id,
        notification_type="etapa",
    )
    db.commit()
    return {"ok": True, "vendedor_id": lead.vendedor_id}


@router.get("/{lead_id}/history", response_model=List[schemas.LeadHistoryOut])
def lead_history(lead_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    _check_lead_access(lead, current_user, db)
    return db.query(models.LeadHistory).options(
        joinedload(models.LeadHistory.creator)
    ).filter(models.LeadHistory.lead_id == lead_id).order_by(models.LeadHistory.created_at).all()


@router.post("/{lead_id}/retry-pagacuotas")
def retry_pagacuotas(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Re-intenta crear cliente en PagaCuotas y enviar WhatsApp para leads con status failed."""
    if current_user.role not in ("superadmin", "subadmin", "vendedor", "verificador", "asistente_seguimiento"):
        raise HTTPException(status_code=403, detail="Sin permiso")

    lead = db.query(models.Lead).options(
        joinedload(models.Lead.contact),
        joinedload(models.Lead.area).joinedload(models.Area.phone_configs),
        joinedload(models.Lead.vendedor),
    ).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    contact = lead.contact
    rut = ((contact.rut_persona or contact.rut_empresa) if contact else None) or f"SIN-RUT-{lead.id}"
    area_name = lead.area.name if lead.area else "Sin categoría"
    vendedor_name = lead.vendedor.name if lead.vendedor else None

    try:
        result = asyncio.run(pc.crear_cliente(
            db=db,
            crm_lead_id=lead.id,
            rut=rut,
            nombre=contact.name if contact else "Cliente",
            razon_social=getattr(contact, "razon_social", None) if contact else None,
            email=contact.email if contact else None,
            phone=contact.phone if contact else None,
            honorarios=float(lead.honorarios or 0),
            cuota_inicial=float(lead.cuota_inicial or 0),
            num_cuotas=int(lead.num_cuotas or 1),
            monto_cuota=float(lead.monto_cuota or 0),
            tipo_servicio=lead.service_description or area_name,
            area_name=area_name,
            vendedor_name=vendedor_name,
        ))
        lead.pagacuotas_cliente_id = str(result.get("id", ""))
        lead.pagacuotas_status = "created"
        lead.pagacuotas_link = result.get("payment_link")
        db.commit()

        payment_link = result.get("payment_link")
        wa_info = result.get("whatsapp", {})
        wa_sent = False
        if payment_link and contact and contact.phone:
            _dispatch_payment_link_wa(lead, contact, payment_link, db, custom_message=wa_info.get("message"))
            wa_sent = True

        return {"ok": True, "payment_link": payment_link, "whatsapp_sent": wa_sent}
    except Exception as exc:
        lead.pagacuotas_status = "failed"
        db.commit()
        raise HTTPException(status_code=502, detail=f"PagaCuotas error: {exc}")


@router.delete("/{lead_id}")
def delete_lead(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    if current_user.role not in ("superadmin", "subadmin", "tecnico"):
        raise HTTPException(status_code=403, detail="Sin permiso")
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    try:
        # Importación explícita para evitar que Pylance de VSCode marque errores visuales (falsos positivos)
        from ..models import (
            WhatsAppMessage, AIAgentLog, PagaCuotasCliente, Notification,
            CalendarEvent, PaymentVerification, WorkOrder, LeadHistory, Lead as LeadModel
        )

        # 1. Desvincular tablas donde lead_id puede ser nulo
        db.query(WhatsAppMessage).filter(WhatsAppMessage.lead_id == lead_id).update({"lead_id": None}, synchronize_session=False)
        db.query(AIAgentLog).filter(AIAgentLog.lead_id == lead_id).update({"lead_id": None}, synchronize_session=False)
        db.query(PagaCuotasCliente).filter(PagaCuotasCliente.crm_lead_id == lead_id).update({"crm_lead_id": None}, synchronize_session=False)

        # 2. Eliminar explícitamente entidades dependientes
        db.query(Notification).filter(Notification.lead_id == lead_id).delete(synchronize_session=False)
        db.query(CalendarEvent).filter(CalendarEvent.lead_id == lead_id).delete(synchronize_session=False)
        db.query(PaymentVerification).filter(PaymentVerification.lead_id == lead_id).delete(synchronize_session=False)
        db.query(WorkOrder).filter(WorkOrder.lead_id == lead_id).delete(synchronize_session=False)
        db.query(LeadHistory).filter(LeadHistory.lead_id == lead_id).delete(synchronize_session=False)

        # 3. Finalmente eliminar el lead
        db.query(LeadModel).filter(LeadModel.id == lead_id).delete(synchronize_session=False)
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error interno de base de datos al eliminar: {str(e)}")

    wa_broadcaster.broadcast_sync("lead_update", {"action": "delete", "lead_id": lead_id})
    return {"ok": True}


# ── DASHBOARD STATS ────────────────────────────────────────
@router.get("/stats/dashboard")
def dashboard_stats(
    group_id: Optional[int] = None,
    period: Optional[str] = None,  # "day" | "week" | "month" | "year"
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    agenda_date: Optional[str] = None,  # YYYY-MM-DD, overrides events-only queries
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    from datetime import date, timedelta
    from sqlalchemy import or_
    from sqlalchemy.orm import joinedload as jl

    # Resolve tenant scope once for all sub-queries
    _gids = get_visible_group_ids(db, current_user)

    # ── Period start ──────────────────────────────────────────
    _today_start_tmp = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    period_end = None
    if date_from or date_to:
        # Custom range overrides period
        period_start = datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc) if date_from else None
        if date_to:
            period_end = datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc) + timedelta(days=1)
    elif period == "day":
        period_start = _today_start_tmp
    elif period == "week":
        period_start = _today_start_tmp - timedelta(days=_today_start_tmp.weekday())
    elif period == "month":
        period_start = _today_start_tmp.replace(day=1)
    elif period == "year":
        period_start = _today_start_tmp.replace(month=1, day=1)
    else:
        period_start = None

    # scope_filter: role + tenant — NO period (for alert/point-in-time metrics)
    def scope_filter(query):
        if current_user.role == "agendadora":
            return query.filter(models.Lead.agendadora_id == current_user.id)
        elif current_user.role == "vendedor":
            return query.filter(models.Lead.vendedor_id == current_user.id)
        elif current_user.role == "verificador":
            return query.filter(models.Lead.current_stage.in_([
                "cierre", "pago_pendiente", "pago_comprometido", "pagado_reunion", "pagado_confirmado",
                "recuperacion_cierre", "recuperacion_pago",
            ]))
        if _gids is not None:
            query = query.filter(models.Lead.group_id.in_(_gids))
        return query

    # apply_dashboard_filter: scope + optional period/custom date filter
    def apply_dashboard_filter(query):
        query = scope_filter(query)
        if period_start is not None:
            query = query.filter(models.Lead.created_at >= period_start)
        if period_end is not None:
            query = query.filter(models.Lead.created_at < period_end)
        return query

    q = apply_dashboard_filter(db.query(models.Lead))

    all_stages = [
        "lead", "reunion", "altamente_interesado", "cierre",
        "pago_pendiente", "pago_comprometido", "pagado_reunion", "pagado_confirmado",
        "recuperacion_lead", "recuperacion_reunion", "recuperacion_cierre", "recuperacion_pago",
    ]
    counts = {s: q.filter(models.Lead.current_stage == s).count() for s in all_stages}
    total = sum(counts.values())

    # Total real sin filtro de período — siempre refleja todos los leads del scope
    total_all = scope_filter(db.query(func.count(models.Lead.id))).scalar() or 0

    pagados_q = db.query(func.sum(models.Lead.honorarios)).filter(
        models.Lead.current_stage.in_(["cierre", "pago_pendiente", "pago_comprometido", "pagado_reunion", "pagado_confirmado"]),
        models.Lead.honorarios > 0,
        or_(models.Lead.num_cuotas > 1, models.Lead.cuota_inicial > 0),
    )
    pagados_q = apply_dashboard_filter(pagados_q)
    total_honorarios = pagados_q.scalar() or 0

    # Today's stats — always point-in-time, NOT period-filtered
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    # Events date: use agenda_date if provided, otherwise today
    if agenda_date:
        try:
            _ad = datetime.strptime(agenda_date, "%Y-%m-%d")
            events_start = _ad.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
        except Exception:
            events_start = today_start
    else:
        events_start = today_start
    events_end = events_start.replace(hour=23, minute=59, second=59)
    today_leads_q = db.query(func.count(models.Lead.id)).filter(
        models.Lead.created_at >= events_start,
        models.Lead.created_at <= events_end,
    )
    today_leads = scope_filter(today_leads_q).scalar() or 0

    # Pending payments — current state, NOT period-filtered
    pending_payments_q = db.query(func.count(models.PaymentVerification.id)).join(
        models.Lead, models.PaymentVerification.lead_id == models.Lead.id
    ).filter(models.PaymentVerification.status == "pendiente")
    pending_payments = scope_filter(pending_payments_q).scalar() or 0

    confirmed_payments_q = db.query(func.count(models.PaymentVerification.id)).join(
        models.Lead, models.PaymentVerification.lead_id == models.Lead.id
    ).filter(models.PaymentVerification.status == "pago_exitoso")
    confirmed_payments = scope_filter(confirmed_payments_q).scalar() or 0

    rejected_payments_q = db.query(func.count(models.PaymentVerification.id)).join(
        models.Lead, models.PaymentVerification.lead_id == models.Lead.id
    ).filter(models.PaymentVerification.status == "rechazado")
    rejected_payments = scope_filter(rejected_payments_q).scalar() or 0

    # Pending payments broken down by group (for dante/admin)
    payments_by_group = []
    if current_user.role in ("verificador", "superadmin", "subadmin"):
        groups_query = db.query(models.Group)
        if _gids is not None:
            groups_query = groups_query.filter(models.Group.id.in_(_gids))
        groups_list = groups_query.all()
        for g in groups_list:
            pending_g = db.query(func.count(models.PaymentVerification.id)).join(
                models.Lead, models.PaymentVerification.lead_id == models.Lead.id
            ).filter(
                models.PaymentVerification.status == "pendiente",
                models.Lead.group_id == g.id,
            ).scalar() or 0
            if pending_g > 0:
                payments_by_group.append({"id": g.id, "name": g.name, "pending": pending_g})

    # Today's calendar events
    events_today_q = db.query(func.count(models.CalendarEvent.id)).filter(
        models.CalendarEvent.start_time >= events_start,
        models.CalendarEvent.start_time <= events_end,
        models.CalendarEvent.is_completed == False,
    )
    if current_user.role in ("superadmin", "subadmin") and _gids is not None:
        # Scope to events linked to leads in their negocio
        events_today_q = events_today_q.join(
            models.Lead, models.CalendarEvent.lead_id == models.Lead.id, isouter=True
        ).filter(models.Lead.group_id.in_(_gids))
    elif current_user.role not in ("superadmin", "subadmin", "tecnico"):
        events_today_q = events_today_q.filter(
            or_(
                models.CalendarEvent.created_by == current_user.id,
                models.CalendarEvent.assigned_to == current_user.id,
            )
        )

    events_today = events_today_q.scalar() or 0

    # Recent activity
    history_q = (
        db.query(models.LeadHistory)
        .join(models.Lead, models.LeadHistory.lead_id == models.Lead.id)
        .options(
            jl(models.LeadHistory.creator),
            jl(models.LeadHistory.lead).joinedload(models.Lead.contact),
        )
    )
    
    # Filter based on user's access to leads
    if current_user.role == "agendadora":
        history_q = history_q.filter(models.Lead.agendadora_id == current_user.id)
    elif current_user.role == "vendedor":
        history_q = history_q.filter(models.Lead.vendedor_id == current_user.id)
    elif current_user.role == "verificador":
        # Solo transiciones hacia etapas de cobro, no todo el historial de esos leads
        history_q = history_q.filter(models.LeadHistory.to_stage.in_([
            "cierre", "pago_comprometido", "pagado_confirmado", "recuperacion_cierre", "recuperacion_pago",
        ]))
    elif current_user.role in ("superadmin", "subadmin") and _gids is not None:
        history_q = history_q.filter(models.Lead.group_id.in_(_gids))

    # Filter by user's clear timestamp
    if current_user.dashboard_clear_at:
        history_q = history_q.filter(models.LeadHistory.created_at > current_user.dashboard_clear_at)

    recent_history = history_q.order_by(models.LeadHistory.created_at.desc()).limit(20).all()
    recent_activity = []
    for h in recent_history:
        recent_activity.append({
            "id": h.id,
            "user": h.creator.name if h.creator else "Sistema",
            "user_role": h.creator.role if h.creator else "",
            "action": f"{h.from_stage or 'inicio'} → {h.to_stage}",
            "lead_id": h.lead_id,
            "contact_name": h.lead.contact.name if h.lead and h.lead.contact else "—",
            "result": h.result,
            "notes": h.notes,
            "time": h.created_at.isoformat(),
        })

    # By group breakdown — show sub-groups of the negocio, not the negocio root itself
    by_group = []
    if current_user.role in ("superadmin", "subadmin"):
        if _gids is None:
            # Global admin: show all top-level groups (legacy / tecnico view)
            groups = db.query(models.Group).all()
        else:
            # Find the root negocio group for this user
            root_gid = current_user.group_id
            if root_gid:
                ug = db.query(models.Group).filter(models.Group.id == root_gid).first()
                if ug and ug.negocio_id:
                    root_gid = ug.negocio_id  # user is in a sub-group
            # Show only sub-groups of the root (not the root itself)
            groups = db.query(models.Group).filter(
                models.Group.negocio_id == root_gid
            ).all() if root_gid else []
        for g in groups:
            gl = db.query(func.count(models.Lead.id)).filter(
                models.Lead.group_id == g.id
            ).scalar() or 0
            gp = db.query(func.count(models.Lead.id)).filter(
                models.Lead.group_id == g.id,
                models.Lead.current_stage == "pagado_confirmado"
            ).scalar() or 0
            by_group.append({"id": g.id, "name": g.name, "total": gl, "pagado": gp})

    # Top performers
    top_vendedores = []
    if current_user.role in ("superadmin", "subadmin"):
        vendor_q = (
            db.query(models.User, models.Group.name.label("group_name"))
            .outerjoin(models.Group, models.User.group_id == models.Group.id)
            .filter(models.User.role == "vendedor", models.User.is_active == True)
        )
        if _gids is not None:
            vendor_q = vendor_q.filter(models.User.group_id.in_(_gids))

        for v, group_name in vendor_q.all():
            closed_q = db.query(func.count(models.Lead.id)).filter(
                models.Lead.vendedor_id == v.id,
                models.Lead.current_stage == "pagado_confirmado",
            )
            if period_start is not None:
                closed_q = closed_q.filter(models.Lead.created_at >= period_start)
            closed = closed_q.scalar() or 0
            total_q = db.query(func.count(models.Lead.id)).filter(models.Lead.vendedor_id == v.id)
            if period_start is not None:
                total_q = total_q.filter(models.Lead.created_at >= period_start)
            total_v = total_q.scalar() or 0
            top_vendedores.append({
                "id": v.id,
                "name": v.name,
                "group": group_name or "Sin grupo",
                "closed": closed,
                "total": total_v,
            })
        top_vendedores.sort(key=lambda x: x["closed"], reverse=True)

    # Leads sin OT — in cierre/pago_comprometido without any work order
    sin_ot_q = (
        db.query(func.count(models.Lead.id))
        .outerjoin(models.WorkOrder, models.WorkOrder.lead_id == models.Lead.id)
        .filter(
            models.Lead.current_stage.in_(["cierre"]),
            models.WorkOrder.id.is_(None),
        )
    )
    sin_ot_count = scope_filter(sin_ot_q).scalar() or 0

    # Cold leads — point-in-time alert, NOT period-filtered
    cold_threshold = today_start - timedelta(days=3)
    from sqlalchemy import or_ as _or_
    cold_leads_q = db.query(func.count(models.Lead.id)).filter(
        _or_(
            models.Lead.updated_at < cold_threshold,
            models.Lead.updated_at.is_(None),
        ),
        models.Lead.created_at < cold_threshold,
        models.Lead.current_stage.notin_(["pagado_confirmado"]),
    )
    cold_leads_count = scope_filter(cold_leads_q).scalar() or 0

    # This week vs last week
    week_start = today_start - timedelta(days=today_start.weekday())
    last_week_start = week_start - timedelta(days=7)

    this_week_q = db.query(func.count(models.Lead.id)).filter(models.Lead.created_at >= week_start)
    last_week_q = db.query(func.count(models.Lead.id)).filter(
        models.Lead.created_at >= last_week_start,
        models.Lead.created_at < week_start,
    )

    this_week_leads = apply_dashboard_filter(this_week_q).scalar() or 0
    last_week_leads = apply_dashboard_filter(last_week_q).scalar() or 0

    # Appointments stats (cumulative and this month)
    month_start = today_start.replace(day=1)
    total_appointments_q = db.query(func.count(models.CalendarEvent.id)).filter(
        models.CalendarEvent.assigned_to == current_user.id
    )
    month_appointments_q = total_appointments_q.filter(models.CalendarEvent.start_time >= month_start)

    total_appointments = total_appointments_q.scalar() or 0
    month_appointments = month_appointments_q.scalar() or 0

    # ── New dashboard data ─────────────────────────────────────
    now = datetime.now(timezone.utc)

    # Unread WhatsApp messages — only count messages from active configs (config_id=None = orphan test messages)
    unread_q = (
        db.query(func.count(models.WhatsAppMessage.id))
        .join(models.Lead, models.WhatsAppMessage.lead_id == models.Lead.id)
        .join(models.WhatsAppConfig, models.WhatsAppMessage.whatsapp_config_id == models.WhatsAppConfig.id)
        .filter(
            models.WhatsAppMessage.direction == "in",
            models.WhatsAppMessage.is_read == False,
            models.WhatsAppConfig.is_active == True,
        )
    )
    if current_user.role == "agendadora":
        unread_q = unread_q.filter(models.Lead.agendadora_id == current_user.id)
    elif current_user.role == "vendedor":
        unread_q = unread_q.filter(models.Lead.vendedor_id == current_user.id)
    elif current_user.role in ("superadmin", "subadmin") and _gids is not None:
        unread_q = unread_q.filter(models.Lead.group_id.in_(_gids))
    unread_messages = unread_q.scalar() or 0

    # Lead ID of the most recent unread message (for direct navigation)
    first_unread_lead_id = None
    if unread_messages > 0:
        fuq = (
            db.query(models.WhatsAppMessage.lead_id)
            .join(models.Lead, models.WhatsAppMessage.lead_id == models.Lead.id)
            .join(models.WhatsAppConfig, models.WhatsAppMessage.whatsapp_config_id == models.WhatsAppConfig.id)
            .filter(
                models.WhatsAppMessage.direction == "in",
                models.WhatsAppMessage.is_read == False,
                models.WhatsAppConfig.is_active == True,
                models.WhatsAppMessage.lead_id.isnot(None),
            )
        )
        if current_user.role == "agendadora":
            fuq = fuq.filter(models.Lead.agendadora_id == current_user.id)
        elif current_user.role == "vendedor":
            fuq = fuq.filter(models.Lead.vendedor_id == current_user.id)
        elif current_user.role in ("superadmin", "subadmin") and _gids is not None:
            fuq = fuq.filter(models.Lead.group_id.in_(_gids))
        row = fuq.order_by(models.WhatsAppMessage.created_at.desc()).first()
        first_unread_lead_id = row[0] if row else None

    # Recovery leads count
    recovery_count = (
        counts.get("recuperacion_lead", 0) +
        counts.get("recuperacion_reunion", 0) +
        counts.get("recuperacion_cierre", 0) +
        counts.get("recuperacion_pago", 0)
    )

    # Today's events as a detailed list
    cal_user_filter = or_(
        models.CalendarEvent.assigned_to == current_user.id,
        models.CalendarEvent.created_by == current_user.id,
    )
    today_evs_q = (
        db.query(models.CalendarEvent)
        .options(
            jl(models.CalendarEvent.lead).joinedload(models.Lead.contact),
            jl(models.CalendarEvent.lead).joinedload(models.Lead.vendedor),
            jl(models.CalendarEvent.lead).joinedload(models.Lead.area),
        )
        .filter(
            models.CalendarEvent.start_time >= events_start,
            models.CalendarEvent.start_time <= events_end,
        )
    )
    if current_user.role in ("superadmin", "subadmin") and _gids is not None:
        today_evs_q = today_evs_q.join(
            models.Lead, models.CalendarEvent.lead_id == models.Lead.id, isouter=True
        ).filter(models.Lead.group_id.in_(_gids))
    elif current_user.role not in ("superadmin", "subadmin", "tecnico"):
        today_evs_q = today_evs_q.filter(cal_user_filter)
    today_events_list = [
        {
            "id": ev.id,
            "title": ev.title,
            "start_time": ev.start_time.isoformat(),
            "end_time": ev.end_time.isoformat(),
            "event_type": ev.event_type,
            "color": ev.color,
            "vendor_status": ev.vendor_status,
            "lead_id": ev.lead_id,
            "contact_name": ev.lead.contact.name if ev.lead and ev.lead.contact else None,
            "contact_phone": ev.lead.contact.phone if ev.lead and ev.lead.contact else None,
            "vendor_name": ev.lead.vendedor.name if ev.lead and ev.lead.vendedor else None,
            "area": ev.lead.area.name if ev.lead and ev.lead.area else None,
            "lead_stage": ev.lead.current_stage if ev.lead else None,
        }
        for ev in today_evs_q.order_by(models.CalendarEvent.start_time).all()
    ]

    # Past events with no vendor_status (meetings that happened but were never marked).
    # Excluye eventos cuyo lead ya avanzó de etapa: el resultado ya quedó implícito
    # (p.ej. badge con_exito_pagada falló al guardarse, o evento duplicado viejo).
    _RESOLVED_STAGES = [
        "altamente_interesado", "cierre",
        "pago_pendiente", "pago_comprometido", "pagado_reunion", "pagado_confirmado",
        "recuperacion_lead", "recuperacion_reunion", "recuperacion_cierre", "recuperacion_pago",
        "papelera",
    ]
    past_unmarked_count = 0
    past_unmarked_events = []
    if current_user.role in ("vendedor", "agendadora"):
        past_ev_q = (
            db.query(models.CalendarEvent)
            .options(jl(models.CalendarEvent.lead).joinedload(models.Lead.contact))
            .outerjoin(models.Lead, models.CalendarEvent.lead_id == models.Lead.id)
            .filter(
                models.CalendarEvent.end_time < today_start,  # strictly before today
                models.CalendarEvent.vendor_status == None,
                cal_user_filter,
                or_(
                    models.CalendarEvent.lead_id == None,
                    models.Lead.current_stage.notin_(_RESOLVED_STAGES),
                ),
            )
            .order_by(models.CalendarEvent.start_time.desc())
            .limit(10)
        )
        past_evs = past_ev_q.all()
        past_unmarked_count = len(past_evs)
        past_unmarked_events = [
            {
                "id": ev.id,
                "title": ev.title,
                "start_time": ev.start_time.isoformat(),
                "lead_id": ev.lead_id,
                "contact_name": ev.lead.contact.name if ev.lead and ev.lead.contact else None,
            }
            for ev in past_evs
        ]

    # cierre sin abono = in "cierre" stage with no initial payment
    cierre_sin_abono = counts.get("cierre", 0)
    # cierre abonado = pago_pendiente + pago_comprometido + pagado_reunion + pagado_confirmado
    cierre_abonado = (
        counts.get("pago_pendiente", 0)
        + counts.get("pago_comprometido", 0)
        + counts.get("pagado_reunion", 0)
        + counts.get("pagado_confirmado", 0)
    )
    # Total leads that have reached cierre or beyond (conversion)
    cierre_total_conversion = cierre_sin_abono + cierre_abonado + counts.get("recuperacion_cierre", 0)

    # Cuotas: sum of monto_cuota for leads with installment plans in active payment stages
    ACTIVE_PAYMENT_STAGES = ["cierre", "pago_pendiente", "pago_comprometido", "pagado_reunion", "pagado_confirmado"]
    cuotas_q = db.query(func.sum(models.Lead.monto_cuota)).filter(
        models.Lead.current_stage.in_(ACTIVE_PAYMENT_STAGES),
        models.Lead.num_cuotas > 1,
        models.Lead.monto_cuota > 0,
    )
    cuotas_q = apply_dashboard_filter(cuotas_q)
    total_cuotas = cuotas_q.scalar() or 0

    pagos_q = db.query(func.sum(models.Lead.cuota_inicial)).filter(
        models.Lead.current_stage.in_(["pago_pendiente", "pago_comprometido", "pagado_reunion", "pagado_confirmado"]),
        models.Lead.num_cuotas <= 1,
        models.Lead.cuota_inicial > 0,
    )
    pagos_q = apply_dashboard_filter(pagos_q)
    total_pagos_unicos = pagos_q.scalar() or 0

    return {
        "total_leads": total,
        "total_leads_all": total_all,
        "by_stage": counts,
        "total_honorarios": float(total_honorarios),
        "total_cuotas": float(total_cuotas),
        "total_pagos_unicos": float(total_pagos_unicos),
        "conversion_rate": round(cierre_total_conversion / total * 100, 1) if total > 0 else 0,
        "cierre_sin_abono": cierre_sin_abono,
        "cierre_abonado": cierre_abonado,
        "today_leads": today_leads,
        "pending_payments": pending_payments,
        "confirmed_payments": confirmed_payments,
        "rejected_payments": rejected_payments,
        "payments_by_group": payments_by_group,
        "events_today": events_today,
        "total_appointments": total_appointments,
        "month_appointments": month_appointments,
        "recent_activity": recent_activity,
        "by_group": by_group,
        "top_vendedores": top_vendedores,
        "this_week_leads": this_week_leads,
        "last_week_leads": last_week_leads,
        "cold_leads_count": cold_leads_count,
        "unread_messages": int(unread_messages),
        "first_unread_lead_id": first_unread_lead_id,
        "recovery_count": recovery_count,
        "today_events_list": today_events_list,
        "past_unmarked_count": past_unmarked_count,
        "past_unmarked_events": past_unmarked_events,
        "leads_sin_ot_count": sin_ot_count,
    }


@router.get("/stats/dashboard-detail")
def dashboard_detail(
    metric: str,
    period: str = "month",
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    group_id: Optional[int] = None,
    vendor_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Return lead rows for a given dashboard metric card."""
    from sqlalchemy.orm import joinedload as jl

    q = (
        db.query(models.Lead)
        .options(
            jl(models.Lead.contact),
            jl(models.Lead.vendedor),
            jl(models.Lead.agendadora),
            jl(models.Lead.area),
            jl(models.Lead.group),
        )
    )

    # Scope filter
    visible = get_visible_group_ids(db, current_user)
    if visible is not None:
        q = q.filter(models.Lead.group_id.in_(visible))
    if group_id:
        q = q.filter(models.Lead.group_id == group_id)
    if vendor_id:
        q = q.filter(models.Lead.vendedor_id == vendor_id)

    # Period filter — same semantics as /stats/dashboard
    now = datetime.now(timezone.utc)
    _today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if date_from or date_to:
        if date_from:
            q = q.filter(models.Lead.created_at >= datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc))
        if date_to:
            q = q.filter(models.Lead.created_at < datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc) + timedelta(days=1))
    elif period in ("day", "today"):
        q = q.filter(models.Lead.created_at >= _today_start)
    elif period == "week":
        q = q.filter(models.Lead.created_at >= _today_start - timedelta(days=_today_start.weekday()))
    elif period == "month":
        q = q.filter(models.Lead.created_at >= _today_start.replace(day=1))

    # Metric filter
    # Same stage sets as /stats/dashboard — keep both endpoints coherent
    _PAGO_STAGES = ["pago_pendiente", "pago_comprometido", "pagado_reunion", "pagado_confirmado"]
    METRIC_FILTERS = {
        "active":           lambda q: q,
        "cierre_sin_abono": lambda q: q.filter(models.Lead.current_stage == "cierre"),
        "cierre_abonado":   lambda q: q.filter(models.Lead.current_stage.in_(_PAGO_STAGES)),
        # Convertidos = llegaron a Cierre o a cualquier etapa de pago (numerador de la tasa de conversión)
        "convertidos":      lambda q: q.filter(models.Lead.current_stage.in_(["cierre"] + _PAGO_STAGES)),
        "recovery":         lambda q: q.filter(
            models.Lead.current_stage.in_([
                "recuperacion_lead", "recuperacion_reunion",
                "recuperacion_cierre", "recuperacion_pago",
            ])
        ),
        "cuotas":           lambda q: q.filter(
            models.Lead.current_stage.in_(["cierre"] + _PAGO_STAGES),
            models.Lead.num_cuotas > 1,
            models.Lead.monto_cuota > 0,
        ),
        "pagos_unicos":     lambda q: q.filter(
            models.Lead.current_stage.in_(_PAGO_STAGES),
            models.Lead.num_cuotas <= 1,
            models.Lead.cuota_inicial > 0,
        ),
        "honorarios":       lambda q: q.filter(
            models.Lead.current_stage.in_(["cierre"] + _PAGO_STAGES),
            models.Lead.honorarios > 0,
            or_(models.Lead.num_cuotas > 1, models.Lead.cuota_inicial > 0),
        ),
    }

    fn = METRIC_FILTERS.get(metric)
    if fn is None:
        raise HTTPException(status_code=400, detail=f"Métrica desconocida: {metric}")
    q = fn(q)

    leads = q.order_by(models.Lead.updated_at.desc().nullslast()).limit(200).all()

    result = []
    for l in leads:
        result.append({
            "id": l.id,
            "contact_name": l.contact.name if l.contact else "—",
            "contact_phone": l.contact.phone if l.contact else None,
            "area": l.area.name if l.area else "—",
            "group": l.group.name if l.group else "—",
            "stage": l.current_stage,
            "honorarios": float(l.honorarios or 0),
            "cuota_inicial": float(l.cuota_inicial or 0),
            "num_cuotas": l.num_cuotas or 1,
            "monto_cuota": float(l.monto_cuota or 0),
            "vendedor": l.vendedor.name if l.vendedor else "—",
            "created_at": l.created_at.isoformat() if l.created_at else None,
        })
    return result


@router.get("/stats/panel-analista")
def panel_analista_stats(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    period: Optional[str] = "month",
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Dashboard completo para analista: métricas por vendedor y por agendadora.
    Accesible por analista, superadmin y subadmin.
    """
    if current_user.role not in ("analista", "superadmin", "subadmin"):
        raise HTTPException(status_code=403, detail="Sin permiso")

    from datetime import date as _date, timedelta as _td
    from sqlalchemy.orm import joinedload as _jl

    _gids = get_visible_group_ids(db, current_user)

    # Period bounds
    _today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    if date_from and date_to:
        p_start = datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc)
        p_end   = datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc) + timedelta(days=1)
    elif period == "week":
        p_start = _today - timedelta(days=_today.weekday())
        p_end   = p_start + timedelta(days=7)
    elif period == "year":
        p_start = _today.replace(month=1, day=1)
        p_end   = _today.replace(year=_today.year + 1, month=1, day=1)
    else:  # month default
        p_start = _today.replace(day=1)
        p_end   = (_today.replace(day=28) + timedelta(days=4)).replace(day=1)

    def lead_in_period(q):
        return q.filter(models.Lead.created_at >= p_start, models.Lead.created_at < p_end)

    def scoped(q):
        if _gids is not None:
            q = q.filter(models.Lead.group_id.in_(_gids))
        return q

    PAGO_STAGES = ("pago_comprometido", "pago_pendiente", "pagado_reunion", "pagado_confirmado")
    ACTIVO_STAGES = ("lead", "reunion", "altamente_interesado", "cierre",
                     "recuperacion_lead", "recuperacion_reunion", "recuperacion_altamente_interesado", "recuperacion_cierre")

    # ── Vendedores ─────────────────────────────────────────────────────────────
    vendor_users_q = db.query(models.User).filter(
        models.User.role == "vendedor",
        models.User.is_active == True,
    )
    if _gids is not None:
        vendor_users_q = vendor_users_q.filter(models.User.group_id.in_(_gids))
    vendor_users = vendor_users_q.all()

    vendedores = []
    for v in vendor_users:
        def vl(extra_filter=None, period_filter=True):
            q = db.query(func.count(models.Lead.id)).filter(models.Lead.vendedor_id == v.id)
            if _gids is not None:
                q = q.filter(models.Lead.group_id.in_(_gids))
            if period_filter:
                q = q.filter(models.Lead.created_at >= p_start, models.Lead.created_at < p_end)
            if extra_filter is not None:
                q = q.filter(extra_filter)
            return q.scalar() or 0

        total_periodo      = vl()
        en_reunion         = vl(models.Lead.current_stage.in_(["reunion", "recuperacion_reunion"]), False)
        altamente          = vl(models.Lead.current_stage == "altamente_interesado", False)
        cierre_count       = vl(models.Lead.current_stage == "cierre", False)
        en_pago            = vl(models.Lead.current_stage.in_(list(PAGO_STAGES)), False)
        confirmados        = vl(models.Lead.current_stage == "pagado_confirmado", False)
        activos            = vl(models.Lead.current_stage.in_(list(ACTIVO_STAGES)), False)

        hon_q = db.query(func.sum(models.Lead.honorarios)).filter(
            models.Lead.vendedor_id == v.id,
            models.Lead.current_stage.in_(list(PAGO_STAGES)),
            models.Lead.honorarios > 0,
        )
        if _gids is not None:
            hon_q = hon_q.filter(models.Lead.group_id.in_(_gids))
        honorarios_comprometidos = float(hon_q.scalar() or 0)

        hon_conf_q = db.query(func.sum(models.Lead.honorarios)).filter(
            models.Lead.vendedor_id == v.id,
            models.Lead.current_stage == "pagado_confirmado",
            models.Lead.honorarios > 0,
        )
        if _gids is not None:
            hon_conf_q = hon_conf_q.filter(models.Lead.group_id.in_(_gids))
        honorarios_confirmados = float(hon_conf_q.scalar() or 0)

        # Eventos de reunión del período (asignados o creados por este vendedor)
        ev_q = db.query(func.count(models.CalendarEvent.id)).filter(
            models.CalendarEvent.event_type == "reunion",
            models.CalendarEvent.start_time >= p_start,
            models.CalendarEvent.start_time < p_end,
            models.CalendarEvent.assigned_to == v.id,
        )
        reuniones_asignadas = ev_q.scalar() or 0

        exitosas_q = db.query(func.count(models.CalendarEvent.id)).filter(
            models.CalendarEvent.event_type == "reunion",
            models.CalendarEvent.assigned_to == v.id,
            models.CalendarEvent.vendor_status.in_(["altamente_interesado", "con_exito_pagada"]),
            models.CalendarEvent.start_time >= p_start,
            models.CalendarEvent.start_time < p_end,
        )
        reuniones_exitosas = exitosas_q.scalar() or 0

        # No-show y sin éxito del período
        noshow_q = db.query(func.count(models.CalendarEvent.id)).filter(
            models.CalendarEvent.event_type == "reunion",
            models.CalendarEvent.assigned_to == v.id,
            models.CalendarEvent.vendor_status == "no_show",
            models.CalendarEvent.start_time >= p_start,
            models.CalendarEvent.start_time < p_end,
        )
        sinexito_q = db.query(func.count(models.CalendarEvent.id)).filter(
            models.CalendarEvent.event_type == "reunion",
            models.CalendarEvent.assigned_to == v.id,
            models.CalendarEvent.vendor_status == "sin_exito",
            models.CalendarEvent.start_time >= p_start,
            models.CalendarEvent.start_time < p_end,
        )
        reuniones_no_show   = noshow_q.scalar() or 0
        reuniones_sin_exito = sinexito_q.scalar() or 0
        reuniones_pendientes = reuniones_asignadas - reuniones_exitosas - reuniones_no_show - reuniones_sin_exito

        # Leads activos detallados (nombre, etapa, honorarios, área)
        leads_activos_q = db.query(models.Lead).options(
            _jl(models.Lead.contact),
            _jl(models.Lead.area),
        ).filter(
            models.Lead.vendedor_id == v.id,
            models.Lead.current_stage.in_(list(ACTIVO_STAGES) + list(PAGO_STAGES)),
        )
        if _gids is not None:
            leads_activos_q = leads_activos_q.filter(models.Lead.group_id.in_(_gids))
        leads_activos_rows = leads_activos_q.order_by(models.Lead.updated_at.desc()).limit(50).all()
        leads_detalle = [
            {
                "lead_id": l.id,
                "contact_name": l.contact.name if l.contact else "—",
                "contact_phone": l.contact.phone if l.contact else "",
                "area": l.area.name if l.area else "—",
                "stage": l.current_stage,
                "honorarios": float(l.honorarios or 0),
                "updated_at": l.updated_at.isoformat() if l.updated_at else None,
            }
            for l in leads_activos_rows
        ]

        pct_conv = round(confirmados / total_periodo * 100, 1) if total_periodo > 0 else 0.0
        pct_exit = round(reuniones_exitosas / reuniones_asignadas * 100, 1) if reuniones_asignadas > 0 else 0.0
        pct_noshow = round(reuniones_no_show / reuniones_asignadas * 100, 1) if reuniones_asignadas > 0 else 0.0

        group_name = v.group.name if v.group else "—"

        vendedores.append({
            "id": v.id, "name": v.name, "group": group_name,
            "total_periodo": total_periodo,
            "activos": activos,
            "en_reunion": en_reunion,
            "altamente_interesado": altamente,
            "cierre": cierre_count,
            "en_pago": en_pago,
            "confirmados": confirmados,
            "honorarios_comprometidos": honorarios_comprometidos,
            "honorarios_confirmados": honorarios_confirmados,
            "reuniones_asignadas": reuniones_asignadas,
            "reuniones_exitosas": reuniones_exitosas,
            "reuniones_no_show": reuniones_no_show,
            "reuniones_sin_exito": reuniones_sin_exito,
            "reuniones_pendientes": max(0, reuniones_pendientes),
            "pct_conversion": pct_conv,
            "pct_efectividad_reunion": pct_exit,
            "pct_noshow": pct_noshow,
            "leads_detalle": leads_detalle,
        })
    vendedores.sort(key=lambda x: x["honorarios_confirmados"], reverse=True)

    # ── Agendadoras ────────────────────────────────────────────────────────────
    agenda_users_q = db.query(models.User).filter(
        models.User.role == "agendadora",
        models.User.is_active == True,
    )
    if _gids is not None:
        agenda_users_q = agenda_users_q.filter(models.User.group_id.in_(_gids))
    agenda_users = agenda_users_q.all()

    agendadoras = []
    for a in agenda_users:
        def al(extra_filter=None, period_filter=True):
            q = db.query(func.count(models.Lead.id)).filter(models.Lead.agendadora_id == a.id)
            if _gids is not None:
                q = q.filter(models.Lead.group_id.in_(_gids))
            if period_filter:
                q = q.filter(models.Lead.created_at >= p_start, models.Lead.created_at < p_end)
            if extra_filter is not None:
                q = q.filter(extra_filter)
            return q.scalar() or 0

        leads_creados   = al()
        leads_activos   = al(models.Lead.current_stage.in_(list(ACTIVO_STAGES)), False)
        leads_convertidos = al(models.Lead.current_stage.in_(list(PAGO_STAGES)), False)

        # Eventos de reunión creados por esta agendadora en el período
        ev_base = db.query(models.CalendarEvent).filter(
            models.CalendarEvent.event_type == "reunion",
            models.CalendarEvent.created_by == a.id,
            models.CalendarEvent.start_time >= p_start,
            models.CalendarEvent.start_time < p_end,
        )
        reuniones_agendadas = ev_base.count()

        exitosas_a  = ev_base.filter(models.CalendarEvent.vendor_status.in_(["altamente_interesado", "con_exito_pagada"])).count()
        no_shows    = ev_base.filter(models.CalendarEvent.vendor_status == "no_show").count()
        sin_exito_a = ev_base.filter(models.CalendarEvent.vendor_status == "sin_exito").count()
        pendientes  = ev_base.filter(models.CalendarEvent.vendor_status.in_(["espera_cliente", None])).count()

        pct_show   = round((reuniones_agendadas - no_shows) / reuniones_agendadas * 100, 1) if reuniones_agendadas > 0 else 0.0
        pct_exit_a = round(exitosas_a / reuniones_agendadas * 100, 1) if reuniones_agendadas > 0 else 0.0
        # Conversión: convertidos ÷ (activos + convertidos) — evita valores >100%
        total_asignados = leads_activos + leads_convertidos
        pct_conv_a = round(leads_convertidos / total_asignados * 100, 1) if total_asignados > 0 else 0.0

        # Leads detalle de esta agendadora (activos + en pago)
        leads_ag_q = db.query(models.Lead).options(
            _jl(models.Lead.contact),
            _jl(models.Lead.area),
        ).filter(
            models.Lead.agendadora_id == a.id,
            models.Lead.current_stage.in_(list(ACTIVO_STAGES) + list(PAGO_STAGES)),
        )
        if _gids is not None:
            leads_ag_q = leads_ag_q.filter(models.Lead.group_id.in_(_gids))
        leads_ag_rows = leads_ag_q.order_by(models.Lead.updated_at.desc()).limit(50).all()
        leads_detalle_a = [
            {
                "lead_id": l.id,
                "contact_name": l.contact.name if l.contact else "—",
                "contact_phone": l.contact.phone if l.contact else "",
                "area": l.area.name if l.area else "—",
                "stage": l.current_stage,
                "honorarios": float(l.honorarios or 0),
                "updated_at": l.updated_at.isoformat() if l.updated_at else None,
            }
            for l in leads_ag_rows
        ]

        group_name = a.group.name if a.group else "—"

        agendadoras.append({
            "id": a.id, "name": a.name, "group": group_name,
            "leads_creados": leads_creados,
            "leads_activos": leads_activos,
            "leads_convertidos": leads_convertidos,
            "reuniones_agendadas": reuniones_agendadas,
            "reuniones_exitosas": exitosas_a,
            "reuniones_no_show": no_shows,
            "reuniones_sin_exito": sin_exito_a,
            "reuniones_pendientes": pendientes,
            "pct_show_rate": pct_show,
            "pct_efectividad": pct_exit_a,
            "pct_conversion_leads": pct_conv_a,
            "leads_detalle": leads_detalle_a,
        })
    agendadoras.sort(key=lambda x: x["reuniones_agendadas"], reverse=True)

    # ── Totales globales del período ───────────────────────────────────────────
    total_leads_q = scoped(lead_in_period(db.query(func.count(models.Lead.id))))
    total_leads = total_leads_q.scalar() or 0

    total_hon_q = scoped(db.query(func.sum(models.Lead.honorarios)).filter(
        models.Lead.current_stage.in_(list(PAGO_STAGES)),
        models.Lead.honorarios > 0,
    ))
    total_honorarios = float(total_hon_q.scalar() or 0)

    total_conf_q = scoped(db.query(func.sum(models.Lead.honorarios)).filter(
        models.Lead.current_stage == "pagado_confirmado",
        models.Lead.honorarios > 0,
    ))
    total_honorarios_conf = float(total_conf_q.scalar() or 0)

    total_ev_q = db.query(func.count(models.CalendarEvent.id)).filter(
        models.CalendarEvent.event_type == "reunion",
        models.CalendarEvent.start_time >= p_start,
        models.CalendarEvent.start_time < p_end,
    )
    total_reuniones = total_ev_q.scalar() or 0

    return {
        "period": {"from": p_start.date().isoformat(), "to": (p_end - timedelta(days=1)).date().isoformat()},
        "resumen": {
            "total_leads_periodo": total_leads,
            "total_honorarios_comprometidos": total_honorarios,
            "total_honorarios_confirmados": total_honorarios_conf,
            "total_reuniones": total_reuniones,
        },
        "vendedores": vendedores,
        "agendadoras": agendadoras,
    }



@router.post("/run-recovery-automation")
def run_recovery_automation(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Auto-move pago_comprometido leads with no payment confirmation in 15+ days to recuperacion_pago."""
    if current_user.role not in ("superadmin", "subadmin", "tecnico"):
        raise HTTPException(status_code=403, detail="Sin permiso")

    from datetime import timedelta
    cutoff = datetime.now(timezone.utc) - timedelta(days=15)

    stale_leads = (
        db.query(models.Lead)
        .join(models.PaymentVerification, models.PaymentVerification.lead_id == models.Lead.id)
        .filter(
            models.Lead.current_stage == "pago_comprometido",
            models.PaymentVerification.status == "pendiente",
            models.PaymentVerification.created_at < cutoff,
        )
        .all()
    )

    moved = 0
    for lead in stale_leads:
        lead.current_stage = "recuperacion_pago"
        db.add(models.LeadHistory(
            lead_id=lead.id,
            from_stage="pago_comprometido",
            to_stage="recuperacion_pago",
            result="failed",
            notes="Recuperación automática: sin pago confirmado en 15 días",
            created_by=current_user.id,
        ))
        moved += 1

    if moved:
        db.commit()
    return {"moved": moved}


@router.post("/revert-sinexito-moves")
def revert_sinexito_moves(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    One-time fix: move leads that were incorrectly sent to recuperacion_reunion
    by the old sin_exito/no_show logic back to 'reunion'.
    Identifies them by their last history entry: from_stage=reunion,
    to_stage=recuperacion_reunion, notes containing 'sin éxito' or 'no conectó'.
    """
    if current_user.role not in ("superadmin", "subadmin"):
        raise HTTPException(status_code=403, detail="Sin permiso")

    from sqlalchemy import desc

    leads_in_rec = (
        db.query(models.Lead)
        .filter(models.Lead.current_stage == "recuperacion_reunion")
        .all()
    )

    reverted = 0
    for lead in leads_in_rec:
        last_history = (
            db.query(models.LeadHistory)
            .filter(models.LeadHistory.lead_id == lead.id)
            .order_by(desc(models.LeadHistory.created_at))
            .first()
        )
        if last_history and last_history.from_stage == "reunion" and last_history.to_stage == "recuperacion_reunion":
            notes = last_history.notes or ""
            if "sin éxito" in notes or "no conectó" in notes or "sin exito" in notes.lower():
                lead.current_stage = "reunion"
                db.add(models.LeadHistory(
                    lead_id=lead.id,
                    from_stage="recuperacion_reunion",
                    to_stage="reunion",
                    result="info",
                    notes="Corrección automática: revertido de recuperación incorrecta por sin_exito/no_show",
                    created_by=current_user.id,
                ))
                reverted += 1

    if reverted:
        db.commit()
    return {"reverted": reverted}
