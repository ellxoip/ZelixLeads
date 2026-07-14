from typing import Any
from fastapi import HTTPException
from sqlalchemy.orm import Session

PLAN_LIMITS: dict[str, dict[str, Any]] = {
    "basico": {
        "label": "Básico",
        "max_users": 5,
        "max_wa_numbers": 1,
        "max_leads": 300,
        "max_ai_agents": 0,
        "google_calendar": False,
        "export_csv": False,
        "seguimiento": False,
        "analytics_avanzados": False,
        "pdf_ot": True,
        "whatsapp_chat": True,
    },
    "pro": {
        "label": "Pro",
        "max_users": 15,
        "max_wa_numbers": 3,
        "max_leads": 2000,
        "max_ai_agents": 2,
        "google_calendar": True,
        "export_csv": True,
        "seguimiento": True,
        "analytics_avanzados": False,
        "pdf_ot": True,
        "whatsapp_chat": True,
    },
    "enterprise": {
        "label": "Enterprise",
        "max_users": -1,
        "max_wa_numbers": -1,
        "max_leads": -1,
        "max_ai_agents": -1,
        "google_calendar": True,
        "export_csv": True,
        "seguimiento": True,
        "analytics_avanzados": True,
        "pdf_ot": True,
        "whatsapp_chat": True,
    },
}


def get_limits(plan: str) -> dict[str, Any]:
    return PLAN_LIMITS.get(plan, PLAN_LIMITS["basico"])


def _get_negocio(db: Session, group_id: int | None):
    if not group_id:
        return None
    from . import models
    g = db.query(models.Group).filter(models.Group.id == group_id).first()
    if not g:
        return None
    return g if g.negocio_id is None else db.query(models.Group).filter(models.Group.id == g.negocio_id).first()


def enforce_limit(db: Session, group_id: int | None, key: str, current: int) -> None:
    """Raise HTTP 403 if current count >= plan limit. Skips when group_id is None (tecnico/superadmin without negocio)."""
    negocio = _get_negocio(db, group_id)
    if not negocio:
        return
    plan = negocio.plan or "basico"
    limits = get_limits(plan)
    max_val = limits.get(key, 0)
    if max_val != -1 and current >= max_val:
        pretty = {"max_users": "usuarios", "max_leads": "leads activos", "max_wa_numbers": "números WhatsApp"}
        raise HTTPException(
            status_code=403,
            detail=f"Plan {limits['label']}: límite de {max_val} {pretty.get(key, key)} alcanzado. Actualiza el plan para continuar.",
        )
