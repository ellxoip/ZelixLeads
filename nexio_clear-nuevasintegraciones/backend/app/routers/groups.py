from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload
from typing import List
from ..database import get_db
from .. import models, schemas
from ..auth import get_current_user, require_roles, get_visible_group_ids

router = APIRouter(prefix="/api/groups", tags=["groups"])


@router.get("", response_model=List[schemas.GroupOut])
def list_groups(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    gids = get_visible_group_ids(db, current_user)
    # Only return sub-groups (negocio_id IS NOT NULL); negocios are root entities, not grupos
    q = db.query(models.Group).filter(models.Group.negocio_id.isnot(None))
    if gids is not None:
        q = q.filter(models.Group.id.in_(gids))
    return q.all()


@router.post("", response_model=schemas.GroupOut)
def create_group(
    data: schemas.GroupCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin"))
):
    # Attach new group as a sub-group of the superadmin's negocio
    negocio_id = None
    if current_user.group_id:
        ug = db.query(models.Group).filter(models.Group.id == current_user.group_id).first()
        if ug:
            negocio_id = ug.negocio_id if ug.negocio_id else ug.id
    group = models.Group(name=data.name, description=data.description, negocio_id=negocio_id)
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


@router.put("/{group_id}", response_model=schemas.GroupOut)
def update_group(
    group_id: int,
    data: schemas.GroupUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin"))
):
    group = db.query(models.Group).filter(models.Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Grupo no encontrado")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(group, field, value)
    db.commit()
    db.refresh(group)
    return group


@router.delete("/{group_id}")
def delete_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin"))
):
    group = db.query(models.Group).filter(models.Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Grupo no encontrado")

    blockers = []

    sub_groups = db.query(models.Group).filter(models.Group.negocio_id == group_id).count()
    if sub_groups:
        blockers.append(f"{sub_groups} sub-grupo(s)")

    users = db.query(models.User).filter(models.User.group_id == group_id).count()
    if users:
        blockers.append(f"{users} usuario(s)")

    areas = db.query(models.Area).filter(models.Area.group_id == group_id).count()
    if areas:
        blockers.append(f"{areas} área(s)")

    leads = db.query(models.Lead).filter(models.Lead.group_id == group_id).count()
    if leads:
        blockers.append(f"{leads} lead(s)")

    wconfigs = db.query(models.WhatsAppConfig).filter(models.WhatsAppConfig.group_id == group_id).count()
    if wconfigs:
        blockers.append(f"{wconfigs} config(s) de WhatsApp")

    agents = db.query(models.AIAgent).filter(models.AIAgent.group_id == group_id).count()
    if agents:
        blockers.append(f"{agents} agente(s) IA")

    if blockers:
        raise HTTPException(
            status_code=409,
            detail=f"No se puede eliminar el grupo porque tiene: {', '.join(blockers)}. Reasigná o eliminá estos registros primero."
        )

    db.delete(group)
    db.commit()
    return {"ok": True}


# ── DEFAULT ASSIGNMENT ───────────────────────────────────
@router.get("/{group_id}/default-assignment")
def get_default_assignment(
    group_id: int,
    area_id: int = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Return suggested agendadora and vendedor for lead creation.
    If area_id provided and that area has assigned users, picks from them (round-robin by least leads).
    Falls back to all group users if the area has no assignments.
    """
    from sqlalchemy import func as sqlfunc

    def _least_loaded(users: list, role: str):
        """From a list of users, pick the one with fewest active leads (round-robin by load)."""
        candidates = [u for u in users if u.role == role and u.is_active]
        if not candidates:
            return None
        # Count active leads per candidate
        counts = {u.id: 0 for u in candidates}
        rows = (
            db.query(models.Lead.agendadora_id if role == "agendadora" else models.Lead.vendedor_id,
                     sqlfunc.count())
            .filter(
                (models.Lead.agendadora_id if role == "agendadora" else models.Lead.vendedor_id).in_(counts.keys()),
                models.Lead.current_stage.notin_(["pagado_confirmado"]),
            )
            .group_by(models.Lead.agendadora_id if role == "agendadora" else models.Lead.vendedor_id)
            .all()
        )
        for uid, cnt in rows:
            if uid in counts:
                counts[uid] = cnt
        return min(candidates, key=lambda u: counts[u.id])

    # Try area-specific users first
    if area_id:
        area = (
            db.query(models.Area)
            .options(joinedload(models.Area.users))
            .filter(models.Area.id == area_id)
            .first()
        )
        if area and area.users:
            agendadora = _least_loaded(area.users, "agendadora")
            vendedor   = _least_loaded(area.users, "vendedor")
            return {
                "agendadora": {"id": agendadora.id, "name": agendadora.name} if agendadora else None,
                "vendedor":   {"id": vendedor.id,   "name": vendedor.name}   if vendedor   else None,
            }

    # Fallback: all group users (primary group_id OR in group_users M2M)
    from ..models import group_users as group_users_table
    m2m_rows = db.execute(
        group_users_table.select().where(group_users_table.c.group_id == group_id)
    ).fetchall()
    m2m_user_ids = [row[1] for row in m2m_rows]
    membership_filter = (
        or_(models.User.group_id == group_id, models.User.id.in_(m2m_user_ids))
        if m2m_user_ids
        else (models.User.group_id == group_id)
    )
    group_members = db.query(models.User).filter(
        models.User.is_active == True,
        membership_filter,
    ).all()
    agendadora = _least_loaded(group_members, "agendadora")
    vendedor   = _least_loaded(group_members, "vendedor")
    return {
        "agendadora": {"id": agendadora.id, "name": agendadora.name} if agendadora else None,
        "vendedor":   {"id": vendedor.id,   "name": vendedor.name}   if vendedor   else None,
    }


# ── GROUP ↔ USER MEMBERSHIP (M2M) ────────────────────────
@router.get("/{group_id}/members", response_model=List[schemas.UserOut])
def list_group_members(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    group = (
        db.query(models.Group)
        .options(joinedload(models.Group.member_users))
        .filter(models.Group.id == group_id)
        .first()
    )
    if not group:
        raise HTTPException(status_code=404, detail="Grupo no encontrado")
    # Merge M2M members with users whose primary group_id matches
    primary_users = db.query(models.User).filter(
        models.User.group_id == group_id,
        models.User.is_active == True,
    ).all()
    merged = {u.id: u for u in group.member_users if u.is_active}
    for u in primary_users:
        merged.setdefault(u.id, u)
    return list(merged.values())


@router.post("/{group_id}/members/{user_id}")
def assign_user_to_group(
    group_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin"))
):
    group = (
        db.query(models.Group)
        .options(joinedload(models.Group.member_users))
        .filter(models.Group.id == group_id)
        .first()
    )
    if not group:
        raise HTTPException(status_code=404, detail="Grupo no encontrado")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if user not in group.member_users:
        group.member_users.append(user)
        db.commit()
    return {"ok": True, "group_id": group_id, "user_id": user_id}


@router.delete("/{group_id}/members/{user_id}")
def remove_user_from_group(
    group_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin"))
):
    group = (
        db.query(models.Group)
        .options(joinedload(models.Group.member_users))
        .filter(models.Group.id == group_id)
        .first()
    )
    if not group:
        raise HTTPException(status_code=404, detail="Grupo no encontrado")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user and user in group.member_users:
        group.member_users.remove(user)
        db.commit()
    return {"ok": True}


# ── AREAS ────────────────────────────────────────────────
@router.get("/all-areas", response_model=List[schemas.AreaOut])
def list_all_areas(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """Return unique area names visible to this user (for dropdowns). Deduplicates by name."""
    from ..auth import get_visible_group_ids
    gids = get_visible_group_ids(db, current_user)
    q = db.query(models.Area).options(joinedload(models.Area.users)).filter(models.Area.is_active == True)
    if gids is not None:
        q = q.filter(models.Area.group_id.in_(gids))
    areas = q.order_by(models.Area.name).all()
    seen: set = set()
    unique: list = []
    for a in areas:
        if a.name not in seen:
            seen.add(a.name)
            unique.append(a)
    return unique


@router.get("/{group_id}/areas", response_model=List[schemas.AreaOut])
def list_areas(group_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    group = db.query(models.Group).filter(models.Group.id == group_id).first()
    target_ids = [group_id]
    if group and group.negocio_id:
        target_ids.append(group.negocio_id)
    return (
        db.query(models.Area)
        .options(joinedload(models.Area.phone_configs), joinedload(models.Area.users))
        .filter(models.Area.group_id.in_(target_ids), models.Area.is_active == True)
        .order_by(models.Area.name)
        .all()
    )


@router.post("/{group_id}/areas", response_model=schemas.AreaOut)
def create_area(
    group_id: int,
    data: schemas.AreaCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin"))
):
    config_ids = list(data.whatsapp_config_ids)
    if data.whatsapp_config_id and data.whatsapp_config_id not in config_ids:
        config_ids.insert(0, data.whatsapp_config_id)

    payload = data.model_dump(exclude={"whatsapp_config_ids"})
    payload["group_id"] = group_id
    payload["whatsapp_config_id"] = config_ids[0] if config_ids else None
    area = models.Area(**payload)
    db.add(area)
    db.flush()

    for wid in config_ids:
        wc = db.query(models.WhatsAppConfig).filter(models.WhatsAppConfig.id == wid).first()
        if wc and wc not in area.phone_configs:
            area.phone_configs.append(wc)

    db.commit()
    db.refresh(area)
    return area


@router.put("/areas/{area_id}", response_model=schemas.AreaOut)
def update_area(
    area_id: int,
    data: schemas.AreaUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin"))
):
    area = db.query(models.Area).filter(models.Area.id == area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="Área no encontrada")

    fields = data.model_dump(exclude_unset=True, exclude={"whatsapp_config_ids"})
    for field, value in fields.items():
        setattr(area, field, value)

    if data.whatsapp_config_ids is not None:
        config_ids = list(data.whatsapp_config_ids)
        if data.whatsapp_config_id and data.whatsapp_config_id not in config_ids:
            config_ids.insert(0, data.whatsapp_config_id)

        area.phone_configs.clear()
        for wid in config_ids:
            wc = db.query(models.WhatsAppConfig).filter(models.WhatsAppConfig.id == wid).first()
            if wc:
                area.phone_configs.append(wc)
        area.whatsapp_config_id = config_ids[0] if config_ids else None

    db.commit()
    db.refresh(area)
    return area


@router.delete("/areas/{area_id}")
def delete_area(
    area_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin"))
):
    area = db.query(models.Area).filter(models.Area.id == area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="Área no encontrada")
    db.delete(area)
    db.commit()
    return {"ok": True}


# ── AREA ↔ USER ASSIGNMENT ───────────────────────────────
@router.post("/areas/{area_id}/users/{user_id}")
def assign_user_to_area(
    area_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin", "tecnico"))
):
    """Assign an agendadora/vendedor to an area (many-to-many)."""
    area = db.query(models.Area).options(joinedload(models.Area.users)).filter(models.Area.id == area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="Área no encontrada")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if user.role not in ("agendadora", "vendedor", "subadmin", "superadmin", "verificador"):
        raise HTTPException(status_code=400, detail="Solo se pueden asignar agendadoras y vendedores a áreas")
    if user not in area.users:
        area.users.append(user)
        db.commit()
    return {"ok": True, "area_id": area_id, "user_id": user_id}


@router.delete("/areas/{area_id}/users/{user_id}")
def remove_user_from_area(
    area_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin", "tecnico"))
):
    """Remove a user from an area."""
    area = db.query(models.Area).options(joinedload(models.Area.users)).filter(models.Area.id == area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="Área no encontrada")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user and user in area.users:
        area.users.remove(user)
        db.commit()
    return {"ok": True}


# ── WHATSAPP CONFIGS ─────────────────────────────────────
@router.get("/{group_id}/whatsapp", response_model=List[schemas.WhatsAppConfigOut])
def list_whatsapp(group_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    return db.query(models.WhatsAppConfig).filter(models.WhatsAppConfig.group_id == group_id).all()


@router.post("/{group_id}/whatsapp", response_model=schemas.WhatsAppConfigOut)
def create_whatsapp(
    group_id: int,
    data: schemas.WhatsAppConfigCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin"))
):
    data.group_id = group_id
    config = models.WhatsAppConfig(**data.model_dump())
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


@router.put("/whatsapp/{config_id}", response_model=schemas.WhatsAppConfigOut)
def update_whatsapp(
    config_id: int,
    data: schemas.WhatsAppConfigUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin"))
):
    config = db.query(models.WhatsAppConfig).filter(models.WhatsAppConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Config no encontrada")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(config, field, value)
    db.commit()
    db.refresh(config)
    return config


@router.delete("/whatsapp/{config_id}")
def delete_whatsapp(
    config_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin"))
):
    config = db.query(models.WhatsAppConfig).filter(models.WhatsAppConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Config no encontrada")
    db.delete(config)
    db.commit()
    return {"ok": True}
