"""ISO 27001 A.12.4.1 — security audit log API."""
from datetime import datetime, timedelta, timezone
from typing import Optional


def _ts(dt: datetime | None) -> str | None:
    """Return ISO-8601 string always tagged as UTC so JS converts to local time."""
    if dt is None:
        return None
    s = dt.isoformat()
    if '+' not in s and not s.endswith('Z'):
        s += 'Z'
    return s
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from ..database import get_db
from .. import models
from ..auth import require_roles, get_visible_group_ids

router = APIRouter(prefix="/api/security", tags=["security"])




def _business_name(db: Session, user: models.User) -> str | None:
    group = user.group
    if not group:
        return None
    if not group.negocio_id:
        return group.name
    root = db.query(models.Group).filter(models.Group.id == group.negocio_id).first()
    return root.name if root else group.name

def _negocio_user_ids(db: Session, current_user: models.User) -> list[int] | None:
    """Returns user IDs visible to this user, or None for tecnico (unrestricted)."""
    if current_user.role == "tecnico":
        return None
    gids = get_visible_group_ids(db, current_user)
    if gids is None:
        return None
    rows = db.query(models.User.id).filter(models.User.group_id.in_(gids)).all()
    return [r[0] for r in rows]


@router.get("/audit-log")
def audit_log(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    action: Optional[str] = None,
    severity: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "tecnico")),
):
    q = db.query(models.SecurityAuditLog)

    # Superadmin sees only their negocio's events; tecnico sees all
    user_ids = _negocio_user_ids(db, current_user)
    if user_ids is not None:
        q = q.filter(models.SecurityAuditLog.user_id.in_(user_ids))

    if action:
        q = q.filter(models.SecurityAuditLog.action == action)
    if severity:
        q = q.filter(models.SecurityAuditLog.severity == severity)

    total = q.count()
    items = (
        q.order_by(models.SecurityAuditLog.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
        "items": [
            {
                "id": e.id,
                "action": e.action,
                "actor_email": e.actor_email,
                "resource_type": e.resource_type,
                "resource_id": e.resource_id,
                "ip_address": e.ip_address,
                "severity": e.severity,
                "details": e.details,
                "created_at": _ts(e.created_at),
            }
            for e in items
        ],
    }


@router.get("/stats")
def security_stats(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "tecnico")),
):
    now = datetime.now(timezone.utc)
    since_24h = now - timedelta(hours=24)

    user_ids = _negocio_user_ids(db, current_user)

    def _scoped(base_q):
        if user_ids is not None:
            return base_q.filter(models.SecurityAuditLog.user_id.in_(user_ids))
        return base_q

    failed_24h = _scoped(
        db.query(models.SecurityAuditLog).filter(
            models.SecurityAuditLog.action == "login_failed",
            models.SecurityAuditLog.created_at >= since_24h,
        )
    ).count()

    blocked_q = db.query(models.User).filter(models.User.locked_until > now)
    if user_ids is not None:
        blocked_q = blocked_q.filter(models.User.id.in_(user_ids))
    blocked_accounts = blocked_q.count()

    critical_24h = _scoped(
        db.query(models.SecurityAuditLog).filter(
            models.SecurityAuditLog.severity == "critical",
            models.SecurityAuditLog.created_at >= since_24h,
        )
    ).count()

    total_events = _scoped(db.query(models.SecurityAuditLog)).count()

    return {
        "failed_logins_24h": failed_24h,
        "blocked_accounts": blocked_accounts,
        "critical_events_24h": critical_24h,
        "total_events": total_events,
    }


@router.get("/locked-users")
def locked_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "tecnico")),
):
    now = datetime.now(timezone.utc)
    q = db.query(models.User).filter(
        models.User.locked_until > now,
        models.User.is_active == True,
    )
    user_ids = _negocio_user_ids(db, current_user)
    if user_ids is not None:
        q = q.filter(models.User.id.in_(user_ids))
    users = q.order_by(models.User.locked_until.asc()).all()
    return [
        {
            "id": u.id,
            "name": u.name,
            "email": u.email,
            "role": u.role,
            "group_id": u.group_id,
            "group_name": u.group.name if u.group else None,
            "negocio_name": _business_name(db, u),
            "failed_attempts": u.failed_login_attempts,
            "locked_until": _ts(u.locked_until),
        }
        for u in users
    ]


@router.post("/unlock/{user_id}")
def unlock_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "tecnico")),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    # Superadmin can only unlock users in their negocio
    user_ids = _negocio_user_ids(db, current_user)
    if user_ids is not None and user.id not in user_ids:
        raise HTTPException(status_code=403, detail="Acceso denegado")

    user.locked_until = None
    user.failed_login_attempts = 0
    db.commit()

    from ..security import log_event
    log_event(db, "account_unlocked", user_id=current_user.id, actor_email=current_user.email,
              resource_type="user", resource_id=user_id,
              details=f"Desbloqueado por {current_user.email}", severity="info")
    return {"ok": True}
