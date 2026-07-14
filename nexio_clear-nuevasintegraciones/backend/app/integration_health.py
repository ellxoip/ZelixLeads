"""
Salud de integraciones — panel verde/rojo del superadmin de Nexio.

Sondea, por canal, los enlaces del ecosistema con auth real, latencia y estado
HTTP, y devuelve un DIAGNÓSTICO accionable (causa + pasos) cuando algo está en
rojo. No expone secretos: solo estados/booleanos.

FASE 4: Nexio ↔ Control. (Fases 5 y 6 — Contable y PagaCuota — se agregan luego.)
"""
import os
import time
import httpx

TIMEOUT = 5.0


def _env(*names: str) -> str:
    for n in names:
        v = (os.getenv(n) or "").strip()
        if v:
            return v
    return ""


def _base(url: str) -> str:
    return url.rstrip("/")


# ── Canales (Fase 4: Nexio ↔ Control) ────────────────────────────────────────
# realm: internal | ingest | webhook_crm | inbound
_CHANNELS = [
    {"id": "nx-work-orders", "name": "Empujar Orden de Trabajo (OT)", "phase": 4, "direction": "Nexio → Control", "method": "POST", "endpoint": "/api/internal/integration/work-orders", "realm": "internal"},
    {"id": "nx-cases",       "name": "Crear / sembrar caso",          "phase": 4, "direction": "Nexio → Control", "method": "POST", "endpoint": "/api/internal/integration/cases", "realm": "internal"},
    {"id": "nx-auto-login",  "name": "Auto-login del cliente",        "phase": 4, "direction": "Nexio → Control", "method": "POST", "endpoint": "/api/internal/integration/clients/auto-login", "realm": "internal"},
    {"id": "nx-reunion",     "name": "Lead de reunión",               "phase": 4, "direction": "Nexio → Control", "method": "POST", "endpoint": "/api/integration/reunion-lead", "realm": "ingest"},
    {"id": "nx-payment",     "name": "Aviso de pago necesario",       "phase": 4, "direction": "Nexio → Control", "method": "POST", "endpoint": "/api/integration/payment-needed", "realm": "ingest"},
    {"id": "nx-abogados",    "name": "Consulta de abogados",          "phase": 4, "direction": "Nexio → Control", "method": "GET",  "endpoint": "/api/integration/abogados", "realm": "ingest"},
    {"id": "nx-crm-webhook", "name": "Sync de vendedores (webhook)",  "phase": 4, "direction": "Nexio → Control", "method": "POST", "endpoint": "/api/webhooks/crm", "realm": "webhook_crm"},
    {"id": "nx-inbound",     "name": "Webhook entrante (AT Informa)", "phase": 4, "direction": "Control → Nexio", "method": "POST", "endpoint": "/api/webhooks/at_informa", "realm": "inbound"},
    # ── Fase 5: Nexio ↔ Contable (Finanzas / legal_finance) ──
    {"id": "lf-dashboard",  "name": "Dashboard del analista",       "phase": 5, "direction": "Nexio → Contable", "method": "GET",  "endpoint": "/api/internal/integration/analista-dashboard", "realm": "lf_http"},
    {"id": "lf-db",         "name": "Lectura directa DB contable",  "phase": 5, "direction": "Nexio → Contable", "method": "SQL",  "endpoint": "CONTABLE_DATABASE_URL", "realm": "lf_db"},
    {"id": "lf-inbound",    "name": "Webhook entrante (Finanzas)",  "phase": 5, "direction": "Contable → Nexio", "method": "POST", "endpoint": "/webhooks/legal_finance", "realm": "lf_inbound"},
    # ── Fase 6: Nexio ↔ PagaCuota ──
    {"id": "pc-crear",      "name": "Crear cliente en PagaCuota",   "phase": 6, "direction": "Nexio → PagaCuota", "method": "POST", "endpoint": "/api/integration/clients/from-crm", "realm": "pc_http"},
    {"id": "pc-db",         "name": "Lectura directa DB PagaCuota", "phase": 6, "direction": "Nexio → PagaCuota", "method": "SQL",  "endpoint": "PAGACUOTAS_DATABASE_URL", "realm": "pc_db"},
    {"id": "pc-inbound",    "name": "Webhook de pago entrante",     "phase": 6, "direction": "Pasarela → Nexio",  "method": "POST", "endpoint": "/webhooks/pagacuotas", "realm": "pc_inbound"},
]


