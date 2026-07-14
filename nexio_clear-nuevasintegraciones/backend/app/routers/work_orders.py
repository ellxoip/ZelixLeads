from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse, HTMLResponse
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime, date, timezone, timedelta
from io import BytesIO
import json
import os
import hmac
import hashlib
import asyncio
import logging
import threading
import time

from ..database import get_db
from .. import models
from ..auth import get_current_user
from ..utils.notifications import create_notification
from ..utils.ot_templates import OT_CONTENT, HAS_OWN_CLIENT, acceptance_body
import copy

logger = logging.getLogger(__name__)


def _get_ot_catalog(ot_type: str, db=None) -> list:
    catalog = copy.deepcopy(OT_CONTENT.get(ot_type, []))
    if db is None:
        return catalog
    setting = db.query(models.AppSetting).filter(
        models.AppSetting.key == f"ot_template__{ot_type}"
    ).first()
    if not setting:
        return catalog
    try:
        overrides = json.loads(setting.value)
    except Exception:
        return catalog
    for sec_idx, entry in enumerate(catalog):
        if entry.get("kind") != "section":
            continue
        for blk_idx, block in enumerate(entry.get("blocks", [])):
            if block.get("kind") == "body":
                key = f"sec_{sec_idx}_blk_{blk_idx}"
                if key in overrides and overrides[key]:
                    block["paragraphs"] = overrides[key]
    return catalog


def _ot_pdf_secret() -> str:
    return (
        os.getenv("OT_PDF_SHARED_SECRET")
        or os.getenv("SECRET_KEY")
        or "nexio-ot-pdf-default-secret-change-me"
    )


def sign_ot_pdf_token(wo_id: int) -> str:
    secret = _ot_pdf_secret().encode()
    msg = f"ot-pdf:{wo_id}".encode()
    return hmac.new(secret, msg, hashlib.sha256).hexdigest()


def verify_ot_pdf_token(wo_id: int, token: str) -> bool:
    if not token:
        return False
    try:
        return hmac.compare_digest(sign_ot_pdf_token(wo_id), token.strip())
    except Exception:
        return False


def sign_ot_lead_pdf_token(lead_id: int) -> str:
    """Token para el link público ANCLADO AL LEAD (siempre sirve la OT vigente).
    A diferencia del token por OT, este link sobrevive si la OT se re-crea."""
    secret = _ot_pdf_secret().encode()
    msg = f"ot-lead-pdf:{lead_id}".encode()
    return hmac.new(secret, msg, hashlib.sha256).hexdigest()


def verify_ot_lead_pdf_token(lead_id: int, token: str) -> bool:
    if not token:
        return False
    try:
        return hmac.compare_digest(sign_ot_lead_pdf_token(lead_id), token.strip())
    except Exception:
        return False


def sign_ot_doc_token(wo_id: int) -> str:
    secret = _ot_pdf_secret().encode()
    msg = f"ot-doc:{wo_id}".encode()
    return hmac.new(secret, msg, hashlib.sha256).hexdigest()


def verify_ot_doc_token(wo_id: int, token: str) -> bool:
    if not token:
        return False
    try:
        return hmac.compare_digest(sign_ot_doc_token(wo_id), token.strip())
    except Exception:
        return False

# ReportLab
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, KeepTogether, Image, ListFlowable, ListItem
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY

router = APIRouter(prefix="/api/work-orders", tags=["work-orders"])

# ─── OT type catalog ───────────────────────────────────────────────────────────

OT_TYPES: dict[str, dict] = {
    "prescripcion": {
        "label": "Prescripción de Deuda Tributaria",
        "subtitle": "Tramitación de Prescripción de Deuda Tributaria — Art. 200 C.T.",
        "icon": "📋",
        "has_diagnosis": False,
        "extra_fields": [],
        "ai_fields": ["plazo_estimado", "observaciones_adicionales"],
    },
    "desbloqueo": {
        "label": "Desbloqueo y Levantamiento de Anotaciones",
        "subtitle": "Desbloqueo y Levantamiento de Anotaciones — SII",
        "icon": "🔓",
        "has_diagnosis": False,
        "extra_fields": [],
        "ai_fields": ["plazo_estimado", "observaciones_adicionales"],
    },
    "desbloqueo_contable": {
        "label": "Desbloqueo + Normalización Contable",
        "subtitle": "Desbloqueo, Levantamiento de Anotaciones y Normalización Contable — SII",
        "icon": "📊",
        "has_diagnosis": False,
        "extra_fields": [],
        "ai_fields": ["plazo_estimado", "observaciones_adicionales"],
    },
    "liquidacion_juridica": {
        "label": "Liquidación Voluntaria — Persona Jurídica",
        "subtitle": "Liquidación Voluntaria de Empresa de Menor Tamaño (Ley 20.720)",
        "icon": "🏢",
        "has_diagnosis": True,
        "extra_fields": [
            {"key": "representante_legal", "label": "Representante Legal", "type": "text"},
            {"key": "rut_representante",   "label": "RUT Representante",   "type": "text"},
            {"key": "razon_social",         "label": "Razón Social Empresa", "type": "text"},
            {"key": "rut_empresa",          "label": "RUT Empresa",          "type": "text"},
        ],
        "ai_fields": ["deuda_total_estimada", "estado_alerta", "observacion_tecnica", "perfil_cliente"],
    },
    "liquidacion_natural": {
        "label": "Liquidación Voluntaria — Persona Natural",
        "subtitle": "Liquidación Voluntaria (Ley 20.720) — Persona Natural",
        "icon": "👤",
        "has_diagnosis": True,
        "extra_fields": [
            {"key": "perfil_deudor", "label": "Perfil del Deudor", "type": "text"},
        ],
        "ai_fields": ["deuda_total_consolidada", "estado_pago", "observacion_critica", "composicion_deuda"],
    },
    "facturas_irregulares": {
        "label": "Facturas Irregulares (Art. 97 N°4)",
        "subtitle": "Defensa Administrativa por Observación de Facturas Irregulares — SII",
        "icon": "🧾",
        "has_diagnosis": False,
        "extra_fields": [],
        "ai_fields": ["observaciones_adicionales"],
    },
    "convenio_full": {
        "label": "Convenio de Pago — TGR",
        "subtitle": "Tramitación de Convenio de Pago — Tesorería General de la República",
        "icon": "🤝",
        "has_diagnosis": False,
        "extra_fields": [
            {"key": "cuotas_propuestas_cantidad", "label": "Cantidad de cuotas propuestas", "type": "number"},
            {"key": "cuotas_propuestas_monto",    "label": "Monto aprox. por cuota ($)",    "type": "number"},
        ],
        "ai_fields": ["observaciones_adicionales"],
    },
    "defensa_ejecutiva": {
        "label": "Defensa Ejecutiva Completa",
        "subtitle": "Asesoría Legal Integral para Defensa Ejecutiva Completa",
        "icon": "⚖️",
        "has_diagnosis": True,
        "extra_fields": [
            {"key": "perfil_deudor", "label": "Perfil del Deudor", "type": "text"},
        ],
        "ai_fields": ["deuda_total_consolidada", "estado_alerta", "observacion_tecnica", "perfil_cliente", "composicion_deuda"],
    },
    "proteccion_patrimonial": {
        "label": "Defensa Ejecutiva + Protección Patrimonial",
        "subtitle": "Defensa Ejecutiva de Largo Plazo y Gestión de Protección Patrimonial",
        "icon": "🛡️",
        "has_diagnosis": True,
        "extra_fields": [
            {"key": "perfil_deudor",               "label": "Perfil del Deudor",          "type": "text"},
            {"key": "proteccion_patrimonial_solicitada", "label": "Protección patrimonial solicitada", "type": "textarea"},
        ],
        "ai_fields": ["deuda_financiera_total", "origen_deuda", "observacion_tecnica", "perfil_cliente", "composicion_deuda"],
    },
    "renegociacion": {
        "label": "Renegociación Ley 20.720 (SUPERIR)",
        "subtitle": "Renegociación y Reestructuración de Pasivos ante Superintendencia de Insolvencia",
        "icon": "🔄",
        "has_diagnosis": True,
        "extra_fields": [
            {"key": "perfil_deudor", "label": "Perfil del Deudor", "type": "text"},
        ],
        "ai_fields": ["deuda_total_reportada", "estado_pago", "observacion_tecnica", "perfil_cliente", "composicion_deuda"],
    },
    "alzamiento": {
        "label": "Alzamiento de Gravamen de Vehículo",
        "subtitle": "Gestión Legal Especializada para Alzamiento de Embargo de Vehículo Motorizado",
        "icon": "🚗",
        "has_diagnosis": False,
        "extra_fields": [
            {"key": "causa_referencia",    "label": "Causa Referencia / Rol",   "type": "text"},
            {"key": "tribunal",            "label": "Tribunal",                  "type": "text"},
            {"key": "acreedor_demandante", "label": "Acreedor / Demandante",     "type": "text"},
        ],
        "ai_fields": ["estrategia_legal"],
    },
    "constitucion": {
        "label": "Constitución de Sociedades",
        "subtitle": "Creación y Constitución de Nueva Sociedad",
        "icon": "🏗️",
        "has_diagnosis": False,
        "extra_fields": [
            {"key": "tipo_societario",      "label": "Tipo societario",          "type": "select",
             "options": ["SpA", "SRL", "EIRL", "SA", "Otro"]},
            {"key": "metodo_constitucion",  "label": "Método de constitución",   "type": "select",
             "options": ["Digital (RES)", "Tradicional (Notaría + CBR)"]},
        ],
        "ai_fields": ["plazo_estimado", "observaciones_adicionales"],
    },
}

