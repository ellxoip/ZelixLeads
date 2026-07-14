"""ISO 27001 A.12.4.1 — centralized security event logging."""
from sqlalchemy.orm import Session
from . import models


def log_event(
    db: Session,
    action: str,
    *,
    user_id: int | None = None,
    actor_email: str | None = None,
    resource_type: str | None = None,
    resource_id: int | None = None,
    ip: str | None = None,
    ua: str | None = None,
    details: str | None = None,
    severity: str = "info",
) -> None:
    try:
        entry = models.SecurityAuditLog(
            user_id=user_id,
            actor_email=actor_email,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            ip_address=ip,
            user_agent=ua[:500] if ua else None,
            details=details,
            severity=severity,
        )
        db.add(entry)
        db.commit()
    except Exception:
        db.rollback()
