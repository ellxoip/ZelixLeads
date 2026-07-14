"""
Panel del Asistente de Seguimiento.

Flujo: cuando el vendedor marca una reunión como "con éxito sin pago"
(vendor_status = altamente_interesado) registra una fecha de compromiso de
pago (Lead.payment_commitment_date). Si pasan 5 días desde esa fecha sin que
el cliente pague (el lead sigue en etapa 'altamente_interesado'), el lead
"cae" automáticamente en este panel, donde el asistente puede gestionarlo y
conversar con el cliente por WhatsApp (igual que las agendadoras).

La caída es dinámica (no requiere cron): se calcula en cada consulta a partir
de payment_commitment_date. El asistente marca el avance vía seguimiento_status.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from datetime import date, datetime, timezone
from .. import models
from ..database import get_db
from ..auth import get_current_user
from ..broadcaster import wa_broadcaster
import asyncio

router = APIRouter(prefix="/api/seguimiento-asistente", tags=["seguimiento-asistente"])

# Días tras la fecha de compromiso sin pago a partir de los cuales el lead entra al panel.
DIAS_GRACIA = 5  # default; can be overridden via AppSetting "seguimiento_dias_gracia"


def _get_dias_gracia(db: Session) -> int:
    setting = db.query(models.AppSetting).filter(models.AppSetting.key == "seguimiento_dias_gracia").first()
    try:
        return int(setting.value) if setting else DIAS_GRACIA
    except (ValueError, TypeError):
        return DIAS_GRACIA

# Roles con acceso al panel del asistente de seguimiento.
ALLOWED_ROLES = ("asistente_seguimiento", "superadmin", "subadmin", "tecnico")

# Estados de gestión que dan por cerrado el caso (salen de la lista activa).
RESOLVED_STATUSES = ("pagado", "perdido")


def _guard(current_user: models.User):
    if current_user.role not in ALLOWED_ROLES:
        raise HTTPException(status_code=403, detail="Sin acceso al panel de seguimiento")


# Etapas de pago que caen al panel si no avanzan a pagado_confirmado
PAGO_STAGES = ("pago_pendiente", "pago_comprometido")


def _base_query(db: Session):
    """Leads candidatos a seguimiento: altamente_interesado con compromiso de pago,
    o cualquier lead en pago_pendiente / pago_comprometido (con o sin fecha)."""
    from sqlalchemy import or_, and_
    return (
        db.query(models.Lead)
        .options(
            joinedload(models.Lead.contact),
            joinedload(models.Lead.vendedor),
            joinedload(models.Lead.agendadora),
        )
        .filter(
            or_(
                and_(
                    models.Lead.current_stage == "altamente_interesado",
                    models.Lead.payment_commitment_date.isnot(None),
                ),
                models.Lead.current_stage.in_(PAGO_STAGES),
            ),
            models.Lead.deleted_at.is_(None),
        )
    )


def stage_entry_dates(db: Session, leads: list) -> dict[int, date]:
    """Fecha en que cada lead entró a su etapa actual (último LeadHistory con to_stage == current_stage)."""
    ids = [l.id for l in leads]
    if not ids:
        return {}
    from sqlalchemy import func as _func
    stage_of = {l.id: l.current_stage for l in leads}
    rows = (
        db.query(models.LeadHistory.lead_id, models.LeadHistory.to_stage, _func.max(models.LeadHistory.created_at))
        .filter(models.LeadHistory.lead_id.in_(ids))
        .group_by(models.LeadHistory.lead_id, models.LeadHistory.to_stage)
        .all()
    )
    out: dict[int, date] = {}
    for lid, to_stage, ts in rows:
        if ts and stage_of.get(lid) == to_stage:
            d = ts.date()
            if lid not in out or d > out[lid]:
                out[lid] = d
    return out


def lead_fecha_base(lead: models.Lead, entry_dates: dict[int, date]) -> date | None:
    """Fecha desde la que corre la gracia: compromiso de pago, o entrada a la etapa de pago."""
    if lead.payment_commitment_date:
        return lead.payment_commitment_date
    if lead.current_stage in PAGO_STAGES:
        d = entry_dates.get(lead.id)
        if d:
            return d
        ts = lead.updated_at or lead.created_at
        return ts.date() if ts else None
    return None


def _serialize(lead: models.Lead, today: date, dias_gracia: int = DIAS_GRACIA, fecha_base: date | None = None) -> dict:
    commitment = lead.payment_commitment_date
    base = fecha_base or commitment
    dias_vencido = (today - base).days if base else 0
    gracia_lead = dias_gracia
    return {
        "lead_id": lead.id,
        "contact_id": lead.contact_id,
        "contact_name": lead.contact.name if lead.contact else None,
        "contact_phone": lead.contact.phone if lead.contact else None,
        "vendor_name": lead.vendedor.name if lead.vendedor else None,
        "agendadora_name": lead.agendadora.name if lead.agendadora else None,
        "honorarios": lead.honorarios,
        "service_description": lead.service_description,
        "notes": lead.notes,
        "payment_commitment_date": commitment.isoformat() if commitment else None,
        "dias_vencido": dias_vencido,
        "dias_gracia": gracia_lead,
        "seguimiento_status": lead.seguimiento_status,
        "current_stage": lead.current_stage,
        "en_seguimiento": dias_vencido >= gracia_lead,
        "pagacuotas_status": lead.pagacuotas_status,
        "pagacuotas_link": lead.pagacuotas_link,
    }


@router.get("/leads")
def listar_leads(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Devuelve dos buckets:
      - en_seguimiento: compromiso vencido por >= DIAS_GRACIA días, sin pagar/perdido.
      - proximos: compromiso aún dentro del periodo de gracia (visibilidad anticipada).
    """
    _guard(current_user)
    today = datetime.now(timezone.utc).date()
    dias_gracia = _get_dias_gracia(db)
    en_seguimiento, proximos = [], []
    leads = _base_query(db).all()
    entry_dates = stage_entry_dates(db, leads)
    for lead in leads:
        item = _serialize(lead, today, dias_gracia, fecha_base=lead_fecha_base(lead, entry_dates))
        if item["seguimiento_status"] in RESOLVED_STATUSES:
            continue
        if item["en_seguimiento"]:
            en_seguimiento.append(item)
        else:
            proximos.append(item)
    en_seguimiento.sort(key=lambda x: x["dias_vencido"], reverse=True)
    proximos.sort(key=lambda x: x["payment_commitment_date"] or "")
    return {"en_seguimiento": en_seguimiento, "proximos": proximos}


