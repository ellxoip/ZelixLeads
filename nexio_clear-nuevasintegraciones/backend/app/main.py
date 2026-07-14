from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from starlette.middleware.base import BaseHTTPMiddleware
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")
import os
import time
import asyncio

# Set Chilean Timezone
os.environ['TZ'] = 'America/Santiago'
if hasattr(time, 'tzset'):
    time.tzset()

from sqlalchemy import text
from .database import engine
from . import models
from .routers import auth, users, groups, contacts, leads, payments, calendar, notifications, whatsapp, pdf, webhooks, settings, tecnico, google_calendar, push, whatsapp_qr, whatsapp_sessions, at_informa_integration, legal_finance_integration, pagacuotas_router, ai_agents, pipeline_stages, work_orders, security, cobrador, seguimiento_asistente, analista, integrations_health, webhook_dlq_router, search, insights, nexin, telegram
from .seed import seed
from .auth import hash_password
from .broadcaster import wa_broadcaster
models.Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="CRM Abogados Tributarios",
    description="Sistema CRM para gestión de leads, clientes y pagos",
    version="1.0.0",
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """ISO 27001 A.14.1.3 — HTTP security headers on every response."""
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        return response


app.add_middleware(SecurityHeadersMiddleware)

# ISO 27001 A.13.1 — CORS restricted to configured origins
_raw_origins = os.getenv("ALLOWED_ORIGINS", "*")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=_raw_origins != "*",
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(groups.router)
app.include_router(contacts.router)
app.include_router(leads.router)
app.include_router(payments.router)
app.include_router(calendar.router)
app.include_router(notifications.router)
app.include_router(whatsapp.router)
app.include_router(webhooks.router)
app.include_router(pdf.router)
app.include_router(settings.router)
app.include_router(tecnico.router)
app.include_router(google_calendar.router)
app.include_router(push.router)
app.include_router(whatsapp_qr.router)
app.include_router(whatsapp_qr.webhook_router)
app.include_router(whatsapp_sessions.router)
app.include_router(at_informa_integration.router)
app.include_router(legal_finance_integration.router)
app.include_router(pagacuotas_router.router)
app.include_router(pagacuotas_router.public_router)
app.include_router(ai_agents.router)
app.include_router(work_orders.router)
app.include_router(pipeline_stages.router)
app.include_router(security.router)
app.include_router(cobrador.router)
app.include_router(seguimiento_asistente.router)
app.include_router(analista.router)
app.include_router(integrations_health.router)
app.include_router(webhook_dlq_router.router)
app.include_router(search.router)
app.include_router(insights.router)
app.include_router(nexin.router)
app.include_router(telegram.router)
app.include_router(telegram.webhook_router)


def _ensure_tecnico():
    """Create the root tecnico user if it doesn't exist."""
    from .database import SessionLocal
    db = SessionLocal()
    try:
        if not db.query(models.User).filter(models.User.role == "tecnico").first():
            db.add(models.User(
                name="Técnico Zelix",
                email="tecnico@zelix.cl",
                password_hash=hash_password("Tecnico2026!"),
                role="tecnico",
                group_id=None,
            ))
            db.commit()
    except Exception as e:
        db.rollback()
        import logging as _log
        _log.getLogger(__name__).debug("Could not create tecnico user: %s", e)
    finally:
        db.close()


def _run_pg_migrations():
    """PostgreSQL: add new columns that create_all() can't add to existing tables."""
    from .database import _is_sqlite
    if _is_sqlite:
        return
    pg_stmts = [
        "ALTER TABLE leads ADD COLUMN IF NOT EXISTS payment_commitment_date DATE",
        "ALTER TABLE leads ADD COLUMN IF NOT EXISTS payment_reminder_sent_at DATE",
        "ALTER TABLE leads ADD COLUMN IF NOT EXISTS seguimiento_status VARCHAR(30)",
        # Resumen IA de la conversación, cacheado para el evento de Google Calendar
        "ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS ai_summary TEXT",
        # Enlace de Google Meet del evento (generado vía conferenceData)
        "ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS meet_link VARCHAR(500)",
        # Ensure updated_at has a default so new rows are immediately sortable
        "ALTER TABLE leads ALTER COLUMN updated_at SET DEFAULT now()",
        # Back-fill NULL updated_at with created_at for proper ordering
        "UPDATE leads SET updated_at = created_at WHERE updated_at IS NULL",
        # Buscador Global 360 — columnas derivadas indexadas (sargables)
        "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS search_name VARCHAR(200)",
        "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_norm VARCHAR(40)",
        "CREATE INDEX IF NOT EXISTS ix_contacts_search_name ON contacts (search_name)",
        "CREATE INDEX IF NOT EXISTS ix_contacts_phone_norm ON contacts (phone_norm)",
    ]
    with engine.connect() as conn:
        for stmt in pg_stmts:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception as e:
                print(f"⚠️  PG migration skipped: {stmt[:60]} — {e}")

    # ── Índices CONCURRENTLY para el validador de exclusividad por RUT ────────
    # 100% aditivo: CONCURRENTLY NO bloquea la tabla (seguro sobre la DB
    # compartida nexio_pool) pero NO puede correr dentro de una transacción →
    # conexión AUTOCOMMIT dedicada. `contacts` no tiene deleted_at → índice plano.
    concurrent_idx = [
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_contacts_rut_persona ON contacts (rut_persona)",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_contacts_rut_empresa ON contacts (rut_empresa)",
        # Índices funcionales para la comparación de RUT NORMALIZADO (sin puntos,
        # guiones ni espacios, en mayúsculas) — mantienen sargable el candado de
        # exclusividad aunque las filas tengan formatos mixtos.
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_contacts_rut_persona_norm "
        "ON contacts (upper(replace(replace(replace(rut_persona,'.',''),'-',''),' ','')))",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_contacts_rut_empresa_norm "
        "ON contacts (upper(replace(replace(replace(rut_empresa,'.',''),'-',''),' ','')))",
    ]
    try:
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as aconn:
            for stmt in concurrent_idx:
                try:
                    aconn.execute(text(stmt))
                    print(f"✅ PG index ready: {stmt.split('EXISTS ')[1].split(' ON')[0]}")
                except Exception as e:
                    print(f"⚠️  PG concurrent index skipped: {stmt[:70]} — {e}")
    except Exception as e:
        print(f"⚠️  PG concurrent index block skipped — {e}")


