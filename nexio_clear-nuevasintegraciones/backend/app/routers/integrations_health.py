"""
Healthcheck de integraciones del ecosistema.

Endpoint additivo de diagnóstico: reporta, por cada hop, si el secreto/URL están
configurados y si el sistema remoto responde (vivo). No expone los valores de los
secretos — solo si están presentes. Sirve para "despertar"/verificar las
integraciones sin tocar la lógica de negocio.

Hops:
  - legal_finance (NEXIO → systemFinance, secreto D)
  - pagacuotas    (NEXIO → PagaCuotas, x-crm-api-key)
  - at_informa    (NEXIO → Hive Service Control)
  - hive_service  (NEXIO → Hive Service Control, casos)
"""
import os
import time
import httpx
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from .. import models
from ..auth import require_roles
from ..database import get_db
from ..integration_health import check_integrations
from ..integration_reconcile import reconcile_rut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/integrations", tags=["integrations-health"])


def _present(name: str) -> bool:
    return bool((os.getenv(name) or "").strip())


async def _ping(url: str | None) -> dict:
    """Ping ligero al base URL. 'alive' = el host responde algo (cualquier status)."""
    if not url:
        return {"reachable": False, "status_code": None, "error": "sin URL", "latency_ms": None}
    base = url.rstrip("/")
    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=5, follow_redirects=True) as client:
            resp = await client.get(base)
        return {"reachable": True, "status_code": resp.status_code, "error": None,
                "latency_ms": round((time.perf_counter() - t0) * 1000)}
    except httpx.RequestError as exc:
        return {"reachable": False, "status_code": None, "error": str(exc)[:120],
                "latency_ms": round((time.perf_counter() - t0) * 1000)}


@router.get("/health")
async def integrations_health(
    current_user: models.User = Depends(require_roles("superadmin", "subadmin")),
):
    legal_finance_url = os.getenv("LEGAL_FINANCE_URL")
    pagacuotas_url    = os.getenv("PAGACUOTAS_URL")
    at_informa_url    = os.getenv("AT_INFORMA_URL")
    hive_service_url  = os.getenv("HIVE_SERVICE_URL")

    hops = {
        "legal_finance": {
            "url": legal_finance_url,
            "secrets": {
                "LEGAL_FINANCE_URL": _present("LEGAL_FINANCE_URL"),
                "LEGAL_FINANCE_API_KEY": _present("LEGAL_FINANCE_API_KEY"),
                "LF_CALLBACK_SECRET": _present("LF_CALLBACK_SECRET"),
            },
            "live": await _ping(legal_finance_url),
        },
        "pagacuotas": {
            "url": pagacuotas_url,
            "secrets": {
                "PAGACUOTAS_URL": _present("PAGACUOTAS_URL"),
                "PAGACUOTAS_API_KEY": _present("PAGACUOTAS_API_KEY"),
                "PAGACUOTAS_PORTAL_URL": _present("PAGACUOTAS_PORTAL_URL"),
            },
            "live": await _ping(pagacuotas_url),
        },
        "at_informa": {
            "url": at_informa_url,
            "secrets": {
                "AT_INFORMA_URL": _present("AT_INFORMA_URL"),
                "AT_INFORMA_INTEGRATION_SECRET": _present("AT_INFORMA_INTEGRATION_SECRET"),
            },
            "live": await _ping(at_informa_url),
        },
        "hive_service": {
            "url": hive_service_url,
            "secrets": {
                "HIVE_SERVICE_URL": _present("HIVE_SERVICE_URL"),
                "HIVE_SERVICE_API_KEY": _present("HIVE_SERVICE_API_KEY") or _present("INTEGRATION_INTERNAL_API_KEY"),
            },
            "live": await _ping(hive_service_url),
        },
    }

    def _ok(hop: dict) -> bool:
        return all(hop["secrets"].values()) and hop["live"]["reachable"]

    for hop in hops.values():
        hop["ok"] = _ok(hop)

    return {
        "ok": all(h["ok"] for h in hops.values()),
        "hops": hops,
    }


@router.get("/panel")
async def integrations_panel(
    current_user: models.User = Depends(require_roles("superadmin")),
):
    """Panel de salud por canal (semáforo + latencia + HTTP + diagnóstico). Solo superadmin."""
    integrations = await check_integrations()
    ok = all(i["status"] == "ok" for i in integrations)
    return {
        "ok": ok,
        "integrations": integrations,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/reconcile")
def integrations_reconcile(
    rut: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin")),
):
    """Reconciliación de datos por RUT: compara datos REALES entre sistemas. Solo superadmin."""
    return reconcile_rut(rut, db)
