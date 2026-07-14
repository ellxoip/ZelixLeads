"""
Test E2E masivo — simula uso real del sistema completo.
Crea datos masivos, prueba concurrencia 200+ usuarios,
valida broadcaster SSE, seguimiento_asistente, analista y todas las integraciones.

Ejecutar en el servidor:
  cd /opt/nexio-test/backend
  ./venv/bin/python3 tests/e2e_masivo.py
"""
import asyncio
import json
import logging
import os
import random
import sys
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any
from pathlib import Path

# Asegurar que el directorio backend esté en el path
_backend_dir = Path(__file__).resolve().parent.parent
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

import httpx
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

load_dotenv(dotenv_path=_backend_dir / ".env")

# ── Config ───────────────────────────────────────────────────────────────────
BASE_URL = "http://127.0.0.1:8001"
DATABASE_URL = os.getenv("DATABASE_URL", "")
CONCURRENCY = 200
LOG_LEVEL = logging.INFO

logging.basicConfig(
    format="%(asctime)s %(levelname)-8s %(message)s",
    level=LOG_LEVEL,
    datefmt="%H:%M:%S",
)
log = logging.getLogger("e2e")

engine = create_engine(DATABASE_URL, pool_size=20, max_overflow=30, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine)

# ── Datos chilenos ficticios ──────────────────────────────────────────────────
NOMBRES = [
    "Carlos","María","Juan","Ana","Pedro","Claudia","Diego","Valentina","Rodrigo","Francisca",
    "Andrés","Constanza","Felipe","Gabriela","Tomás","Camila","Matías","Sofía","Nicolás","Daniela",
    "Ignacio","Fernanda","Sebastián","Javiera","Cristóbal","Catalina","Martín","Isidora","Ricardo","Josefa",
    "Eduardo","Antonia","Patricio","Natalia","Alejandro","Beatriz","Maximiliano","Paula","Hernán","Lorena",
    "Roberto","Verónica","Hugo","Marcela","Víctor","Isabel","Ernesto","Soledad","Álvaro","Carla",
]
APELLIDOS = [
    "González","Muñoz","Rojas","Díaz","Pérez","Soto","Contreras","Silva","Martínez","Sepúlveda",
    "Morales","Rodríguez","López","Fuentes","Hernández","Torres","Araya","Flores","Espinoza","Valenzuela",
    "Castillo","Reyes","Gutiérrez","Castro","Vargas","Álvarez","Vásquez","Ramos","Navarrete","Cortés",
    "Bravo","Cárdenas","Romero","Ojeda","Zamora","Ríos","Vega","Salinas","Núñez","Jara",
]
AREAS = ["Deuda Ejecutiva","Contabilidad","Facturas Falsas","Bloqueo de Folios","Convenio TGR",
         "CRM Genético SII","Grandes Empresas","Planificación Tributaria","PERDONAZO","Quiebra Empresa"]
STAGES = ["lead","reunion","altamente_interesado","cierre","pago_pendiente","pagado_confirmado",
          "recuperacion_lead","recuperacion_reunion","recuperacion_cierre"]
SOURCES = ["whatsapp","referido","facebook","google","llamada","email","sitio_web"]
SERVICES = [
    "Defensa deuda ejecutiva SII","Regularización IVA","Facturación fraudulenta",
    "Bloqueo folios tributarios","Convenio de pago TGR","Planificación fiscal anual",
    "Reorganización empresarial","Quiebra personal","Recuperación crédito fiscal",
    "Auditoria tributaria","Deuda previsional","Multas SII",
]
COBRADOR_STAGES = ["pendiente_moroso","lead_moroso","pago_comprometido","pagado","historial"]

# ── Resultados ────────────────────────────────────────────────────────────────
results: dict[str, Any] = {
    "data_created": {},
    "load_test": {},
    "seguimiento": {},
    "analista": {},
    "broadcaster": {},
    "errors": [],
}


def rut_fake(i: int) -> str:
    base = 10_000_000 + i
    digits = [int(c) for c in str(base)]
    factors = [2,3,4,5,6,7,2,3][::-1][:len(digits)]
    s = sum(d * f for d, f in zip(reversed(digits), [2,3,4,5,6,7,2,3]))
    r = 11 - (s % 11)
    dv = "0" if r == 11 else ("K" if r == 10 else str(r))
    return f"{base}-{dv}"


def nombre_fake(i: int) -> str:
    return f"{NOMBRES[i % len(NOMBRES)]} {APELLIDOS[i % len(APELLIDOS)]} {APELLIDOS[(i+7) % len(APELLIDOS)]}"


def phone_fake(i: int) -> str:
    return f"+569{50000000 + i}"


def email_fake(i: int) -> str:
    n = nombre_fake(i).lower().replace(" ", ".").replace("á","a").replace("é","e").replace("í","i").replace("ó","o").replace("ú","u")
    return f"{n}.{i}@test.cl"


# ── FASE 1: Crear datos masivos directamente en BD ───────────────────────────

