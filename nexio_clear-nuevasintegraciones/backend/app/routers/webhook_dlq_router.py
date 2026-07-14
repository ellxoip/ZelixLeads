"""
Admin de la Dead Letter Queue de webhooks entrantes.

  GET  /api/webhooks/dlq            → lista eventos (filtrable por status)
  GET  /api/webhooks/dlq/stats      → conteo por status (monitoreo)
  POST /api/webhooks/dlq/{id}/retry → reprocesa un evento manualmente

Solo superadmin/subadmin. Ver app/utils/webhook_dlq.py.
"""
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..auth import require_roles
from ..utils import webhook_dlq

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/webhooks/dlq", tags=["webhooks-dlq"])


def _serialize(ev: models.WebhookInbox) -> dict:
    return {
        "id": ev.id,
        "source": ev.source,
        "event_type": ev.event_type,
        "status": ev.status,
        "attempts": ev.attempts,
        "max_attempts": ev.max_attempts,
        "last_error": ev.last_error,
        "request_id": ev.request_id,
        "next_retry_at": ev.next_retry_at.isoformat() if ev.next_retry_at else None,
        "created_at": ev.created_at.isoformat() if ev.created_at else None,
        "updated_at": ev.updated_at.isoformat() if ev.updated_at else None,
    }


@router.get("")
def list_events(
    status: str | None = Query(None, description="received|processing|processed|failed|dead"),
    source: str | None = Query(None, description="legal_finance|at_informa"),
    limit: int = Query(100, le=500),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin")),
    db: Session = Depends(get_db),
):
    q = db.query(models.WebhookInbox)
    if status:
        q = q.filter(models.WebhookInbox.status == status)
    if source:
        q = q.filter(models.WebhookInbox.source == source)
    rows = q.order_by(models.WebhookInbox.created_at.desc()).limit(limit).all()
    return {"ok": True, "count": len(rows), "events": [_serialize(e) for e in rows]}


@router.get("/stats")
def stats(
    current_user: models.User = Depends(require_roles("superadmin", "subadmin")),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(models.WebhookInbox.status, func.count(models.WebhookInbox.id))
        .group_by(models.WebhookInbox.status)
        .all()
    )
    by_status = {status: count for status, count in rows}
    return {
        "ok": True,
        "by_status": by_status,
        "dead": by_status.get("dead", 0),
        "pending_retry": by_status.get("failed", 0),
    }


@router.get("/{event_id}")
def get_event(
    event_id: int,
    current_user: models.User = Depends(require_roles("superadmin", "subadmin")),
    db: Session = Depends(get_db),
):
    ev = db.query(models.WebhookInbox).filter(models.WebhookInbox.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Evento no encontrado")
    data = _serialize(ev)
    try:
        data["payload"] = json.loads(ev.payload_json)
    except Exception:
        data["payload"] = None
    return {"ok": True, "event": data}


@router.post("/{event_id}/retry")
def retry_event(
    event_id: int,
    current_user: models.User = Depends(require_roles("superadmin", "subadmin")),
    db: Session = Depends(get_db),
):
    ev = db.query(models.WebhookInbox).filter(models.WebhookInbox.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Evento no encontrado")

    # Reset para reproceso manual: vuelve a 'received' y limpia el contador.
    ev.status = "received"
    ev.attempts = 0
    ev.next_retry_at = None
    db.commit()

    webhook_dlq.process_event(ev.id)

    db.refresh(ev)
    logger.info("[DLQ] reproceso manual evento %s por %s → %s", ev.id, current_user.email, ev.status)
    return {"ok": True, "event": _serialize(ev)}
