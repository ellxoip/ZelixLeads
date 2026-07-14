"""
Integration: CRM ↔ AT Informa
Handles all HTTP calls between the two systems.
"""
import os
import httpx
import logging

logger = logging.getLogger(__name__)

AT_INFORMA_URL               = os.getenv("AT_INFORMA_URL", "http://localhost:3000")
AT_INFORMA_SECRET            = os.getenv("AT_INFORMA_WEBHOOK_SECRET", "")
AT_INFORMA_INTEGRATION_SECRET = os.getenv("AT_INFORMA_INTEGRATION_SECRET", "")


# ── CRM → AT Informa (push) ───────────────────────────────────────────────

async def push_confirmed_payment(
    *,
    full_name:   str,
    email:       str,
    phone:       str,
    category:    str,
    invoice_url: str | None = None,
    case_code:   str | None = None,
) -> dict:
    """POST /api/webhooks/crm — creates client+case in AT Informa when pago_exitoso."""
    _check_secret()
    payload = {
        "fullName": full_name,
        "email":    email,
        "phone":    phone,
        "category": category.upper(),
        **({"invoiceUrl": invoice_url} if invoice_url else {}),
        **({"caseCode":   case_code}   if case_code   else {}),
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{AT_INFORMA_URL}/api/webhooks/crm",
            json=payload,
            headers={"x-webhook-signature": AT_INFORMA_SECRET, "Content-Type": "application/json"},
        )
        resp.raise_for_status()
        return resp.json()


async def cancel_confirmed_payment(*, case_code: str) -> dict:
    """DELETE /api/webhooks/crm — revert a confirmed payment in AT Informa."""
    _check_secret()
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.request(
            "DELETE",
            f"{AT_INFORMA_URL}/api/webhooks/crm",
            json={"caseCode": case_code},
            headers={"x-webhook-signature": AT_INFORMA_SECRET, "Content-Type": "application/json"},
        )
        resp.raise_for_status()
        return resp.json()


async def push_reunion_lead(
    *,
    crm_lead_id:      int,
    full_name:        str,
    email:            str,
    phone:            str,
    category:         str,
    service_desc:     str | None,
    honorarios:       float,
    vendedor_email:   str | None,
    agendadora_name:  str | None,
    at_vendedor_id:   str | None,
    meeting_at:       str | None = None,   # ISO 8601 datetime
    meeting_duration: int        = 60,      # minutes
) -> dict:
    """
    POST /api/integration/reunion-lead
    Notify AT Informa when a lead enters the 'reunion' stage.
    Returns { ok, leadId, caseId } or raises.
    """
    _check_integration_secret()
    payload = {
        "crmLeadId":       crm_lead_id,
        "fullName":        full_name,
        "email":           email,
        "phone":           phone,
        "category":        category.upper(),
        "serviceDesc":     service_desc or "",
        "honorarios":      honorarios,
        "vendedorEmail":   vendedor_email or "",
        "vendedorId":      at_vendedor_id or "",
        "agendadoraName":  agendadora_name or "",
        "meetingDuration": meeting_duration,
        **({"meetingAt": meeting_at} if meeting_at else {}),
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{AT_INFORMA_URL}/api/integration/reunion-lead",
            json=payload,
            headers={"x-integration-secret": AT_INFORMA_INTEGRATION_SECRET, "Content-Type": "application/json"},
        )
        resp.raise_for_status()
        return resp.json()


async def push_pago_comprometido(
    *,
    crm_lead_id:  int,
    at_case_id:   str | None,
    full_name:    str,
    honorarios:   float,
    invoice_url:  str | None = None,
) -> dict:
    """
    POST /api/integration/payment-needed
    Notify AT Informa that a lead reached pago_comprometido — triggers SuperAdmin bandeja.
    """
    _check_integration_secret()
    payload = {
        "crmLeadId":  crm_lead_id,
        "caseId":     at_case_id or "",
        "fullName":   full_name,
        "honorarios": honorarios,
        **({"invoiceUrl": invoice_url} if invoice_url else {}),
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{AT_INFORMA_URL}/api/integration/payment-needed",
            json=payload,
            headers={"x-integration-secret": AT_INFORMA_INTEGRATION_SECRET, "Content-Type": "application/json"},
        )
        resp.raise_for_status()
        return resp.json()


# ── AT Informa → CRM (pull) ───────────────────────────────────────────────

async def get_abogados() -> list[dict]:
    """
    GET /api/integration/abogados
    Fetch all active abogados from AT Informa for sync into CRM vendedores.
    """
    _check_integration_secret()
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{AT_INFORMA_URL}/api/integration/abogados",
            headers={"x-integration-secret": AT_INFORMA_INTEGRATION_SECRET},
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("abogados", data) if isinstance(data, dict) else data


# ── helpers ───────────────────────────────────────────────────────────────

def _check_secret():
    if not AT_INFORMA_SECRET:
        raise RuntimeError("AT_INFORMA_WEBHOOK_SECRET not configured")

def _check_integration_secret():
    if not AT_INFORMA_INTEGRATION_SECRET:
        raise RuntimeError("AT_INFORMA_INTEGRATION_SECRET not configured")
