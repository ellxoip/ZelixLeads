"""
WhatsApp QR sessions — self-service for agendadoras + admin management.
Uses the same Node.js/Baileys service as the tecnico router.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import Optional
import httpx
import os
from ..database import get_db
from .. import models
from ..auth import get_current_user
from ..plans import enforce_limit, _get_negocio, get_limits

QR_SERVICE_URL = os.getenv("QR_SERVICE_URL", "http://localhost:3005")
QR_TIMEOUT = 10

router = APIRouter(prefix="/api/whatsapp-sessions", tags=["whatsapp-sessions"])




# ── Helpers ──────────────────────────────────────────────────────────────────

async def _node(method: str, path: str, data: dict = None) -> dict:
    async with httpx.AsyncClient() as client:
        url = f"{QR_SERVICE_URL}{path}"
        try:
            if method == "GET":
                r = await client.get(url, timeout=QR_TIMEOUT)
            elif method == "POST":
                r = await client.post(url, json=data or {}, timeout=QR_TIMEOUT)
            elif method == "DELETE":
                r = await client.delete(url, timeout=QR_TIMEOUT)
            else:
                raise ValueError(f"Unknown method {method}")
            return r.json()
        except httpx.ConnectError:
            return {"status": "service_unavailable", "error": "Servicio QR no disponible"}
        except Exception as e:
            return {"status": "service_unavailable", "error": str(e)}


def _serialize(cfg: models.WhatsAppConfig) -> dict:
    return {
        "id": cfg.id,
        "name": cfg.name,
        "phone_number": cfg.phone_number,
        "api_provider": cfg.api_provider,
        "is_active": cfg.is_active,
        "group_id": cfg.group_id,
        "group_name": cfg.group.name if cfg.group else None,
        "owner_user_id": cfg.owner_user_id,
        "owner_name": cfg.owner.name if cfg.owner else None,
        "owner_role": cfg.owner.role if cfg.owner else None,
        "created_at": cfg.created_at.isoformat() if cfg.created_at else None,
        "areas": [{"id": a.id, "name": a.name} for a in cfg.areas] if cfg.areas else [],
    }


# ── Agendadora self-service ───────────────────────────────────────────────────

@router.get("/mine")
async def list_my_sessions(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Return QR sessions owned by the current user."""
    if current_user.role not in ("agendadora", "cobrador", "superadmin", "subadmin", "tecnico"):
        raise HTTPException(status_code=403, detail="Sin acceso")

    owner_id = current_user.id if current_user.role in ("agendadora", "cobrador") else None
    q = db.query(models.WhatsAppConfig).options(
        joinedload(models.WhatsAppConfig.group),
        joinedload(models.WhatsAppConfig.owner),
        joinedload(models.WhatsAppConfig.areas),
    ).filter(models.WhatsAppConfig.api_provider == "qr")

    if owner_id:
        q = q.filter(models.WhatsAppConfig.owner_user_id == owner_id)

    cfgs = q.order_by(models.WhatsAppConfig.created_at.desc()).all()
    return [_serialize(c) for c in cfgs]


