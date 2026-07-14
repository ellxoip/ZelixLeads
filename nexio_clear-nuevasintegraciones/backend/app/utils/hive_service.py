import os
from typing import Any

import aiohttp

from .resilient_http import resilient_request, TIMEOUT_HEAVY


HIVE_SERVICE_URL = os.getenv("HIVE_SERVICE_URL", "http://localhost:3005").rstrip("/")
HIVE_SERVICE_API_KEY = os.getenv("HIVE_SERVICE_API_KEY") or os.getenv("INTEGRATION_INTERNAL_API_KEY")


async def push_work_order(
    *,
    crm_lead_id: int,
    rut: str | None,
    case_code: str | None,
    service_category: str,
    work_order: dict[str, Any],
) -> dict[str, Any]:
    """
    Sincroniza (upsert) la OT como documento del caso en hive-service-control.

    A diferencia de `push_pago_comprometido` (que crea el caso completo y exige
    password), este hop solo refresca el documento OT del caso ya existente:
    cuando el vendedor edita/guarda la OT en NEXIO después de que el caso fue
    creado en control, el documento de la subcarpeta [OT/...] se actualiza para
    seguir siendo exactamente la OT vigente de NEXIO. Usa el cliente HTTP
    resiliente (reintentos + circuit breaker + idempotencia) para resistir
    estrés y caídas transitorias del receptor.
    """
    if not HIVE_SERVICE_API_KEY:
        raise RuntimeError("HIVE_SERVICE_API_KEY no configurada")

    payload = {
        "crm_lead_id": crm_lead_id,
        "rut": rut,
        "case_code": case_code,
        "service_category": service_category,
        "work_order": work_order,
        "source": "NEXIO",
    }
    resp = await resilient_request(
        "POST",
        f"{HIVE_SERVICE_URL}/api/internal/integration/work-orders",
        json=payload,
        headers={
            "Authorization": f"Bearer {HIVE_SERVICE_API_KEY}",
            "Content-Type": "application/json",
        },
        hop="hive_service.work_orders",
        timeout=TIMEOUT_HEAVY,
        idempotency_key=f"nexio-wo-{work_order.get('id') or crm_lead_id}",
    )
    try:
        data = resp.json()
    except Exception:
        data = {"raw": resp.text}
    if resp.status_code == 404:
        # El caso todavía no existe en control (se crea por la vía PagaCuotas,
        # de la que NEXIO no se entera en el momento). No es un error: la OT
        # volverá a viajar en el próximo guardado/edición. Se reporta como
        # no-op para que el caller no lo registre como fallo.
        return {"skipped": "case_not_found"}
    if resp.status_code >= 400:
        raise RuntimeError(f"Hive Service error {resp.status_code}: {data}")
    return data


async def push_pago_comprometido(
    *,
    crm_lead_id: int,
    rut: str,
    nombre: str,
    email: str | None,
    telefono: str | None,
    password_plain: str,
    case_code: str,
    service_category: str,
    honorarios: float,
    cuota_inicial: float,
    num_cuotas: int,
    monto_cuota: float,
    vendedor: str | None,
    agendadora: str | None,
    work_order: dict[str, Any] | None,
    payment_link: str | None = None,
) -> dict[str, Any]:
    """
    Crea/actualiza el caso del cliente en hive-service-control con la OT
    adjunta. Se invoca desde `_handle_portal_credentials_ready` cuando
    financial-control nos avisa que las credenciales del portal están
    listas — en ese momento ya tenemos `password_plain`, que es requerido
    por el endpoint `/api/internal/integration/cases` para sembrar el
    `User.passwordHash` del cliente. Antes este push se disparaba al
    pasar a Pago Comprometido sin password y fallaba con 422.
    """
    if not HIVE_SERVICE_API_KEY:
        raise RuntimeError("HIVE_SERVICE_API_KEY no configurada")
    if not password_plain or len(password_plain) < 6:
        raise ValueError("password_plain requerido (mínimo 6 chars)")

    payload = {
        "rut": rut,
        "nombre": nombre,
        "email": email,
        "telefono": telefono,
        "password_plain": password_plain,
        "case_code": case_code,
        "service_category": service_category,
        "crm_lead_id": crm_lead_id,
        "correlation_id": f"nexio-lead-{crm_lead_id}",
        "initial_payment_amount": cuota_inicial,
        "payment_link": payment_link,
        "work_order": work_order,
        "financials": {
            "honorarios": honorarios,
            "cuota_inicial": cuota_inicial,
            "num_cuotas": num_cuotas,
            "monto_cuota": monto_cuota,
        },
        "team": {
            "vendedor": vendedor,
            "agendadora": agendadora,
        },
        "source": "NEXIO",
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{HIVE_SERVICE_URL}/api/internal/integration/cases",
            json=payload,
            headers={
                "Authorization": f"Bearer {HIVE_SERVICE_API_KEY}",
                "Content-Type": "application/json",
            },
            timeout=aiohttp.ClientTimeout(total=20),
        ) as resp:
            data = await resp.json(content_type=None)
            if resp.status >= 400:
                raise RuntimeError(f"Hive Service error {resp.status}: {data}")
            return data


async def request_auto_login(
    *,
    rut: str,
    ttl_seconds: int = 14400,
    source: str = "PagaCuotas",
    crm_lead_id: int | None = None,
) -> dict[str, Any] | None:
    """
    Pide a service-control un magic-link de auto-login para un cliente YA
    existente, identificado solo por RUT (no requiere la clave). Se usa al
    confirmar el pago de una cuota: el cliente fue creado en el onboarding, asi
    que basta el RUT para emitirle el enlace de acceso (valido `ttl_seconds`, 4h
    por defecto). Devuelve el JSON ({redirectUrl, ...}) o None si el cliente no
    existe todavia (404) — el caller lo trata como best-effort.
    """
    if not HIVE_SERVICE_API_KEY:
        raise RuntimeError("HIVE_SERVICE_API_KEY no configurada")

    payload: dict[str, Any] = {
        "rut": rut,
        "ttl_seconds": ttl_seconds,
        "source": source,
    }
    if crm_lead_id is not None:
        payload["correlation_id"] = f"nexio-lead-{crm_lead_id}"

    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{HIVE_SERVICE_URL}/api/internal/integration/clients/auto-login",
            json=payload,
            headers={
                "Authorization": f"Bearer {HIVE_SERVICE_API_KEY}",
                "Content-Type": "application/json",
            },
            timeout=aiohttp.ClientTimeout(total=20),
        ) as resp:
            data = await resp.json(content_type=None)
            if resp.status == 404:
                return None
            if resp.status >= 400:
                raise RuntimeError(f"Hive Service auto-login error {resp.status}: {data}")
            return data
