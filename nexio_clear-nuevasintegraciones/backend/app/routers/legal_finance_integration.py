"""
CRM ↔ Legal Finance Integration Router
──────────────────────────────────────
POST /api/webhooks/legal_finance  → receives callbacks FROM Legal Finance
                                    (payment_confirmed)
"""
import os
import re
import json
import asyncio
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Header
from sqlalchemy import create_engine, func as sa_func, text as sa_text
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..utils import hive_service as hs
from ..utils import webhook_dlq
from ..utils.pagacuotas_links import normalize_pagacuotas_portal_link
from .at_informa_integration import _notify_team

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["legal_finance"])

LF_CALLBACK_SECRET = os.getenv("LF_CALLBACK_SECRET", "")

_CONTABLE_URL = os.getenv(
    "CONTABLE_DATABASE_URL",
    "postgresql://contable_user:CHANGE_ME@pg-produccion-do-user-35082994-0.m.db.ondigitalocean.com:25061/contable_pool?sslmode=require",
)

_PAGACUOTAS_DB_URL = os.getenv(
    "PAGACUOTAS_DATABASE_URL",
    "",
)


async def _broadcast_cobrador_sync(created: int = 0, updated: int = 1):
    try:
        from ..broadcaster import wa_broadcaster
        await wa_broadcaster.broadcast("cobrador_sync", {"created": created, "updated": updated})
    except Exception as e:
        logger.warning("[cobrador] broadcast failed: %s", e)


def _fetch_lf_contrato_totals(lf_contrato_id: int) -> dict | None:
    """Query LF DB for real payment totals. Returns None on any failure."""
    if not lf_contrato_id or "CHANGE_ME" in _CONTABLE_URL:
        return None
    try:
        engine = create_engine(_CONTABLE_URL, pool_pre_ping=True)
        with engine.connect() as conn:
            row = conn.execute(sa_text("""
                SELECT
                    ct.monto_ccto,
                    COALESCE(SUM(cu.monto_pagado) FILTER (WHERE cu.estado = 'PAGADA'), 0)
                        AS total_pagado,
                    MIN(cu.fecha_vencimiento) FILTER (WHERE cu.estado = 'PENDIENTE')
                        AS proxima_cuota_fecha,
                    MIN(cu.monto_actual) FILTER (
                        WHERE cu.estado = 'PENDIENTE'
                        AND cu.fecha_vencimiento = (
                            SELECT MIN(q.fecha_vencimiento) FROM "Cuota" q
                            WHERE q.contrato_id = ct.id AND q.estado = 'PENDIENTE'
                        )
                    ) AS proxima_cuota_monto
                FROM "Contrato" ct
                LEFT JOIN "Cuota" cu ON cu.contrato_id = ct.id
                WHERE ct.id = :cid
                GROUP BY ct.id, ct.monto_ccto
            """), {"cid": lf_contrato_id}).first()
        engine.dispose()
        if row:
            return dict(row._mapping)
    except Exception as e:
        logger.warning("[cobrador] LF fetch totals failed contrato=%s: %s", lf_contrato_id, e)
    return None


@router.post("/webhooks/legal_finance")
def legal_finance_webhook(
    payload: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    x_lf_callback_secret: str = Header(None, alias="x-lf-callback-secret"),
    x_request_id: str = Header(None, alias="x-request-id"),
    idempotency_key: str = Header(None, alias="idempotency-key"),
):
    """
    Receives event callbacks from Legal Finance (SIS.CONTABLE).

    Confirmación asíncrona: valida la firma, encola el evento (DLQ) y responde 200
    de inmediato. El procesamiento real (con reintentos) corre en background.

    Expected payload: { "event": "payment_confirmed", "crmLeadId": 123, "contratoId": 456 }
    """
    if LF_CALLBACK_SECRET and x_lf_callback_secret != LF_CALLBACK_SECRET:
        raise HTTPException(status_code=401, detail="Secret inválido")

    event       = payload.get("event")
    crm_lead_id = payload.get("crmLeadId")

    if not event or not crm_lead_id:
        raise HTTPException(status_code=400, detail="Faltan campos: event, crmLeadId")

    idem = idempotency_key or f"lf:{event}:{crm_lead_id}:{payload.get('contratoId')}"
    ev, duplicate = webhook_dlq.record_inbound(
        db, source="legal_finance", event_type=event,
        payload=payload, idempotency_key=idem, request_id=x_request_id,
    )
    if duplicate:
        return {"ok": True, "idempotent": True, "eventId": ev.id, "status": ev.status}

    background_tasks.add_task(webhook_dlq.process_event, ev.id)
    return {"ok": True, "queued": True, "eventId": ev.id}