def _run_migrations():
    """SQLite-only: patch columns/tables on existing DBs. PostgreSQL uses create_all()."""
    from .database import _is_sqlite
    if not _is_sqlite:
        return
    with engine.connect() as conn:
        # Recreate whatsapp_configs with nullable group_id if needed
        # Check if group_id is NOT NULL
        cursor = conn.execute(text("PRAGMA table_info('whatsapp_configs')"))
        is_not_null = False
        for col in cursor.fetchall():
            if col[1] == 'group_id' and col[3] == 1:
                is_not_null = True
        
        if is_not_null:
            conn.execute(text("PRAGMA foreign_keys=OFF"))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS whatsapp_configs_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name VARCHAR(100) NOT NULL,
                    phone_number VARCHAR(30) NOT NULL,
                    api_token VARCHAR(500),
                    api_provider VARCHAR(30) DEFAULT 'manual',
                    phone_number_id VARCHAR(100),
                    group_id INTEGER REFERENCES groups(id),
                    is_active BOOLEAN DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.execute(text("INSERT INTO whatsapp_configs_new SELECT * FROM whatsapp_configs"))
            conn.execute(text("DROP TABLE whatsapp_configs"))
            conn.execute(text("ALTER TABLE whatsapp_configs_new RENAME TO whatsapp_configs"))
            conn.execute(text("PRAGMA foreign_keys=ON"))
            conn.commit()

        # Create push_subscriptions table if missing
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS push_subscriptions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    endpoint TEXT NOT NULL UNIQUE,
                    p256dh TEXT NOT NULL,
                    auth TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.commit()
        except Exception:
            pass

        # Create area_phone_numbers junction table (many-to-many area ↔ WA config)
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS area_phone_numbers (
                    area_id INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
                    whatsapp_config_id INTEGER NOT NULL REFERENCES whatsapp_configs(id) ON DELETE CASCADE,
                    PRIMARY KEY (area_id, whatsapp_config_id)
                )
            """))
            conn.commit()
            # Migrate existing whatsapp_config_id data
            conn.execute(text("""
                INSERT OR IGNORE INTO area_phone_numbers (area_id, whatsapp_config_id)
                SELECT id, whatsapp_config_id FROM areas WHERE whatsapp_config_id IS NOT NULL
            """))
            conn.commit()
        except Exception:
            pass

        for stmt in [
            "ALTER TABLE whatsapp_messages ADD COLUMN is_read BOOLEAN DEFAULT 0",
            "ALTER TABLE whatsapp_messages ADD COLUMN media_url VARCHAR(1000)",
            "ALTER TABLE calendar_events ADD COLUMN google_event_id VARCHAR(200)",
            "ALTER TABLE calendar_events ADD COLUMN vendor_status VARCHAR(30)",
            "ALTER TABLE calendar_events ADD COLUMN ai_summary TEXT",
            "ALTER TABLE calendar_events ADD COLUMN meet_link VARCHAR(500)",
            "ALTER TABLE payment_verifications ADD COLUMN invoice_url VARCHAR(1000)",
            # AT Informa integration columns
            "ALTER TABLE leads ADD COLUMN at_informa_case_id VARCHAR(100)",
            "ALTER TABLE leads ADD COLUMN at_informa_status VARCHAR(50)",
            "ALTER TABLE users ADD COLUMN at_informa_user_id VARCHAR(100)",
            # Legal Finance integration column
            "ALTER TABLE leads ADD COLUMN legal_finance_contrato_id INTEGER",
            # Vendor outcome tracking (for Seguimiento page)
            "ALTER TABLE leads ADD COLUMN last_vendor_outcome VARCHAR(30)",
            # PagaCuotas integration columns
            "ALTER TABLE leads ADD COLUMN pagacuotas_cliente_id VARCHAR(100)",
            "ALTER TABLE leads ADD COLUMN pagacuotas_status VARCHAR(20)",
            "ALTER TABLE leads ADD COLUMN pagacuotas_link VARCHAR(500)",
            "ALTER TABLE leads ADD COLUMN hive_service_case_id VARCHAR(100)",
            "ALTER TABLE leads ADD COLUMN hive_service_status VARCHAR(30)",
            "ALTER TABLE groups ADD COLUMN plan VARCHAR(20) DEFAULT 'basico'",
            "ALTER TABLE groups ADD COLUMN plan_expires_at DATETIME",
            # Buscador Global 360 — columnas derivadas indexadas (sargables)
            "ALTER TABLE contacts ADD COLUMN search_name VARCHAR(200)",
            "ALTER TABLE contacts ADD COLUMN phone_norm VARCHAR(40)",
            "CREATE INDEX IF NOT EXISTS ix_contacts_search_name ON contacts (search_name)",
            "CREATE INDEX IF NOT EXISTS ix_contacts_phone_norm ON contacts (phone_norm)",
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass  # Column already exists

        # PagaCuotas tables
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS pagacuotas_clientes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    crm_lead_id INTEGER UNIQUE,
                    nombre VARCHAR(200) NOT NULL,
                    rut VARCHAR(30),
                    razon_social VARCHAR(200),
                    email VARCHAR(100),
                    phone VARCHAR(30),
                    honorarios REAL DEFAULT 0,
                    cuota_inicial REAL DEFAULT 0,
                    num_cuotas INTEGER DEFAULT 1,
                    monto_cuota REAL DEFAULT 0,
                    tipo_servicio VARCHAR(200),
                    area_name VARCHAR(100),
                    vendedor_name VARCHAR(100),
                    access_token VARCHAR(64) UNIQUE NOT NULL,
                    cuotas_pagadas INTEGER DEFAULT 0,
                    is_active BOOLEAN DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS pagacuotas_pagos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    cliente_id INTEGER NOT NULL REFERENCES pagacuotas_clientes(id) ON DELETE CASCADE,
                    monto REAL NOT NULL,
                    metodo VARCHAR(50),
                    referencia VARCHAR(100),
                    notas TEXT,
                    status VARCHAR(30) DEFAULT 'pendiente',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_pagacuotas_token ON pagacuotas_clientes (access_token)"))
            conn.commit()
        except Exception:
            pass

        # AI Agents tables
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS ai_agents (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name VARCHAR(100) NOT NULL,
                    description TEXT,
                    whatsapp_config_id INTEGER REFERENCES whatsapp_configs(id),
                    group_id INTEGER REFERENCES groups(id),
                    is_active BOOLEAN DEFAULT 1,
                    openai_api_key VARCHAR(200) NOT NULL,
                    openai_model VARCHAR(50) DEFAULT 'gpt-4o-mini',
                    temperature REAL DEFAULT 0.7,
                    max_tokens INTEGER DEFAULT 500,
                    max_history_messages INTEGER DEFAULT 20,
                    system_prompt TEXT NOT NULL,
                    response_delay_seconds INTEGER DEFAULT 2,
                    escalation_keywords TEXT DEFAULT '[]',
                    business_hours_start VARCHAR(5),
                    business_hours_end VARCHAR(5),
                    total_messages_sent INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS ai_agent_contact_states (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    agent_id INTEGER NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
                    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
                    state VARCHAR(20) DEFAULT 'active',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME,
                    UNIQUE(agent_id, contact_id)
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS ai_agent_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    agent_id INTEGER NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
                    contact_id INTEGER REFERENCES contacts(id),
                    lead_id INTEGER REFERENCES leads(id),
                    input_message TEXT,
                    output_message TEXT,
                    tokens_used INTEGER DEFAULT 0,
                    model_used VARCHAR(50),
                    latency_ms INTEGER DEFAULT 0,
                    error TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ai_agent_logs_agent ON ai_agent_logs(agent_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ai_agent_contact_agent ON ai_agent_contact_states(agent_id)"))
            conn.commit()
        except Exception:
            pass

        # ai_agent_configs M2M table + migrate existing single-config data
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS ai_agent_configs (
                    agent_id INTEGER NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
                    whatsapp_config_id INTEGER NOT NULL REFERENCES whatsapp_configs(id) ON DELETE CASCADE,
                    PRIMARY KEY (agent_id, whatsapp_config_id)
                )
            """))
            conn.execute(text("""
                INSERT OR IGNORE INTO ai_agent_configs (agent_id, whatsapp_config_id)
                SELECT id, whatsapp_config_id FROM ai_agents
                WHERE whatsapp_config_id IS NOT NULL
            """))
            conn.commit()
        except Exception:
            pass

        # Performance indexes (safe to re-run — CREATE INDEX IF NOT EXISTS)
        indexes = [
            "CREATE INDEX IF NOT EXISTS ix_leads_current_stage ON leads (current_stage)",
            "CREATE INDEX IF NOT EXISTS ix_leads_group_id ON leads (group_id)",
            "CREATE INDEX IF NOT EXISTS ix_leads_agendadora_id ON leads (agendadora_id)",
            "CREATE INDEX IF NOT EXISTS ix_leads_vendedor_id ON leads (vendedor_id)",
            "CREATE INDEX IF NOT EXISTS ix_leads_created_at ON leads (created_at)",
            "CREATE INDEX IF NOT EXISTS ix_leads_stage_group ON leads (current_stage, group_id)",
            "CREATE INDEX IF NOT EXISTS ix_leads_contact_id ON leads (contact_id)",
            "CREATE INDEX IF NOT EXISTS ix_wamsg_lead_id ON whatsapp_messages (lead_id)",
            "CREATE INDEX IF NOT EXISTS ix_wamsg_contact_id ON whatsapp_messages (contact_id)",
            "CREATE INDEX IF NOT EXISTS ix_notif_user_id ON notifications (user_id)",
            "CREATE INDEX IF NOT EXISTS ix_notif_is_read ON notifications (is_read)",
        ]
        for stmt in indexes:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass

        # Add negocio_id to groups (self-referential FK for sub-groups)
        try:
            conn.execute(text("ALTER TABLE groups ADD COLUMN negocio_id INTEGER REFERENCES groups(id)"))
            conn.commit()
        except Exception:
            pass

        # Add tipo to groups (negocio type — drives pipeline mode & integrations)
        try:
            conn.execute(text("ALTER TABLE groups ADD COLUMN tipo VARCHAR(50) NOT NULL DEFAULT 'abogados'"))
            conn.commit()
        except Exception:
            pass

        # ISO 27001 A.9.4.2 — brute-force lockout columns on users
        for stmt in [
            "ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE users ADD COLUMN locked_until DATETIME",
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass

        # ISO 27001 A.12.4.1 — security audit log table
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS security_audit_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    actor_email VARCHAR(100),
                    action VARCHAR(100) NOT NULL,
                    resource_type VARCHAR(50),
                    resource_id INTEGER,
                    ip_address VARCHAR(45),
                    user_agent VARCHAR(500),
                    details TEXT,
                    severity VARCHAR(20) NOT NULL DEFAULT 'info',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_sal_action ON security_audit_logs(action)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_sal_created ON security_audit_logs(created_at)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_sal_severity ON security_audit_logs(severity)"))
            conn.commit()
        except Exception:
            pass

        # group_users M2M table (user can belong to multiple groups)
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS group_users (
                    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    PRIMARY KEY (group_id, user_id)
                )
            """))
            conn.commit()
        except Exception:
            pass

        # Pipeline stages table for non-abogados negocios
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS pipeline_stages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    negocio_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
                    key VARCHAR(100) NOT NULL,
                    name VARCHAR(100) NOT NULL,
                    color VARCHAR(50),
                    "order" INTEGER DEFAULT 0,
                    UNIQUE(negocio_id, key)
                )
            """))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_pipeline_stages_negocio ON pipeline_stages(negocio_id)"))
            conn.commit()
        except Exception:
            pass

