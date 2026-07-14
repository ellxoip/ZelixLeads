"""Nexio Copilot — endpoints de lectura y dismiss de insights."""
from datetime import datetime, timedelta, timezone
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_user
from .. import models
from ..copilot import evaluate_for_user
from .leads import _visible_leads

router = APIRouter(prefix="/api/insights", tags=["insights"])


@router.get("")
def list_insights(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Insights vigentes para el usuario (scoping por rol vía _visible_leads).
    Evalúa solo los leads activos visibles (conjunto pequeño → barato)."""
    return evaluate_for_user(db, current_user, _visible_leads)


@router.post("/{insight_id}/dismiss")
def dismiss_insight(
    insight_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Silencia una tarjeta por 24 h para este usuario (idempotente)."""
    if ":" not in insight_id:
        raise HTTPException(status_code=400, detail="id de insight inválido")
    until = datetime.now(timezone.utc) + timedelta(hours=24)
    row = db.query(models.InsightDismissal).filter(
        models.InsightDismissal.user_id == current_user.id,
        models.InsightDismissal.insight_key == insight_id,
    ).first()
    if row:
        row.until = until
    else:
        db.add(models.InsightDismissal(
            user_id=current_user.id, insight_key=insight_id, until=until,
        ))
    db.commit()
    return {"ok": True, "dismissed_until": until.isoformat()}