def process_legal_finance_event(db: Session, payload: dict) -> None:
    """Handler DLQ: procesa un webhook de Legal Finance. Muta la sesión SIN commit
    (process_event hace el commit único). Levanta PermanentWebhookError para
    fallos no-reintentables (evento desconocido)."""
    event       = payload.get("event")
    crm_lead_id = payload.get("crmLeadId")
    contrato_id = payload.get("contratoId")
    raw_id = int(crm_lead_id)

    # Negative IDs = cobrador leads (set when moving to pago_comprometido)
    if raw_id < 0:
        cobrador_lead = db.query(models.CobradorLead).filter(
            models.CobradorLead.id == abs(raw_id)
        ).first()
        if not cobrador_lead:
            # transitorio: el lead podría crearse en breve → reintentar
            raise RuntimeError(f"Cobrador lead {abs(raw_id)} no encontrado (reintentar)")
        if event == "payment_confirmed":
            _handle_cobrador_payment_confirmed(db, cobrador_lead, payload)
        webhook_dlq.run_coro_safe(_broadcast_cobrador_sync(0, 1))
        return

    lead = db.query(models.Lead).filter(models.Lead.id == raw_id).first()
    if not lead:
        raise RuntimeError(f"Lead {raw_id} no encontrado (reintentar)")

    if event == "payment_confirmed":
        _handle_payment_confirmed(db, lead, contrato_id)
    elif event == "service_started":
        _handle_service_started(db, lead, contrato_id, payload)
    elif event in ("portal_credentials_ready", "pagacuotas_ready"):
        _handle_portal_credentials_ready(db, lead, payload)
    else:
        raise webhook_dlq.PermanentWebhookError(f"Evento desconocido: {event}")


webhook_dlq.register_handler("legal_finance", process_legal_finance_event)


def _handle_cobrador_payment_confirmed(db: Session, cobrador_lead: models.CobradorLead, payload: dict):
    """Sync real payment totals from LF and move to 'pagado' only when saldo = 0."""
    lf_data = _fetch_lf_contrato_totals(cobrador_lead.lf_contrato_id)

    if lf_data:
        total_pagado = float(lf_data.get("total_pagado") or 0)
        cobrador_lead.monto_pagado = total_pagado
        cobrador_lead.lf_total_pagado = total_pagado
        pcf = lf_data.get("proxima_cuota_fecha")
        cobrador_lead.proxima_cuota_fecha = (
            pcf.isoformat() if pcf and hasattr(pcf, "isoformat") else str(pcf) if pcf else None
        )
        pm = lf_data.get("proxima_cuota_monto")
        cobrador_lead.proxima_cuota_monto = float(pm) if pm else None
    else:
        # Fallback: accumulate from webhook if LF DB unreachable
        monto_cuota = float(payload.get("montoPagado") or payload.get("amount") or 0)
        if monto_cuota > 0:
            cobrador_lead.monto_pagado = min(
                cobrador_lead.monto_pagado + monto_cuota,
                cobrador_lead.monto_deuda,
            )

    # Move to pagado ONLY when fully paid (saldo = 0)
    if cobrador_lead.monto_pagado >= cobrador_lead.monto_deuda:
        if cobrador_lead.stage != "pagado":
            cobrador_lead.pagado_at = datetime.now(timezone.utc)
        cobrador_lead.stage = "pagado"
        logger.info("[cobrador] Lead %s → pagado (totalmente pagado)", cobrador_lead.id)
    else:
        pct = 100 * cobrador_lead.monto_pagado / cobrador_lead.monto_deuda if cobrador_lead.monto_deuda else 0
        logger.info(
            "[cobrador] Lead %s pago parcial: %s / %s (%.1f%%)",
            cobrador_lead.id, cobrador_lead.monto_pagado, cobrador_lead.monto_deuda, pct,
        )


