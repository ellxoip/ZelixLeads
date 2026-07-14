# Endurecimiento de Integraciones — Estado y Roadmap

Refuerzo de resiliencia para la matriz de integraciones (nexio ↔ fc / pagacuotas / control).
Estado al día de hoy. ✅ hecho · 🟡 parcial · ⛏️ requiere infra/decisión.

---

## 1. Error Handling & Resiliencia — ✅ implementado en nexio

Módulo nuevo: `app/utils/resilient_http.py`. Cableado en los 4 clientes
(`legal_finance`, `pagacuotas`, `hive_service`, `at_informa`).

- ✅ **Reintentos backoff exponencial + jitter** (`BACKOFF_BASE`·2^intento, jitter 50–150%, tope `BACKOFF_CAP`).
- ✅ **Circuit breaker por host** (abre tras `CB_FAIL_THRESHOLD=5` fallos, half-open tras `CB_RESET_TIMEOUT=30s`).
- ✅ **Timeouts por endpoint**: `TIMEOUT_PAYMENT=8s` (pagos), `TIMEOUT_HEAVY=15s` (cases), `TIMEOUT_QUICK=5s` (lecturas).
- ✅ **Retryable vs no-retryable**: retry en red/timeout/429/5xx; nunca en 4xx de negocio (400/401/403/404/409/422).

Todo configurable por env (`HTTP_MAX_RETRIES`, `HTTP_TIMEOUT_*`, `HTTP_CB_*`).

## 2. Idempotencia — 🟡 emisor listo; receptores varían

- ✅ nexio envía `Idempotency-Key` **estable por operación lógica** (p.ej. `nexio-lead-{id}`,
  `nexio-lf-pago-{id}`) → los reintentos no duplican si el receptor deduplica.
- 🟡 **control** ya tiene `src/lib/idempotency.ts` + `correlation_id` → puede deduplicar `/cases`.
- ⛏️ **fc** y **pagacuotas**: confirmar que `pago-comprometido` y `from-crm` deduplican por
  `Idempotency-Key`/`crmLeadId`. Si no, añadir índice único + upsert por esa clave.

## 3. Monitoreo y Observabilidad — 🟡 base lista

- ✅ **Trace ID**: nexio propaga `X-Request-ID` + `X-Correlation-Id` en toda la cadena.
- ✅ **Logs estructurados por intento**: hop, método, status, latencia, intento, req_id (logger `nexio.integrations`).
- ✅ **Métricas bajo demanda**: `scripts/stress_integrations.py` (p50/p95/p99, throughput, error-rate, % por status).
- ⛏️ **Métricas en vivo**: exportar a Prometheus/OpenTelemetry (contadores por hop) — pendiente.
- ⛏️ **Alertas** (error-rate > 2%, p95 > umbral, webhook sin respuesta): requiere
  Slack/Email webhook + un colector. Definir destino.

## 4. Webhooks (críticos) — ✅ DLQ implementada

Módulo: `app/utils/webhook_dlq.py` + modelo `WebhookInbox` + router `webhook_dlq_router.py`.
Cubre ambos webhooks entrantes (`/api/webhooks/legal_finance`, `/api/webhooks/at_informa`).

- ✅ **Confirmación asíncrona**: el endpoint valida firma, persiste el evento y responde 200 al
  instante; el proceso real corre en `BackgroundTask` (ambos webhooks, no solo legal_finance).
- ✅ **Retry queue + Dead Letter Queue**: reintentos con backoff (30/120/300/900/3600s); tras agotar
  → estado `dead`. Store durable en DB (`webhook_inbox`), sobrevive reinicios. Barrido periódico
  (`_webhook_dlq_sweep`, 60s) reprocesa los `failed` vencidos.
- ✅ **Dedupe** por `Idempotency-Key` (o derivada de source+event+leadId): reenvíos no re-procesan.
- ✅ **Reproceso manual**: `GET /api/webhooks/dlq[?status=dead]`, `GET /dlq/stats`,
  `POST /api/webhooks/dlq/{id}/retry` (superadmin/subadmin).
- ✅ **Clasificación**: `PermanentWebhookError` (evento desconocido) → `dead` sin reintentar;
  transitorios (lead aún no existe, DB caída) → reintentan.
- ✅ **Auth en webhooks recibidos**: `x-lf-callback-secret` y `x-crm-callback-secret`.
- ⛏️ **HMAC de body** (en vez de shared-secret plano): requiere que fc/control **firmen** el body
  (HMAC-SHA256) y nexio valide. Cambio en ambos extremos — único pendiente de #4.

## 5. Seguridad y Credenciales — ⛏️

- ⛏️ **Rotación periódica** de keys (`889…`, `0f6b…`, `e3fd…`, etc.): definir cadencia (90d) y
  procedimiento de rotación coordinada en ambos extremos (rotar receptor → emisor → verificar).
- ⛏️ **Secret manager** (no `.env` en prod): mover a Doppler / AWS Secrets Manager / Vault.
- ⛏️ **Least privilege**: cada servicio con su propia key por canal (hoy algunas keys se reusan).

## 6. Bases de Datos directas — ⛏️ (punto débil)

`CONTABLE_DATABASE_URL` (fc) y `PAGACUOTAS_DATABASE_URL` consultadas por SQL directo desde nexio
(`legal_finance_integration._fetch_lf_contrato_totals`, `cobrador`).

- ⛏️ **Usuario de solo-lectura** con permisos mínimos sobre las tablas necesarias.
- 🟡 **Caché + fallback**: nexio ya tiene `app/cache.py` → cachear los `totals` de contrato.
- ⛏️ **Migrar a API** a futuro (fc ya expone endpoints; reemplazar los SELECT directos).

## 7. Pruebas y Calidad — ✅ / ⛏️

- ✅ **Load testing**: `scripts/stress_integrations.py` (Fase 1 smoke/auth) y
  `scripts/stress_e2e_ramp.py` (Fase 2 rampa de carga, detecta punto de quiebre).
- ✅ **Modo E2E con datos sintéticos** (prefijo `STRESS-`) **gateado** por `--e2e` +
  `STRESS_ALLOW_WRITES=1` + chequeo de que la DB **no** sea producción.
- ⛏️ **Tests de integración automáticos** contra staging (CI).
- ⛏️ **Chaos testing ligero**: inyectar latencia/errores (el circuit breaker ya está listo para
  reaccionar) — añadir un toggle de fallo en staging.

---

### Próximos pasos sugeridos (orden de impacto)
1. ✅ Dedupe por `Idempotency-Key` en fc y pagacuotas (#2) — hecho.
2. ✅ DLQ de webhooks (#4) — hecho (DB-backed, sin Redis; durable y con reproceso manual).
3. Cachear totals de contrato + usuario read-only en las DBs directas (#6).
4. Exportar métricas del logger `nexio.integrations` + DLQ stats a Prometheus + alertas (#3).
5. HMAC de body en webhooks entrantes (último pendiente de #4).
