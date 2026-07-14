"""
Dead Letter Queue (DLQ) para webhooks ENTRANTES de nexio.

Webhooks cubiertos:
  - fc → nexio        POST /api/webhooks/legal_finance
  - control → nexio   POST /api/webhooks/at_informa

Patrón:
  1. El endpoint valida la firma (rápido) y PERSISTE el evento en `webhook_inbox`.
  2. Responde 200 de inmediato (confirmación asíncrona) y procesa en background.
  3. Si el proceso falla: reintenta con backoff. Tras agotar los intentos, el evento
     queda en estado `dead` (DLQ) para reproceso manual.
  4. Dedupe por `idempotency_key`: un reenvío del mismo evento ya procesado se ignora.

Clasificación de errores:
  - PermanentWebhookError  → no se reintenta, va directo a `dead` (ej: evento desconocido).
  - cualquier otra excepción → transitoria, se reintenta (ej: lead aún no existe, DB caída).

Durabilidad: el store es la DB (sobrevive reinicios). Un barrido periódico
(`sweep_due`) reprocesa los `failed` cuyo `next_retry_at` ya venció — esto cubre el
caso de que el proceso se reinicie con reintentos en vuelo.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Callable

from sqlalchemy.orm import Session

from .. import models
from ..database import SessionLocal

logger = logging.getLogger("nexio.webhook_dlq")

# Backoff por intento (segundos). El índice = nº de intento ya realizado.
BACKOFF_SECONDS = [30, 120, 300, 900, 3600]
DEFAULT_MAX_ATTEMPTS = len(BACKOFF_SECONDS)

# Handlers de proceso por source. Cada handler: (db, payload) -> None.
# Debe MUTAR la sesión (sin commit); process_event hace el commit único.
# Debe levantar PermanentWebhookError para fallos no-reintentables.
_HANDLERS: dict[str, Callable[[Session, dict], None]] = {}

# Loop principal capturado en startup, para broadcasts best-effort desde threads.
_LOOP: asyncio.AbstractEventLoop | None = None


class PermanentWebhookError(Exception):
    """Fallo de negocio no-reintentable (ej: evento desconocido)."""


def register_handler(source: str, fn: Callable[[Session, dict], None]) -> None:
    _HANDLERS[source] = fn


def set_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _LOOP
    _LOOP = loop


def run_coro_safe(coro) -> None:
    """Programa una corutina (ej: broadcast SSE) en el loop principal sin bloquear.
    Best-effort: si no hay loop, descarta silenciosamente."""
    if _LOOP is None:
        coro.close()
        return
    try:
        asyncio.run_coroutine_threadsafe(coro, _LOOP)
    except Exception as exc:  # noqa: BLE001
        logger.warning("broadcast best-effort falló: %s", exc)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def record_inbound(
    db: Session,
    *,
    source: str,
    event_type: str | None,
    payload: dict,
    idempotency_key: str,
    request_id: str | None = None,
) -> tuple[models.WebhookInbox, bool]:
    """
    Persiste el webhook entrante. Devuelve (evento, is_duplicate).
    is_duplicate=True si ya existe uno con la misma idempotency_key YA procesado
    (o en curso): el caller debe responder 200 sin re-encolar.
    """
    existing = (
        db.query(models.WebhookInbox)
        .filter(models.WebhookInbox.idempotency_key == idempotency_key)
        .first()
    )
    if existing:
        if existing.status in ("processed", "processing", "received"):
            return existing, True
        # estaba failed/dead → permitimos re-encolar reseteando a received.
        existing.status = "received"
        existing.next_retry_at = None
        db.commit()
        return existing, False

    ev = models.WebhookInbox(
        source=source,
        event_type=event_type,
        idempotency_key=idempotency_key,
        payload_json=json.dumps(payload, default=str),
        status="received",
        attempts=0,
        max_attempts=DEFAULT_MAX_ATTEMPTS,
        request_id=request_id,
    )
    db.add(ev)
    db.commit()
    db.refresh(ev)
    return ev, False


def _mark_dead(db: Session, ev: models.WebhookInbox, error: str) -> None:
    ev.status = "dead"
    ev.last_error = error[:2000]
    ev.next_retry_at = None
    db.commit()
    logger.error("[DLQ] evento %s (%s/%s) → DEAD: %s",
                 ev.id, ev.source, ev.event_type, error[:200])


def _mark_retry_or_dead(db: Session, ev: models.WebhookInbox, error: str) -> None:
    ev.attempts = (ev.attempts or 0) + 1
    ev.last_error = error[:2000]
    if ev.attempts >= (ev.max_attempts or DEFAULT_MAX_ATTEMPTS):
        ev.status = "dead"
        ev.next_retry_at = None
        db.commit()
        logger.error("[DLQ] evento %s agotó %s intentos → DEAD: %s",
                     ev.id, ev.attempts, error[:200])
        return
    delay = BACKOFF_SECONDS[min(ev.attempts - 1, len(BACKOFF_SECONDS) - 1)]
    ev.status = "failed"
    ev.next_retry_at = _now() + timedelta(seconds=delay)
    db.commit()
    logger.warning("[DLQ] evento %s intento %s falló, retry en %ss: %s",
                   ev.id, ev.attempts, delay, error[:200])


def process_event(event_id: int) -> None:
    """Procesa un evento del inbox (sync). Usado por BackgroundTask y por el barrido."""
    db = SessionLocal()
    try:
        ev = db.query(models.WebhookInbox).filter(models.WebhookInbox.id == event_id).first()
        if not ev or ev.status == "processed":
            return
        handler = _HANDLERS.get(ev.source)
        if handler is None:
            _mark_dead(db, ev, f"sin handler registrado para source={ev.source}")
            return

        ev.status = "processing"
        db.commit()

        payload = json.loads(ev.payload_json)
        try:
            handler(db, payload)
            ev.status = "processed"
            ev.last_error = None
            ev.next_retry_at = None
            db.commit()
            logger.info("[DLQ] evento %s (%s/%s) procesado", ev.id, ev.source, ev.event_type)
        except PermanentWebhookError as exc:
            db.rollback()
            _mark_dead(db, ev, str(exc))
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            _mark_retry_or_dead(db, ev, f"{type(exc).__name__}: {exc}")
    finally:
        db.close()


def sweep_due(db: Session, limit: int = 50) -> int:
    """Reprocesa los `failed` cuyo next_retry_at ya venció. Devuelve cuántos reintentó."""
    due = (
        db.query(models.WebhookInbox)
        .filter(
            models.WebhookInbox.status == "failed",
            models.WebhookInbox.next_retry_at <= _now(),
        )
        .order_by(models.WebhookInbox.next_retry_at.asc())
        .limit(limit)
        .all()
    )
    ids = [e.id for e in due]
    for eid in ids:
        process_event(eid)
    return len(ids)