AI_FIELD_LABELS = {
    "plazo_estimado":          "Plazo estimado del procedimiento",
    "observaciones_adicionales": "Observaciones adicionales",
    "deuda_total_estimada":    "Deuda total estimada",
    "deuda_total_consolidada": "Deuda total consolidada",
    "deuda_total_reportada":   "Deuda total reportada",
    "deuda_financiera_total":  "Deuda financiera total",
    "estado_alerta":           "Estado de alerta",
    "estado_pago":             "Estado de pago",
    "observacion_tecnica":     "Observación técnica",
    "observacion_critica":     "Observación crítica",
    "perfil_cliente":          "Perfil del cliente",
    "composicion_deuda":       "Composición de la deuda",
    "estrategia_legal":        "Estrategia legal",
    "origen_deuda":            "Origen de la deuda",
}

# ─── Schemas ───────────────────────────────────────────────────────────────────

class WorkOrderCreate(BaseModel):
    lead_id:     int
    ot_type:     str
    fields_json: dict = {}

class WorkOrderUpdate(BaseModel):
    fields_json: dict
    status:      Optional[str] = None
    notify_agendadora: bool = False

class WorkOrderOut(BaseModel):
    id:          int
    lead_id:     int
    ot_type:     str
    fields_json: dict
    status:      str
    is_copy:     bool
    created_by:  int
    created_at:  datetime
    updated_at:  Optional[datetime]
    ot_label:    str

    class Config:
        from_attributes = True

class WorkOrderCreateOut(BaseModel):
    original: WorkOrderOut
    copia:    WorkOrderOut

# ─── Helpers ───────────────────────────────────────────────────────────────────

def _check_access(lead: models.Lead, user: models.User):
    if user.role in ("superadmin", "subadmin", "tecnico", "verificador"):
        return
    if user.role == "vendedor" and lead.vendedor_id != user.id:
        raise HTTPException(403, "Sin permiso")
    if user.role == "agendadora" and lead.agendadora_id != user.id:
        raise HTTPException(403, "Sin permiso")

def build_ot_integration_payload(wo: models.WorkOrder) -> dict:
    """Payload estándar de una OT para las integraciones salientes.

    `document_url` apunta al HTML público que replica 1:1 la OT del panel del
    vendedor (la misma que él exporta a PDF); `pdf_url` queda como respaldo en
    formato PDF (ReportLab).
    """
    try:
        fields = json.loads(wo.fields_json or "{}")
    except Exception:
        fields = {}
    # Plan de pago AUTORITATIVO de la OT (del lead). Se envía estructurado para
    # que el contable use EXACTO el monto_cuota de NEXIO (pie + N×monto_cuota) y
    # NO caiga a su reparto legacy (saldo/(N−1)), que produce cuotas erróneas.
    financials = {}
    try:
        lead = wo.lead
        if lead:
            financials = {
                "honorarios": float(lead.honorarios or 0),
                "cuota_inicial": float(lead.cuota_inicial or 0),
                "num_cuotas": int(lead.num_cuotas or 0),
                "monto_cuota": float(lead.monto_cuota or 0),
            }
    except Exception:
        financials = {}
    nexio_public_url = os.getenv("NEXIO_PUBLIC_URL", "http://localhost:8000").rstrip("/")
    return {
        "id": wo.id,
        "type": wo.ot_type,
        "label": OT_TYPES.get(wo.ot_type, {}).get("label", wo.ot_type),
        "status": wo.status,
        "is_copy": bool(wo.is_copy),
        "created_at": wo.created_at.isoformat() if wo.created_at else None,
        "updated_at": wo.updated_at.isoformat() if wo.updated_at else None,
        "document_url": f"{nexio_public_url}/api/work-orders/public/{wo.id}/document?token={sign_ot_doc_token(wo.id)}",
        "pdf_url": f"{nexio_public_url}/api/work-orders/public/{wo.id}/pdf?token={sign_ot_pdf_token(wo.id)}",
        "fields": fields,
        "financials": financials,
    }