def _diag(cause, message, remediation):
    return {"cause": cause, "message": message, "remediation": remediation}


async def _http_probe(url: str, headers: dict, origin_label: str, auth_remediation: list[str]) -> dict:
    """GET seguro a un endpoint. 2xx/404 autenticado = ok; 401/403 = auth; 5xx = degraded."""
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(url, headers={"Accept": "application/json", **headers})
        latency = int((time.monotonic() - started) * 1000)
        if resp.status_code in (401, 403):
            return {"status": "down", "http": resp.status_code, "latency": latency,
                    "diagnosis": _diag("auth_failed", f"Auth rechazada (HTTP {resp.status_code}).", auth_remediation)}
        if resp.status_code >= 500:
            return {"status": "degraded", "http": resp.status_code, "latency": latency,
                    "diagnosis": _diag("http_error", f"El servicio remoto respondió error de servidor (HTTP {resp.status_code}).",
                                       ["Revisar los logs del servicio remoto.", "Verificar su base de datos y dependencias.", "Re-verificar cuando responda 2xx/404."])}
        return {"status": "ok", "http": resp.status_code, "latency": latency}
    except httpx.RequestError as exc:
        latency = int((time.monotonic() - started) * 1000)
        return {"status": "down", "http": None, "latency": latency,
                "diagnosis": _diag("unreachable", f"No se pudo alcanzar {origin_label}: {str(exc)[:120]}",
                                   [f"Verificar que {origin_label} esté arriba y sea alcanzable desde este servidor.",
                                    "Revisar la URL base (sin typos), DNS/red/firewall y que el deploy esté vivo."])}


def _env_missing(env_name: str, extra: str, remediation: list[str]) -> dict:
    return {"status": "down", "http": None, "latency": None,
            "diagnosis": _diag("env_missing", f"{env_name} no está seteada — {extra}", remediation)}


async def _probe_internal() -> dict:
    url = _env("HIVE_SERVICE_URL")
    key = _env("HIVE_SERVICE_API_KEY", "INTEGRATION_INTERNAL_API_KEY")
    if not url or not key:
        return _env_missing("HIVE_SERVICE_URL / HIVE_SERVICE_API_KEY",
                            "Nexio no puede empujar OT/casos a Control.",
                            ["Agregar HIVE_SERVICE_URL y HIVE_SERVICE_API_KEY en el .env de Nexio.",
                             "La key debe coincidir con INTEGRATION_INTERNAL_API_KEY de Control (mismo entorno).",
                             "Reiniciar el backend y re-verificar."])
    return await _http_probe(f"{_base(url)}/api/internal/integration/health",
                             {"Authorization": f"Bearer {key}"}, url,
                             ["La HIVE_SERVICE_API_KEY de Nexio y la INTEGRATION_INTERNAL_API_KEY de Control no coinciden (rotada/typo).",
                              "Alinear el secreto en ambos .env (mismo entorno test/prod).", "Reiniciar y re-verificar."])


async def _probe_ingest() -> dict:
    url = _env("AT_INFORMA_URL")
    secret = _env("AT_INFORMA_INTEGRATION_SECRET")
    if not url or not secret:
        return _env_missing("AT_INFORMA_URL / AT_INFORMA_INTEGRATION_SECRET",
                            "Nexio no puede enviar leads de reunión/avisos a Control.",
                            ["Agregar AT_INFORMA_URL y AT_INFORMA_INTEGRATION_SECRET en el .env de Nexio.",
                             "El secreto debe coincidir con INTEGRATION_INGEST_SECRET de Control (mismo entorno).",
                             "Reiniciar y re-verificar."])
    return await _http_probe(f"{_base(url)}/api/integration/abogados",
                             {"x-integration-secret": secret}, url,
                             ["El AT_INFORMA_INTEGRATION_SECRET de Nexio y el ingest de Control no coinciden (rotada/typo).",
                              "Alinear el secreto en ambos .env (mismo entorno).", "Reiniciar y re-verificar."])


