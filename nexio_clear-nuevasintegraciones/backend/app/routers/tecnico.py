"""
Tecnico panel — root-level admin for WhatsApp Meta config and Google OAuth setup.
Only accessible by users with role='tecnico'.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional, Literal
from pydantic import BaseModel, EmailStr
from ..database import get_db
from .. import models
from ..auth import require_tecnico, hash_password
from ..plans import PLAN_LIMITS, get_limits

router = APIRouter(prefix="/api/tecnico", tags=["tecnico"])


# ── Schemas (inline for isolation) ──────────────────────────

class WAConfigIn(BaseModel):
    phone_number: str
    api_provider: str = "meta"
    api_token: Optional[str] = None
    phone_number_id: Optional[str] = None

class WAConfigOut(BaseModel):
    id: int
    name: str
    phone_number: str
    api_provider: str
    phone_number_id: Optional[str]
    has_token: bool
    group_id: Optional[int]
    group_name: Optional[str]
    is_active: bool
    class Config:
        from_attributes = True

class GoogleSettingsIn(BaseModel):
    client_id: str
    client_secret: str        # send '__keep__' to preserve existing secret
    redirect_uri: str         # e.g. https://yourapp.com/api/google/callback

class GoogleSettingsOut(BaseModel):
    client_id: str
    client_secret_masked: str
    redirect_uri: str
    configured: bool


# ── Helper ─────────────────────────────────────────────────

def _wa_out(cfg: models.WhatsAppConfig) -> dict:
    return {
        "id": cfg.id,
        "name": cfg.name,
        "phone_number": cfg.phone_number,
        "api_provider": cfg.api_provider or "manual",
        "phone_number_id": cfg.phone_number_id,
        "has_token": bool(cfg.api_token),
        "group_id": cfg.group_id,
        "group_name": cfg.group.name if cfg.group else None,
        "is_active": cfg.is_active,
    }


# ── Routes ─────────────────────────────────────────────────

@router.get("/stats")
def get_stats(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_tecnico),
):
    total_users   = db.query(models.User).count()
    total_leads   = db.query(models.Lead).count()
    total_groups  = db.query(models.Group).count()
    total_wa      = db.query(models.WhatsAppConfig).count()
    meta_configs  = db.query(models.WhatsAppConfig).filter(
        models.WhatsAppConfig.api_provider == "meta",
        models.WhatsAppConfig.api_token != None,
    ).count()
    google_connected = db.query(models.GoogleCalendarToken).count()

    groups = db.query(models.Group).options(
        joinedload(models.Group.members),
        joinedload(models.Group.areas),
        joinedload(models.Group.whatsapp_configs),
    ).all()

    group_summary = []
    for g in groups:
        wa_cfgs = [c for c in g.whatsapp_configs]
        group_summary.append({
            "id": g.id,
            "name": g.name,
            "description": g.description,
            "member_count": len(g.members),
            "area_count": len(g.areas),
            "wa_count": len(wa_cfgs),
            "wa_meta_count": sum(1 for c in wa_cfgs if c.api_provider == "meta" and c.api_token),
        })

    return {
        "total_users": total_users,
        "total_leads": total_leads,
        "total_groups": total_groups,
        "total_wa_configs": total_wa,
        "meta_wa_configured": meta_configs,
        "google_connected_users": google_connected,
        "groups": group_summary,
    }


@router.get("/whatsapp")
def list_all_whatsapp(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_tecnico),
):
    cfgs = db.query(models.WhatsAppConfig).options(
        joinedload(models.WhatsAppConfig.group)
    ).order_by(models.WhatsAppConfig.group_id, models.WhatsAppConfig.id).all()
    return [_wa_out(c) for c in cfgs]


@router.post("/whatsapp")
def create_whatsapp(
    data: WAConfigIn,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_tecnico),
):
    cfg = models.WhatsAppConfig(
        name=data.phone_number,   # admin will rename later
        phone_number=data.phone_number,
        api_provider=data.api_provider,
        api_token=data.api_token,
        phone_number_id=data.phone_number_id,
        group_id=None,
    )
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return _wa_out(cfg)


@router.put("/whatsapp/{config_id}")
def update_whatsapp(
    config_id: int,
    data: WAConfigIn,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_tecnico),
):
    cfg = db.query(models.WhatsAppConfig).filter(models.WhatsAppConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Config no encontrada")
    cfg.phone_number = data.phone_number
    cfg.name = data.phone_number   # keep name in sync with phone for tecnico-managed entries
    cfg.api_provider = data.api_provider
    cfg.phone_number_id = data.phone_number_id
    if data.api_token:
        cfg.api_token = data.api_token
    db.commit()
    db.refresh(cfg)
    return _wa_out(cfg)


@router.delete("/whatsapp/{config_id}")
def delete_whatsapp(
    config_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_tecnico),
):
    cfg = db.query(models.WhatsAppConfig).filter(models.WhatsAppConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Config no encontrada")
    # Delete all messages from this config so conversations disappear from the inbox
    db.query(models.WhatsAppMessage).filter(
        models.WhatsAppMessage.whatsapp_config_id == config_id
    ).delete(synchronize_session=False)
    db.delete(cfg)
    db.commit()
    return {"ok": True}


@router.patch("/whatsapp/{config_id}/toggle")
def toggle_whatsapp(
    config_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_tecnico),
):
    cfg = db.query(models.WhatsAppConfig).filter(models.WhatsAppConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Config no encontrada")
    cfg.is_active = not cfg.is_active
    db.commit()
    return {"id": cfg.id, "is_active": cfg.is_active}


# ── Google OAuth Settings ───────────────────────────────────

@router.get("/google-settings")
def get_google_settings(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_tecnico),
):
    client_id  = _get_setting(db, "google_client_id")
    secret     = _get_setting(db, "google_client_secret")
    redir      = _get_setting(db, "google_redirect_uri")
    configured = bool(client_id and secret)
    return {
        "client_id": client_id or "",
        "client_secret_masked": ("*" * 8 + secret[-4:]) if secret and len(secret) > 4 else ("*" * len(secret) if secret else ""),
        "redirect_uri": redir or "",
        "configured": configured,
    }


@router.put("/google-settings")
def update_google_settings(
    data: GoogleSettingsIn,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_tecnico),
):
    _set_setting(db, "google_client_id", data.client_id)
    if data.client_secret != "__keep__":
        _set_setting(db, "google_client_secret", data.client_secret)
    _set_setting(db, "google_redirect_uri", data.redirect_uri)
    return {"ok": True, "configured": True}


@router.get("/users")
def list_all_users(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_tecnico),
):
    users = db.query(models.User).options(joinedload(models.User.group)).all()
    google_tokens = {t.user_id: t for t in db.query(models.GoogleCalendarToken).all()}
    return [
        {
            "id": u.id,
            "name": u.name,
            "email": u.email,
            "role": u.role,
            "group_id": u.group_id,
            "group_name": u.group.name if u.group else None,
            "is_active": u.is_active,
            "google_connected": u.id in google_tokens,
            "google_email": google_tokens[u.id].google_email if u.id in google_tokens else None,
        }
        for u in users
    ]


# ── Internal helpers ────────────────────────────────────────

def _get_setting(db: Session, key: str) -> str | None:
    s = db.query(models.AppSetting).filter(models.AppSetting.key == key).first()
    return s.value if s else None


def _set_setting(db: Session, key: str, value: str):
    s = db.query(models.AppSetting).filter(models.AppSetting.key == key).first()
    if s:
        s.value = value
    else:
        s = models.AppSetting(key=key, value=value)
        db.add(s)
    db.commit()


# ── Negocios (Group + superadmin atomic creation) ───────────

NEGOCIO_TIPOS = Literal["abogados", "inmobiliaria", "restaurant", "clinica", "otro"]

class NegocioIn(BaseModel):
    business_name: str
    description: Optional[str] = None
    tipo: NEGOCIO_TIPOS = "abogados"
    admin_name: str
    admin_email: EmailStr
    admin_password: str


def _negocio_out(group: models.Group, superadmin, ai_agent_count: int) -> dict:
    return {
        "id": group.id,
        "name": group.name,
        "description": group.description,
        "admin": {
            "id": superadmin.id,
            "name": superadmin.name,
            "email": superadmin.email,
            "is_active": superadmin.is_active,
        } if superadmin else None,
        "member_count": len(group.members) if hasattr(group, "members") else 0,
        "wa_count": len(group.whatsapp_configs) if hasattr(group, "whatsapp_configs") else 0,
        "ai_agent_count": ai_agent_count,
    }


@router.get("/negocios")
def list_negocios(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_tecnico),
):
    # Negocios are groups that have a superadmin member
    negocio_groups = (
        db.query(models.Group)
        .options(
            joinedload(models.Group.members),
            joinedload(models.Group.whatsapp_configs),
        )
        .filter(models.Group.negocio_id == None)  # top-level groups only
        .order_by(models.Group.id)
        .all()
    )
    result = []
    for g in negocio_groups:
        superadmin = next((m for m in g.members if m.role == "superadmin"), None)
        if superadmin is None:
            continue  # regular group, not a negocio root

        # Collect all group IDs: the negocio group itself + all its sub-groups
        all_group_ids = [g.id] + [
            sg.id for sg in db.query(models.Group).filter(models.Group.negocio_id == g.id).all()
        ]

        member_count = db.query(models.User).filter(models.User.group_id.in_(all_group_ids)).count()
        wa_count     = db.query(models.WhatsAppConfig).filter(models.WhatsAppConfig.group_id.in_(all_group_ids)).count()
        ai_count     = db.query(models.AIAgent).filter(models.AIAgent.group_id.in_(all_group_ids)).count()

        plan = g.plan or "basico"
        result.append({
            "id": g.id,
            "name": g.name,
            "description": g.description,
            "tipo": g.tipo or "abogados",
            "plan": plan,
            "plan_limits": get_limits(plan),
            "plan_expires_at": g.plan_expires_at.isoformat() if g.plan_expires_at else None,
            "admin": {
                "id": superadmin.id,
                "name": superadmin.name,
                "email": superadmin.email,
                "is_active": superadmin.is_active,
            } if superadmin else None,
            "member_count": member_count,
            "wa_count": wa_count,
            "ai_agent_count": ai_count,
            "sub_group_count": len(all_group_ids) - 1,
            "all_group_ids": all_group_ids,
        })
    return result


@router.post("/negocios", status_code=201)
def create_negocio(
    data: NegocioIn,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_tecnico),
):
    if db.query(models.User).filter(models.User.email == data.admin_email).first():
        raise HTTPException(status_code=409, detail="Ya existe un usuario con ese correo electrónico")
    if db.query(models.Group).filter(models.Group.name == data.business_name).first():
        raise HTTPException(status_code=409, detail="Ya existe un negocio con ese nombre")

    group = models.Group(name=data.business_name, description=data.description, tipo=data.tipo)
    db.add(group)
    db.flush()

    user = models.User(
        name=data.admin_name,
        email=data.admin_email,
        password_hash=hash_password(data.admin_password),
        role="superadmin",
        group_id=group.id,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(group)
    db.refresh(user)

    return {
        "id": group.id,
        "name": group.name,
        "description": group.description,
        "tipo": group.tipo,
        "plan": group.plan or "basico",
        "plan_limits": get_limits(group.plan or "basico"),
        "plan_expires_at": None,
        "admin": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "is_active": user.is_active,
        },
        "member_count": 1,
        "wa_count": 0,
        "ai_agent_count": 0,
        "sub_group_count": 0,
    }


class NegocioPatch(BaseModel):
    tipo: Optional[NEGOCIO_TIPOS] = None
    name: Optional[str] = None
    description: Optional[str] = None


@router.patch("/negocios/{negocio_id}")
def patch_negocio(
    negocio_id: int,
    data: NegocioPatch,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_tecnico),
):
    group = db.query(models.Group).filter(models.Group.id == negocio_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Negocio no encontrado")
    if data.tipo is not None:
        group.tipo = data.tipo
    if data.name is not None:
        group.name = data.name
    if data.description is not None:
        group.description = data.description
    db.commit()
    db.refresh(group)
    return {"id": group.id, "name": group.name, "description": group.description, "tipo": group.tipo}


@router.delete("/negocios/{negocio_id}", status_code=204)
def delete_negocio(
    negocio_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_tecnico),
):
    group = db.query(models.Group).filter(
        models.Group.id == negocio_id,
        models.Group.negocio_id == None,
    ).first()
    if not group:
        raise HTTPException(status_code=404, detail="Negocio no encontrado")
    db.delete(group)
    db.commit()


class NegocioAdminPatch(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None


@router.patch("/negocios/{negocio_id}/admin")
def patch_negocio_admin(
    negocio_id: int,
    data: NegocioAdminPatch,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_tecnico),
):
    admin = db.query(models.User).filter(
        models.User.group_id == negocio_id,
        models.User.role == "superadmin",
    ).first()
    if not admin:
        raise HTTPException(status_code=404, detail="Administrador no encontrado")
    if data.name is not None:
        admin.name = data.name
    if data.email is not None:
        existing = db.query(models.User).filter(models.User.email == data.email, models.User.id != admin.id).first()
        if existing:
            raise HTTPException(status_code=409, detail="Ya existe un usuario con ese correo")
        admin.email = data.email
    if data.password is not None:
        if len(data.password) < 8:
            raise HTTPException(status_code=422, detail="La contraseña debe tener al menos 8 caracteres")
        from ..auth import get_password_hash
        admin.hashed_password = get_password_hash(data.password)
    if data.is_active is not None:
        admin.is_active = data.is_active
    db.commit()
    return {"id": admin.id, "name": admin.name, "email": admin.email, "is_active": admin.is_active}


class NegocioPlanPatch(BaseModel):
    plan: Literal["basico", "pro", "enterprise"]
    plan_expires_at: Optional[str] = None  # ISO date string, None = no expiry


@router.patch("/negocios/{negocio_id}/plan")
def patch_negocio_plan(
    negocio_id: int,
    data: NegocioPlanPatch,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_tecnico),
):
    from datetime import datetime
    group = db.query(models.Group).filter(
        models.Group.id == negocio_id,
        models.Group.negocio_id == None,
    ).first()
    if not group:
        raise HTTPException(status_code=404, detail="Negocio no encontrado")
    group.plan = data.plan
    if data.plan_expires_at:
        try:
            group.plan_expires_at = datetime.fromisoformat(data.plan_expires_at)
        except ValueError:
            raise HTTPException(status_code=422, detail="Fecha de expiración inválida")
    else:
        group.plan_expires_at = None
    db.commit()
    return {
        "id": group.id,
        "plan": group.plan,
        "plan_limits": get_limits(group.plan),
        "plan_expires_at": group.plan_expires_at.isoformat() if group.plan_expires_at else None,
    }