def _handle_payment_confirmed(db: Session, lead: models.Lead, contrato_id):
    """
    Called when Legal Finance confirms full payment for a contract linked to this lead.
    Moves lead to pagado_confirmado and marks PaymentVerification.
    """
    if lead.current_stage not in ("pago_comprometido", "pago_pendiente"):
        logger.info(
            "Lead %s is in stage %s — skipping payment_confirmed", lead.id, lead.current_stage
        )
        return

    old_stage = lead.current_stage
    lead.current_stage      = "pagado_confirmado"
    lead.at_informa_status  = "pago_verificado_lf"

    if contrato_id:
        lead.legal_finance_contrato_id = int(contrato_id)

    db.add(models.LeadHistory(
        lead_id    = lead.id,
        from_stage = old_stage,
        to_stage   = "pagado_confirmado",
        result     = "success",
        notes      = "[Legal Finance] Pago confirmado automáticamente desde SIS.CONTABLE.",
        created_by = lead.vendedor_id or lead.agendadora_id,
    ))

    pv = db.query(models.PaymentVerification).filter(
        models.PaymentVerification.lead_id == lead.id
    ).first()
    if pv:
        pv.status       = "pago_exitoso"
        pv.confirmed_at = datetime.now(timezone.utc)
        pv.notes        = "Confirmado automáticamente por Legal Finance (SIS.CONTABLE)"

    contact_name = lead.contact.name if lead.contact else "cliente"
    _notify_team(
        db, lead,
        f"Pago confirmado — {contact_name}",
        f"El pago de {contact_name} fue verificado en Hive Contable. Lead cerrado exitosamente.",
    )

    # La OT debe NACER en AT INFORMA justo cuando el cliente queda apto y con el
    # pago al día. Para entonces el caso ya existe en control (creado por la vía
    # PagaCuotas / credenciales), así que basta empujar su OT vigente por el
    # endpoint work-orders (no requiere password; resuelve el caso por
    # crm_lead_id/rut/case_code). Best-effort: si el caso aún no aterrizó es
    # no-op y la OT viajará en su próximo guardado.
    try:
        from .work_orders import select_integration_work_order, _sync_ot_to_service_control
        wo = select_integration_work_order(db, lead.id)
        if wo:
            _sync_ot_to_service_control(wo, db)
    except Exception as exc:
        logger.warning(
            "No se pudo sincronizar la OT a control tras pago confirmado (lead %s): %s",
            lead.id, exc,
        )


def _handle_portal_credentials_ready(db: Session, lead: models.Lead, payload: dict):
    """
    Recibe credenciales del portal PagaCuotas generadas en SIS.CONTABLE.
    Actualiza pagacuotas_link y envía WhatsApp al cliente con RUT + clave + link de pago.

    Mismo RUT + clave sirven para Hive Service Control (portal del caso legal)
    una vez que se confirma el pago inicial. El cliente entra a ambos sistemas
    con la misma credencial.
    """
    # `identifier` es el nombre canónico del campo en el callback de
    # legal-finance (CrmClient.notifyPagaCuotasReady en hive-financial-control).
    # Aceptamos `rut` como alias por compatibilidad histórica.
    rut          = payload.get("identifier") or payload.get("rut") or ""
    password     = payload.get("password", "")
    payment_link = normalize_pagacuotas_portal_link(
        payload.get("paymentLink") or payload.get("autoLoginUrl") or ""
    )

    if payment_link:
        lead.pagacuotas_link = payment_link

    contact = lead.contact
    if not contact or not contact.phone:
        logger.warning("Lead %s sin teléfono — no se envió WhatsApp de credenciales", lead.id)
        return

    hive_portal_url = os.getenv("HIVE_SERVICE_PUBLIC_URL", "http://localhost:3005").rstrip("/")

    nombre = contact.name.split()[0] if contact.name else "cliente"
    message = (
        f"Hola {nombre}, aquí están tus credenciales:\n\n"
        f"👤 RUT: {rut}\n"
        f"🔑 Clave: {password}\n\n"
        f"🔗 Portal PagaCuotas:\n{payment_link}\n\n"
        f"🛡️ Portal del caso legal (una vez confirmado el pago):\n{hive_portal_url}/login\n"
        f"   → ingresa con tu RUT (o correo) y la misma clave.\n\n"
        f"Puedes cambiar tu clave cuando quieras desde cualquiera de los dos portales."
    )

    try:
        from .leads import _dispatch_payment_link_wa
        _dispatch_payment_link_wa(lead, contact, payment_link, db, custom_message=message)
    except Exception as exc:
        logger.warning("No se pudo enviar WhatsApp de credenciales al lead %s: %s", lead.id, exc)

    # ── Empuje a hive-service-control con OT ─────────────────────────────
    # Ahora que tenemos `password` desde fc/PagaCuotas, podemos crear el
    # caso + sembrar la OT en sc. Antes este push se intentaba al pasar
    # Pago Comprometido sin password y fallaba con 422.
    if rut and password:
        contrato_id = payload.get("contratoId")
        _push_case_with_ot_to_service_control(db, lead, rut, password, payment_link, contrato_id)