async def _probe_webhook_crm() -> dict:
    url = _env("AT_INFORMA_URL")
    secret = _env("AT_INFORMA_WEBHOOK_SECRET")
    if not url or not secret:
        return _env_missing("AT_INFORMA_URL / AT_INFORMA_WEBHOOK_SECRET",
                            "Nexio no puede sincronizar vendedores vía webhook a Control.",
                            ["Agregar AT_INFORMA_WEBHOOK_SECRET (y AT_INFORMA_URL) en el .env de Nexio.",
                             "Debe coincidir con la firma que valida Control en /api/webhooks/crm.",
                             "Reiniciar y re-verificar."])
    # Endpoint POST-only: sondeo de alcance del host (el secreto se valida en el POST real).
    probe = await _http_probe(_base(url), {}, url,
                              ["Control no aceptó la petición: revisar AT_INFORMA_URL y disponibilidad.",])
    return probe


async def _probe_inbound() -> dict:
    # Control → Nexio: Nexio expone /api/webhooks/at_informa y valida CRM_CALLBACK_SECRET.
    # No hay sonda remota; se verifica que el secreto esté cableado en Nexio.
    if not _env("CRM_CALLBACK_SECRET"):
        return _env_missing("CRM_CALLBACK_SECRET",
                            "Nexio rechazará los webhooks entrantes de Control (resultados de reunión/pago).",
                            ["Agregar CRM_CALLBACK_SECRET en el .env de Nexio.",
                             "Debe coincidir con el secreto que usa Control al llamar a /api/webhooks/at_informa.",
                             "Reiniciar y re-verificar."])
    return {"status": "ok", "http": None, "latency": None}


async def _probe_lf_http() -> dict:
    url = _env("LEGAL_FINANCE_URL")
    key = _env("LEGAL_FINANCE_API_KEY")
    if not url or not key:
        return _env_missing("LEGAL_FINANCE_URL / LEGAL_FINANCE_API_KEY",
                            "Nexio no puede leer el dashboard del analista desde el contable.",
                            ["Agregar LEGAL_FINANCE_URL y LEGAL_FINANCE_API_KEY en el .env de Nexio.",
                             "La key debe coincidir con la que valida el contable (mismo entorno test/prod).",
                             "Reiniciar y re-verificar."])
    return await _http_probe(f"{_base(url)}/api/internal/integration/analista-dashboard",
                             {"Authorization": f"Bearer {key}"}, url,
                             ["La LEGAL_FINANCE_API_KEY de Nexio y la del contable no coinciden (rotada/typo).",
                              "Alinear el secreto en ambos .env (mismo entorno).", "Reiniciar y re-verificar."])


async def _db_probe(url: str) -> dict:
    """SELECT 1 en vivo sobre una DB externa (en hilo, timeout de conexión 5s)."""
    import asyncio, time as _t
    started = _t.monotonic()

    def _try() -> None:
        from sqlalchemy import create_engine, text
        engine = create_engine(url, pool_pre_ping=True, connect_args={"connect_timeout": 5})
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        finally:
            engine.dispose()

    try:
        await asyncio.to_thread(_try)
        return {"status": "ok", "http": None, "latency": int((_t.monotonic() - started) * 1000)}
    except Exception as exc:
        return {"status": "down", "http": None, "latency": int((_t.monotonic() - started) * 1000),
                "diagnosis": _diag("db_down", f"Sin conexión a la base de datos: {str(exc)[:120]}",
                                   ["Verificar la URL (host/credenciales/SSL) y que el pool esté arriba.",
                                    "Confirmar que el rol tenga acceso de lectura y el firewall permita la conexión.",
                                    "Re-verificar tras confirmar conectividad."])}


async def _probe_lf_db() -> dict:
    url = _env("CONTABLE_DATABASE_URL")
    if not url or "CHANGE_ME" in url:
        return _env_missing("CONTABLE_DATABASE_URL",
                            "Nexio no puede leer directamente la DB del contable (totales de contrato).",
                            ["Setear CONTABLE_DATABASE_URL (sin el placeholder CHANGE_ME) en el .env de Nexio.",
                             "Usar credenciales de solo lectura del pool contable del entorno correcto.",
                             "Reiniciar y re-verificar."])
    return await _db_probe(url)


