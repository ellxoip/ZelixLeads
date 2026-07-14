"""
Cliente HTTP resiliente para las integraciones de nexio.

Aporta, en un solo lugar, lo que antes faltaba en cada cliente (legal_finance,
pagacuotas, hive_service, at_informa):

  - Timeouts por-endpoint (8s pagos, 15s procesos pesados, configurable).
  - Reintentos con backoff exponencial + jitter.
  - Clasificación retryable vs no-retryable:
      retryable     -> errores de red/timeout, 429, 5xx
      no-retryable  -> 4xx de negocio (400/401/403/404/409/422) → no se reintenta
  - Circuit breaker por host: tras N fallos consecutivos abre el circuito y deja
    de martillar al sistema caído; se auto-recupera (half-open) tras reset_timeout.
  - Idempotencia: header `Idempotency-Key` estable a través de los reintentos de
    una misma llamada lógica (el receptor puede deduplicar con seguridad).
  - Trazabilidad: propaga `X-Request-ID` / `X-Correlation-Id` por toda la cadena.
  - Métricas/logs estructurados por intento (hop, status, latencia, intento, request_id).

Uso (async):
    from .resilient_http import resilient_request, TIMEOUT_PAYMENT
    resp = await resilient_request(
        "POST", url, headers={...}, json=payload,
        hop="legal_finance.pago-comprometido", timeout=TIMEOUT_PAYMENT,
    )
    resp.raise_for_status()
    data = resp.json()

Devuelve un httpx.Response (el caller sigue usando .raise_for_status()/.json()).
Levanta:
  - CircuitOpenError  si el circuito del host está abierto.
  - httpx.HTTPError / RequestError si se agotan los reintentos.
"""
from __future__ import annotations

import logging
import os
import random
import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from urllib.parse import urlsplit

import httpx

logger = logging.getLogger("nexio.integrations")

# ── Timeouts por tipo de operación (segundos) ─────────────────────────────────
TIMEOUT_DEFAULT = float(os.getenv("HTTP_TIMEOUT_DEFAULT", "10"))
TIMEOUT_PAYMENT = float(os.getenv("HTTP_TIMEOUT_PAYMENT", "8"))   # pagos: fail-fast
TIMEOUT_HEAVY   = float(os.getenv("HTTP_TIMEOUT_HEAVY", "15"))    # procesos pesados
TIMEOUT_QUICK   = float(os.getenv("HTTP_TIMEOUT_QUICK", "5"))     # lecturas ligeras

# ── Política de reintentos ────────────────────────────────────────────────────
MAX_RETRIES   = int(os.getenv("HTTP_MAX_RETRIES", "3"))
BACKOFF_BASE  = float(os.getenv("HTTP_BACKOFF_BASE", "0.3"))      # seg
BACKOFF_CAP   = float(os.getenv("HTTP_BACKOFF_CAP", "8"))         # tope por espera

RETRYABLE_STATUS = {429, 500, 502, 503, 504}
# 4xx de negocio: nunca se reintentan (la respuesta no cambiará).
NON_RETRYABLE_STATUS = {400, 401, 403, 404, 409, 422}

# ── Circuit breaker ───────────────────────────────────────────────────────────
CB_FAIL_THRESHOLD = int(os.getenv("HTTP_CB_FAIL_THRESHOLD", "5"))
CB_RESET_TIMEOUT  = float(os.getenv("HTTP_CB_RESET_TIMEOUT", "30"))


class CircuitOpenError(RuntimeError):
    """El circuito hacia un host está abierto (sistema caído) — no se intenta."""


@dataclass
class _Circuit:
    fails: int = 0
    opened_at: float = 0.0
    state: str = "closed"  # closed | open | half_open
    lock: Lock = field(default_factory=Lock)

    def allow(self) -> bool:
        with self.lock:
            if self.state == "open":
                if (time.monotonic() - self.opened_at) >= CB_RESET_TIMEOUT:
                    self.state = "half_open"
                    return True
                return False
            return True

    def on_success(self):
        with self.lock:
            self.fails = 0
            self.state = "closed"

    def on_failure(self):
        with self.lock:
            self.fails += 1
            if self.fails >= CB_FAIL_THRESHOLD:
                self.state = "open"
                self.opened_at = time.monotonic()


_circuits: dict[str, _Circuit] = {}
_circuits_lock = Lock()


