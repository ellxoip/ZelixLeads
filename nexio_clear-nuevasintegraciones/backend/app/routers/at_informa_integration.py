"""
CRM ↔ AT Informa Integration Router
─────────────────────────────────────
GET  /api/at_informa/abogados          → fetch abogados from AT Informa (preview)
POST /api/at_informa/sync_vendedores   → import/sync vendedores from AT Informa into CRM
POST /api/at_informa/push_reunion_leads → bulk-push existing reunion leads to AT Informa
POST /api/webhooks/at_informa          → receive callbacks FROM AT Informa (results, payments)
"""
import os
import logging
import asyncio
from fastapi import APIRouter, Depends, HTTPException, Header, BackgroundTasks
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..auth import get_current_user, require_roles, hash_password
from ..utils import at_informa as ati
from ..utils import legal_finance as lf
from ..utils.at_informa import get_abogados
from .leads import create_notification
from ..broadcaster import wa_broadcaster

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["at_informa"])

CRM_CALLBACK_SECRET = os.getenv("CRM_CALLBACK_SECRET", "")


# ── 1. Preview abogados from AT Informa (with CRM diff) ──────────────────

@router.get("/at_informa/abogados")
async def list_at_informa_abogados(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin"))
):
    """Return abogados from AT Informa categorised against current CRM vendedores."""
    try:
        abogados = await get_abogados()
    except Exception as e:
        logger.error("Error fetching abogados from AT Informa: %s", e)
        raise HTTPException(status_code=502, detail=f"No se pudo conectar con AT Informa: {e}")

    # Build set of emails currently in AT Informa
    at_emails = {ab.get("email", "").strip().lower() for ab in abogados if ab.get("email")}

    # CRM vendedores not in AT Informa → will be deactivated on sync
    crm_vendedores = db.query(models.User).filter(
        models.User.role == "vendedor",
        models.User.is_active == True,
    ).all()
    to_deactivate = [
        {"name": u.name, "email": u.email}
        for u in crm_vendedores
        if u.email.strip().lower() not in at_emails
    ]

    # Categorise each AT abogado
    crm_emails = {u.email.strip().lower() for u in crm_vendedores}
    categorised = []
    for ab in abogados:
        email = ab.get("email", "").strip().lower()
        if not email:
            continue
        ab["status"] = "update" if email in crm_emails else "new"
        categorised.append(ab)

    return {
        "ok":            True,
        "abogados":      categorised,
        "to_deactivate": to_deactivate,
        "total":         len(categorised),
    }


# ── 2. Sync (import) abogados as vendedores in CRM ───────────────────────

@router.post("/at_informa/sync_vendedores")
async def sync_vendedores_from_at_informa(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin"))
):
    """
    Pulls abogados from AT Informa and upserts them as role=vendedor in the CRM.
    - Creates new users if they don't exist (email as key).
    - Updates name, whatsapp, at_informa_user_id for existing ones.
    - Deactivates CRM vendedores that are no longer in AT Informa.
    """
    try:
        abogados = await get_abogados()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"No se pudo conectar con AT Informa: {e}")

    created    = []
    updated    = []
    deactivated = []

    at_emails = set()

    for ab in abogados:
        email          = ab.get("email", "").strip().lower()
        nombre         = ab.get("fullName") or ab.get("nombre") or ""
        at_id          = ab.get("id", "")
        phone          = ab.get("phone") or ab.get("telefono") or ""
        activo         = ab.get("active", True)

        if not email:
            continue

        at_emails.add(email)
        existing = db.query(models.User).filter(models.User.email == email).first()

        if existing:
            existing.name               = nombre
            existing.whatsapp_number    = phone or existing.whatsapp_number
            existing.at_informa_user_id = at_id
            existing.is_active          = bool(activo)
            if existing.role != "vendedor":
                existing.role = "vendedor"
            updated.append(email)
        else:
            nombre_part = nombre.split()[0][:4] if nombre else "AT"
            digits = "".join(c for c in phone if c.isdigit())
            temp_pwd = f"{nombre_part}{digits[-4:]}" if len(digits) >= 4 else f"{nombre_part}0000"
            new_user = models.User(
                name               = nombre,
                email              = email,
                password_hash      = hash_password(temp_pwd),
                role               = "vendedor",
                is_active          = bool(activo),
                whatsapp_number    = phone,
                at_informa_user_id = at_id,
            )
            db.add(new_user)
            created.append(email)

    # Deactivate CRM vendedores no longer present in AT Informa
    crm_vendedores = db.query(models.User).filter(
        models.User.role == "vendedor",
        models.User.is_active == True,
    ).all()
    for u in crm_vendedores:
        if u.email.strip().lower() not in at_emails:
            u.is_active = False
            deactivated.append(u.email)

    db.commit()
    return {
        "ok":          True,
        "created":     created,
        "updated":     updated,
        "deactivated": deactivated,
        "total":       len(created) + len(updated),
    }