@router.post("/mine")
async def create_my_session(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Create a new QR session for the current user, respecting the negocio plan limit."""
    if current_user.role not in ("agendadora", "cobrador", "superadmin", "subadmin", "tecnico"):
        raise HTTPException(status_code=403, detail="Sin acceso")

    # Enforce self-service WA limit: count only configs owned by this user.
    # Tecnico-managed group configs (no owner_user_id) are excluded from this count
    # because they are a separate infrastructure concern.
    plan_str = "basico"
    if current_user.group_id:
        negocio = _get_negocio(db, current_user.group_id)
        if negocio and negocio.plan:
            plan_str = negocio.plan
    elif current_user.role == "cobrador":
        abogados_negocio = db.query(models.Group).filter(
            models.Group.tipo == "abogados",
            models.Group.negocio_id.is_(None),
        ).first()
        if abogados_negocio and abogados_negocio.plan:
            plan_str = abogados_negocio.plan

    limits = get_limits(plan_str)
    max_wa = limits.get("max_wa_numbers", 1)
    if max_wa != -1:
        own_count = db.query(models.WhatsAppConfig).filter(
            models.WhatsAppConfig.owner_user_id == current_user.id,
        ).count()
        if own_count >= max_wa:
            label = limits.get("label", plan_str)
            raise HTTPException(
                status_code=403,
                detail=f"Plan {label}: límite de {max_wa} número{'s' if max_wa != 1 else ''} WhatsApp alcanzado. Actualiza el plan para continuar.",
            )

    cfg = models.WhatsAppConfig(
        name=f"WhatsApp de {current_user.name.split()[0]}",
        phone_number="pending",
        api_provider="qr",
        is_active=False,
        owner_user_id=current_user.id,
        group_id=current_user.group_id,
    )
    db.add(cfg)
    db.commit()
    db.refresh(cfg)

    result = await _node("POST", f"/sessions/{cfg.id}/start")
    if result.get("status") == "service_unavailable":
        db.delete(cfg)
        db.commit()
        raise HTTPException(status_code=503, detail="Servicio QR no disponible. Contacta al técnico.")

    # Reload with relationships
    db.refresh(cfg)
    return _serialize(cfg)


@router.post("/mine/{config_id}/start")
async def start_my_session(
    config_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    cfg = _get_owned_cfg(config_id, current_user, db)
    result = await _node("POST", f"/sessions/{config_id}/start")
    if result.get("status") == "service_unavailable":
        raise HTTPException(status_code=503, detail="Servicio QR no disponible")
    return result


@router.get("/mine/{config_id}/status")
async def get_my_session_status(
    config_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    cfg = _get_owned_cfg(config_id, current_user, db)
    node_status = await _node("GET", f"/sessions/{config_id}/status")
    return {**node_status, "config": _serialize(cfg)}


@router.get("/mine/{config_id}/qr")
async def get_my_session_qr(
    config_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _get_owned_cfg(config_id, current_user, db)
    data = await _node("GET", f"/sessions/{config_id}/qr")
    if data.get("status") == "service_unavailable":
        raise HTTPException(status_code=503, detail="Servicio QR no disponible")
    return data


@router.patch("/mine/{config_id}/rename")
async def rename_my_session(
    config_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    cfg = _get_owned_cfg(config_id, current_user, db)
    name = (body.get("name") or "").strip()
    if name:
        cfg.name = name
        db.commit()
    return _serialize(cfg)


@router.delete("/mine/{config_id}")
async def delete_my_session(
    config_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    cfg = _get_owned_cfg(config_id, current_user, db)
    await _node("DELETE", f"/sessions/{config_id}")
    # Delete all messages from this config so conversations disappear from the inbox
    db.query(models.WhatsAppMessage).filter(
        models.WhatsAppMessage.whatsapp_config_id == config_id
    ).delete(synchronize_session=False)
    db.delete(cfg)
    db.commit()
    return {"ok": True}


# ── Admin management ──────────────────────────────────────────────────────────

@router.get("/admin/all")
async def admin_list_all_sessions(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Admins see all QR sessions with owner info and live status."""
    if current_user.role not in ("superadmin", "subadmin", "tecnico"):
        raise HTTPException(status_code=403, detail="Solo administradores")

    cfgs = db.query(models.WhatsAppConfig).options(
        joinedload(models.WhatsAppConfig.group),
        joinedload(models.WhatsAppConfig.owner),
        joinedload(models.WhatsAppConfig.areas),
    ).filter(
        models.WhatsAppConfig.api_provider == "qr"
    ).order_by(models.WhatsAppConfig.owner_user_id, models.WhatsAppConfig.created_at).all()

    result = []
    for cfg in cfgs:
        node_status = await _node("GET", f"/sessions/{cfg.id}/status")
        entry = _serialize(cfg)
        entry["live_status"] = node_status.get("status", "unknown")
        entry["live_phone"] = node_status.get("phone")
        result.append(entry)
    return result


@router.patch("/admin/{config_id}/assign-area")
async def admin_assign_area(
    config_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Assign a QR session to an area (admin only)."""
    if current_user.role not in ("superadmin", "subadmin", "tecnico"):
        raise HTTPException(status_code=403, detail="Solo administradores")

    cfg = db.query(models.WhatsAppConfig).options(
        joinedload(models.WhatsAppConfig.areas),
    ).filter(models.WhatsAppConfig.id == config_id, models.WhatsAppConfig.api_provider == "qr").first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")

    area_ids: list[int] = body.get("area_ids", [])
    areas = db.query(models.Area).filter(models.Area.id.in_(area_ids)).all() if area_ids else []

    # Update the many-to-many phone_configs on each area
    # First remove this config from all areas that currently have it
    all_areas = db.query(models.Area).all()
    for area in all_areas:
        if cfg in area.phone_configs:
            area.phone_configs.remove(cfg)
    # Add to selected areas
    for area in areas:
        if cfg not in area.phone_configs:
            area.phone_configs.append(cfg)

    cfg.group_id = body.get("group_id", cfg.group_id)
    db.commit()
    db.refresh(cfg)
    return _serialize(cfg)


@router.patch("/admin/{config_id}/reassign-owner")
async def admin_reassign_owner(
    config_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in ("superadmin", "subadmin", "tecnico"):
        raise HTTPException(status_code=403, detail="Solo administradores")

    cfg = db.query(models.WhatsAppConfig).filter(
        models.WhatsAppConfig.id == config_id,
        models.WhatsAppConfig.api_provider == "qr"
    ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")

    new_owner_id = body.get("owner_user_id")
    cfg.owner_user_id = new_owner_id
    db.commit()
    db.refresh(cfg)
    return _serialize(cfg)


@router.delete("/admin/{config_id}")
async def admin_delete_session(
    config_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in ("superadmin", "subadmin", "tecnico"):
        raise HTTPException(status_code=403, detail="Solo administradores")

    cfg = db.query(models.WhatsAppConfig).filter(
        models.WhatsAppConfig.id == config_id,
        models.WhatsAppConfig.api_provider == "qr"
    ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")

    await _node("DELETE", f"/sessions/{config_id}")
    # Delete all messages from this config so conversations disappear from the inbox
    db.query(models.WhatsAppMessage).filter(
        models.WhatsAppMessage.whatsapp_config_id == config_id
    ).delete(synchronize_session=False)
    db.delete(cfg)
    db.commit()
    return {"ok": True}


# ── Private helpers ───────────────────────────────────────────────────────────

def _get_owned_cfg(config_id: int, current_user: models.User, db: Session) -> models.WhatsAppConfig:
    q = db.query(models.WhatsAppConfig).options(
        joinedload(models.WhatsAppConfig.group),
        joinedload(models.WhatsAppConfig.owner),
        joinedload(models.WhatsAppConfig.areas),
    ).filter(
        models.WhatsAppConfig.id == config_id,
        models.WhatsAppConfig.api_provider == "qr",
    )
    # Agendadoras/cobradores can only access their own; admins/tecnico can access any
    if current_user.role in ("agendadora", "cobrador"):
        q = q.filter(models.WhatsAppConfig.owner_user_id == current_user.id)

    cfg = q.first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")
    return cfg