def _push_case_with_ot_to_service_control(
    db: Session,
    lead: models.Lead,
    rut: str,
    password: str,
    payment_link: str,
    contrato_id: int | None,
) -> None:
    contact = lead.contact
    area_name = lead.area.name if lead.area else "TRIBUTARIO"
    vendedor = lead.vendedor.name if lead.vendedor else None
    agendadora = lead.agendadora.name if lead.agendadora else None

    # La OT que viaja es la del vendedor (copia editable vigente), con
    # document_url apuntando al HTML que replica 1:1 el documento del panel
    # de vendedor (el mismo del que se exporta el PDF) + pdf_url de respaldo.
    from .work_orders import select_integration_work_order, build_ot_integration_payload
    vendor_ot = select_integration_work_order(db, lead.id)
    work_order_payload = build_ot_integration_payload(vendor_ot) if vendor_ot else None

    try:
        result = asyncio.run(hs.push_pago_comprometido(
            crm_lead_id=lead.id,
            rut=rut,
            nombre=contact.name if contact else "Cliente",
            email=contact.email if contact else None,
            telefono=contact.phone if contact else None,
            password_plain=password,
            # Alineamos con la convención de fc (`SIS-{contratoId}`) para
            # que ambos lados upserten el mismo Case. Fallback al lead-id
            # si fc no envió contratoId en el webhook.
            case_code=f"SIS-{contrato_id}" if contrato_id else f"NEXIO-{lead.id}",
            service_category=area_name,
            honorarios=float(lead.honorarios or 0),
            cuota_inicial=float(lead.cuota_inicial or 0),
            num_cuotas=int(lead.num_cuotas or 1),
            monto_cuota=float(lead.monto_cuota or 0),
            vendedor=vendedor,
            agendadora=agendadora,
            work_order=work_order_payload,
            payment_link=payment_link,
        ))
        if result:
            lead.hive_service_case_id = result.get("caseId")
            lead.hive_service_status = "created"
            db.commit()
        logger.info("Hive Service notified (con OT): lead %s -> case %s", lead.id, result.get("caseId"))
    except Exception as exc:
        logger.warning("Hive Service push failed (non-critical) for lead %s: %s", lead.id, exc)
        try:
            lead.hive_service_status = "failed"
            db.commit()
        except Exception:
            pass


def _handle_service_started(db: Session, lead: models.Lead, contrato_id, payload: dict | None = None):
    """
    Called when Legal Finance activates the contract (AT.Informa case created).
    """
    if lead.current_stage not in ("pagado_confirmado", "pago_comprometido"):
        logger.info(
            "Lead %s is in stage %s — skipping service_started", lead.id, lead.current_stage
        )
        return

    lead.at_informa_status = "servicio_iniciado_lf"

    if contrato_id:
        lead.legal_finance_contrato_id = int(contrato_id)

    service_case_id = (payload or {}).get("serviceCaseId") or (payload or {}).get("caseId")
    if service_case_id:
        lead.hive_service_case_id = str(service_case_id)
    lead.hive_service_status = "created"

    db.add(models.LeadHistory(
        lead_id    = lead.id,
        from_stage = lead.current_stage,
        to_stage   = lead.current_stage,
        result     = "success",
        notes      = "[Hive Contable] Servicio iniciado. Caso creado en Hive Service Control.",
        created_by = lead.vendedor_id or lead.agendadora_id,
    ))

    contact_name = lead.contact.name if lead.contact else "cliente"
    _notify_team(
        db, lead,
        f"Servicio activo — {contact_name}",
        f"El caso de {contact_name} fue iniciado en Hive Service Control a través de Hive Contable.",
    )