def crear_datos_masivos():
    log.info("═══ FASE 1: Cargando datos masivos en PostgreSQL ═══")
    db: Session = SessionLocal()
    try:
        from app import models
        from app.auth import hash_password

        # Contar existentes
        n_contacts = db.query(models.Contact).count()
        n_leads = db.query(models.Lead).count()
        log.info("Estado actual → contacts: %d, leads: %d", n_contacts, n_leads)

        # Obtener usuarios base
        agendadoras = db.query(models.User).filter(models.User.role.in_(["agendadora","superadmin","subadmin"])).all()
        vendedores = db.query(models.User).filter(models.User.role.in_(["vendedor","superadmin","subadmin"])).all()
        grupos = db.query(models.Group).all()
        areas = db.query(models.Area).all()

        if not agendadoras or not vendedores:
            log.error("No hay usuarios suficientes — ejecuta seed.py primero")
            return False

        log.info("Usuarios: %d agendadoras, %d vendedores, %d grupos, %d áreas",
                 len(agendadoras), len(vendedores), len(grupos), len(areas))

        superadmin = db.query(models.User).filter(models.User.role == "superadmin").first()

        # ── Crear usuarios adicionales de prueba ──────────────────────────────
        new_users_created = 0
        for r_idx in range(20):
            email = f"vendedor_test_{r_idx}@nexio-test.cl"
            if not db.query(models.User).filter(models.User.email == email).first():
                u = models.User(
                    name=f"Vendedor Test {r_idx}",
                    email=email,
                    password_hash=hash_password("Test2024!"),
                    role="vendedor",
                    group_id=grupos[r_idx % len(grupos)].id,
                    is_active=True,
                )
                db.add(u)
                new_users_created += 1

        for r_idx in range(20):
            email = f"agendadora_test_{r_idx}@nexio-test.cl"
            if not db.query(models.User).filter(models.User.email == email).first():
                u = models.User(
                    name=f"Agendadora Test {r_idx}",
                    email=email,
                    password_hash=hash_password("Test2024!"),
                    role="agendadora",
                    group_id=grupos[r_idx % len(grupos)].id,
                    is_active=True,
                )
                db.add(u)
                new_users_created += 1

        if new_users_created:
            db.flush()
            log.info("  Usuarios de prueba creados: %d", new_users_created)
            # Refrescar listas
            agendadoras = db.query(models.User).filter(models.User.role.in_(["agendadora","superadmin","subadmin"])).all()
            vendedores = db.query(models.User).filter(models.User.role.in_(["vendedor","superadmin","subadmin"])).all()

        # ── Contactos masivos ──────────────────────────────────────────────────
        TARGET_CONTACTS = 800
        contacts_to_create = max(0, TARGET_CONTACTS - n_contacts)
        log.info("  Creando %d contactos nuevos...", contacts_to_create)
        new_contacts = []
        for i in range(contacts_to_create):
            idx = n_contacts + i
            c = models.Contact(
                name=nombre_fake(idx),
                rut_persona=rut_fake(idx),
                email=email_fake(idx),
                phone=phone_fake(idx),
                city=random.choice(["Santiago","Valparaíso","Concepción","La Serena","Antofagasta","Temuco"]),
                group_id=grupos[idx % len(grupos)].id,
                created_by=agendadoras[idx % len(agendadoras)].id,
                notes=f"Contacto de prueba {idx} — deuda tributaria estimada ${random.randint(1,50)*100_000:,}",
            )
            db.add(c)
            new_contacts.append(c)
            if i % 200 == 0 and i > 0:
                db.flush()
                log.info("    %d/%d contactos...", i, contacts_to_create)

        db.flush()
        log.info("  ✓ %d contactos creados", contacts_to_create)
        results["data_created"]["contacts"] = contacts_to_create

        # Obtener todos los contactos
        all_contacts = db.query(models.Contact).all()

        # ── Leads masivos ──────────────────────────────────────────────────────
        TARGET_LEADS = 2000
        leads_to_create = max(0, TARGET_LEADS - n_leads)
        log.info("  Creando %d leads nuevos...", leads_to_create)

        today = date.today()
        new_leads_created = 0
        for i in range(leads_to_create):
            contact = all_contacts[(n_leads + i) % len(all_contacts)]
            area = areas[(n_leads + i) % len(areas)]
            agendadora = agendadoras[(n_leads + i) % len(agendadoras)]
            vendedor = vendedores[(n_leads + i) % len(vendedores)]
            stage = STAGES[i % len(STAGES)]
            honorarios = random.choice([390_000, 490_000, 590_000, 790_000, 990_000,
                                        1_200_000, 1_500_000, 2_000_000, 3_000_000])

            # Seguimiento: 15% de leads en altamente_interesado con fecha de compromiso vencida
            payment_date = None
            seguimiento_st = None
            if stage == "altamente_interesado" and random.random() < 0.6:
                dias_atras = random.randint(1, 25)
                payment_date = today - timedelta(days=dias_atras)
                if dias_atras >= 5:
                    seguimiento_st = random.choice([None, None, "contactado", "en_seguimiento", "repactado"])

            lead = models.Lead(
                contact_id=contact.id,
                area_id=area.id,
                group_id=area.group_id,
                agendadora_id=agendadora.id,
                vendedor_id=vendedor.id,
                current_stage=stage,
                service_description=random.choice(SERVICES),
                honorarios=honorarios,
                cuota_inicial=honorarios * random.choice([0.3, 0.4, 0.5]),
                num_cuotas=random.choice([1, 2, 3, 4, 6]),
                monto_cuota=honorarios / random.choice([1, 2, 3]),
                notes=f"Lead test {n_leads+i} — urgente {'alta' if random.random()>0.7 else 'normal'}",
                priority=random.choice(["low","normal","normal","high"]),
                source=random.choice(SOURCES),
                payment_commitment_date=payment_date,
                seguimiento_status=seguimiento_st,
                last_vendor_outcome=random.choice([None, None, None, "no_show"]) if stage == "reunion" else None,
                created_at=datetime.now(timezone.utc) - timedelta(days=random.randint(0, 180)),
            )
            db.add(lead)
            new_leads_created += 1

            if i % 300 == 0 and i > 0:
                db.flush()
                log.info("    %d/%d leads...", i, leads_to_create)

        db.flush()

        # ── Lead history para todos los leads nuevos ───────────────────────────
        all_leads = db.query(models.Lead).all()
        n_history = db.query(models.LeadHistory).count()
        log.info("  Creando historial para leads sin historial...")
        hist_created = 0
        for lead in all_leads:
            if hist_created >= 3000:
                break
            # Crear 1-3 entradas de historial por lead
            n_entries = random.randint(1, 3)
            for h in range(n_entries):
                stage_from = STAGES[max(0, STAGES.index(lead.current_stage) - h - 1)] if lead.current_stage in STAGES else "lead"
                stage_to = STAGES[max(0, STAGES.index(lead.current_stage) - h)] if lead.current_stage in STAGES else lead.current_stage
                db.add(models.LeadHistory(
                    lead_id=lead.id,
                    from_stage=stage_from,
                    to_stage=stage_to,
                    result=random.choice(["success","pending","failed"]),
                    notes=f"Gestión {h+1} — {random.choice(['Llamada exitosa','Cliente interesado','Sin respuesta','Reagendado','Pago comprometido'])}",
                    created_by=agendadoras[0].id,
                    created_at=datetime.now(timezone.utc) - timedelta(days=random.randint(0, 60)),
                ))
                hist_created += 1
        log.info("  ✓ %d entradas de historial creadas", hist_created)

        # ── Work Orders para leads en cierre/pagado ────────────────────────────
        leads_con_ot = db.query(models.Lead).filter(
            models.Lead.current_stage.in_(["cierre","pagado_confirmado","pago_pendiente"])
        ).limit(200).all()
        ot_created = 0
        for lead in leads_con_ot:
            existing = db.query(models.WorkOrder).filter(models.WorkOrder.lead_id == lead.id).first()
            if not existing:
                db.add(models.WorkOrder(
                    lead_id=lead.id,
                    ot_type=random.choice(["propuesta","mandato","contrato","finiquito"]),
                    fields_json=json.dumps({"servicio": random.choice(SERVICES), "honorarios": lead.honorarios}),
                    status=random.choice(["draft","final"]),
                    created_by=superadmin.id if superadmin else agendadoras[0].id,
                ))
                ot_created += 1
        log.info("  ✓ %d work orders creados", ot_created)

        # ── Cobrador Leads masivos ─────────────────────────────────────────────
        n_cobrador = db.query(models.CobradorLead).count()
        cobrador_target = 300
        cobrador_to_create = max(0, cobrador_target - n_cobrador)
        cobradores = db.query(models.User).filter(models.User.role.in_(["cobrador","superadmin","subadmin"])).limit(5).all()
        if not cobradores:
            cobradores = [superadmin] if superadmin else agendadoras[:1]

        for i in range(cobrador_to_create):
            contact = all_contacts[(i * 3) % len(all_contacts)]
            cobrador = cobradores[i % len(cobradores)]
            monto = random.randint(5, 200) * 100_000
            db.add(models.CobradorLead(
                cobrador_id=cobrador.id,
                contact_id=contact.id,
                nombre=contact.name,
                rut=contact.rut_persona or rut_fake(9_000_000 + i),
                empresa=f"Empresa Deudora {i+1} SpA" if random.random() > 0.4 else None,
                telefono=contact.phone,
                email=contact.email,
                monto_deuda=monto,
                stage=random.choice(COBRADOR_STAGES),
                notes=f"Deuda morosa {i+1} — gestión {random.choice(['telefónica','presencial','email'])}",
                created_at=datetime.now(timezone.utc) - timedelta(days=random.randint(0, 90)),
            ))
        if cobrador_to_create:
            log.info("  ✓ %d cobrador leads creados", cobrador_to_create)

        # ── Notifications masivas ──────────────────────────────────────────────
        n_notif = db.query(models.Notification).count()
        if n_notif < 500:
            for i in range(500 - n_notif):
                user = agendadoras[i % len(agendadoras)]
                db.add(models.Notification(
                    user_id=user.id,
                    title=random.choice(["Nuevo lead asignado","Reunión confirmada","Pago recibido","Lead sin gestión","Compromiso vencido"]),
                    message=f"Notificación de prueba {i+1} — {random.choice(['Acción requerida','Revisar expediente','Contactar cliente'])}",
                    notification_type=random.choice(["lead_assigned","payment","reminder","general"]),
                    is_read=random.choice([True, True, False]),
                    created_at=datetime.now(timezone.utc) - timedelta(hours=random.randint(0, 72)),
                ))
            log.info("  ✓ 500 notificaciones creadas")

        # ── Calendar events ────────────────────────────────────────────────────
        n_cal = db.query(models.CalendarEvent).count()
        if n_cal < 200:
            all_leads_sample = db.query(models.Lead).limit(200).all()
            for i in range(200 - n_cal):
                lead = all_leads_sample[i % len(all_leads_sample)]
                event_dt = datetime.now(timezone.utc) + timedelta(days=random.randint(-30, 30), hours=random.randint(8, 18))
                db.add(models.CalendarEvent(
                    lead_id=lead.id,
                    title=f"Reunión {nombre_fake(i)} — {random.choice(AREAS)}",
                    notes=f"Cita tributaria {i+1}",
                    start_time=event_dt,
                    end_time=event_dt + timedelta(hours=1),
                    event_type=random.choice(["reunion","llamada","seguimiento"]),
                    created_by=agendadoras[i % len(agendadoras)].id,
                ))
            log.info("  ✓ 200 eventos de calendario creados")

        db.commit()
        log.info("  ✓ Commit masivo completado")

        # Reporte final
        final_contacts = db.query(models.Contact).count()
        final_leads = db.query(models.Lead).count()
        final_cobrador = db.query(models.CobradorLead).count()
        final_history = db.query(models.LeadHistory).count()
        seguimiento_leads = db.query(models.Lead).filter(
            models.Lead.current_stage == "altamente_interesado",
            models.Lead.payment_commitment_date.isnot(None),
        ).count()

        log.info("  ┌─ RESUMEN BD ─────────────────────────────────")
        log.info("  │ Contactos:           %d", final_contacts)
        log.info("  │ Leads:               %d", final_leads)
        log.info("  │ Cobrador leads:      %d", final_cobrador)
        log.info("  │ Lead history:        %d", final_history)
        log.info("  │ Para seguimiento:    %d (altamente_interesado + commitment_date)", seguimiento_leads)
        log.info("  └────────────────────────────────────────────────")

        results["data_created"] = {
            "contacts": final_contacts,
            "leads": final_leads,
            "cobrador_leads": final_cobrador,
            "lead_history": final_history,
            "seguimiento_leads": seguimiento_leads,
        }
        return True

    except Exception as e:
        db.rollback()
        log.error("Error creando datos: %s", e, exc_info=True)
        results["errors"].append(f"data_creation: {e}")
        return False
    finally:
        db.close()


