"""
Integration: CRM → Legal Finance (SIS.CONTABLE)
Handles all HTTP calls to the Legal Finance system.
"""
import os
import httpx
import logging

logger = logging.getLogger(__name__)

LEGAL_FINANCE_URL    = os.getenv("LEGAL_FINANCE_URL", "http://localhost:4000")
LEGAL_FINANCE_API_KEY = os.getenv("LEGAL_FINANCE_API_KEY", "")


async def push_pago_comprometido(
    *,
    crm_lead_id:   int,
    rut:           str,
    nombre:        str,
    email:         str | None,
    phone:         str | None,
    honorarios:    float,
    cuota_inicial: float,
    num_cuotas:    int,
    tipo_servicio: str,
    fecha_ingreso: str,
) -> dict:
    """
    POST /api/integrations/crm/pago-comprometido
    Creates client + contract + cuotas in Legal Finance when CRM lead reaches pago_comprometido.
    Returns { ok, clienteId, contratoId } or raises.
    """
    if not LEGAL_FINANCE_API_KEY:
        raise RuntimeError("LEGAL_FINANCE_API_KEY not configured")

    payload = {
        "crmLeadId":    crm_lead_id,
        "rut":          rut,
        "nombre":       nombre,
        "email":        email,
        "phone":        phone,
        "honorarios":   honorarios,
        "cuotaInicial": cuota_inicial,
        "numCuotas":    num_cuotas,
        "tipoServicio": tipo_servicio,
        "fechaIngreso": fecha_ingreso,
    }

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{LEGAL_FINANCE_URL}/api/integrations/crm/pago-comprometido",
            json=payload,
            headers={
                "x-api-key":    LEGAL_FINANCE_API_KEY,
                "Content-Type": "application/json",
            },
        )
        resp.raise_for_status()
        return resp.json()