# ── PagaCuotas integration ────────────────────────────────────────────────────

def _mark_pagacuotas_payment_synced(external_payment_id: str) -> None:
    """Mark a payment as CRM-synced in PagaCuotas DB so it stops retrying."""
    if not external_payment_id or not _PAGACUOTAS_DB_URL or "CHANGE_ME" in _PAGACUOTAS_DB_URL:
        return
    try:
        engine = create_engine(_PAGACUOTAS_DB_URL, pool_pre_ping=True)
        with engine.connect() as conn:
            conn.execute(sa_text("""
                UPDATE "Payment"
                SET crm_sync_status = 'synced', updated_at = NOW()
                WHERE external_payment_id = :pid
            """), {"pid": external_payment_id})
            conn.execute(sa_text("""
                UPDATE "IntegrationOutbox"
                SET status = 'sent', updated_at = NOW()
                WHERE payload_json->>'external_payment_id' = :pid
            """), {"pid": external_payment_id})
            conn.commit()
        engine.dispose()
    except Exception as e:
        logger.warning("[pagacuotas] mark_synced failed for %s: %s", external_payment_id, e)


def _apply_payment_to_cobrador_lead(
    db: Session,
    cobrador_lead: models.CobradorLead,
    lf_contrato_id: int,
    fallback_amount: float = 0,
) -> None:
    """Fetch real LF totals and apply to cobrador lead. Fallback to amount if LF unreachable."""
    lf_data = _fetch_lf_contrato_totals(lf_contrato_id)
    if lf_data:
        total_pagado = float(lf_data.get("total_pagado") or 0)
        cobrador_lead.monto_pagado = total_pagado
        cobrador_lead.lf_total_pagado = total_pagado
        pcf = lf_data.get("proxima_cuota_fecha")
        cobrador_lead.proxima_cuota_fecha = (
            pcf.isoformat() if pcf and hasattr(pcf, "isoformat") else str(pcf) if pcf else None
        )
        pm = lf_data.get("proxima_cuota_monto")
        cobrador_lead.proxima_cuota_monto = float(pm) if pm else None
        if cobrador_lead.stage != "pagado" and cobrador_lead.monto_deuda > 0 and total_pagado >= cobrador_lead.monto_deuda:
            cobrador_lead.stage = "pagado"
            cobrador_lead.pagado_at = datetime.now(timezone.utc)
            logger.info("[pagacuotas] Lead %s → pagado (saldo=0)", cobrador_lead.id)
    elif fallback_amount > 0:
        cobrador_lead.monto_pagado = min(
            cobrador_lead.monto_pagado + fallback_amount, cobrador_lead.monto_deuda
        )


def process_pagacuotas_pending_payments(db: Session) -> int:
    """
    Poll PagaCuotas DB for confirmed payments with crm_sync_status pending/failed,
    apply them to cobrador leads, and mark them synced. Returns count processed.
    """
    if not _PAGACUOTAS_DB_URL or "CHANGE_ME" in _PAGACUOTAS_DB_URL:
        return 0
    try:
        pc_engine = create_engine(_PAGACUOTAS_DB_URL, pool_pre_ping=True)
        with pc_engine.connect() as conn:
            rows = conn.execute(sa_text("""
                SELECT id, external_payment_id, contrato_contable_id, amount
                FROM "Payment"
                WHERE crm_sync_status IN ('pending', 'failed')
                  AND status = 'confirmado'
                ORDER BY paid_at ASC
                LIMIT 50
            """)).fetchall()
        pc_engine.dispose()
    except Exception as e:
        logger.warning("[pagacuotas] fetch pending payments failed: %s", e)
        return 0

    processed = 0
    for row in rows:
        d = dict(row._mapping)
        external_id = d.get("external_payment_id")
        lf_contrato_id_str = d.get("contrato_contable_id")
        if not lf_contrato_id_str:
            _mark_pagacuotas_payment_synced(external_id)
            continue
        try:
            lf_contrato_id = int(lf_contrato_id_str)
        except (ValueError, TypeError):
            continue

        cobrador_lead = db.query(models.CobradorLead).filter(
            models.CobradorLead.lf_contrato_id == lf_contrato_id
        ).first()

        if not cobrador_lead:
            _mark_pagacuotas_payment_synced(external_id)
            continue

        _apply_payment_to_cobrador_lead(db, cobrador_lead, lf_contrato_id, float(d.get("amount") or 0))
        _mark_pagacuotas_payment_synced(external_id)
        processed += 1
        logger.info("[pagacuotas] Processed payment %s → lf_contrato %s", external_id, lf_contrato_id)

    if processed > 0:
        try:
            db.commit()
        except Exception as e:
            db.rollback()
            logger.warning("[pagacuotas] commit failed: %s", e)
            return 0

    return processed