@router.get("/dashboard")
def dashboard(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _guard(current_user)
    today = datetime.now(timezone.utc).date()
    dias_gracia = _get_dias_gracia(db)
    en_seguimiento = 0
    proximos = 0
    monto_en_riesgo = 0.0
    por_estado: dict = {}
    leads = _base_query(db).all()
    entry_dates = stage_entry_dates(db, leads)
    for lead in leads:
        item = _serialize(lead, today, dias_gracia, fecha_base=lead_fecha_base(lead, entry_dates))
        estado = item["seguimiento_status"] or "en_seguimiento"
        if item["seguimiento_status"] in RESOLVED_STATUSES:
            por_estado[estado] = por_estado.get(estado, 0) + 1
            continue
        if item["en_seguimiento"]:
            en_seguimiento += 1
            monto_en_riesgo += lead.honorarios or 0
            por_estado[estado] = por_estado.get(estado, 0) + 1
        else:
            proximos += 1
    return {
        "en_seguimiento": en_seguimiento,
        "proximos": proximos,
        "monto_en_riesgo": monto_en_riesgo,
        "por_estado": por_estado,
    }


def _normalize_rut(rut: str | None) -> str | None:
    if not rut:
        return None
    return rut.replace(".", "").replace(" ", "").upper() or None


def _fresh_pagacuotas_link(lead: models.Lead, contact) -> str | None:
    """Token de auto-login VIGENTE desde la DB de PagaCuotas (fuente de verdad).

    Los links guardados en lead.pagacuotas_link quedan obsoletos cuando el token
    rota/se revoca o cuando apuntan a otro entorno — nunca se reutilizan a ciegas.
    """
    import os
    from sqlalchemy import create_engine, text as sa_text

    pc_db_url = os.getenv("PAGACUOTAS_DATABASE_URL", "")
    portal = os.getenv("PAGACUOTAS_PORTAL_URL", "https://pagacuotas.hivelegaltech.cl").rstrip("/")
    if not pc_db_url:
        return None
    rut = _normalize_rut((contact.rut_persona or contact.rut_empresa) if contact else None)
    try:
        engine = create_engine(pc_db_url, pool_pre_ping=True)
        with engine.connect() as conn:
            row = conn.execute(sa_text(
                'SELECT magic_token, magic_token_revoked FROM "CrmClientProfile" '
                "WHERE crm_lead_id = :lid "
                "   OR (:rut IS NOT NULL AND REPLACE(UPPER(rut), '.', '') = :rut) "
                "ORDER BY (crm_lead_id = :lid) DESC LIMIT 1"
            ), {"lid": str(lead.id), "rut": rut}).first()
        engine.dispose()
        if row and row[0] and not row[1]:
            return f"{portal}/client/auto-login?token={row[0]}"
    except Exception:
        pass
    return None


@router.get("/leads/{lead_id}/mensaje-pago")
def mensaje_pago(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Mensaje de pago listo para copiar/pegar en WhatsApp Web.

    El link de pago se obtiene SIEMPRE fresco desde PagaCuotas (token vigente);
    si el cliente no existe allá, se crea (mismo flujo que la primera vez).
    El texto reusa el mensaje original con credenciales si está registrado,
    reemplazando el link viejo por el vigente.
    """
    import re
    from ..utils import pagacuotas as pc

    _guard(current_user)
    lead = (
        db.query(models.Lead)
        .options(
            joinedload(models.Lead.contact),
            joinedload(models.Lead.area),
            joinedload(models.Lead.vendedor),
        )
        .filter(models.Lead.id == lead_id)
        .first()
    )
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    contact = lead.contact

    # 1) Link vigente desde PagaCuotas; si el cliente no existe, crearlo
    fresh_link = _fresh_pagacuotas_link(lead, contact)
    if not fresh_link:
        rut = ((contact.rut_persona or contact.rut_empresa) if contact else None) or f"SIN-RUT-{lead.id}"
        area_name = lead.area.name if lead.area else "Sin categoría"
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
                vendedor_name=lead.vendedor.name if lead.vendedor else None,
            ))
            lead.pagacuotas_cliente_id = str(result.get("id", ""))
            lead.pagacuotas_status = "created"
            fresh_link = result.get("payment_link")
            # crear_cliente pudo registrar el cliente recién: relee el token vigente
            fresh_link = _fresh_pagacuotas_link(lead, contact) or fresh_link
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"PagaCuotas no disponible: {exc}")
    if not fresh_link:
        raise HTTPException(status_code=502, detail="No se pudo obtener un link de pago vigente de PagaCuotas.")

    if lead.pagacuotas_link != fresh_link:
        lead.pagacuotas_link = fresh_link
        db.commit()

    url_re = re.compile(r"https?://\S*/client/(?:auto-login\?token=|access/)\S+")

    # 2) Mensaje original con credenciales (por lead; fallback por contacto)
    base = db.query(models.WhatsAppMessage).filter(
        models.WhatsAppMessage.direction == "out",
        models.WhatsAppMessage.content.ilike("%credenciales%"),
        models.WhatsAppMessage.content.ilike("%pagacuotas%"),
    )
    msg = (
        base.filter(models.WhatsAppMessage.lead_id == lead_id)
        .order_by(models.WhatsAppMessage.id.desc())
        .first()
    )
    if msg is None and contact:
        msg = (
            base.filter(models.WhatsAppMessage.contact_id == contact.id)
            .order_by(models.WhatsAppMessage.id.desc())
            .first()
        )
    if msg:
        content = url_re.sub(fresh_link, msg.content, count=1)
        return {"message": content, "source": "original", "payment_link": fresh_link}

    # 3) Fallback: armar mensaje con lo que el CRM conoce
    nombre = (contact.name.split()[0] if contact and contact.name else "estimado cliente")
    rut_display = (contact.rut_persona or contact.rut_empresa) if contact else None
    lines = [f"Hola {nombre}, aquí está tu acceso para pagar:", ""]
    if rut_display:
        lines.append(f"👤 RUT: {rut_display}")
    lines += [
        "",
        "🔗 Portal PagaCuotas:",
        fresh_link,
        "",
        "Este enlace es personal y seguro.",
    ]
    return {"message": "\n".join(lines), "source": "generado", "payment_link": fresh_link}


@router.patch("/leads/{lead_id}/status")
def actualizar_status(
    lead_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """El asistente marca el avance de la gestión.

    Estados válidos: en_seguimiento | contactado | repactado | pagado | perdido.
    """
    _guard(current_user)
    valid = {"en_seguimiento", "contactado", "repactado", "pagado", "perdido"}
    nuevo = (data.get("seguimiento_status") or "").strip()
    if nuevo not in valid:
        raise HTTPException(status_code=400, detail="Estado inválido")
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    old = lead.seguimiento_status
    lead.seguimiento_status = nuevo
    note = (data.get("notes") or "").strip()
    db.add(models.LeadHistory(
        lead_id=lead.id,
        from_stage=lead.current_stage,
        to_stage=lead.current_stage,
        result="pending" if nuevo not in ("pagado", "perdido") else ("success" if nuevo == "pagado" else "failed"),
        notes=f"Seguimiento: {old or '—'} → {nuevo}" + (f" · {note}" if note else "") + f" — {current_user.name}",
        created_by=current_user.id,
    ))
    db.commit()
    return {"ok": True, "seguimiento_status": nuevo}


@router.post("/leads/{lead_id}/accion")
def ejecutar_accion(
    lead_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Acciones rápidas desde el panel de seguimiento:
    - accion: altamente_interesado  → revierte stage a altamente_interesado
    - accion: pago_pendiente        → avanza stage a pago_pendiente (Pago en el Día)
    - accion: compromiso            → actualiza payment_commitment_date con nueva fecha
    """
    _guard(current_user)
    accion = (data.get("accion") or "").strip()
    if accion not in {"altamente_interesado", "pago_pendiente", "compromiso"}:
        raise HTTPException(status_code=400, detail="Acción inválida")

    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    notes = (data.get("notes") or "").strip()
    prev_stage = lead.current_stage

    if accion == "altamente_interesado":
        lead.current_stage = "altamente_interesado"
        lead.payment_commitment_date = None
        lead.seguimiento_status = None
        history_note = f"Seguimiento → Altamente interesado — {current_user.name}"
        result = "pending"

    elif accion == "pago_pendiente":
        lead.current_stage = "pago_pendiente"
        lead.seguimiento_status = "pagado"
        history_note = f"Pago en el día → Pago pendiente — {current_user.name}"
        result = "success"

    elif accion == "compromiso":
        fecha_str = (data.get("fecha") or "").strip()
        if not fecha_str:
            raise HTTPException(status_code=400, detail="Se requiere fecha de compromiso")
        try:
            nueva_fecha = date.fromisoformat(fecha_str[:10])
        except ValueError:
            raise HTTPException(status_code=400, detail="Fecha inválida (usa YYYY-MM-DD)")
        lead.payment_commitment_date = nueva_fecha
        lead.seguimiento_status = "repactado"
        # El lead vuelve al pipeline del vendedor como Pago Comprometido con su
        # cuenta regresiva; si vence de nuevo, cae otra vez a este panel.
        lead.current_stage = "pago_comprometido"
        history_note = f"Compromiso de pago repactado: {nueva_fecha.isoformat()}" + (f" · {notes}" if notes else "") + f" — {current_user.name}"
        result = "pending"

    db.add(models.LeadHistory(
        lead_id=lead.id,
        from_stage=prev_stage,
        to_stage=lead.current_stage,
        result=result,
        notes=history_note,
        created_by=current_user.id,
    ))
    db.commit()

    wa_broadcaster.broadcast_sync("lead_update", {"lead_id": lead.id, "stage": lead.current_stage})
    return {"ok": True, "current_stage": lead.current_stage}