def select_integration_work_order(db: Session, lead_id: int) -> "models.WorkOrder | None":
    """La OT que viaja a las integraciones: la copia editable más reciente.

    El vendedor trabaja y exporta SIEMPRE la copia (`is_copy=True`, sincronizada
    con los valores vigentes del lead); el original queda congelado como
    respaldo. Antes se tomaba "la última por fecha", lo que podía mandar el
    original congelado en vez de la OT real del vendedor.
    """
    copia = (
        db.query(models.WorkOrder)
        .filter(models.WorkOrder.lead_id == lead_id, models.WorkOrder.is_copy == True)  # noqa: E712
        .order_by(models.WorkOrder.created_at.desc())
        .first()
    )
    if copia:
        return copia
    return (
        db.query(models.WorkOrder)
        .filter(models.WorkOrder.lead_id == lead_id)
        .order_by(models.WorkOrder.created_at.desc())
        .first()
    )


def _sync_ot_to_service_control(wo: models.WorkOrder, db: Session) -> None:
    """Fire-and-forget: empuja/actualiza el documento OT del caso en
    hive-service-control para que control siempre muestre la OT vigente de
    NEXIO. Jamás interrumpe el guardado de la OT.

    Antes esto se auto-bloqueaba salvo que el lead tuviera un caso creado por
    NEXIO (`hive_service_case_id`/`status=="created"`), flag que solo encendía
    el push encadenado a finanzas. Como el caso normalmente lo crea la vía
    PagaCuotas (NEXIO no se entera), la OT nunca viajaba. Ahora SIEMPRE se
    intenta: control resuelve el caso por `crm_lead_id`/`rut`/`case_code`; si
    aún no existe responde 404 y el push lo trata como no-op (reintenta al
    próximo guardado/edición de la OT), sin ruido de error."""
    lead = wo.lead
    if not lead:
        return

    # Snapshot de todo lo necesario ANTES de soltar el hilo: el hilo no debe
    # tocar la sesión de BD del request.
    contact = lead.contact
    rut = (contact.rut_persona or contact.rut_empresa) if contact else None
    contrato_id = getattr(lead, "legal_finance_contrato_id", None)
    case_code = f"SIS-{contrato_id}" if contrato_id else f"NEXIO-{lead.id}"
    service_category = lead.area.name if lead.area else "TRIBUTARIO"
    payload = build_ot_integration_payload(wo)
    lead_id, wo_id = lead.id, wo.id

    def _push():
        try:
            from ..utils import hive_service as hs
            res = asyncio.run(hs.push_work_order(
                crm_lead_id=lead_id,
                rut=rut,
                case_code=case_code,
                service_category=service_category,
                work_order=payload,
            ))
            if isinstance(res, dict) and res.get("skipped") == "case_not_found":
                logger.info(
                    "OT %s: el caso aún no existe en control (lead %s); "
                    "reintentará en el próximo guardado de la OT", wo_id, lead_id)
            else:
                logger.info("OT %s sincronizada a service-control (lead %s)", wo_id, lead_id)
        except Exception as exc:
            logger.warning(
                "Sync OT %s a service-control falló (no crítico, lead %s): %s",
                wo_id, lead_id, exc,
            )

    threading.Thread(target=_push, name=f"ot-sync-{wo_id}", daemon=True).start()


def _wo_to_out(wo: models.WorkOrder) -> WorkOrderOut:
    return WorkOrderOut(
        id=wo.id,
        lead_id=wo.lead_id,
        ot_type=wo.ot_type,
        fields_json=json.loads(wo.fields_json or '{}'),
        status=wo.status,
        is_copy=bool(wo.is_copy),
        created_by=wo.created_by,
        created_at=wo.created_at,
        updated_at=wo.updated_at,
        ot_label=OT_TYPES.get(wo.ot_type, {}).get("label", wo.ot_type),
    )

# ─── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/types")
def get_ot_types():
    return [{"key": k, **{f: v for f, v in v.items()}} for k, v in OT_TYPES.items()]