# ── 3. Bulk-push existing reunion leads to AT Informa ────────────────────

@router.post("/at_informa/push_reunion_leads")
async def push_reunion_leads(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin")),
    force_lead_id: int | None = None,
):
    """
    Push all 'reunion'/'recuperacion_reunion' leads that haven't been synced yet
    (no at_informa_case_id) to AT Informa. Idempotent — re-running is safe.
    Pass force_lead_id to re-push a specific lead regardless of at_informa_case_id.
    """
    if force_lead_id is not None:
        leads = (
            db.query(models.Lead)
            .filter(models.Lead.id == force_lead_id)
            .all()
        )
    else:
        leads = (
            db.query(models.Lead)
            .filter(
                models.Lead.current_stage.in_(["reunion", "recuperacion_reunion"]),
                models.Lead.at_informa_case_id.is_(None),
            )
            .all()
        )

    pushed, failed = [], []

    for lead in leads:
        try:
            contact    = lead.contact
            vendedor   = lead.vendedor
            agendadora = lead.agendadora
            area       = lead.area
            category   = area.name if area else "TRIBUTARIO"

            # Get the most recent scheduled reunion event
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
            meeting_at_iso   = event.start_time.isoformat() if event else None
            meeting_duration = (
                max(15, int((event.end_time - event.start_time).total_seconds() / 60))
                if event and event.end_time else 60
            )

            result = await ati.push_reunion_lead(
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
            )

            at_id = result.get("leadId") or result.get("caseId")
            if at_id:
                lead.at_informa_case_id = at_id
            db.commit()
            pushed.append({"lead_id": lead.id, "at_informa_id": at_id, "duplicate": result.get("duplicate", False)})

        except Exception as exc:
            logger.error("push_reunion_leads: lead %s failed: %s", lead.id, exc)
            failed.append({"lead_id": lead.id, "error": str(exc)})

    return {
        "ok": True,
        "total":  len(leads),
        "pushed": len(pushed),
        "failed": len(failed),
        "results": pushed,
        "errors":  failed,
    }


# ── 4. Webhook: receive callbacks FROM AT Informa ─────────────────────────

@router.post("/webhooks/at_informa")
async def at_informa_webhook(
    payload: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    x_crm_callback_secret: str = Header(None, alias="x-crm-callback-secret"),
):
    """
    Receives event callbacks from AT Informa.

    Expected payload:
    {
      "event":      "reunion_result" | "payment_verified" | "case_halted",
      "crmLeadId":  123,
      "result":     "exitoso" | "no_exitoso"   (for reunion_result),
      "caseId":     "uuid"                      (AT Informa case UUID),
      "notes":      "optional notes"
    }
    """
    # Validate shared secret
    if CRM_CALLBACK_SECRET and x_crm_callback_secret != CRM_CALLBACK_SECRET:
        raise HTTPException(status_code=401, detail="Secret inválido")

    event       = payload.get("event")
    crm_lead_id = payload.get("crmLeadId")
    result      = payload.get("result")
    case_id     = payload.get("caseId")
    notes       = payload.get("notes", "")

    if not event or not crm_lead_id:
        raise HTTPException(status_code=400, detail="Faltan campos: event, crmLeadId")

    lead = db.query(models.Lead).filter(models.Lead.id == int(crm_lead_id)).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    # Store the AT Informa case ID if provided
    if case_id:
        lead.at_informa_case_id = case_id

    if event == "reunion_result":
        _handle_reunion_result(db, lead, result, notes)

    elif event == "payment_verified":
        _handle_payment_verified(db, lead, notes)

    elif event == "case_halted":
        lead.at_informa_status = "halted"
        _notify_team(db, lead, "Caso detenido en Hive Service Control",
                     f"El caso de {lead.contact.name if lead.contact else 'cliente'} fue detenido en Hive Service Control por falta de pago.")

    else:
        logger.warning("Unknown AT Informa event: %s", event)
        raise HTTPException(status_code=400, detail=f"Evento desconocido: {event}")

    db.commit()
    await wa_broadcaster.broadcast("pipeline_refresh", {
        "lead_id": crm_lead_id,
        "new_stage": lead.current_stage,
    })
    return {"ok": True, "leadId": crm_lead_id, "event": event}


# ── internal helpers ──────────────────────────────────────────────────────