def _send_at_informa_access_link(db: Session, lead: models.Lead) -> None:
    """
    Tras confirmar el pago (lead -> pagado_confirmado), reenvia al cliente por
    WhatsApp el magic-link de acceso directo a AT INFORMA (autologin valido 4h).
    El cliente ya existe en service-control desde el onboarding, asi que pedimos
    el enlace solo con el RUT (sin la clave). Best-effort: cualquier fallo se
    loguea y NUNCA interrumpe la confirmacion de pago.
    """
    contact = lead.contact
    if not contact or not contact.phone:
        logger.info("[at-informa] lead %s sin telefono — no se envia link de acceso", lead.id)
        return
    rut = (getattr(contact, "rut_persona", None) or getattr(contact, "rut_empresa", None) or "").strip()
    if not rut:
        logger.info("[at-informa] lead %s sin RUT — no se envia link de acceso", lead.id)
        return

    try:
        result = asyncio.run(hs.request_auto_login(
            rut=rut,
            ttl_seconds=4 * 60 * 60,
            source="PagaCuotas",
            crm_lead_id=lead.id,
        ))
    except Exception as exc:
        logger.warning("[at-informa] auto-login fallo para lead %s (rut=%s): %s", lead.id, rut, exc)
        return

    access_url = result.get("redirectUrl") if result else None
    if not access_url:
        logger.info(
            "[at-informa] cliente rut=%s sin cuenta en service-control todavia — no se envia link (lead %s)",
            rut, lead.id,
        )
        return

    nombre = contact.name.split()[0] if contact.name else "cliente"
    hive_portal_url = os.getenv("HIVE_SERVICE_PUBLIC_URL", "http://localhost:3001").rstrip("/")
    # La URL va SOLA en su linea, con esquema https y sin signos pegados, para
    # que WhatsApp la enlace como link clickeable (no texto plano).
    message = (
        f"¡Hola {nombre}! Confirmamos tu pago. ✅\n\n"
        f"Entra directo a tu caso legal (acceso valido 4 horas):\n"
        f"{access_url}\n\n"
        f"Si el enlace expira, ingresa con tu RUT y tu clave aqui:\n"
        f"{hive_portal_url}/login"
    )
    try:
        from .leads import _dispatch_payment_link_wa
        _dispatch_payment_link_wa(lead, contact, "", db, custom_message=message)
    except Exception as exc:
        logger.warning("[at-informa] no se pudo enviar WhatsApp de acceso al lead %s: %s", lead.id, exc)


