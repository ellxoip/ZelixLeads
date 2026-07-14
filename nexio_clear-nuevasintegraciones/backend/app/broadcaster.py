"""Redis-backed SSE broadcaster — works across multiple uvicorn workers."""
import asyncio
import json
import logging
from typing import Any

import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

REDIS_CHANNEL = "wa_events"
REDIS_URL = "redis://localhost:6379/0"


class WaBroadcaster:
    def __init__(self) -> None:
        self._queues: list[asyncio.Queue] = []
        self._redis: aioredis.Redis | None = None
        self._listener_task: asyncio.Task | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    # ── lifecycle ──────────────────────────────────────────────────────────

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        try:
            r = aioredis.from_url(REDIS_URL, decode_responses=True, socket_connect_timeout=2)
            await r.ping()
            self._redis = r
            self._listener_task = asyncio.create_task(self._listen())
        except Exception as exc:
            logger.debug(
                "Redis no disponible en %s (%s) — modo in-memory (un solo worker).",
                REDIS_URL, exc,
            )
            self._redis = None

    async def stop(self) -> None:
        if self._listener_task:
            self._listener_task.cancel()
            try:
                await self._listener_task
            except asyncio.CancelledError:
                pass
        if self._redis:
            await self._redis.aclose()

    # ── pub/sub listener (runs once per worker) ───────────────────────────

    async def _listen(self) -> None:
        # Reconexión con backoff: un timeout puntual de Redis no debe matar
        # el listener (sin él, los SSE de este worker dejan de recibir eventos).
        backoff = 1
        while True:
            pubsub = self._redis.pubsub()
            try:
                await pubsub.subscribe(REDIS_CHANNEL)
                backoff = 1
                while True:
                    # get_message con timeout devuelve None en idle (listen() en
                    # redis-py 8.x levanta TimeoutError tras 5s sin tráfico).
                    raw = await pubsub.get_message(ignore_subscribe_messages=True, timeout=4)
                    if raw is None or raw["type"] != "message":
                        continue
                    payload: str = raw["data"]
                    dead: list[asyncio.Queue] = []
                    for q in list(self._queues):
                        try:
                            q.put_nowait(payload)
                        except asyncio.QueueFull:
                            dead.append(q)
                    for q in dead:
                        self.unsubscribe(q)
            except asyncio.CancelledError:
                try:
                    await pubsub.unsubscribe(REDIS_CHANNEL)
                    await pubsub.aclose()
                except Exception:
                    pass
                return
            except Exception as exc:
                logger.error("WaBroadcaster listener error (reintento en %ss): %s", backoff, exc)
            try:
                await pubsub.aclose()
            except Exception:
                pass
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)

    # ── SSE subscriber management ─────────────────────────────────────────

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._queues.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        try:
            self._queues.remove(q)
        except ValueError:
            pass

    # ── broadcast (publishes to Redis → all workers receive via _listen) ──

    async def broadcast(self, event_type: str, data: dict[str, Any]) -> None:
        payload = json.dumps({"type": event_type, **data})
        if self._redis:
            try:
                await self._redis.publish(REDIS_CHANNEL, payload)
            except Exception as exc:
                logger.error("WaBroadcaster publish error: %s", exc)
        else:
            # in-memory fallback: notifica directamente las colas del worker actual
            dead: list[asyncio.Queue] = []
            for q in list(self._queues):
                try:
                    q.put_nowait(payload)
                except asyncio.QueueFull:
                    dead.append(q)
            for q in dead:
                self.unsubscribe(q)

    def broadcast_sync(self, event_type: str, data: dict[str, Any]) -> None:
        """Fire-and-forget broadcast from a synchronous (thread-pool) context."""
        # Solo se exige el loop (la app debe estar iniciada). NO se exige Redis:
        # broadcast() ya cae a entrega in-memory si Redis no está disponible, así
        # el tiempo real (SSE) también funciona en single-worker/dev sin Redis.
        if not self._loop:
            return
        try:
            asyncio.run_coroutine_threadsafe(self.broadcast(event_type, data), self._loop)
        except Exception as exc:
            logger.debug("broadcast_sync error: %s", exc)


wa_broadcaster = WaBroadcaster()