def _handle_reunion_result(db: Session, lead: models.Lead, result: str | None, notes: str):
    """
    Called when abogado marks meeting result in AT Informa.
    exitoso   → advance to altamente_interesado
    no_exitoso → move to recuperacion_reunion
    """
    if lead.current_stage not in ("reunion", "recuperacion_reunion"):
        logger.info("Lead %s is in stage %s — skipping reunion_result", lead.id, lead.current_stage)
        return

    old_stage = lead.current_stage

    if result == "exitoso":
        new_stage = "altamente_interesado"
        lead.at_informa_status = "reunion_exitosa"
    else:
        new_stage = "recuperacion_reunion"
        lead.at_informa_status = "reunion_fallida"

    lead.current_stage = new_stage

    db.add(models.LeadHistory(
        lead_id    = lead.id,
        from_stage = old_stage,
        to_stage   = new_stage,
        result     = "success" if result == "exitoso" else "failed",
        notes      = f"[AT Informa] {notes}" if notes else "[AT Informa] Resultado de reunión",
        created_by = lead.vendedor_id,
    ))

    contact_name = lead.contact.name if lead.contact else "cliente"
    msg = (
        f"Reunión exitosa con {contact_name} — avanzado a Altamente Interesado"
        if result == "exitoso"
        else f"Reunión fallida con {contact_name} — enviado a Recuperación"
    )
    _notify_team(db, lead, f"Resultado de reunión — {contact_name}", msg)


def _handle_payment_verified(db: Session, lead: models.Lead, notes: str):
    """
    Called when AT Informa SuperAdmin validates payment.
    Automatically moves lead to pagado_confirmado and marks PaymentVerification.
    """
    if lead.current_stage != "pago_comprometido":
        logger.info("Lead %s is in stage %s — skipping payment_verified", lead.id, lead.current_stage)
        return

    old_stage = lead.current_stage
    lead.current_stage      = "pagado_confirmado"
    lead.at_informa_status  = "pago_verificado"

    db.add(models.LeadHistory(
        lead_id    = lead.id,
        from_stage = old_stage,
        to_stage   = "pagado_confirmado",
        result     = "success",
        notes      = f"[Hive Service Control] Pago verificado. {notes}".strip(),
        created_by = lead.vendedor_id,
    ))

    # Mark the PaymentVerification as confirmed
    pv = db.query(models.PaymentVerification).filter(
        models.PaymentVerification.lead_id == lead.id
    ).first()
    if pv:
        from datetime import datetime, timezone
        pv.status       = "pago_exitoso"
        pv.confirmed_at = datetime.now(timezone.utc)
        if notes:
            pv.notes = notes

    contact_name = lead.contact.name if lead.contact else "cliente"
    _notify_team(db, lead,
                 f"Pago confirmado — {contact_name}",
                 f"El pago de {contact_name} fue verificado en Hive Service Control. Lead cerrado exitosamente.")


def _notify_team(db: Session, lead: models.Lead, title: str, message: str):
    for uid in {lead.agendadora_id, lead.vendedor_id}:
        if uid:
            try:
                create_notification(db, uid, title, message,
                                    lead_id=lead.id, notification_type="at_informa")
            except Exception:
                pass


async def _push_pago_comprometido_to_lf(lead_id: int):
    """Background task: push lead to SIS.CONTABLE when reunion is exitoso."""
    from ..database import SessionLocal
    from datetime import datetime, timezone
    from sqlalchemy.orm import joinedload

    db = SessionLocal()
    try:
        lead = (
            db.query(models.Lead)
            .options(
                joinedload(models.Lead.contact),
                joinedload(models.Lead.vendedor),
                joinedload(models.Lead.area),
            )
            .filter(models.Lead.id == lead_id)
            .first()
        )
        if not lead:
            logger.error("_push_pago_comprometido_to_lf: lead %s not found", lead_id)
            return

        contact = lead.contact
        rut = ((contact.rut_persona or contact.rut_empresa) if contact else None) or f"SIN-RUT-{lead.id}"
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        category = lead.area.name if lead.area else "TRIBUTARIO"

        result = await lf.push_pago_comprometido(
            crm_lead_id   = lead.id,
            rut           = rut,
            nombre        = contact.name if contact else "Cliente",
            email         = contact.email if contact else None,
            phone         = contact.phone if contact else None,
            honorarios    = float(lead.honorarios or 0),
            cuota_inicial = float(lead.cuota_inicial or 0),
            num_cuotas    = int(lead.num_cuotas or 1),
            tipo_servicio = lead.service_description or category,
            fecha_ingreso = today,
        )

        if result and result.get("contratoId"):
            lead.legal_finance_contrato_id = int(result["contratoId"])
            db.commit()
            logger.info("SIS.CONTABLE notified: lead %s → pago_comprometido (contrato: %s)", lead.id, result["contratoId"])
        else:
            logger.warning("SIS.CONTABLE push succeeded but no contratoId returned for lead %s", lead.id)

    except Exception as exc:
        logger.error("_push_pago_comprometido_to_lf failed for lead %s: %s", lead_id, exc)
    finally:
        db.close()