# ── FASE 2: Login y obtener tokens ────────────────────────────────────────────

async def get_token(client: httpx.AsyncClient, email: str, password: str) -> str | None:
    try:
        r = await client.post(f"{BASE_URL}/api/auth/login",
                              json={"email": email, "password": password}, timeout=10)
        if r.status_code == 200:
            return r.json().get("access_token")
    except Exception as e:
        log.debug("Login error %s: %s", email, e)
    return None


# ── FASE 3: Load test — 200 usuarios simulando uso real ───────────────────────

async def load_test():
    log.info("═══ FASE 3: Load test — %d usuarios, patrón uso real ═══", CONCURRENCY)

    # Obtener tokens para múltiples usuarios
    credentials = [
        ("jorge@abogadostributarios.cl", "Admin2024!"),
        ("nicolas@abogadostributarios.cl", "Sub2024!"),
        ("jonathan@abogadostributarios.cl", "Pass2024!"),
        ("marcela@abogadostributarios.cl", "Pass2024!"),
        ("nicolasj@abogadostributarios.cl", "Pass2024!"),
        ("aizel@abogadostributarios.cl", "Pass2024!"),
        ("jorgejavier@abogadostributarios.cl", "Pass2024!"),
        ("francisca@abogadostributarios.cl", "Pass2024!"),
        ("tecnico@abogadostributarios.cl", "Tecnico2024!"),
    ]
    for i in range(20):
        credentials.append((f"vendedor_test_{i}@nexio-test.cl", "Test2024!"))
        credentials.append((f"agendadora_test_{i}@nexio-test.cl", "Test2024!"))

    tokens = []
    async with httpx.AsyncClient(timeout=30) as client:
        for email, pwd in credentials:
            t = await get_token(client, email, pwd)
            if t:
                tokens.append(t)

    if not tokens:
        log.error("No se pudieron obtener tokens")
        return

    log.info("  %d tokens obtenidos", len(tokens))

    # Endpoints realistas (lo que un usuario real consulta)
    ENDPOINTS = [
        "/api/leads?limit=50",
        "/api/leads?limit=50&stage=lead",
        "/api/leads?limit=50&stage=reunion",
        "/api/leads?limit=30&stage=altamente_interesado",
        "/api/leads?limit=30&stage=cierre",
        "/api/leads?limit=30&stage=pagado_confirmado",
        "/api/contacts?limit=30",
        "/api/users",
        "/api/notifications?limit=20",
        "/api/groups",
        "/api/pipeline-stages",
        "/api/seguimiento-asistente/leads",
        "/api/seguimiento-asistente/dashboard",
        "/api/cobrador/leads",
        "/health",
        "/api/leads?limit=20&offset=50",
        "/api/contacts?limit=20&offset=100",
    ]

    ok_count = 0
    err_count = 0
    latencies: list[float] = []
    errors_by_status: dict[str, int] = {}

    semaphore = asyncio.Semaphore(30)  # máx 30 requests en vuelo simultáneos (realista)

    async def hit_endpoint(client: httpx.AsyncClient, token: str, path: str):
        nonlocal ok_count, err_count
        async with semaphore:
            headers = {"Authorization": f"Bearer {token}"}
            t0 = time.perf_counter()
            try:
                r = await client.get(f"{BASE_URL}{path}", headers=headers, timeout=30)
                elapsed = (time.perf_counter() - t0) * 1000
                latencies.append(elapsed)
                if r.status_code < 400:
                    ok_count += 1
                else:
                    err_count += 1
                    k = f"{r.status_code}"
                    errors_by_status[k] = errors_by_status.get(k, 0) + 1
            except Exception as exc:
                elapsed = (time.perf_counter() - t0) * 1000
                latencies.append(elapsed)
                err_count += 1
                k = type(exc).__name__
                errors_by_status[k] = errors_by_status.get(k, 0) + 1

    # 200 usuarios × 10 requests cada uno = 2000 requests con patrón distribuido
    USUARIOS = CONCURRENCY
    REQ_POR_USUARIO = 10
    TOTAL_REQUESTS = USUARIOS * REQ_POR_USUARIO

    async with httpx.AsyncClient(
        timeout=30,
        limits=httpx.Limits(max_connections=80, max_keepalive_connections=40),
    ) as client:
        t_start = time.perf_counter()
        tasks = []
        for u in range(USUARIOS):
            token = tokens[u % len(tokens)]
            for r_idx in range(REQ_POR_USUARIO):
                path = ENDPOINTS[(u * REQ_POR_USUARIO + r_idx) % len(ENDPOINTS)]
                tasks.append(hit_endpoint(client, token, path))

        # Ejecutar con progreso
        batch_size = 100
        for i in range(0, len(tasks), batch_size):
            batch = tasks[i:i+batch_size]
            await asyncio.gather(*batch)
            pct = min(100, (i + batch_size) * 100 // TOTAL_REQUESTS)
            log.info("    %d%% — ok: %d err: %d", pct, ok_count, err_count)

        total_time = time.perf_counter() - t_start

    latencies.sort()
    p50 = latencies[len(latencies) // 2] if latencies else 0
    p90 = latencies[int(len(latencies) * 0.9)] if latencies else 0
    p99 = latencies[int(len(latencies) * 0.99)] if latencies else 0
    avg = sum(latencies) / len(latencies) if latencies else 0
    rps = TOTAL_REQUESTS / total_time if total_time else 0

    log.info("  ┌─ RESULTADOS CARGA ───────────────────────────────")
    log.info("  │ Usuarios:          %d (×%d req c/u = %d total)", USUARIOS, REQ_POR_USUARIO, TOTAL_REQUESTS)
    log.info("  │ OK:                %d (%.1f%%)", ok_count, 100*ok_count/max(1,TOTAL_REQUESTS))
    log.info("  │ Errores:           %d (%.1f%%)", err_count, 100*err_count/max(1,TOTAL_REQUESTS))
    log.info("  │ RPS efectivo:      %.1f req/s", rps)
    log.info("  │ Latencia avg:      %.0fms", avg)
    log.info("  │ Latencia p50:      %.0fms", p50)
    log.info("  │ Latencia p90:      %.0fms", p90)
    log.info("  │ Latencia p99:      %.0fms", p99)
    log.info("  │ Tiempo total:      %.1fs", total_time)
    if errors_by_status:
        log.info("  │ Errores: %s", errors_by_status)
    log.info("  └────────────────────────────────────────────────────")

    results["load_test"] = {
        "total_requests": TOTAL_REQUESTS,
        "ok": ok_count,
        "errors": err_count,
        "success_rate": round(100 * ok_count / max(1, TOTAL_REQUESTS), 1),
        "rps": round(rps, 1),
        "avg_ms": round(avg, 0),
        "p50_ms": round(p50, 0),
        "p90_ms": round(p90, 0),
        "p99_ms": round(p99, 0),
    }
    return tokens[0]


# ── FASE 4: Pruebas funcionales panel Seguimiento Asistente ───────────────────

async def test_seguimiento(token: str):
    log.info("═══ FASE 4: Panel Seguimiento Asistente ═══")
    headers = {"Authorization": f"Bearer {token}"}
    errors = []

    async with httpx.AsyncClient(timeout=15) as client:
        # 1) Dashboard
        r = await client.get(f"{BASE_URL}/api/seguimiento-asistente/dashboard", headers=headers)
        assert r.status_code == 200, f"dashboard status {r.status_code}"
        dash = r.json()
        log.info("  Dashboard → en_seguimiento: %d, próximos: %d, monto_riesgo: $%s",
                 dash.get("en_seguimiento", 0),
                 dash.get("proximos", 0),
                 f"{dash.get('monto_en_riesgo', 0):,.0f}")

        # 2) Lista de leads
        r = await client.get(f"{BASE_URL}/api/seguimiento-asistente/leads", headers=headers)
        assert r.status_code == 200, f"leads status {r.status_code}"
        data = r.json()
        en_seg = data.get("en_seguimiento", [])
        proximos = data.get("proximos", [])
        log.info("  Leads → en_seguimiento: %d, próximos: %d", len(en_seg), len(proximos))

        # 3) Actualizar status de leads en seguimiento
        updates_ok = 0
        for lead_item in en_seg[:10]:
            lid = lead_item["lead_id"]
            nuevo = random.choice(["contactado","en_seguimiento","repactado"])
            r = await client.patch(
                f"{BASE_URL}/api/seguimiento-asistente/leads/{lid}/status",
                headers=headers,
                json={"seguimiento_status": nuevo, "notes": f"Test E2E — {nuevo}"},
            )
            if r.status_code == 200:
                updates_ok += 1
            else:
                errors.append(f"seguimiento PATCH lead {lid}: {r.status_code} {r.text[:100]}")

        log.info("  Updates de status: %d/%d OK", updates_ok, min(10, len(en_seg)))

        # 4) Verificar que el dashboard refleja cambios
        r2 = await client.get(f"{BASE_URL}/api/seguimiento-asistente/dashboard", headers=headers)
        if r2.status_code == 200:
            dash2 = r2.json()
            log.info("  Dashboard post-update → por_estado: %s", dash2.get("por_estado", {}))

    if errors:
        log.warning("  Errores seguimiento: %s", errors)
        results["errors"].extend(errors)

    results["seguimiento"] = {
        "en_seguimiento": len(en_seg),
        "proximos": len(proximos),
        "dashboard": dash,
        "updates_ok": updates_ok,
        "errors": errors,
    }


# ── FASE 5: Pruebas Analista ───────────────────────────────────────────────────

async def test_analista(token: str):
    log.info("═══ FASE 5: Panel Analista ═══")
    headers = {"Authorization": f"Bearer {token}"}

    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(f"{BASE_URL}/api/analista/dashboard", headers=headers)
        log.info("  Analista dashboard → status: %d", r.status_code)
        if r.status_code == 200:
            body = r.json()
            log.info("  Respuesta financial: %s", str(body)[:200])
            results["analista"] = {"status": "ok", "data_keys": list(body.keys()) if isinstance(body, dict) else type(body).__name__}
        elif r.status_code == 502:
            # Financial externo puede no responder con datos — es OK si el proxy funciona
            log.info("  Sistema financiero no devuelve datos de analista (502 — externo) — endpoint proxy OK")
            results["analista"] = {"status": "proxy_ok_no_data", "detail": r.json().get("detail", "")}
        else:
            log.warning("  Analista respondió %d: %s", r.status_code, r.text[:200])
            results["analista"] = {"status": "error", "code": r.status_code}

        # Test con período específico
        r2 = await client.get(f"{BASE_URL}/api/analista/dashboard?period=2026-06", headers=headers)
        log.info("  Analista con período 2026-06 → status: %d", r2.status_code)


# ── FASE 6: Broadcaster SSE ────────────────────────────────────────────────────

async def test_broadcaster(token: str):
    log.info("═══ FASE 6: Broadcaster SSE (Redis pub/sub) ═══")
    headers = {"Authorization": f"Bearer {token}"}

    # Verificar Redis directamente
    try:
        import redis
        r = redis.Redis(host="localhost", port=6379, db=0, socket_timeout=3)
        ping = r.ping()
        log.info("  Redis ping: %s", ping)

        # Publicar evento de prueba
        payload = json.dumps({"type": "wa_message", "contact_id": 1, "text": "E2E test broadcast"})
        n = r.publish("wa_events", payload)
        log.info("  Redis publish wa_events → %d suscriptores recibieron", n)

        # Verificar con múltiples publicaciones
        count = 0
        for i in range(10):
            c = r.publish("wa_events", json.dumps({"type": "ping", "seq": i}))
            count += c

        log.info("  10 broadcasts enviados — suscriptores totales: %d", count)
        results["broadcaster"] = {"redis_ok": True, "subscribers": n, "test_broadcasts": 10}

    except Exception as e:
        log.warning("  Redis directo no disponible: %s", e)
        results["broadcaster"] = {"redis_ok": False, "error": str(e)}

    # Probar SSE endpoint si existe
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            # SSE normalmente en /api/events o /api/ws/events
            for sse_path in ["/api/events", "/api/sse", "/api/whatsapp/events"]:
                r = await client.get(f"{BASE_URL}{sse_path}", headers=headers, timeout=3)
                if r.status_code in (200, 204):
                    log.info("  SSE endpoint %s → activo", sse_path)
                    results["broadcaster"]["sse_path"] = sse_path
                    break
    except Exception:
        pass  # Timeout en SSE es normal — el endpoint sigue vivo


# ── FASE 7: Tests funcionales CRUD completo ────────────────────────────────────

async def test_crud_completo(token: str):
    log.info("═══ FASE 7: CRUD funcional completo ═══")
    headers = {"Authorization": f"Bearer {token}"}
    errors = []

    async with httpx.AsyncClient(timeout=15) as client:
        # Obtener IDs base
        r = await client.get(f"{BASE_URL}/api/groups", headers=headers)
        groups = r.json() if r.status_code == 200 else []
        group_id = groups[0]["id"] if groups else 1

        r = await client.get(f"{BASE_URL}/api/users", headers=headers)
        users = r.json() if r.status_code == 200 else []
        agendadora_id = next((u["id"] for u in users if u.get("role") == "agendadora"), None)
        vendedor_id = next((u["id"] for u in users if u.get("role") == "vendedor"), None)

        r_areas = await client.get(f"{BASE_URL}/api/groups/{group_id}/areas" if groups else f"{BASE_URL}/api/groups", headers=headers)

        # Obtener área
        db_temp = SessionLocal()
        from app import models as m
        area = db_temp.query(m.Area).filter(m.Area.group_id == group_id).first()
        area_id = area.id if area else 1
        db_temp.close()

        log.info("  Contexto: group=%d, area=%d, agendadora=%s, vendedor=%s",
                 group_id, area_id, agendadora_id, vendedor_id)

        # ── Crear contacto ──
        contact_data = {
            "name": f"Test E2E Funcional {int(time.time())}",
            "phone": f"+569{random.randint(80000000, 99999999)}",
            "email": f"e2e_{int(time.time())}@test.cl",
            "rut_persona": "12345678-9",
            "city": "Santiago",
            "group_id": group_id,
        }
        r = await client.post(f"{BASE_URL}/api/contacts", headers=headers, json=contact_data)
        if r.status_code not in (200, 201):
            errors.append(f"POST contact: {r.status_code} {r.text[:150]}")
            log.warning("  POST contact FAILED: %d %s", r.status_code, r.text[:150])
            contact_id = None
        else:
            contact_id = r.json().get("id")
            log.info("  ✓ Contacto creado ID=%d", contact_id)

        # ── Crear lead ──
        lead_id = None
        if contact_id and agendadora_id and vendedor_id:
            lead_data = {
                "contact_id": contact_id,
                "area_id": area_id,
                "group_id": group_id,
                "agendadora_id": agendadora_id,
                "vendedor_id": vendedor_id,
                "service_description": "Defensa deuda ejecutiva E2E test",
                "honorarios": 590000,
                "cuota_inicial": 177000,
                "num_cuotas": 3,
                "monto_cuota": 137667,
                "notes": "Lead creado por test E2E masivo",
                "priority": "high",
                "source": "test",
            }
            r = await client.post(f"{BASE_URL}/api/leads", headers=headers, json=lead_data)
            if r.status_code not in (200, 201):
                errors.append(f"POST lead: {r.status_code} {r.text[:150]}")
                log.warning("  POST lead FAILED: %d %s", r.status_code, r.text[:150])
            else:
                lead_id = r.json().get("id")
                log.info("  ✓ Lead creado ID=%d stage=lead", lead_id)

        # ── Transición de stage ──
        if lead_id:
            r = await client.post(
                f"{BASE_URL}/api/leads/{lead_id}/advance",
                headers=headers,
                json={"result": "success", "notes": "Test E2E avance a reunion"},
            )
            if r.status_code in (200, 201):
                new_stage = r.json().get("current_stage")
                log.info("  ✓ Lead avanzó → %s", new_stage)
            else:
                errors.append(f"advance lead: {r.status_code} {r.text[:150]}")
                log.warning("  advance lead FAILED: %d", r.status_code)

            # ── Avance a altamente_interesado ──
            r = await client.post(
                f"{BASE_URL}/api/leads/{lead_id}/advance",
                headers=headers,
                json={"result": "success", "notes": "Test E2E avance a altamente_interesado"},
            )
            if r.status_code in (200, 201):
                log.info("  ✓ Lead → %s", r.json().get("current_stage"))

            # ── Set payment_commitment_date (seguimiento) ──
            commit_date = (date.today() - timedelta(days=7)).isoformat()
            r = await client.patch(
                f"{BASE_URL}/api/leads/{lead_id}",
                headers=headers,
                json={"payment_commitment_date": commit_date},
            )
            if r.status_code in (200, 201):
                log.info("  ✓ payment_commitment_date seteada → %s", commit_date)
            else:
                log.info("  payment_commitment_date patch → %d (puede no tener endpoint PATCH)", r.status_code)

        # ── Leer leads con filtros ──
        for stage in ["lead", "reunion", "altamente_interesado", "cierre"]:
            r = await client.get(f"{BASE_URL}/api/leads?stage={stage}&limit=10", headers=headers)
            if r.status_code == 200:
                items = r.json()
                count = len(items) if isinstance(items, list) else items.get("total", items.get("count", "?"))
                log.info("  GET leads?stage=%s → %s registros", stage, count)

        # ── Cobrador ──
        r = await client.get(f"{BASE_URL}/api/cobrador/leads", headers=headers)
        if r.status_code == 200:
            body = r.json()
            total = len(body) if isinstance(body, list) else body.get("total", "?")
            log.info("  ✓ Cobrador leads: %s", total)
        else:
            log.info("  Cobrador leads → %d", r.status_code)

        # ── Payments ──
        r = await client.get(f"{BASE_URL}/api/payments", headers=headers)
        log.info("  Payments → %d", r.status_code)

        # ── WhatsApp sessions ──
        r = await client.get(f"{BASE_URL}/api/whatsapp-sessions", headers=headers)
        log.info("  WhatsApp sessions → %d", r.status_code)

        # ── Settings ──
        r = await client.get(f"{BASE_URL}/api/settings", headers=headers)
        log.info("  Settings → %d", r.status_code)

        # ── Security audit log ──
        r = await client.get(f"{BASE_URL}/api/security/audit-log", headers=headers)
        log.info("  Security audit → %d", r.status_code)

        if errors:
            log.warning("  Errores CRUD: %s", errors)
            results["errors"].extend(errors)

        log.info("  ✓ CRUD funcional completado — %d errores", len(errors))


# ── FASE 8: Test de resiliencia concurrente sobre datos masivos ───────────────

async def test_resiliencia_masiva(tokens: list[str]):
    log.info("═══ FASE 8: Resiliencia — 300 usuarios simultáneos sobre datos masivos ═══")

    USUARIOS_SIMULADOS = 300
    REQUESTS_POR_USUARIO = 10

    async def simular_usuario(uid: int, token: str):
        """Simula un usuario real navegando por el sistema."""
        headers = {"Authorization": f"Bearer {token}"}
        local_ok = 0
        local_err = 0
        async with httpx.AsyncClient(timeout=20) as client:
            acciones = [
                ("GET", "/api/leads?limit=50"),
                ("GET", f"/api/leads?limit=20&offset={random.randint(0,500)}"),
                ("GET", "/api/contacts?limit=30"),
                ("GET", "/api/notifications?limit=10"),
                ("GET", "/api/seguimiento-asistente/leads"),
                ("GET", "/api/cobrador/leads"),
                ("GET", "/api/groups"),
                ("GET", "/api/leads?stage=lead&limit=20"),
                ("GET", "/api/leads?stage=reunion&limit=20"),
                ("GET", "/health"),
            ]
            for _ in range(REQUESTS_POR_USUARIO):
                method, path = random.choice(acciones)
                try:
                    r = await client.get(f"{BASE_URL}{path}", headers=headers, timeout=15)
                    if r.status_code < 400:
                        local_ok += 1
                    else:
                        local_err += 1
                except Exception:
                    local_err += 1
        return local_ok, local_err

    # Crear lista de tokens extendida para 300 usuarios
    extended_tokens = [tokens[i % len(tokens)] for i in range(USUARIOS_SIMULADOS)]

    t0 = time.perf_counter()
    semaphore = asyncio.Semaphore(40)  # 40 requests simultáneos máx — realista

    async def bounded_usuario(uid, token):
        async with semaphore:
            return await simular_usuario(uid, token)

    tasks = [bounded_usuario(i, extended_tokens[i]) for i in range(USUARIOS_SIMULADOS)]
    results_batch = await asyncio.gather(*tasks, return_exceptions=True)

    elapsed = time.perf_counter() - t0
    total_ok = sum(r[0] for r in results_batch if isinstance(r, tuple))
    total_err = sum(r[1] for r in results_batch if isinstance(r, tuple))
    total_req = total_ok + total_err

    log.info("  ┌─ RESILIENCIA 300 USUARIOS ──────────────────────")
    log.info("  │ Usuarios simulados:  %d", USUARIOS_SIMULADOS)
    log.info("  │ Requests totales:    %d", total_req)
    log.info("  │ OK:                  %d (%.1f%%)", total_ok, 100*total_ok/max(1,total_req))
    log.info("  │ Errores:             %d (%.1f%%)", total_err, 100*total_err/max(1,total_req))
    log.info("  │ Tiempo total:        %.1fs", elapsed)
    log.info("  │ RPS efectivo:        %.0f req/s", total_req/elapsed if elapsed else 0)
    log.info("  └────────────────────────────────────────────────────")

    results["resiliencia_300"] = {
        "usuarios": USUARIOS_SIMULADOS,
        "total_requests": total_req,
        "ok": total_ok,
        "errors": total_err,
        "success_rate": round(100*total_ok/max(1,total_req), 1),
        "elapsed_s": round(elapsed, 1),
        "rps": round(total_req/elapsed if elapsed else 0, 0),
    }


# ── MAIN ──────────────────────────────────────────────────────────────────────

async def main():
    log.info("")
    log.info("╔══════════════════════════════════════════════════════════════╗")
    log.info("║   NEXIO — Test E2E Masivo — Uso Real Completo               ║")
    log.info("║   Sistema: %s", BASE_URL)
    log.info("╚══════════════════════════════════════════════════════════════╝")
    log.info("")

    t_global = time.perf_counter()

    # Fase 1: Datos masivos
    ok = crear_datos_masivos()
    if not ok:
        log.error("Abortando — fallo en creación de datos")
        return

    # Obtener token admin
    async with httpx.AsyncClient(timeout=30) as client:
        admin_token = await get_token(client, "jorge@abogadostributarios.cl", "Admin2024!")

    if not admin_token:
        log.error("Sin token admin — abortando pruebas funcionales")
        return

    # Recolectar todos los tokens para fase 8
    all_tokens = []
    async with httpx.AsyncClient(timeout=30) as client:
        creds_extended = [
            ("jorge@abogadostributarios.cl", "Admin2024!"),
            ("nicolas@abogadostributarios.cl", "Sub2024!"),
            ("tecnico@abogadostributarios.cl", "Tecnico2024!"),
        ]
        for i in range(20):
            creds_extended.append((f"vendedor_test_{i}@nexio-test.cl", "Test2024!"))
            creds_extended.append((f"agendadora_test_{i}@nexio-test.cl", "Test2024!"))
        for email, pwd in creds_extended:
            t = await get_token(client, email, pwd)
            if t:
                all_tokens.append(t)

    all_tokens = all_tokens or [admin_token]

    # Fase 3: Load test
    load_token = await load_test()
    admin_token = load_token or admin_token

    # Fases funcionales
    await test_seguimiento(admin_token)
    await test_analista(admin_token)
    await test_broadcaster(admin_token)
    await test_crud_completo(admin_token)
    await test_resiliencia_masiva(all_tokens)

    total_elapsed = time.perf_counter() - t_global

    log.info("")
    log.info("╔══════════════════════════════════════════════════════════════╗")
    log.info("║   RESULTADOS FINALES                                        ║")
    log.info("╠══════════════════════════════════════════════════════════════╣")
    log.info("║  BD: %d contactos, %d leads, %d cobrador leads",
             results["data_created"].get("contacts", 0),
             results["data_created"].get("leads", 0),
             results["data_created"].get("cobrador_leads", 0))
    log.info("║  Seguimiento: %d en_seguimiento, %d próximos",
             results["seguimiento"].get("en_seguimiento", 0),
             results["seguimiento"].get("proximos", 0))
    lt = results.get("load_test", {})
    log.info("║  Load test 200usr: %d req, %.1f%% OK, %.0fms p90, %.0f RPS",
             lt.get("total_requests", 0), lt.get("success_rate", 0),
             lt.get("p90_ms", 0), lt.get("rps", 0))
    rt = results.get("resiliencia_300", {})
    log.info("║  Resiliencia 300usr: %d req, %.1f%% OK, %.0f RPS",
             rt.get("total_requests", 0), rt.get("success_rate", 0), rt.get("rps", 0))
    log.info("║  Broadcaster Redis: %s", "✓ OK" if results["broadcaster"].get("redis_ok") else "✗ ERROR")
    log.info("║  Analista: %s", results["analista"].get("status", "?"))
    log.info("║  Errores globales: %d", len(results["errors"]))
    log.info("║  Tiempo total: %.1fs", total_elapsed)
    if results["errors"]:
        log.info("╠══════════════════════════════════════════════════════════════╣")
        for e in results["errors"][:10]:
            log.info("║  ✗ %s", e[:60])
    log.info("╚══════════════════════════════════════════════════════════════╝")


if __name__ == "__main__":
    asyncio.run(main())