@app.on_event("startup")
async def startup():
    startup_lock = None
    try:
        from .database import _is_sqlite
        if not _is_sqlite:
            startup_lock = engine.connect()
            startup_lock.execute(text("SELECT pg_advisory_lock(5288001)"))

        _run_pg_migrations()
        _run_migrations()
        try:
            seed()
        except Exception:
            pass
        _ensure_tecnico()
        try:
            _migrate_negocio()  # Must run after seed so superadmin user exists
        except Exception:
            pass
        try:
            from .database import SessionLocal as _SL
            _db = _SL()
            cobrador.seed_cobrador(_db)  # ensures cobrador user exists
            result = cobrador.sync_morosos(_db)
            if result["ok"] and result.get("created", 0) + result.get("updated", 0) > 0:
                print(f"✅ LF sync: {result['created']} nuevos, {result['updated']} actualizados ({result['total']} morosos)")
            elif not result["ok"]:
                import logging as _log
                _log.getLogger(__name__).debug("LF sync skipped: %s", result.get("error"))
            # Process PagaCuotas payment backlog on startup
            try:
                from .routers.legal_finance_integration import process_pagacuotas_pending_payments
                n_pc = process_pagacuotas_pending_payments(_db)
                if n_pc > 0:
                    print(f"✅ PagaCuotas backlog: {n_pc} pagos procesados al arrancar")
            except Exception as e:
                import logging as _log
                _log.getLogger(__name__).debug("PagaCuotas backlog skipped: %s", e)
            _db.close()
        except Exception as e:
            import logging as _log
            _log.getLogger(__name__).debug("cobrador startup skipped: %s", e)
    finally:
        if startup_lock is not None:
            try:
                startup_lock.execute(text("SELECT pg_advisory_unlock(5288001)"))
            finally:
                startup_lock.close()
    await wa_broadcaster.start()
    # Telegram: long-polling para bots activos (si no hay webhook público)
    try:
        await telegram.start_all_polling()
    except Exception as _tg_exc:
        import logging as _log
        _log.getLogger(__name__).warning("Telegram polling startup skipped: %s", _tg_exc)
    # Start background auto-sync for cobrador leads (every 5 minutes)
    asyncio.create_task(_auto_sync_cobrador())
    # Start background papelera cleanup (every 6 hours)
    asyncio.create_task(_auto_cleanup_papelera())
    # Start background payment commitment day reminders (every hour)
    asyncio.create_task(_auto_send_payment_reminders())
    # Start background meeting reminders (daily summary + 2h/now alerts)
    asyncio.create_task(_auto_meeting_reminders())
    # Start background cartera sync CRM cobradores → sistema contable (analista dashboard)
    asyncio.create_task(_auto_sync_carteras())