def _circuit_for(url: str) -> _Circuit:
    host = urlsplit(url).netloc
    with _circuits_lock:
        c = _circuits.get(host)
        if c is None:
            c = _Circuit()
            _circuits[host] = c
        return c


def circuit_state(url: str) -> str:
    return _circuit_for(url).state


def _sleep_backoff(attempt: int):
    import asyncio  # local: evita acoplar el import async a nivel de módulo
    delay = min(BACKOFF_CAP, BACKOFF_BASE * (2 ** attempt))
    delay = delay * (0.5 + random.random())  # jitter: 50%–150%
    return asyncio.sleep(delay)


async def resilient_request(
    method: str,
    url: str,
    *,
    headers: dict | None = None,
    json: object = None,
    data: object = None,
    hop: str = "",
    timeout: float = TIMEOUT_DEFAULT,
    max_retries: int = MAX_RETRIES,
    idempotent: bool = True,
    idempotency_key: str | None = None,
    request_id: str | None = None,
    retry_status: bool = True,
) -> httpx.Response:
    """
    Ejecuta un request con reintentos, circuit breaker, idempotencia y trazas.

    idempotent=True (default) agrega `Idempotency-Key` estable a través de los
    reintentos, de modo que el receptor pueda deduplicar. Para operaciones que
    NO crean datos (GET) es inofensivo.
    """
    method = method.upper()
    req_id = request_id or str(uuid.uuid4())
    idem = idempotency_key or (str(uuid.uuid4()) if idempotent else None)
    base_headers = dict(headers or {})
    base_headers.setdefault("X-Request-ID", req_id)
    base_headers.setdefault("X-Correlation-Id", req_id)
    if idem:
        base_headers.setdefault("Idempotency-Key", idem)

    circuit = _circuit_for(url)
    if not circuit.allow():
        logger.warning("[%s] circuito ABIERTO hacia %s — request abortado (req_id=%s)",
                       hop or method, urlsplit(url).netloc, req_id)
        raise CircuitOpenError(f"circuit open for {urlsplit(url).netloc}")

    last_exc: Exception | None = None
    attempt = 0
    while attempt <= max_retries:
        t0 = time.perf_counter()
        try:
            async with httpx.AsyncClient(follow_redirects=True) as client:
                resp = await client.request(
                    method, url, headers=base_headers, json=json, data=data, timeout=timeout,
                )
            dt = (time.perf_counter() - t0) * 1000

            if resp.status_code in NON_RETRYABLE_STATUS:
                # 4xx de negocio: éxito desde la perspectiva del circuito (el host
                # responde), no se reintenta. El caller decide con raise_for_status.
                circuit.on_success()
                logger.info("[%s] %s %d %.0fms intento=%d req_id=%s (no-retryable)",
                            hop or method, method, resp.status_code, dt, attempt, req_id)
                return resp

            if retry_status and resp.status_code in RETRYABLE_STATUS and attempt < max_retries:
                circuit.on_failure()
                logger.warning("[%s] %s %d %.0fms intento=%d req_id=%s → retry",
                               hop or method, method, resp.status_code, dt, attempt, req_id)
                await _sleep_backoff(attempt)
                attempt += 1
                continue

            # 2xx/3xx o 5xx sin reintentos restantes.
            if 200 <= resp.status_code < 400:
                circuit.on_success()
            else:
                circuit.on_failure()
            logger.info("[%s] %s %d %.0fms intento=%d req_id=%s",
                        hop or method, method, resp.status_code, dt, attempt, req_id)
            return resp

        except (httpx.TimeoutException, httpx.TransportError) as exc:
            dt = (time.perf_counter() - t0) * 1000
            last_exc = exc
            circuit.on_failure()
            if attempt < max_retries:
                logger.warning("[%s] %s ERROR %s %.0fms intento=%d req_id=%s → retry",
                               hop or method, method, type(exc).__name__, dt, attempt, req_id)
                await _sleep_backoff(attempt)
                attempt += 1
                continue
            logger.error("[%s] %s ERROR %s %.0fms intento=%d req_id=%s (agotado)",
                         hop or method, method, type(exc).__name__, dt, attempt, req_id)
            raise

    if last_exc:
        raise last_exc
    raise RuntimeError("resilient_request: estado inalcanzable")