@router.get("", response_model=list[WorkOrderOut])
def list_work_orders(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(404, "Lead no encontrado")
    _check_access(lead, current_user)
    wos = db.query(models.WorkOrder).filter(
        models.WorkOrder.lead_id == lead_id
    ).order_by(models.WorkOrder.created_at.desc()).all()
    return [_wo_to_out(w) for w in wos]


@router.get("/{wo_id}", response_model=WorkOrderOut)
def get_work_order(
    wo_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    wo = db.query(models.WorkOrder).filter(models.WorkOrder.id == wo_id).first()
    if not wo:
        raise HTTPException(404)
    _check_access(wo.lead, current_user)
    return _wo_to_out(wo)


def _send_ot_whatsapp(db: Session, lead: models.Lead, wo: models.WorkOrder) -> None:
    """Best-effort: envía al cliente el link DESCARGABLE de la OT por WhatsApp.
    No-crítico: cualquier fallo se loguea sin romper la creación de la OT.
    Incluye guarda ANTI-DUPLICACIÓN (no reenvía el mismo link de OT en <60s)."""
    try:
        contact = lead.contact
        if not contact or not contact.phone:
            logger.info("[ot-wa] lead %s sin teléfono — no se envía OT", lead.id)
            return

        # Anti-duplicación: bloquea doble clic / reintento de red.
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=60)
        dup = db.query(models.WhatsAppMessage.id).filter(
            models.WhatsAppMessage.lead_id == lead.id,
            models.WhatsAppMessage.direction == "out",
            models.WhatsAppMessage.content.like("%/work-orders/public/%"),
            models.WhatsAppMessage.created_at >= cutoff,
        ).first()
        if dup:
            logger.info("[ot-wa] OT ya enviada hace <60s para lead %s — se omite", lead.id)
            return

        # Config WA: misma resolución que el resto de los envíos automáticos —
        # sesión por la que el contacto YA conversa → área → grupo → cualquiera.
        from .leads import _resolve_wa_config
        cfg = _resolve_wa_config(lead, db)
        if not cfg:
            logger.warning("[ot-wa] sin config WA activa — no se envió OT para lead %s", lead.id)
            return

        # Link público firmado (renderiza el PDF en vivo). En TEST apunta a
        # https://test.nexio.hivelegaltech.cl vía NEXIO_PUBLIC_URL.
        # Link anclado al LEAD (no a la OT): si la OT se elimina y re-crea, el
        # link ya enviado sigue sirviendo la versión vigente en vez de dar 404.
        nexio_public_url = os.getenv("NEXIO_PUBLIC_URL", "http://localhost:8000").rstrip("/")
        pdf_url = f"{nexio_public_url}/api/work-orders/public/lead/{lead.id}/pdf?token={sign_ot_lead_pdf_token(lead.id)}"
        nombre = contact.name.split()[0] if contact.name else "estimado cliente"
        message = (
            f"Hola {nombre}, aquí puedes descargar la Orden de Trabajo de tu reunión:\n"
            f"🔗 {pdf_url}\n\n"
            f"Saludos, Abogados Tributarios."
        )

        # "Respiro" anti-race: espacia este envío para que NO colisione con otro
        # mensaje automático simultáneo al mismo número/sesión del whatsapp-qr-service
        # (p. ej. el link de PagaCuotas de _fire_integrations). El qr-service puede
        # descartar envíos consecutivos demasiado juntos; 1.2s da orden y armonía.
        time.sleep(1.2)

        from ..routers.whatsapp import send_whatsapp_api
        res = asyncio.run(send_whatsapp_api(cfg, contact.phone, message))
        db.add(models.WhatsAppMessage(
            contact_id=contact.id, lead_id=lead.id, whatsapp_config_id=cfg.id,
            direction="out", message_type="text", content=message,
            status=res.get("status", "logged"), message_id=res.get("message_id"),
        ))
        db.commit()
        logger.info("[ot-wa] OT %s enviada por WA a %s (lead %s)", wo.id, contact.phone, lead.id)
    except Exception as exc:
        logger.warning("[ot-wa] no se pudo enviar OT por WA para lead %s: %s", lead.id, exc)


@router.post("", response_model=WorkOrderCreateOut)
def create_work_order(
    data: WorkOrderCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if data.ot_type not in OT_TYPES:
        raise HTTPException(400, f"Tipo de OT inválido: {data.ot_type}")
    lead = db.query(models.Lead).options(
        joinedload(models.Lead.contact)
    ).filter(models.Lead.id == data.lead_id).first()
    if not lead:
        raise HTTPException(404, "Lead no encontrado")
    _check_access(lead, current_user)

    # Auto-populate common fields from lead/contact
    fields = {
        "fecha": date.today().strftime("%d/%m/%Y"),
        "nombre_razon_social": lead.contact.razon_social or lead.contact.name or "",
        "rut": lead.contact.rut_empresa or lead.contact.rut_persona or "",
        "domicilio": lead.contact.address or "",
        "comuna": lead.contact.city or "",
        "telefono": lead.contact.phone or "",
        "email": lead.contact.email or "",
        "honorarios": lead.honorarios or 0,
        "pie_inicial": lead.cuota_inicial or 0,
        "num_cuotas": lead.num_cuotas or 1,
        "monto_cuota": lead.monto_cuota or 0,
        "forma_de_pago": "",
        "plazo_estimado": "",
        "observaciones_adicionales": "",
    }
    if data.ot_type == "liquidacion_juridica":
        fields["representante_legal"] = lead.contact.name or ""
        fields["rut_representante"] = lead.contact.rut_persona or ""
        fields["razon_social"] = lead.contact.razon_social or ""
        fields["rut_empresa"] = lead.contact.rut_empresa or ""

    fields.update(data.fields_json)

    # Coherencia financiera: el pie inicial no puede superar los honorarios.
    try:
        _hon = float(fields.get('honorarios') or 0)
        _pie = float(fields.get('pie_inicial') or 0)
    except (ValueError, TypeError):
        _hon = _pie = 0.0
    if _hon > 0 and _pie > _hon:
        raise HTTPException(
            status_code=400,
            detail="El pie inicial no puede ser mayor que los honorarios profesionales.",
        )

    fields_str = json.dumps(fields, ensure_ascii=False)

    # Create original (locked) and editable copy
    original = models.WorkOrder(
        lead_id=lead.id, ot_type=data.ot_type, fields_json=fields_str,
        status="final", is_copy=False, created_by=current_user.id,
    )
    db.add(original)
    db.flush()  # get original.id before commit

    copy = models.WorkOrder(
        lead_id=lead.id, ot_type=data.ot_type, fields_json=fields_str,
        status="draft", is_copy=True, created_by=current_user.id,
    )
    db.add(copy)

    # Sync financial fields to lead on creation (same as PATCH update)
    try:
        if fields.get('honorarios'):
            lead.honorarios = float(fields['honorarios'] or 0)
        if fields.get('num_cuotas'):
            lead.num_cuotas = int(fields['num_cuotas'] or 1)
        if fields.get('pie_inicial'):
            lead.cuota_inicial = float(fields['pie_inicial'] or 0)
        if fields.get('monto_cuota'):
            lead.monto_cuota = float(fields['monto_cuota'] or 0)
    except (ValueError, TypeError):
        pass

    db.commit()
    db.refresh(original)
    db.refresh(copy)

    # ── Automatización obligatoria: enviar la OT descargable al cliente por WA ──
    # Se usa la copia (is_copy=True) — la versión que el vendedor edita; el link
    # público renderiza el PDF en vivo, así refleja los cambios posteriores.
    _send_ot_whatsapp(db, lead, copy)

    # Integración: empujar la OT a control desde su creación. Si el caso ya
    # existe (creado por la vía PagaCuotas) el documento aparece de inmediato en
    # AT INFORMA; si aún no existe, el push es un no-op y reintenta al editarse.
    _sync_ot_to_service_control(copy, db)

    return WorkOrderCreateOut(original=_wo_to_out(original), copia=_wo_to_out(copy))


@router.patch("/{wo_id}", response_model=WorkOrderOut)
def update_work_order(
    wo_id: int,
    data: WorkOrderUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    wo = db.query(models.WorkOrder).options(
        joinedload(models.WorkOrder.lead).joinedload(models.Lead.contact)
    ).filter(models.WorkOrder.id == wo_id).first()
    if not wo:
        raise HTTPException(404)
    _check_access(wo.lead, current_user)

    existing = json.loads(wo.fields_json or '{}')
    existing.update(data.fields_json)

    # Coherencia financiera: el pie inicial no puede superar los honorarios.
    # Espejo del clamp del frontend — evita que un payload directo lo evada.
    try:
        _hon = float(existing.get('honorarios') or 0)
        _pie = float(existing.get('pie_inicial') or 0)
    except (ValueError, TypeError):
        _hon = _pie = 0.0
    if _hon > 0 and _pie > _hon:
        raise HTTPException(
            status_code=400,
            detail="El pie inicial no puede ser mayor que los honorarios profesionales.",
        )

    wo.fields_json = json.dumps(existing, ensure_ascii=False)
    if data.status:
        wo.status = data.status

    # Sync financial fields back to lead when editing the copy
    if wo.is_copy:
        lead = wo.lead
        try:
            if 'honorarios' in existing:
                lead.honorarios = float(existing['honorarios'] or 0)
            if 'num_cuotas' in existing:
                lead.num_cuotas = int(existing['num_cuotas'] or 1)
            if 'pie_inicial' in existing:
                lead.cuota_inicial = float(existing['pie_inicial'] or 0)
            if 'monto_cuota' in existing:
                lead.monto_cuota = float(existing['monto_cuota'] or 0)
        except (ValueError, TypeError):
            pass

        if data.notify_agendadora and lead.agendadora_id and lead.agendadora_id != current_user.id:
            title = "OT cargada — lista para avanzar"
            already_notified = db.query(models.Notification).filter(
                models.Notification.user_id == lead.agendadora_id,
                models.Notification.lead_id == lead.id,
                models.Notification.title == title,
            ).first()
            if not already_notified:
                contact_name = lead.contact.name if lead.contact else "cliente"
                ot_label = OT_TYPES.get(wo.ot_type, {}).get("label", wo.ot_type)
                create_notification(
                    db, lead.agendadora_id,
                    title,
                    f"{current_user.name} cargó la OT '{ot_label}' para {contact_name}. El lead está listo para avanzar.",
                    lead_id=lead.id,
                    notification_type="etapa"
                )

    db.commit()
    db.refresh(wo)

    # Integración: si el caso ya existe en hive-service-control, refrescar el
    # documento OT para que control muestre siempre la OT vigente del vendedor.
    if wo.is_copy:
        _sync_ot_to_service_control(wo, db)

    return _wo_to_out(wo)


@router.delete("/{wo_id}")
def delete_work_order(
    wo_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    wo = db.query(models.WorkOrder).options(
        joinedload(models.WorkOrder.lead)
    ).filter(models.WorkOrder.id == wo_id).first()
    if not wo:
        raise HTTPException(404)
    _check_access(wo.lead, current_user)
    db.delete(wo)
    db.commit()
    return {"ok": True}


# ─── AI Fill ───────────────────────────────────────────────────────────────────

@router.post("/{wo_id}/ai-fill", response_model=WorkOrderOut)
async def ai_fill_work_order(
    wo_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    wo = db.query(models.WorkOrder).options(
        joinedload(models.WorkOrder.lead).joinedload(models.Lead.contact)
    ).filter(models.WorkOrder.id == wo_id).first()
    if not wo:
        raise HTTPException(404)
    _check_access(wo.lead, current_user)

    # Get OpenAI key
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        agent = db.query(models.AIAgent).filter(
            models.AIAgent.is_active == True
        ).first()
        if agent:
            api_key = agent.openai_api_key
    if not api_key:
        raise HTTPException(400, "No hay clave OpenAI configurada. Agrega OPENAI_API_KEY en .env o configura un Agente IA.")

    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=api_key)

    ot_cfg = OT_TYPES[wo.ot_type]
    lead = wo.lead
    contact = lead.contact
    fields = json.loads(wo.fields_json or '{}')

    ai_field_keys = ot_cfg["ai_fields"]
    if not ai_field_keys:
        return _wo_to_out(wo)

    fields_to_fill = "\n".join(
        f'- "{k}": {AI_FIELD_LABELS.get(k, k)}'
        for k in ai_field_keys
    )

    has_composicion = "composicion_deuda" in ai_field_keys

    system_prompt = (
        "Eres un asistente legal de Abogados Tributarios Chile SpA. "
        "Tu tarea es completar campos de una Orden de Trabajo legal en español formal chileno. "
        "Responde SOLO con un objeto JSON válido con los campos solicitados. "
        "Sin explicaciones ni texto adicional. Solo el JSON."
    )

    user_prompt = f"""Completa los siguientes campos para una OT de tipo: {ot_cfg['label']}

DATOS DEL CLIENTE:
- Nombre: {contact.name or '-'}
- Razón Social: {contact.razon_social or '-'}
- RUT persona: {contact.rut_persona or '-'}
- RUT empresa: {contact.rut_empresa or '-'}
- Ciudad: {contact.city or '-'}
- Notas del contacto: {contact.notes or '-'}

DATOS DEL CASO:
- Descripción del servicio: {lead.service_description or '-'}
- Notas del vendedor: {lead.notes or '-'}
- Honorarios pactados: ${lead.honorarios:,.0f} CLP
- Pie inicial: ${lead.cuota_inicial:,.0f} CLP
- Cuotas: {lead.num_cuotas} cuotas de ${lead.monto_cuota:,.0f} CLP

CAMPOS A COMPLETAR (devuelve SOLO estas claves exactas):
{fields_to_fill}

REGLAS:
- Responde con un JSON que tenga ÚNICAMENTE las claves listadas arriba. Ninguna clave adicional.
- Lenguaje jurídico formal chileno. Frases concisas de 1-3 oraciones.
- "deuda_total_*": extrae o estima monto. Ej: "$12.500.000 en deudas tributarias ante el SII".
- "estado_alerta": estado breve. Ej: "Deuda con mora superior a 3 años en Tesorería General".
- "observacion_tecnica" / "observacion_critica": análisis técnico. 1-2 oraciones.
- "perfil_cliente": Ej: "Persona natural, contribuyente de primera categoría con actividad comercial inactiva".
- "plazo_estimado": plazo realista según tipo de servicio.
- "estrategia_legal": estrategia en 1-2 oraciones.
{'''- "composicion_deuda": array JSON con keys: acreedor, tipo_producto, monto_total, estado_critico.
  Ej: [{{"acreedor":"Banco Chile","tipo_producto":"Crédito Consumo","monto_total":"$5.000.000","estado_critico":"Mora 90+ días"}}]
  Crea 2-3 filas representativas si no hay datos específicos.''' if has_composicion else ''}"""

    try:
        resp = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_prompt},
            ],
            temperature=0.4,
            max_tokens=800,
            response_format={"type": "json_object"},
        )
        ai_data = json.loads(resp.choices[0].message.content)
    except Exception as e:
        raise HTTPException(500, f"Error al llamar OpenAI: {str(e)}")

    # Only apply keys that were actually requested
    allowed_keys = set(ai_field_keys)
    for k, v in ai_data.items():
        if k in allowed_keys:
            fields[k] = v
    wo.fields_json = json.dumps(fields, ensure_ascii=False)
    db.commit()
    db.refresh(wo)

    # Integración: si acabamos de rellenar la copia editable, refrescar la OT
    # en control (best-effort, no-op si el caso aún no existe).
    if wo.is_copy:
        _sync_ot_to_service_control(wo, db)

    return _wo_to_out(wo)


# ─── PDF Generation ────────────────────────────────────────────────────────────

BRAND  = colors.HexColor("#1B2A4A")
ACCENT = colors.HexColor("#2563EB")
LIME_C = colors.HexColor("#4D7C0F")
MUTED  = colors.HexColor("#6B7280")
LIGHT  = colors.HexColor("#F0F4FF")
LINE   = colors.HexColor("#D1D5DB")
RED_C  = colors.HexColor("#B91C1C")

def _fmt_money(v) -> str:
    try:
        return f"${int(float(v)):,}".replace(",", ".")
    except Exception:
        return str(v) if v else "-"

def _build_ot_pdf(wo: models.WorkOrder, db=None) -> BytesIO:
    """Render OT como PDF replicando 1:1 el modal del frontend.

    Estilo basado en la referencia visual aprobada:
    - Banner gráfico arriba (ot_header.png).
    - Títulos y encabezados a la izquierda, sin fondos de color.
    - Section headers = texto plano bold negro mayúsculas.
    - Cliente inline (Label: valor) sin líneas separadoras.
    - Pie a 3 columnas: teléfono · web · dirección.
    """
    fields = json.loads(wo.fields_json or '{}')
    cfg = OT_TYPES.get(wo.ot_type, {})

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        rightMargin=2 * cm, leftMargin=2 * cm,
        topMargin=1.4 * cm, bottomMargin=1.8 * cm,
    )

    styles = getSampleStyleSheet()

    DOC_BLACK = colors.HexColor("#111827")  # casi negro
    DOC_MUTED = colors.HexColor("#6B7280")
    FOOTER_LINE = colors.HexColor("#D1D5DB")

    title_s = ParagraphStyle(
        "OTTitle", parent=styles["Normal"],
        fontName="Helvetica-Bold", fontSize=12, textColor=DOC_BLACK,
        alignment=TA_LEFT, spaceAfter=0, leading=14,
    )
    subtitle_s = ParagraphStyle(
        "OTSubtitle", parent=styles["Normal"],
        fontName="Helvetica-Bold", fontSize=10, textColor=DOC_BLACK,
        alignment=TA_LEFT, spaceAfter=12, leading=13,
    )
    section_s = ParagraphStyle(
        "OTSection", parent=styles["Normal"],
        fontName="Helvetica-Bold", fontSize=10, textColor=DOC_BLACK,
        spaceBefore=12, spaceAfter=6, alignment=TA_LEFT,
    )
    body_s = ParagraphStyle(
        "OTBody", parent=styles["Normal"],
        fontName="Helvetica-Bold", fontSize=9, textColor=DOC_BLACK,
        leading=13, alignment=TA_JUSTIFY, spaceAfter=4,
    )
    inline_s = ParagraphStyle(
        "OTInline", parent=styles["Normal"],
        fontName="Helvetica-Bold", fontSize=9, textColor=DOC_BLACK,
        leading=14, alignment=TA_LEFT, spaceAfter=3,
    )
    footer_s = ParagraphStyle(
        "OTFooter", parent=styles["Normal"],
        fontName="Helvetica", fontSize=8, textColor=DOC_MUTED,
        alignment=TA_CENTER, leading=10,
    )

    def section_header(text):
        return Paragraph(text.upper(), section_s)

    def inline_field(label, value):
        val = str(value) if (value not in (None, "")) else ""
        return Paragraph(f"<b>{label}</b> {val}", inline_s)

    story = []

    # ── Header banner ───────────────────────────────────────────────────────────
    header_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "..", "frontend", "public", "ot_header.png",
    )
    if os.path.exists(header_path):
        try:
            story.append(Image(header_path, width=doc.width, height=2.2 * cm))
            story.append(Spacer(1, 14))
        except Exception:
            pass

    # ── Title block (izquierda, sin separadores) ────────────────────────────────
    story.append(Paragraph("ORDEN DE TRABAJO", title_s))
    label_upper = cfg.get("label", wo.ot_type).upper()
    story.append(Paragraph(label_upper, subtitle_s))
    subtitle = cfg.get("subtitle")
    if subtitle and subtitle.upper() != label_upper:
        story.append(Paragraph(subtitle.upper(), ParagraphStyle(
            "OTSubtitle2", parent=subtitle_s, fontSize=9, spaceAfter=14,
        )))

    fecha_str = fields.get("fecha", date.today().strftime("%d/%m/%Y"))
    story.append(Paragraph(f"<b>Fecha:</b> {fecha_str}", inline_s))
    story.append(Spacer(1, 6))

    # ── I. Cliente ───────────────────────────────────────────────────────────────
    def emit_client_rows(rows: list[tuple[str, Any]]):
        # Soporta layout "Comuna  Teléfono" en una misma fila para mantener el look.
        i = 0
        while i < len(rows):
            label, val = rows[i]
            if label == "Comuna:" and i + 1 < len(rows) and rows[i + 1][0] == "Teléfono:":
                lbl2, val2 = rows[i + 1]
                two_col = Table(
                    [[inline_field(label, val), inline_field(lbl2, val2)]],
                    colWidths=[doc.width * 0.5, doc.width * 0.5],
                )
                two_col.setStyle(TableStyle([
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]))
                story.append(two_col)
                i += 2
            else:
                story.append(inline_field(label, val))
                i += 1

    if wo.ot_type not in HAS_OWN_CLIENT:
        story.append(section_header("I. INDIVIDUALIZACIÓN DEL CLIENTE"))
        emit_client_rows([
            ("Nombre o Razón Social:", fields.get("nombre_razon_social", "")),
            ("RUT:", fields.get("rut", "")),
            ("Domicilio:", fields.get("domicilio", "")),
            ("Comuna:", fields.get("comuna", "")),
            ("Teléfono:", fields.get("telefono", "")),
            ("Correo electrónico:", fields.get("email", "")),
        ])
    else:
        story.append(section_header("I. IDENTIFICACIÓN DEL CLIENTE Y ANTECEDENTES"))
        if wo.ot_type == "liquidacion_juridica":
            rows = [
                ("Representante Legal:", fields.get("representante_legal", "")),
                ("RUT Representante:", fields.get("rut_representante", "")),
                ("Razón Social:", fields.get("razon_social", "")),
                ("RUT Empresa:", fields.get("rut_empresa", "")),
                ("Email de Contacto:", fields.get("email", "")),
            ]
        else:
            rows = [
                ("Titular:", fields.get("nombre_razon_social", "")),
                ("RUT:", fields.get("rut", "")),
                ("Email:", fields.get("email", "")),
            ]
            if wo.ot_type == "alzamiento":
                rows += [
                    ("Causa / Rol:", fields.get("causa_referencia", "")),
                    ("Tribunal:", fields.get("tribunal", "")),
                    ("Acreedor / Demandante:", fields.get("acreedor_demandante", "")),
                ]
            else:
                rows.append(("Perfil del Deudor:", fields.get("perfil_deudor", "")))
        emit_client_rows(rows)

    story.append(Spacer(1, 4))

    # ── Body via catalog ────────────────────────────────────────────────────────
    def render_bullets(items: list[str]):
        bullet_style = ParagraphStyle(
            "OTBullet", parent=body_s, fontName="Helvetica-Bold",
            fontSize=9, leftIndent=18, bulletIndent=8, leading=13,
            spaceAfter=2,
        )
        flowables = [
            ListItem(Paragraph(it, bullet_style), bulletColor=DOC_BLACK)
            for it in items
        ]
        return ListFlowable(
            flowables, bulletType="bullet", start="•",
            leftIndent=14, bulletFontSize=9, bulletColor=DOC_BLACK,
        )

    def render_debt_table(value: Any):
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except Exception:
                value = None
        if not isinstance(value, list) or not value:
            return None
        tbl_data = [[
            Paragraph(h, ParagraphStyle(
                "TH", parent=styles["Normal"], fontName="Helvetica-Bold",
                fontSize=8, textColor=DOC_BLACK))
            for h in ["Acreedor", "Tipo de producto", "Monto total", "Estado"]
        ]]
        for row in value:
            if isinstance(row, dict):
                tbl_data.append([
                    Paragraph(str(row.get("acreedor", "")), body_s),
                    Paragraph(str(row.get("tipo_producto", "")), body_s),
                    Paragraph(str(row.get("monto_total", "")), body_s),
                    Paragraph(str(row.get("estado_critico", "")), body_s),
                ])
        col_w = [doc.width * p for p in [0.3, 0.25, 0.22, 0.23]]
        t = Table(tbl_data, colWidths=col_w)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E5E7EB")),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#9CA3AF")),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ]))
        return t

    def render_honorarios(show_bank: bool):
        story.append(section_header("HONORARIOS PROFESIONALES"))
        story.append(Paragraph(
            "Los honorarios profesionales correspondientes a los servicios indicados precedentemente ascienden a la suma de:",
            body_s,
        ))
        story.append(Spacer(1, 4))
        hon_val = fields.get("honorarios", "")
        hon_txt = f"$ {_fmt_money(hon_val)}" if hon_val else "$ "
        story.append(Paragraph(f"<b>{hon_txt}</b>", inline_s))
        story.append(Spacer(1, 2))
        fp = fields.get("forma_de_pago", "")
        story.append(inline_field("Forma de pago:", fp))
        pie_val    = fields.get("pie_inicial", "")
        nc         = fields.get("num_cuotas", 1) or 1
        mc_val     = fields.get("monto_cuota", "")
        pie_txt    = f"$ {_fmt_money(pie_val)}" if pie_val else ""
        mc_txt     = f"$ {_fmt_money(mc_val)}"  if mc_val  else ""
        cuotas_str = f"{nc} de {mc_txt}"
        pie_line = Table(
            [[
                Paragraph(f"<b>Pie Inicial:</b> {pie_txt}", inline_s),
                Paragraph(f"<b>Cuotas:</b> {cuotas_str}", inline_s),
            ]],
            colWidths=[doc.width * 0.45, doc.width * 0.55],
        )
        pie_line.setStyle(TableStyle([
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        story.append(pie_line)
        if show_bank:
            story.append(Spacer(1, 8))
            # Una sola celda de Table: reserva su alto real en el flujo. Con
            # Paragraph+borderPadding las cajas se dibujaban superpuestas.
            bank_style = ParagraphStyle(
                "Bank", parent=styles["Normal"], fontName="Helvetica-Bold",
                fontSize=8, textColor=DOC_MUTED, leading=11,
            )
            bank_cell = [
                Paragraph("<b>DATOS PARA TRANSFERENCIA</b>", bank_style),
                Spacer(1, 2),
                Paragraph("Titular: Abogados Chile SpA  |  RUT: 78.216.743-K  |  Banco: Santander (Cta. Cte.)  |  N° 99606614", bank_style),
                Paragraph("Comprobantes: cobranza@abogadostributarioschile.com", bank_style),
            ]
            bank_tbl = Table([[bank_cell]], colWidths=[doc.width])
            bank_tbl.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F3F4F6")),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E7EB")),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ]))
            story.append(KeepTogether(bank_tbl))

    def render_acceptance(section_num: str):
        story.append(section_header(f"{section_num}. ACEPTACIÓN DEL SERVICIO"))
        for paragraph in acceptance_body():
            story.append(Paragraph(paragraph, body_s))
        story.append(Spacer(1, 10))
        story.append(Paragraph("Atentamente,", inline_s))
        story.append(Paragraph("<b>Abogados Tributarios Chile SpA</b>", inline_s))

    def render_block(block: dict[str, Any]):
        kind = block.get("kind")
        if kind == "body":
            paragraphs = block.get("paragraphs") or ([block["text"]] if block.get("text") else [])
            for p in paragraphs:
                story.append(Paragraph(p, body_s))
        elif kind == "bullets":
            story.append(render_bullets(block.get("items", [])))
            story.append(Spacer(1, 4))
        elif kind == "ai_field":
            key = block.get("key")
            val = fields.get(key, "")
            label = block.get("label", key)
            story.append(inline_field(f"{label}:", val))
        elif kind == "debt_table":
            t = render_debt_table(fields.get(block.get("key")))
            if t is not None:
                story.append(t)
                story.append(Spacer(1, 6))

    catalog = _get_ot_catalog(wo.ot_type, db)
    for entry in catalog:
        ek = entry.get("kind")
        if ek == "section":
            story.append(section_header(entry["title"]))
            for blk in entry.get("blocks", []):
                render_block(blk)
        elif ek == "honorarios":
            render_honorarios(bool(entry.get("show_bank")))
        elif ek == "acceptance":
            render_acceptance(entry.get("section_num", "VIII"))

    # ── Footer 3 columnas ───────────────────────────────────────────────────────
    story.append(Spacer(1, 18))
    story.append(HRFlowable(width="100%", thickness=0.5, color=FOOTER_LINE, spaceAfter=6))
    footer_table = Table(
        [[
            Paragraph("+569 92990681", footer_s),
            Paragraph("www.abogadostributarioschile.com", footer_s),
            Paragraph("Providencia #1208", footer_s),
        ]],
        colWidths=[doc.width / 3.0] * 3,
    )
    footer_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(footer_table)

    doc.build(story)
    buf.seek(0)
    return buf