async def _auto_sync_cobrador():
    """Background task: sync morosos from Legal Finance every 5 minutes.
    Broadcasts SSE + push notification when new morosos arrive."""
    await asyncio.sleep(60)  # wait 1 min after startup before first auto-sync
    while True:
        try:
            from .database import SessionLocal as _SL
            from .routers import cobrador as _cobrador
            _db = _SL()
            try:
                # Sync pendiente_morosos (EN_PROCESO_MORA) from Hive service
                try:
                    _cobrador.sync_pendiente_morosos(_db)
                except Exception as _pe:
                    print(f"⚠️  pendiente_morosos sync error: {_pe}")

                # Sync morosos from LF
                result = _cobrador.sync_morosos(_db)
                n_created = result.get("created", 0)
                n_updated = result.get("updated", 0)

                # Process PagaCuotas pending/failed payments
                from .routers.legal_finance_integration import process_pagacuotas_pending_payments
                n_pc = process_pagacuotas_pending_payments(_db)
                if n_pc > 0:
                    print(f"✅ PagaCuotas sync: {n_pc} pagos procesados")
                    n_updated += n_pc

                if result.get("ok") and (n_created > 0 or n_updated > 0):
                    print(f"✅ Auto-sync LF: {n_created} nuevos morosos, {n_updated} actualizados")
                    # Broadcast SSE so cobrador panels reload automatically
                    await wa_broadcaster.broadcast("cobrador_sync", {
                        "created": n_created,
                        "updated": n_updated,
                    })
                    # Push notification only when new morosos arrive
                    if n_created > 0:
                        try:
                            from .routers.push import send_push_to_user
                            cobradores = _db.query(models.User).filter(
                                models.User.role == "cobrador",
                                models.User.is_active == True,
                            ).all()
                            for cob in cobradores:
                                send_push_to_user(
                                    _db, cob.id,
                                    title="📋 Nuevos morosos en tu cartera",
                                    body=f"{n_created} cliente{'s' if n_created > 1 else ''} nuevo{'s' if n_created > 1 else ''} asignado{'s' if n_created > 1 else ''} desde Legal Finance",
                                    url="/cobrador/cartera",
                                )
                        except Exception as pe:
                            print(f"⚠️  Push cobrador failed: {pe}")
            finally:
                _db.close()
        except Exception as e:
            print(f"⚠️  Auto-sync cobrador error: {e}")
        await asyncio.sleep(300)  # 5 minutes