def _handle_pagacuotas_pipeline_payment(
    db: Session,
    lead: models.Lead,
    monto: float,
    external_id: str | None,
) -> None:
    """
    Auto-confirms a PagaCuotas payment for a regular pipeline lead.
    Moves lead from pago_pendiente/pago_comprometido/pagado_reunion → pagado_confirmado.
    """
    if lead.current_stage not in ("pago_pendiente", "pago_comprometido", "pagado_reunion"):
        logger.info(
            "[pagacuotas] Lead %s in stage %s — skipping pipeline payment confirm",
            lead.id, lead.current_stage,
        )
        return

    old_stage = lead.current_stage
    lead.current_stage = "pagado_confirmado"

    db.add(models.LeadHistory(
        lead_id=lead.id,
        from_stage=old_stage,
        to_stage="pagado_confirmado",
        result="success",
        notes=f"[PagaCuotas] Pago confirmado automáticamente. Referencia: {external_id}",
        created_by=lead.vendedor_id or lead.agendadora_id,
    ))

    pv = db.query(models.PaymentVerification).filter(
        models.PaymentVerification.lead_id == lead.id
    ).first()
    if pv:
        pv.status = "pago_exitoso"
        pv.confirmed_at = datetime.now(timezone.utc)
        if monto:
            pv.payment_amount = monto
        pv.notes = "Confirmado automáticamente por PagaCuotas"
    else:
        verificador = db.query(models.User).filter(
            models.User.role == "verificador",
            models.User.is_active == True,
        ).first()
        if verificador:
            db.add(models.PaymentVerification(
                lead_id=lead.id,
                assigned_to=verificador.id,
                status="pago_exitoso",
                confirmed_at=datetime.now(timezone.utc),
                payment_amount=monto or None,
                notes="Confirmado automáticamente por PagaCuotas",
            ))

    contact_name = lead.contact.name if lead.contact else "cliente"
    _notify_team(
        db, lead,
        f"Pago confirmado — {contact_name}",
        f"PagaCuotas confirmó el pago de {contact_name}. Lead cerrado exitosamente.",
    )

    # Reenvia al cliente el magic-link de acceso a AT INFORMA (autologin 4h)
    # por WhatsApp, ahora que el pago quedo confirmado. Best-effort.
    _send_at_informa_access_link(db, lead)


