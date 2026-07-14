import logging
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List, Optional
from ..database import get_db
from .. import models, schemas
from ..auth import get_current_user, hash_password, require_roles, get_visible_group_ids, validate_password_strength
from ..plans import enforce_limit, _get_negocio
from ..security import log_event

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/users", tags=["users"])


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/clear-dashboard")
def clear_dashboard(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    from datetime import datetime, timezone
    current_user.dashboard_clear_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}


@router.get("", response_model=List[schemas.UserOut])
def list_users(
    group_id: Optional[int] = None,
    role: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    q = db.query(models.User).filter(models.User.is_active == True)
    if current_user.role != "tecnico":
        q = q.filter(models.User.role != "tecnico")
    gids = get_visible_group_ids(db, current_user)
    if gids is not None:
        if current_user.role in ("superadmin", "subadmin"):
            q = q.filter(
                (models.User.group_id.in_(gids)) | (models.User.group_id.is_(None))
            )
        else:
            q = q.filter(models.User.group_id.in_(gids))
    if group_id:
        q = q.filter(models.User.group_id == group_id)
    if role:
        q = q.filter(models.User.role == role)
    return q.order_by(models.User.name).all()


@router.post("", response_model=schemas.UserOut)
def create_user(
    request: Request,
    data: schemas.UserCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin"))
):
    existing = db.query(models.User).filter(models.User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email ya registrado")

    validate_password_strength(data.password)

    target_group_id = data.group_id or current_user.group_id
    negocio = _get_negocio(db, target_group_id)
    if negocio:
        from ..auth import get_visible_group_ids as _gvgi
        all_group_ids_q = db.query(models.Group.id).filter(
            (models.Group.id == negocio.id) | (models.Group.negocio_id == negocio.id)
        ).subquery()
        current_count = db.query(models.User).filter(
            models.User.group_id.in_(all_group_ids_q),
            models.User.is_active == True,
            models.User.role != "tecnico",
        ).count()
        enforce_limit(db, target_group_id, "max_users", current_count)

    user = models.User(
        name=data.name,
        email=data.email,
        password_hash=hash_password(data.password),
        role=data.role,
        group_id=data.group_id,
        whatsapp_number=data.whatsapp_number
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    log_event(db, "user_created", user_id=current_user.id, actor_email=current_user.email,
              resource_type="user", resource_id=user.id,
              ip=_ip(request), details=f"Creado: {data.email} rol={data.role}")
    return user


@router.get("/{user_id}", response_model=schemas.UserOut)
def get_user(user_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return user


@router.put("/{user_id}", response_model=schemas.UserOut)
def update_user(
    user_id: int,
    request: Request,
    data: schemas.UserUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin"))
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    changes = []
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "password" and value:
            validate_password_strength(value)
            setattr(user, "password_hash", hash_password(value))
            changes.append("password_changed")
        elif field != "password":
            setattr(user, field, value)
            changes.append(field)
    db.commit()
    db.refresh(user)
    log_event(db, "user_updated", user_id=current_user.id, actor_email=current_user.email,
              resource_type="user", resource_id=user_id,
              ip=_ip(request), details=f"Campos: {', '.join(changes)}")
    return user


@router.patch("/{user_id}/cobrador-area")
def set_cobrador_area(
    user_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin"))
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if user.role != "cobrador":
        raise HTTPException(status_code=400, detail="Solo se puede asignar área a cobradores")

    # Áreas afectadas = unión de las que tenía + las nuevas (para reasignar y soltar)
    def _split_areas(val):
        return [a.strip() for a in (val or "").split(",") if a.strip()]
    old_areas = _split_areas(user.cobrador_area)
    new_areas = _split_areas(data.get("cobrador_area"))

    user.cobrador_area = data.get("cobrador_area") or None
    db.flush()

    # 1) Trae al toque los morosos del contable (por si hay nuevos de esta área).
    #    Best-effort: si el contable falla, la asignación igual se guarda.
    from .cobrador import _build_area_cobrador_map, sync_pendiente_morosos, sync_morosos
    pulled = {"created": 0, "updated": 0}
    try:
        r1 = sync_pendiente_morosos(db)
        r2 = sync_morosos(db)
        pulled = {
            "created": (r1.get("created", 0) + r2.get("created", 0)),
            "updated": (r1.get("updated", 0) + r2.get("updated", 0)),
        }
    except Exception as e:
        logger.warning("[cobrador-area] sync contable falló (se ignora): %s", e)

    # 2) Re-vincula los morosos existentes de cada área afectada al cobrador que
    #    ahora la posee (o los suelta si ninguna la cubre). Hace el cambio instantáneo.
    area_map = _build_area_cobrador_map(db)
    moved = 0
    for area_name in set(old_areas) | set(new_areas):
        owner = area_map.get(area_name.strip().upper())
        owner_id = owner.id if owner else None
        moved += (
            db.query(models.CobradorLead)
            .filter(func.upper(func.trim(models.CobradorLead.empresa)) == area_name.strip().upper())
            .update({models.CobradorLead.cobrador_id: owner_id}, synchronize_session=False)
        )

    db.commit()

    # Notifica a los paneles abiertos para que refresquen sin recargar
    if moved or pulled["created"] or pulled["updated"]:
        try:
            from ..broadcaster import wa_broadcaster
            wa_broadcaster.broadcast_sync("cobrador_sync", {"created": pulled["created"], "updated": pulled["updated"] + moved})
        except Exception:
            pass

    return {"ok": True, "cobrador_area": user.cobrador_area, "leads_reasignados": moved, **pulled}


@router.get("/cobradores/carteras")
def get_cobrador_carteras(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin"))
):
    """Return all cobrador users with their leads count and deuda totals."""
    cobradores = db.query(models.User).filter(
        models.User.role == "cobrador",
        models.User.is_active == True,
    ).all()
    result = []
    for c in cobradores:
        q = db.query(models.CobradorLead).filter(models.CobradorLead.cobrador_id == c.id)
        if c.cobrador_area:
            assigned_areas = [a.strip() for a in c.cobrador_area.split(',') if a.strip()]
            if assigned_areas:
                q = q.filter(models.CobradorLead.empresa.in_(assigned_areas))
        leads = q.all()
        result.append({
            "id": c.id,
            "name": c.name,
            "email": c.email,
            "cobrador_area": c.cobrador_area,
            "total_leads": len(leads),
            "total_deuda": sum(l.monto_deuda for l in leads),
            # Cobrado = solo clientes con deuda saldada (etapa pagado); abonos parciales no cuentan
            "total_cobrado": sum(l.monto_pagado for l in leads if l.stage == "pagado"),
            "leads": [
                {
                    "id": l.id, "nombre": l.nombre, "empresa": l.empresa,
                    "monto_deuda": l.monto_deuda, "monto_pagado": l.monto_pagado,
                    "stage": l.stage, "telefono": l.telefono,
                }
                for l in leads
            ],
        })
    return result


@router.delete("/cobradores/leads/{lead_id}")
def delete_cobrador_lead(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin"))
):
    lead = db.query(models.CobradorLead).filter(models.CobradorLead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="No encontrado")
    db.delete(lead)
    db.commit()
    return {"ok": True}


@router.delete("/{user_id}")
def delete_user(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin"))
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    user.is_active = False
    db.commit()
    log_event(db, "user_deactivated", user_id=current_user.id, actor_email=current_user.email,
              resource_type="user", resource_id=user_id,
              ip=_ip(request), details=f"Desactivado: {user.email}", severity="warning")
    return {"ok": True}