async def _probe_pc_http() -> dict:
    url = _env("PAGACUOTAS_URL")
    key = _env("PAGACUOTAS_API_KEY")
    if not url or not key:
        return _env_missing("PAGACUOTAS_URL / PAGACUOTAS_API_KEY",
                            "Nexio no puede crear clientes/compromisos de pago en PagaCuota.",
                            ["Agregar PAGACUOTAS_URL y PAGACUOTAS_API_KEY en el .env de Nexio.",
                             "La key (x-crm-api-key) debe coincidir con la que valida PagaCuota (mismo entorno).",
                             "Reiniciar y re-verificar."])
    # Sonda segura del mismo realm de auth (GET de link) — sin crear datos.
    return await _http_probe(f"{_base(url)}/api/integration/clients/1-9/link",
                             {"x-crm-api-key": key}, url,
                             ["El PAGACUOTAS_API_KEY de Nexio y el x-crm-api-key de PagaCuota no coinciden (rotada/typo).",
                              "Alinear el secreto en ambos .env (mismo entorno).", "Reiniciar y re-verificar."])


async def _probe_pc_db() -> dict:
    url = _env("PAGACUOTAS_DATABASE_URL")
    if not url or "CHANGE_ME" in url:
        return _env_missing("PAGACUOTAS_DATABASE_URL",
                            "Nexio no puede leer directamente la DB de PagaCuota (conciliación de pagos).",
                            ["Setear PAGACUOTAS_DATABASE_URL (sin el placeholder CHANGE_ME) en el .env de Nexio.",
                             "Usar credenciales de solo lectura del entorno correcto.",
                             "Reiniciar y re-verificar."])
    return await _db_probe(url)


async def _probe_pc_inbound() -> dict:
    # La pasarela → Nexio: /webhooks/pagacuotas es un webhook abierto (lo llama la
    # pasarela tras confirmar el pago); no valida un secreto propio, así que el
    # canal está sano mientras el backend de Nexio esté vivo (este endpoint corre).
    return {"status": "ok", "http": None, "latency": None}


async def _probe_lf_inbound() -> dict:
    if not _env("LF_CALLBACK_SECRET"):
        return _env_missing("LF_CALLBACK_SECRET",
                            "Nexio rechazará los webhooks entrantes del contable (confirmaciones de pago).",
                            ["Agregar LF_CALLBACK_SECRET en el .env de Nexio.",
                             "Debe coincidir con el secreto que usa el contable al llamar a /webhooks/legal_finance.",
                             "Reiniciar y re-verificar."])
    return {"status": "ok", "http": None, "latency": None}


async def check_integrations() -> list[dict]:
    """Salud de todos los canales (Fase 4: Nexio↔Control, 5: Contable, 6: PagaCuota)."""
    import asyncio
    (internal, ingest, webhook_crm, inbound, lf_http, lf_db, lf_inbound,
     pc_http, pc_db, pc_inbound) = await asyncio.gather(
        _probe_internal(), _probe_ingest(), _probe_webhook_crm(), _probe_inbound(),
        _probe_lf_http(), _probe_lf_db(), _probe_lf_inbound(),
        _probe_pc_http(), _probe_pc_db(), _probe_pc_inbound(),
    )
    by_realm = {
        "internal": internal, "ingest": ingest, "webhook_crm": webhook_crm, "inbound": inbound,
        "lf_http": lf_http, "lf_db": lf_db, "lf_inbound": lf_inbound,
        "pc_http": pc_http, "pc_db": pc_db, "pc_inbound": pc_inbound,
    }
    out = []
    for c in _CHANNELS:
        p = by_realm[c["realm"]]
        out.append({
            "id": c["id"], "name": c["name"], "phase": c["phase"], "direction": c["direction"],
            "method": c["method"], "endpoint": c["endpoint"], "realm": c["realm"],
            "status": p["status"], "latencyMs": p.get("latency"), "httpStatus": p.get("http"),
            "diagnosis": p.get("diagnosis"),
        })
    return out