@router.post("/payments")
@router.post("/webhooks/pagacuotas")  # alias canónico documentado para la pasarela
def pagacuotas_payment_webhook(
    payload: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Receives payment notifications from PagaCuotas (pagacuotas.hivelegaltech.cl).
    Called after MercadoPago confirms a payment.

    Payload fields: contrato_id, monto_pagado, external_payment_id, cliente_nombre, ...
    """
    contrato_id_raw = payload.get("contrato_id")
    external_ref = (payload.get("external_ref") or "").strip()
    external_id = payload.get("external_payment_id") or payload.get("payment_id")
    fallback_monto = float(payload.get("monto_pagado") or payload.get("amount") or 0)
    cliente_rut_raw = (payload.get("cliente_rut") or payload.get("rut") or "").strip()

    logger.info("[pagacuotas] webhook recibido: keys=%s contrato=%s ref=%s rut=%s",
                sorted(payload.keys()), contrato_id_raw, external_ref, cliente_rut_raw)

    # PagaCuotas no siempre envía contrato_id/external_ref: el RUT del cliente
    # también es identificador válido (fallback normalizado más abajo).
    if not contrato_id_raw and not external_ref and not cliente_rut_raw:
        raise HTTPException(status_code=400, detail="contrato_id, external_ref o cliente_rut requerido")

    lf_contrato_id = None
    if contrato_id_raw:
        try:
            lf_contrato_id = int(contrato_id_raw)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="contrato_id inválido")

    cobrador_lead = None
    if lf_contrato_id is not None:
        cobrador_lead = db.query(models.CobradorLead).filter(
            models.CobradorLead.lf_contrato_id == lf_contrato_id
        ).first()

    if not cobrador_lead:
        logger.info(
            "[pagacuotas] No cobrador lead for lf_contrato_id=%s — checking pipeline leads", lf_contrato_id
        )
        cliente_rut = cliente_rut_raw

        pipeline_lead = None

        # 0. Lookup by external_ref "{lead_id}-{N}" — lo emite nuestro propio
        #    payload hacia PagaCuotas, es el identificador más directo.
        if external_ref:
            _lead_part = external_ref.split("-", 1)[0]
            if _lead_part.isdigit():
                pipeline_lead = db.query(models.Lead).filter(
                    models.Lead.id == int(_lead_part)
                ).first()

        # 1. Lookup by lf_contrato_id (works when nexio got a contratoId from LF)
        if not pipeline_lead and lf_contrato_id is not None:
            pipeline_lead = db.query(models.Lead).filter(
                models.Lead.legal_finance_contrato_id == lf_contrato_id
            ).first()

        # 2. Fallback: lookup by RUT via Contact — normalizado en ambos lados
        #    para que "12.345.678-9" de la pasarela matchee "123456789" local.
        if not pipeline_lead and cliente_rut:
            _rut_norm = cliente_rut.replace(".", "").replace("-", "").replace(" ", "").upper()
            _norm = lambda col: sa_func.upper(sa_func.replace(sa_func.replace(sa_func.replace(col, ".", ""), "-", ""), " ", ""))  # noqa: E731
            contact = db.query(models.Contact).filter(
                (_norm(models.Contact.rut_persona) == _rut_norm)
                | (_norm(models.Contact.rut_empresa) == _rut_norm)
            ).first()
            if contact:
                pipeline_lead = (
                    db.query(models.Lead)
                    .filter(
                        models.Lead.contact_id == contact.id,
                        models.Lead.current_stage.in_(("pago_pendiente", "pago_comprometido", "pagado_reunion")),
                    )
                    .order_by(models.Lead.id.desc())
                    .first()
                )

        if pipeline_lead:
            _handle_pagacuotas_pipeline_payment(db, pipeline_lead, fallback_monto, external_id)
            db.commit()
            if external_id:
                _mark_pagacuotas_payment_synced(external_id)
            # SSE OBLIGATORIO: el Pipeline del frontend se mueve solo a
            # 'pagado_confirmado' sin que el usuario refresque el navegador.
            # Blindado: un fallo del broadcast NO debe tumbar el webhook.
            try:
                from ..broadcaster import wa_broadcaster
                wa_broadcaster.broadcast_sync("lead_update", {
                    "action": "stage_change",
                    "lead_id": pipeline_lead.id,
                    "stage": "pagado_confirmado",
                })
            except Exception:
                logger.warning("[pagacuotas] no se pudo emitir lead_update SSE", exc_info=True)
            logger.info(
                "[pagacuotas] pipeline payment OK: contrato=%s lead=%s rut=%s",
                lf_contrato_id, pipeline_lead.id, cliente_rut,
            )
            return {"ok": True, "pipeline_lead_id": pipeline_lead.id}

        logger.info(
            "[pagacuotas] no pipeline lead found for contrato=%s rut=%s",
            lf_contrato_id, cliente_rut,
        )
        if external_id:
            _mark_pagacuotas_payment_synced(external_id)
        return {"ok": True, "message": "no cobrador lead or pipeline lead for this contrato"}

    _apply_payment_to_cobrador_lead(db, cobrador_lead, lf_contrato_id, fallback_monto)
    db.commit()

    if external_id:
        _mark_pagacuotas_payment_synced(external_id)

    background_tasks.add_task(_broadcast_cobrador_sync, 0, 1)
    logger.info("[pagacuotas] webhook OK: contrato=%s lead=%s", lf_contrato_id, cobrador_lead.id)
    return {"ok": True, "cobrador_lead_id": cobrador_lead.id}


def _service_slug(name: str) -> str:
    """Código estable para un servicio a partir del nombre del Área."""
    s = (name or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


@router.get("/services/catalog")
def services_catalog(
    db: Session = Depends(get_db),
    x_lf_callback_secret: str = Header(None, alias="x-lf-callback-secret"),
):
    """
    Catálogo de servicios para SIS.CONTABLE (Legal Finance).

    Devuelve las Áreas activas (distintas por nombre) como servicios facturables.
    El estudio es de dominio tributario, por lo que `arista` = "TRIBUTARIO".

    Auth: header `x-lf-callback-secret` == env `LF_CALLBACK_SECRET`
    (mismo secreto que el webhook payment_confirmed).

    Forma de respuesta:
        { "services": [ { "code": "convenio-tgr", "name": "Convenio TGR",
                          "arista": "TRIBUTARIO" }, ... ] }
    """
    if LF_CALLBACK_SECRET and x_lf_callback_secret != LF_CALLBACK_SECRET:
        raise HTTPException(status_code=401, detail="Secret inválido")

    rows = (
        db.query(models.Area.name)
        .filter(models.Area.is_active == True)  # noqa: E712
        .distinct()
        .order_by(models.Area.name)
        .all()
    )

    seen: set[str] = set()
    services: list[dict] = []
    for (name,) in rows:
        code = _service_slug(name)
        if not code or code in seen:
            continue
        seen.add(code)
        services.append({"code": code, "name": name, "arista": "TRIBUTARIO"})

    return {"services": services}