async def _auto_sync_carteras():
    """Background task: sincroniza carteras de cobranza hacia el sistema contable.

    El dashboard del analista (systemFinance) atribuye cuotas/pagos/aging por
    Cliente.cobrador_id. Esta tarea mantiene eso al día sin pasos manuales:
      1. Espeja cada cobrador activo del CRM como Usuario (rol COBRADOR) en la
         DB contable, identificado por email.
      2. Asigna Cliente.cobrador_id según la cartera del CRM (match por RUT con
         cobrador_leads). Sin match: si hay un único cobrador activo, se le
         asignan los clientes sin dueño.
    """
    await asyncio.sleep(150)  # wait after startup
    import os as _os
    from sqlalchemy import create_engine as _ce
    while True:
        try:
            from .database import SessionLocal
            contable_url = _os.getenv("CONTABLE_DATABASE_URL", "")
            if not contable_url or "CHANGE_ME" in contable_url:
                await asyncio.sleep(600)
                continue

            _db = SessionLocal()
            _got_lock = False
            try:
                from .database import _is_sqlite as _is_sq3
                _got_lock = True if _is_sq3 else bool(_db.execute(text("SELECT pg_try_advisory_lock(5288003)")).scalar())
                if _got_lock:
                    def _norm_rut(r):
                        if not r:
                            return None
                        r = r.replace(".", "").replace(" ", "").upper()
                        return r if r and not r.startswith("SIN-RUT") else None

                    cobradores = _db.query(models.User).filter(
                        models.User.role == "cobrador", models.User.is_active == True,
                    ).all()
                    # rut → email del cobrador CRM (cartera vigente, lead más reciente gana)
                    rut_owner: dict[str, str] = {}
                    if cobradores:
                        email_of = {c.id: c.email for c in cobradores}
                        rows = _db.query(models.CobradorLead.rut, models.CobradorLead.cobrador_id) \
                            .filter(models.CobradorLead.cobrador_id.in_(list(email_of))) \
                            .order_by(models.CobradorLead.id.asc()).all()
                        for rut, cid in rows:
                            nr = _norm_rut(rut)
                            if nr:
                                rut_owner[nr] = email_of[cid]

                    if cobradores:
                        engine = _ce(contable_url, pool_pre_ping=True)
                        try:
                            with engine.begin() as conn:
                                # 1) Usuarios espejo por email
                                mirror_id: dict[str, int] = {}
                                for c in cobradores:
                                    row = conn.execute(text('SELECT id FROM "Usuario" WHERE email = :e'), {"e": c.email}).first()
                                    if row:
                                        conn.execute(text(
                                            'UPDATE "Usuario" SET nombre = :n, activo = true, updated_at = now() '
                                            "WHERE id = :i AND (nombre <> :n OR activo = false)"
                                        ), {"n": c.name, "i": row[0]})
                                        mirror_id[c.email] = row[0]
                                    else:
                                        new = conn.execute(text(
                                            'INSERT INTO "Usuario" (empresa_id, nombre, email, password_hash, rol, activo, dedicacion, created_at, updated_at) '
                                            "SELECT empresa_id, :n, :e, password_hash, 'COBRADOR', true, 100, now(), now() "
                                            'FROM "Usuario" ORDER BY id LIMIT 1 RETURNING id'
                                        ), {"n": c.name, "e": c.email}).first()
                                        if new:
                                            mirror_id[c.email] = new[0]

                                # 2) Asignación de clientes por RUT (fallback: único cobrador)
                                unico = mirror_id.get(cobradores[0].email) if len(cobradores) == 1 else None
                                clientes = conn.execute(text('SELECT id, rut, cobrador_id FROM "Cliente"')).fetchall()
                                cambios = 0
                                for cid_, rut_, actual in clientes:
                                    nr = _norm_rut(rut_)
                                    target = mirror_id.get(rut_owner.get(nr, "")) if nr else None
                                    if target is None and actual is None and unico is not None:
                                        target = unico
                                    if target is not None and target != actual:
                                        conn.execute(text('UPDATE "Cliente" SET cobrador_id = :t WHERE id = :i'), {"t": target, "i": cid_})
                                        cambios += 1
                                if cambios:
                                    print(f"✅ Cartera sync: {cambios} cliente(s) contable(s) asignados a cobradores CRM")
                        finally:
                            engine.dispose()
            finally:
                if _got_lock:
                    try:
                        _db.execute(text("SELECT pg_advisory_unlock(5288003)"))
                    except Exception:
                        pass
                _db.close()
        except Exception as e:
            print(f"⚠️  Cartera sync error: {e}")
        await asyncio.sleep(300)  # 5 minutos