@router.get("/{wo_id}/pdf")
def download_work_order_pdf(
    wo_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    wo = db.query(models.WorkOrder).options(
        joinedload(models.WorkOrder.lead).joinedload(models.Lead.contact)
    ).filter(models.WorkOrder.id == wo_id).first()
    if not wo:
        raise HTTPException(404)
    _check_access(wo.lead, current_user)

    from ..utils.text import safe_ascii_filename
    fields = json.loads(wo.fields_json or '{}')
    nombre = fields.get("nombre_razon_social", f"lead_{wo.lead_id}")
    filename = f"OT_{wo.ot_type}_{safe_ascii_filename(nombre, f'lead_{wo.lead_id}')}.pdf"

    buf = _build_ot_pdf(wo, db)
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/public/{wo_id}/document")
def view_work_order_document_public(
    wo_id: int,
    token: str,
    db: Session = Depends(get_db),
):
    """Documento OT en HTML — el MISMO documento del panel del vendedor.

    Es la URL que NEXIO publica hacia Hive-service-control (AT.Informa) como
    `document_url` de la OT: replica 1:1 el HTML del que el vendedor genera su
    PDF (FullDocument de WorkOrderModal), de modo que en la carpeta documental
    del caso se vea exactamente la misma OT generada en NEXIO. Autenticado con
    token HMAC derivado de OT_PDF_SHARED_SECRET (contexto "ot-doc").
    """
    if not verify_ot_doc_token(wo_id, token):
        raise HTTPException(status_code=401, detail="Token inválido")

    wo = db.query(models.WorkOrder).options(
        joinedload(models.WorkOrder.lead).joinedload(models.Lead.contact)
    ).filter(models.WorkOrder.id == wo_id).first()
    if not wo:
        raise HTTPException(404)

    from ..utils.ot_html import build_ot_html
    fields = json.loads(wo.fields_json or '{}')
    cfg = OT_TYPES.get(wo.ot_type, {})
    # Mismo catálogo que el PDF del servidor (incluye overrides de plantilla
    # guardados en AppSetting) para que el HTML quede 1:1 con el documento.
    html = build_ot_html(
        wo.ot_type, fields,
        label=cfg.get("label", wo.ot_type),
        subtitle=cfg.get("subtitle"),
        catalog=_get_ot_catalog(wo.ot_type, db),
    )
    return HTMLResponse(
        content=html,
        headers={
            # La OT final no cambia; cache corto para no martillar al backend
            # cuando control la muestra repetidas veces.
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/public/{wo_id}/pdf")
def download_work_order_pdf_public(
    wo_id: int,
    token: str,
    db: Session = Depends(get_db),
):
    """Public OT PDF download for integrations (Hive-service-control SuperAdmin).

    Requires an HMAC-signed token derived from OT_PDF_SHARED_SECRET. The link is
    embedded by NEXIO when the lead moves to 'pago_comprometido' and pushed to
    Hive-service so SuperAdmin can open the document directly from the case
    subfolder without holding a NEXIO session.
    """
    if not verify_ot_pdf_token(wo_id, token):
        raise HTTPException(status_code=401, detail="Token inválido")

    wo = db.query(models.WorkOrder).options(
        joinedload(models.WorkOrder.lead).joinedload(models.Lead.contact)
    ).filter(models.WorkOrder.id == wo_id).first()
    if not wo:
        # Rescate: la OT fue eliminada y re-creada después de enviar el link.
        # El token ya validó que el link es legítimo → recuperamos el lead
        # desde el mensaje de WhatsApp que llevó este mismo link y servimos
        # su OT vigente en vez de romperle el enlace al cliente.
        msg = db.query(models.WhatsAppMessage).filter(
            models.WhatsAppMessage.lead_id.isnot(None),
            models.WhatsAppMessage.content.like(f"%/work-orders/public/{wo_id}/pdf%"),
        ).order_by(models.WhatsAppMessage.id.desc()).first()
        if msg:
            wo = _latest_ot_for_lead(db, msg.lead_id)
    if not wo:
        raise HTTPException(
            status_code=404,
            detail="Este documento ya no está disponible — solicita un nuevo enlace.",
        )
    return _stream_ot_pdf(wo, db)


def _latest_ot_for_lead(db: Session, lead_id: int):
    """OT vigente de un lead: la copia editable más reciente; si no, la última."""
    base = db.query(models.WorkOrder).options(
        joinedload(models.WorkOrder.lead).joinedload(models.Lead.contact)
    ).filter(models.WorkOrder.lead_id == lead_id)
    return (
        base.filter(models.WorkOrder.is_copy == True).order_by(models.WorkOrder.id.desc()).first()  # noqa: E712
        or base.order_by(models.WorkOrder.id.desc()).first()
    )


def _stream_ot_pdf(wo: models.WorkOrder, db: Session) -> StreamingResponse:
    from ..utils.text import safe_ascii_filename
    fields = json.loads(wo.fields_json or '{}')
    nombre = fields.get("nombre_razon_social", f"lead_{wo.lead_id}")
    filename = f"OT_{wo.ot_type}_{safe_ascii_filename(nombre, f'lead_{wo.lead_id}')}.pdf"
    buf = _build_ot_pdf(wo, db)
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.get("/public/lead/{lead_id}/pdf")
def download_latest_ot_pdf_public(
    lead_id: int,
    token: str,
    db: Session = Depends(get_db),
):
    """PDF público de la OT VIGENTE de un lead (link que se envía por WhatsApp).

    Anclado al lead, no a una OT específica: si el equipo elimina y re-crea la
    OT, el enlace que ya recibió el cliente sigue mostrando la versión actual.
    """
    if not verify_ot_lead_pdf_token(lead_id, token):
        raise HTTPException(status_code=401, detail="Token inválido")
    wo = _latest_ot_for_lead(db, lead_id)
    if not wo:
        raise HTTPException(
            status_code=404,
            detail="Este cliente aún no tiene una Orden de Trabajo disponible.",
        )
    return _stream_ot_pdf(wo, db)
