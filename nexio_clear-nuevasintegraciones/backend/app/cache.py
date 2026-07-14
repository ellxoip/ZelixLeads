"""
Redis-backed async cache para endpoints de lectura frecuente.
TTL corto (30s) — datos frescos sin ir a la BD en cada request.
"""
import json
import logging
import os
from typing import Any

import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
CACHE_PREFIX = "nexio:cache:"

_redis: aioredis.Redis | None = None


async def _get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _redis


async def cache_get(key: str) -> Any | None:
    try:
        r = await _get_redis()
        raw = await r.get(CACHE_PREFIX + key)
        if raw:
            return json.loads(raw)
    except Exception as exc:
        logger.debug("cache_get error %s: %s", key, exc)
    return None


async def cache_set(key: str, value: Any, ttl: int = 30) -> None:
    try:
        r = await _get_redis()
        await r.setex(CACHE_PREFIX + key, ttl, json.dumps(value, default=str))
    except Exception as exc:
        logger.debug("cache_set error %s: %s", key, exc)


async def cache_del(pattern: str) -> None:
    """Invalidar todas las claves que coincidan con el patrón (usa SCAN, no KEYS)."""
    try:
        r = await _get_redis()
        cur = 0
        while True:
            cur, keys = await r.scan(cur, match=CACHE_PREFIX + pattern, count=100)
            if keys:
                await r.delete(*keys)
            if cur == 0:
                break
    except Exception as exc:
        logger.debug("cache_del error %s: %s", pattern, exc)