async def _auto_meeting_reminders():
    """Background task: recordatorios de reuniones para vendedores.
    - Resumen diario a las 08:00 (Chile): "Hoy tienes N reuniones (HH:MM, ...)".
    - Aviso ~2h antes de cada reunión: "En 1 h 45 min tienes reunión con X (a las HH:MM)".
    - Aviso al inicio: "Tu reunión comienza ahora".
    Dedupe vía tabla notifications (notification_type + event_id/usuario).
    create_notification ya dispara SSE + web push."""
    await asyncio.sleep(90)  # wait after startup
    from zoneinfo import ZoneInfo
    _TZ = ZoneInfo("America/Santiago")
    while True:
        try:
            from datetime import datetime, timezone, timedelta
            from sqlalchemy.orm import joinedload as _jl
            from .database import SessionLocal
            from . import models
            from .utils.notifications import create_notification

            now = datetime.now(timezone.utc)
            now_cl = now.astimezone(_TZ)
            _db = SessionLocal()
            _got_lock = False
            try:
                # Solo un worker uvicorn procesa recordatorios por iteración
                from .database import _is_sqlite as _is_sq2
                _got_lock = True if _is_sq2 else bool(_db.execute(text("SELECT pg_try_advisory_lock(5288002)")).scalar())
                if _got_lock:
                    def _aware(dt):
                        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

                    def _already(uid, kind, event_id=None, since=None):
                        q = _db.query(models.Notification.id).filter(
                            models.Notification.user_id == uid,
                            models.Notification.notification_type == kind,
                        )
                        if event_id is not None:
                            q = q.filter(models.Notification.event_id == event_id)
                        if since is not None:
                            q = q.filter(models.Notification.created_at >= since)
                        return q.first() is not None

                    # ── Avisos por reunión (2h antes y al inicio) ──
                    upcoming = (
                        _db.query(models.CalendarEvent)
                        .options(_jl(models.CalendarEvent.lead).joinedload(models.Lead.contact))
                        .filter(
                            models.CalendarEvent.start_time >= now - timedelta(minutes=10),
                            models.CalendarEvent.start_time <= now + timedelta(hours=2),
                            models.CalendarEvent.vendor_status.is_(None),
                        )
                        .all()
                    )
                    for ev in upcoming:
                        uid = ev.assigned_to or ev.created_by
                        if not uid:
                            continue
                        start = _aware(ev.start_time)
                        delta_min = int((start - now).total_seconds() // 60)
                        name = ev.lead.contact.name if ev.lead and ev.lead.contact else (ev.title or "cliente")
                        hora = start.astimezone(_TZ).strftime("%H:%M")
                        if delta_min <= 10:
                            kind = "meeting_reminder_now"
                            title = "🎥 Tu reunión comienza ahora"
                            msg = f"Reunión con {name} a las {hora}."
                        else:
                            kind = "meeting_reminder_2h"
                            title = "⏰ Reunión próxima"
                            resta = f"{delta_min // 60} h {delta_min % 60:02d} min" if delta_min >= 60 else f"{delta_min} min"
                            msg = f"En {resta} tienes reunión con {name} (a las {hora})."
                        if _already(uid, kind, event_id=ev.id):
                            continue
                        create_notification(_db, uid, title, msg, lead_id=ev.lead_id,
                                            event_id=ev.id, notification_type=kind)
                        _db.commit()

                    # ── Resumen diario a partir de las 08:00 Chile ──
                    if now_cl.hour >= 8:
                        day_start_cl = now_cl.replace(hour=0, minute=0, second=0, microsecond=0)
                        day_start = day_start_cl.astimezone(timezone.utc)
                        day_end = (day_start_cl + timedelta(days=1)).astimezone(timezone.utc)
                        todays = (
                            _db.query(models.CalendarEvent)
                            .filter(
                                models.CalendarEvent.start_time >= day_start,
                                models.CalendarEvent.start_time < day_end,
                                models.CalendarEvent.vendor_status.is_(None),
                            )
                            .all()
                        )
                        by_user: dict[int, list] = {}
                        for ev in todays:
                            uid = ev.assigned_to or ev.created_by
                            if uid:
                                by_user.setdefault(uid, []).append(ev)
                        for uid, evs in by_user.items():
                            if _already(uid, "meeting_daily_summary", since=day_start):
                                continue
                            evs.sort(key=lambda e: _aware(e.start_time))
                            horas = ", ".join(_aware(e.start_time).astimezone(_TZ).strftime("%H:%M") for e in evs[:5])
                            n = len(evs)
                            msg = f"Hoy tienes {n} reunión{'es' if n != 1 else ''} ({horas})."
                            create_notification(_db, uid, "📅 Reuniones de hoy", msg,
                                                notification_type="meeting_daily_summary")
                            _db.commit()
            finally:
                if _got_lock:
                    try:
                        _db.execute(text("SELECT pg_advisory_unlock(5288002)"))
                    except Exception:
                        pass
                _db.close()
        except Exception as e:
            print(f"⚠️  Meeting reminders error: {e}")
        await asyncio.sleep(60)


async def _auto_send_payment_reminders():
    """Background task: on the payment commitment date, resend WA link to the client.
    Runs every hour; sends once per day per lead using payment_reminder_sent_at guard."""
    await asyncio.sleep(120)  # wait 2 min after startup
    while True:
        try:
            from datetime import datetime, timezone, date as _date
            from sqlalchemy.orm import joinedload as _jl
            from .database import SessionLocal
            from . import models
            from .routers.leads import _dispatch_payment_link_wa

            today = datetime.now(timezone.utc).date()
            _db = SessionLocal()
            try:
                leads = (
                    _db.query(models.Lead)
                    .options(_jl(models.Lead.contact))
                    .filter(
                        models.Lead.current_stage == "pago_comprometido",
                        models.Lead.payment_commitment_date == today,
                        models.Lead.pagacuotas_link.isnot(None),
                        (models.Lead.payment_reminder_sent_at == None) |
                        (models.Lead.payment_reminder_sent_at != today),
                    )
                    .all()
                )
                for lead in leads:
                    if not lead.contact or not lead.contact.phone:
                        continue
                    try:
                        _dispatch_payment_link_wa(lead, lead.contact, lead.pagacuotas_link, _db)
                        lead.payment_reminder_sent_at = today
                        _db.commit()
                        print(f"✅ Recordatorio pago enviado WA → lead {lead.id} ({lead.contact.name})")
                    except Exception as exc:
                        print(f"⚠️  Reminder WA failed lead {lead.id}: {exc}")
            finally:
                _db.close()
        except Exception as e:
            print(f"⚠️  Auto payment reminder error: {e}")
        await asyncio.sleep(3600)  # 1 hour


async def _auto_cleanup_papelera():
    """Background task: permanently delete leads in papelera after 30 days."""
    await asyncio.sleep(300)  # wait 5 min after startup
    while True:
        try:
            from datetime import datetime, timezone, timedelta
            from sqlalchemy.orm import Session
            from .database import SessionLocal
            from . import models
            cutoff = datetime.now(timezone.utc) - timedelta(days=30)
            db: Session = SessionLocal()
            try:
                old_leads = db.query(models.Lead).filter(
                    models.Lead.current_stage == "papelera",
                    models.Lead.deleted_at <= cutoff,
                ).all()
                for lead in old_leads:
                    try:
                        db.query(models.WhatsAppMessage).filter(models.WhatsAppMessage.lead_id == lead.id).update({"lead_id": None}, synchronize_session=False)
                        db.query(models.AIAgentLog).filter(models.AIAgentLog.lead_id == lead.id).update({"lead_id": None}, synchronize_session=False) if hasattr(models, 'AIAgentLog') else None
                        db.query(models.Notification).filter(models.Notification.lead_id == lead.id).delete(synchronize_session=False)
                        db.query(models.CalendarEvent).filter(models.CalendarEvent.lead_id == lead.id).delete(synchronize_session=False)
                        db.query(models.PaymentVerification).filter(models.PaymentVerification.lead_id == lead.id).delete(synchronize_session=False)
                        db.query(models.WorkOrder).filter(models.WorkOrder.lead_id == lead.id).delete(synchronize_session=False)
                        db.query(models.LeadHistory).filter(models.LeadHistory.lead_id == lead.id).delete(synchronize_session=False)
                        db.query(models.Lead).filter(models.Lead.id == lead.id).delete(synchronize_session=False)
                        db.commit()
                    except Exception:
                        db.rollback()
            finally:
                db.close()
        except Exception:
            pass
        await asyncio.sleep(6 * 3600)  # run every 6 hours


@app.on_event("shutdown")
async def shutdown():
    await wa_broadcaster.stop()


def _migrate_negocio():
    """Assign orphan superadmins to a root negocio group. Must run AFTER seed()."""
    with engine.connect() as conn:
        try:
            orphan_admins = conn.execute(text(
                "SELECT id, name FROM users WHERE role='superadmin' AND group_id IS NULL ORDER BY id"
            )).fetchall()
            if not orphan_admins:
                return
            has_negocio = conn.execute(text(
                "SELECT g.id FROM groups g INNER JOIN users u ON u.group_id=g.id "
                "WHERE u.role='superadmin' AND g.negocio_id IS NULL LIMIT 1"
            )).fetchone()
            if has_negocio:
                # Root group already exists — assign any remaining orphans to it
                root_id = has_negocio[0]
                orphan_ids = ",".join(str(r[0]) for r in orphan_admins)
                conn.execute(text(f"UPDATE users SET group_id={root_id} WHERE id IN ({orphan_ids})"))
                conn.commit()
                pass  # orphan superadmins assigned to existing negocio
            else:
                # No root group yet — create one and assign ALL orphans
                from .database import _is_sqlite
                if _is_sqlite:
                    conn.execute(text(
                        "INSERT INTO groups (name, description, tipo) "
                        "VALUES ('Abogados Tributarios', 'Negocio principal', 'abogados')"
                    ))
                    conn.commit()
                    root_id = conn.execute(text("SELECT last_insert_rowid()")).scalar()
                else:
                    row = conn.execute(text(
                        "INSERT INTO groups (name, description, tipo) "
                        "VALUES ('Abogados Tributarios', 'Negocio principal', 'abogados') "
                        "RETURNING id"
                    )).fetchone()
                    conn.commit()
                    root_id = row[0]
                orphan_ids = ",".join(str(r[0]) for r in orphan_admins)
                conn.execute(text(f"UPDATE users SET group_id={root_id} WHERE id IN ({orphan_ids})"))
                conn.execute(text(
                    f"UPDATE groups SET negocio_id={root_id} "
                    f"WHERE negocio_id IS NULL AND id != {root_id}"
                ))
                conn.commit()
                pass  # negocio root group created
        except Exception:
            pass


@app.get("/health")
def health():
    return {"status": "ok"}


# Serve uploaded files (invoices, etc.)
uploads_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../uploads"))
os.makedirs(uploads_dir, exist_ok=True)
os.makedirs(os.path.join(uploads_dir, "whatsapp_media"), exist_ok=True)
os.makedirs(os.path.join(uploads_dir, "telegram_media"), exist_ok=True)
try:
    app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")
except Exception:
    pass

# Serve frontend static files
static_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../frontend/dist"))

if os.path.isdir(static_dir):
    try:
        app.mount("/assets", StaticFiles(directory=os.path.join(static_dir, "assets")), name="assets")
    except Exception:
        pass

@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    # Ignore API routes so they return proper 404 JSON if not matched
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="API route not found")
        
    path = os.path.join(static_dir, full_path)
    if full_path and os.path.isfile(path):
        return FileResponse(path)
    
    index_path = os.path.join(static_dir, "index.html")
    if os.path.isfile(index_path):
        return FileResponse(index_path, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
        
    return {"message": "Frontend not built yet. Please run 'npm run build' first."}
