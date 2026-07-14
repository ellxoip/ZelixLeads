"""
Nexin — cerebro asistente conversacional de Nexio.

Fase 1: consultas de solo-lectura sobre LEADS y PIPELINE. El LLM (OpenAI,
function-calling) decide qué herramientas invocar; nosotros las ejecutamos
contra la BD con scoping por rol/grupo y le devolvemos los datos para que
componga la respuesta en español.

Diseño: stateless (el historial viaja desde el frontend), sin escrituras, sin
migraciones de esquema. Añadir fases futuras = agregar una función + su schema.
"""
import os
import json
import logging
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..auth import get_current_user, get_visible_group_ids
from .. import models
from ..copilot import evaluate_for_user
from .leads import _visible_leads

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/nexin", tags=["nexin"])

# Fase 1: acceso exclusivo a superadmin.
ALLOWED_ROLES = ("superadmin",)

NEXIN_MODEL = os.getenv("NEXIN_MODEL", "gpt-4o-mini")  # fallback explícito y barato
MAX_TOOL_ROUNDS = 4

SYSTEM_PROMPT = (
    "Eres Nexin, el cerebro analítico y asistente de IA de Nexio. Tu objetivo es ayudar al "
    "superadmin a comprender el estado actual de los leads, el pipeline comercial, las "
    "reuniones agendadas (agendamientos), las métricas de cobranza del sistema contable "
    "(carteras, cuotas, recaudación, morosidad) y el rendimiento del equipo "
    "(vendedores, agendadoras y cobradores).\n\n"
    "DIRECTRICES DE COMPORTAMIENTO:\n"
    "1. Eres un asistente estrictamente de SOLO LECTURA. No tienes capacidad para crear, "
    "modificar, mover o eliminar leads, contactos o etapas.\n"
    "2. Si el usuario te solicita una acción de escritura (ej. \"crea un lead\", \"cambia a Juan "
    "a la etapa de Cierre\", \"asigna este vendedor\"), debes responder con cortesía: \"Lo siento, "
    "en esta fase actual no poseo permisos de escritura. Solo puedo ayudarte a consultar y "
    "analizar la información existente.\"\n"
    "3. Utiliza las herramientas disponibles de forma proactiva cuando te soliciten datos "
    "cuantitativos, estados de estancamiento u oportunidades.\n"
    "4. Responde siempre en español, de forma concisa, profesional y estructurada (utiliza "
    "viñetas o negritas para facilitar la lectura de datos numéricos).\n"
    "5. Básate únicamente en lo que devuelven tus herramientas: nunca inventes datos, leads ni "
    "métricas. Si una herramienta no devuelve resultados, dilo con naturalidad."
)


class NexinMessage(BaseModel):
    role: str
    content: str


class NexinChatIn(BaseModel):
    messages: list[NexinMessage]


# ── Utilidades ────────────────────────────────────────────────────────────────

def _stage_labels(db: Session, current_user) -> dict:
    """Mapa {key: nombre legible} de las etapas visibles para el usuario."""
    gids = get_visible_group_ids(db, current_user)
    q = db.query(models.PipelineStage)
    if gids is not None:
        q = q.filter(models.PipelineStage.negocio_id.in_(gids))
    out = {}
    for s in q.all():
        out.setdefault(s.key, s.name)
    return out


def _ok(data, message: str = ""):
    return {"status": "success", "data": data, "message": message}


def _empty(message: str):
    return {"status": "success", "data": [], "message": message}


def _err(message: str):
    return {"status": "error", "data": None, "message": message}


# ── Herramientas (solo lectura, con scoping) ─────────────────────────────────

def tool_get_pipeline_summary(db: Session, current_user) -> dict:
    """Conteo de leads por etapa + honorarios comprometidos/confirmados."""
    labels = _stage_labels(db, current_user)
    q = _visible_leads(
        db.query(models.Lead.current_stage, func.count(models.Lead.id))
          .filter(models.Lead.deleted_at.is_(None)),
        current_user, db,
    ).group_by(models.Lead.current_stage)
    por_etapa = [
        {"etapa": st, "nombre": labels.get(st, st), "cantidad": n}
        for st, n in q.all()
    ]
    por_etapa.sort(key=lambda x: x["cantidad"], reverse=True)
    total = sum(x["cantidad"] for x in por_etapa)

    PAGO = ("pago_comprometido", "pago_pendiente", "pagado_reunion", "pagado_confirmado")
    hon_comp = _visible_leads(
        db.query(func.coalesce(func.sum(models.Lead.honorarios), 0))
          .filter(models.Lead.current_stage.in_(PAGO), models.Lead.deleted_at.is_(None)),
        current_user, db,
    ).scalar() or 0
    hon_conf = _visible_leads(
        db.query(func.coalesce(func.sum(models.Lead.honorarios), 0))
          .filter(models.Lead.current_stage == "pagado_confirmado", models.Lead.deleted_at.is_(None)),
        current_user, db,
    ).scalar() or 0

    if total == 0:
        return _empty("No hay leads visibles para este usuario.")
    return _ok({
        "total_leads": total,
        "por_etapa": por_etapa,
        "honorarios_comprometidos": float(hon_comp),
        "honorarios_confirmados": float(hon_conf),
    })


def tool_search_leads(db: Session, current_user, *, stage=None, vendedor_nombre=None,
                      agendadora_nombre=None, area_nombre=None, contacto_nombre=None,
                      estancados_dias=None, limit=20) -> dict:
    labels = _stage_labels(db, current_user)
    q = _visible_leads(
        db.query(models.Lead)
          .options(joinedload(models.Lead.contact), joinedload(models.Lead.area),
                   joinedload(models.Lead.vendedor), joinedload(models.Lead.agendadora))
          .filter(models.Lead.deleted_at.is_(None)),
        current_user, db,
    )
    if stage:
        q = q.filter(models.Lead.current_stage == stage)
    if vendedor_nombre:
        q = q.join(models.User, models.Lead.vendedor_id == models.User.id)\
             .filter(models.User.name.ilike(f"%{vendedor_nombre}%"))
    if agendadora_nombre:
        q = q.join(models.User, models.Lead.agendadora_id == models.User.id)\
             .filter(models.User.name.ilike(f"%{agendadora_nombre}%"))
    if area_nombre:
        q = q.join(models.Area, models.Lead.area_id == models.Area.id)\
             .filter(models.Area.name.ilike(f"%{area_nombre}%"))
    if contacto_nombre:
        q = q.join(models.Contact, models.Lead.contact_id == models.Contact.id)\
             .filter(models.Contact.name.ilike(f"%{contacto_nombre}%"))
    if estancados_dias:
        cutoff = datetime.now(timezone.utc) - timedelta(days=int(estancados_dias))
        q = q.filter(models.Lead.updated_at < cutoff)

    limit = max(1, min(int(limit or 20), 50))
    rows = q.order_by(models.Lead.updated_at.desc()).limit(limit).all()
    if not rows:
        return _empty("No se encontraron leads con esos criterios.")
    data = [{
        "lead_id": l.id,
        "contacto": l.contact.name if l.contact else "—",
        "etapa": l.current_stage,
        "etapa_nombre": labels.get(l.current_stage, l.current_stage),
        "area": l.area.name if l.area else "—",
        "vendedor": l.vendedor.name if l.vendedor else "—",
        "agendadora": l.agendadora.name if l.agendadora else "—",
        "honorarios": float(l.honorarios or 0),
        "actualizado": l.updated_at.isoformat() if l.updated_at else None,
    } for l in rows]
    return _ok(data, f"{len(data)} lead(s) encontrado(s).")


def tool_get_lead_detail(db: Session, current_user, *, lead_id) -> dict:
    labels = _stage_labels(db, current_user)
    l = _visible_leads(
        db.query(models.Lead)
          .options(joinedload(models.Lead.contact), joinedload(models.Lead.area),
                   joinedload(models.Lead.vendedor), joinedload(models.Lead.agendadora))
          .filter(models.Lead.id == int(lead_id)),
        current_user, db,
    ).first()
    if not l:
        return _err(f"No existe un lead #{lead_id} visible para este usuario.")
    hist = db.query(models.LeadHistory).filter(models.LeadHistory.lead_id == l.id)\
             .order_by(models.LeadHistory.created_at.desc()).limit(5).all()
    c = l.contact
    return _ok({
        "lead_id": l.id,
        "contacto": {
            "nombre": c.name if c else "—",
            "telefono": c.phone if c else None,
            "email": (c.email if c else None) or None,
            "rut": (c.rut_persona or c.rut_empresa) if c else None,
        },
        "etapa": l.current_stage,
        "etapa_nombre": labels.get(l.current_stage, l.current_stage),
        "area": l.area.name if l.area else "—",
        "vendedor": l.vendedor.name if l.vendedor else "—",
        "agendadora": l.agendadora.name if l.agendadora else "—",
        "honorarios": float(l.honorarios or 0),
        "creado": l.created_at.isoformat() if l.created_at else None,
        "actualizado": l.updated_at.isoformat() if l.updated_at else None,
        "historial_reciente": [{
            "de": h.from_stage, "a": h.to_stage, "resultado": h.result,
            "nota": h.notes, "fecha": h.created_at.isoformat() if h.created_at else None,
        } for h in hist],
    })


# ── Fase 2: Agendamientos (reuniones del calendario) ─────────────────────────

# Buckets de resultado de reunión (vendor_status) — alineados con el panel analista.
_MEET_STATUS = {
    "exitosa": ("altamente_interesado", "con_exito_pagada"),
    "no_show": ("no_show",),
    "sin_exito": ("sin_exito",),
    "pendiente": ("espera_cliente", None),
}


def _scoped_meetings(db: Session, current_user):
    """Query de CalendarEvent (event_type=reunion) scopeada como el calendario:
    para superadmin, reuniones cuyo lead pertenece a un grupo visible."""
    gids = get_visible_group_ids(db, current_user)
    q = db.query(models.CalendarEvent).filter(models.CalendarEvent.event_type == "reunion")
    if gids is not None:
        q = q.join(models.Lead, models.CalendarEvent.lead_id == models.Lead.id)\
             .filter(models.Lead.group_id.in_(gids))
    return q


def tool_get_agenda_summary(db: Session, current_user) -> dict:
    """Resumen de reuniones: próximas (hoy/7 días), pasadas y desglose por resultado."""
    now = datetime.now(timezone.utc)
    hoy_fin = now.replace(hour=23, minute=59, second=59, microsecond=0)
    en_7d = now + timedelta(days=7)

    base = _scoped_meetings(db, current_user)
    total = base.count()

    def _c(qq):
        return qq.count()

    proximas = _c(base.filter(models.CalendarEvent.start_time >= now))
    hoy = _c(base.filter(models.CalendarEvent.start_time >= now, models.CalendarEvent.start_time <= hoy_fin))
    prox_7d = _c(base.filter(models.CalendarEvent.start_time >= now, models.CalendarEvent.start_time <= en_7d))
    pasadas = _c(base.filter(models.CalendarEvent.start_time < now))

    por_resultado = {}
    for label, statuses in _MEET_STATUS.items():
        vals = [s for s in statuses if s is not None]
        q = base
        if None in statuses:
            q = q.filter(models.CalendarEvent.vendor_status.in_(vals) | models.CalendarEvent.vendor_status.is_(None)) \
                if vals else q.filter(models.CalendarEvent.vendor_status.is_(None))
        else:
            q = q.filter(models.CalendarEvent.vendor_status.in_(vals))
        por_resultado[label] = q.count()

    # Leads en etapa 'reunion' SIN evento agendado (reunión pendiente de agendar).
    sin_agendar = _visible_leads(
        db.query(func.count(models.Lead.id)).filter(
            models.Lead.current_stage.in_(("reunion", "recuperacion_reunion")),
            models.Lead.deleted_at.is_(None),
            ~models.Lead.id.in_(
                db.query(models.CalendarEvent.lead_id).filter(
                    models.CalendarEvent.event_type == "reunion",
                    models.CalendarEvent.lead_id.isnot(None),
                )
            ),
        ),
        current_user, db,
    ).scalar() or 0

    if total == 0 and sin_agendar == 0:
        return _empty("No hay reuniones registradas para este usuario.")
    return _ok({
        "total_reuniones": total,
        "proximas": proximas,
        "hoy": hoy,
        "proximos_7_dias": prox_7d,
        "pasadas": pasadas,
        "por_resultado": por_resultado,
        "leads_en_reunion_sin_agendar": int(sin_agendar),
    })


def tool_list_meetings(db: Session, current_user, *, desde=None, hasta=None,
                       vendedor_nombre=None, agendadora_nombre=None, estado=None,
                       solo_proximas=False, limit=20) -> dict:
    q = _scoped_meetings(db, current_user).options(
        joinedload(models.CalendarEvent.lead).joinedload(models.Lead.contact),
        joinedload(models.CalendarEvent.assigned_user),
        joinedload(models.CalendarEvent.creator),
    )
    if desde:
        try:
            q = q.filter(models.CalendarEvent.start_time >= datetime.fromisoformat(desde).replace(tzinfo=timezone.utc))
        except ValueError:
            return _err("Formato de fecha 'desde' inválido (usa YYYY-MM-DD).")
    if hasta:
        try:
            end = datetime.fromisoformat(hasta).replace(tzinfo=timezone.utc) + timedelta(days=1)
            q = q.filter(models.CalendarEvent.start_time < end)
        except ValueError:
            return _err("Formato de fecha 'hasta' inválido (usa YYYY-MM-DD).")
    if solo_proximas:
        q = q.filter(models.CalendarEvent.start_time >= datetime.now(timezone.utc))
    if vendedor_nombre:
        q = q.join(models.User, models.CalendarEvent.assigned_to == models.User.id)\
             .filter(models.User.name.ilike(f"%{vendedor_nombre}%"))
    if agendadora_nombre:
        q = q.join(models.User, models.CalendarEvent.created_by == models.User.id)\
             .filter(models.User.name.ilike(f"%{agendadora_nombre}%"))
    if estado:
        statuses = _MEET_STATUS.get(estado)
        if not statuses:
            return _err(f"Estado inválido. Usa uno de: {', '.join(_MEET_STATUS)}.")
        vals = [s for s in statuses if s is not None]
        if None in statuses:
            q = q.filter(models.CalendarEvent.vendor_status.in_(vals) | models.CalendarEvent.vendor_status.is_(None))
        else:
            q = q.filter(models.CalendarEvent.vendor_status.in_(vals))

    limit = max(1, min(int(limit or 20), 50))
    order = models.CalendarEvent.start_time.asc() if solo_proximas else models.CalendarEvent.start_time.desc()
    rows = q.order_by(order).limit(limit).all()
    if not rows:
        return _empty("No se encontraron reuniones con esos criterios.")

    _label = {v: k for k, vs in _MEET_STATUS.items() for v in vs}
    data = [{
        "evento_id": e.id,
        "lead_id": e.lead_id,
        "contacto": (e.lead.contact.name if (e.lead and e.lead.contact) else e.title),
        "inicio": e.start_time.isoformat() if e.start_time else None,
        "vendedor": e.assigned_user.name if e.assigned_user else "—",
        "agendadora": e.creator.name if e.creator else "—",
        "estado": _label.get(e.vendor_status, "pendiente"),
        "completada": bool(e.is_completed),
    } for e in rows]
    return _ok(data, f"{len(data)} reunión(es) encontrada(s).")


# ── Fase 3: Métricas del sistema contable (dashboard analista de cobranza) ───

def tool_get_cobranza_metrics(db: Session, current_user, *, period=None, desde=None, hasta=None) -> dict:
    """Métricas de cobranza desde el sistema contable: KPIs, aging, promesas,
    ranking de cobradores y comparativo por cartera. Reutiliza el mismo cálculo
    del dashboard del analista (carteras_cobradores)."""
    from .analista import carteras_cobradores
    try:
        res = carteras_cobradores(period=period, from_date=desde, to_date=hasta,
                                  db=db, current_user=current_user)
    except HTTPException as e:
        return _err(str(e.detail))
    except Exception as exc:
        logger.warning("[nexin] cobranza metrics falló: %s", exc)
        return _err("No se pudieron obtener las métricas de cobranza del sistema contable.")

    kpis = res.get("kpis", {})
    comparativo = res.get("comparativo", [])
    if not comparativo and not kpis.get("totalCartera"):
        return _empty(f"No hay datos de cobranza para el período ({res.get('periodLabel', '—')}).")

    keep = ("nombre", "areas", "clientes", "cartera", "cobrado", "pendiente",
            "pctRecuperacion", "cuotas", "vencidas", "liquidadas", "montoLiquidado",
            "contactabilidad", "efectividad")
    por_cobrador = [{k: c.get(k) for k in keep} for c in comparativo]
    return _ok({
        "periodo": res.get("periodLabel"),
        "kpis": kpis,
        "aging": res.get("aging"),
        "promesas": res.get("promesas"),
        "ranking_cobradores": res.get("ranking"),
        "cartera_por_ejecutivo": res.get("montoPorEjecutivo"),
        "por_cobrador": por_cobrador,
    })


# ── Fase 4: Rendimiento de equipo (vendedores / agendadores / cobradores) ────

_VEND_KEEP = ("name", "group", "total_periodo", "activos", "confirmados",
              "honorarios_comprometidos", "honorarios_confirmados",
              "reuniones_asignadas", "reuniones_exitosas", "reuniones_no_show",
              "pct_conversion", "pct_efectividad_reunion", "pct_noshow")
_AGEN_KEEP = ("name", "group", "leads_creados", "leads_activos", "leads_convertidos",
              "reuniones_agendadas", "reuniones_exitosas", "reuniones_no_show",
              "pct_show_rate", "pct_efectividad", "pct_conversion_leads")
_COBR_KEEP = ("nombre", "areas", "clientes", "cartera", "cobrado", "pendiente",
              "contactados", "contactabilidad", "comprometidos", "pagados",
              "efectividad", "pctRecuperacion", "montoLiquidado")


def tool_get_team_performance(db: Session, current_user, *, equipo="todos",
                              period=None, desde=None, hasta=None) -> dict:
    """Métricas de rendimiento por persona: vendedores y agendadoras (desde
    panel_analista_stats) y cobradores (desde carteras_cobradores)."""
    equipo = (equipo or "todos").lower()
    out: dict = {}
    try:
        if equipo in ("vendedores", "agendadores", "vendedor", "agendadora", "todos"):
            from .leads import panel_analista_stats
            res = panel_analista_stats(date_from=desde, date_to=hasta,
                                       period=(period or "month"),
                                       db=db, current_user=current_user)
            out["periodo"] = res.get("period")
            out["resumen"] = res.get("resumen")
            if equipo in ("vendedores", "vendedor", "todos"):
                out["vendedores"] = [{k: v.get(k) for k in _VEND_KEEP} for v in res.get("vendedores", [])]
            if equipo in ("agendadores", "agendadora", "todos"):
                out["agendadoras"] = [{k: a.get(k) for k in _AGEN_KEEP} for a in res.get("agendadoras", [])]
        if equipo in ("cobradores", "cobrador", "todos"):
            from .analista import carteras_cobradores
            car = carteras_cobradores(period=period, from_date=desde, to_date=hasta,
                                      db=db, current_user=current_user)
            out["cobradores"] = [{k: c.get(k) for k in _COBR_KEEP} for c in car.get("comparativo", [])]
    except HTTPException as e:
        return _err(str(e.detail))
    except Exception as exc:
        logger.warning("[nexin] team performance falló: %s", exc)
        return _err("No se pudo obtener el rendimiento del equipo.")

    if not any(out.get(k) for k in ("vendedores", "agendadoras", "cobradores")):
        return _empty("No hay datos de rendimiento del equipo para el período.")
    return _ok(out)


def tool_get_copilot_insights(db: Session, current_user) -> dict:
    insights = evaluate_for_user(db, current_user, _visible_leads)
    if not insights:
        return _empty("No hay alertas ni oportunidades activas en este momento.")
    data = [{
        "tipo": i.get("type"),
        "titulo": i.get("title"),
        "motivo": i.get("reason"),
        "lead_id": i.get("lead_id"),
        "contacto": i.get("contact_name"),
        "prioridad": i.get("priority"),
        "confianza": i.get("score_confianza"),
    } for i in insights]
    return _ok(data, f"{len(data)} insight(s) activo(s).")


# Registro: nombre de tool -> (callable, ¿acepta kwargs de args?)
def _dispatch_tool(name: str, args: dict, db: Session, current_user) -> dict:
    try:
        if name == "get_pipeline_summary":
            return tool_get_pipeline_summary(db, current_user)
        if name == "search_leads":
            return tool_search_leads(db, current_user, **args)
        if name == "get_lead_detail":
            return tool_get_lead_detail(db, current_user, **args)
        if name == "get_agenda_summary":
            return tool_get_agenda_summary(db, current_user)
        if name == "list_meetings":
            return tool_list_meetings(db, current_user, **args)
        if name == "get_cobranza_metrics":
            return tool_get_cobranza_metrics(db, current_user, **args)
        if name == "get_team_performance":
            return tool_get_team_performance(db, current_user, **args)
        if name == "get_copilot_insights":
            return tool_get_copilot_insights(db, current_user)
        return _err(f"Herramienta desconocida: {name}")
    except Exception as exc:  # nunca romper el chat con un 500
        logger.warning("[nexin] tool %s falló: %s", name, exc)
        return _err(f"No se pudo ejecutar la consulta ({name}).")


_TOOLS = [
    {"type": "function", "function": {
        "name": "get_pipeline_summary",
        "description": "Resumen del pipeline: cantidad de leads por etapa y honorarios comprometidos/confirmados.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "search_leads",
        "description": "Busca/filtra leads del pipeline. Todos los parámetros son opcionales.",
        "parameters": {"type": "object", "properties": {
            "stage": {"type": "string", "description": "Clave de etapa exacta, p.ej. 'lead', 'reunion', 'cierre'."},
            "vendedor_nombre": {"type": "string"},
            "agendadora_nombre": {"type": "string"},
            "area_nombre": {"type": "string"},
            "contacto_nombre": {"type": "string"},
            "estancados_dias": {"type": "integer", "description": "Solo leads sin actualizar hace N o más días."},
            "limit": {"type": "integer", "description": "Máx. resultados (1-50, def. 20)."},
        }},
    }},
    {"type": "function", "function": {
        "name": "get_lead_detail",
        "description": "Detalle de un lead por su id: contacto, etapa, honorarios e historial reciente.",
        "parameters": {"type": "object", "properties": {
            "lead_id": {"type": "integer"},
        }, "required": ["lead_id"]},
    }},
    {"type": "function", "function": {
        "name": "get_agenda_summary",
        "description": "Resumen de agendamientos/reuniones: próximas (hoy y próximos 7 días), pasadas, desglose por resultado (exitosa/no_show/sin_exito/pendiente) y leads en etapa reunión aún sin agendar.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "list_meetings",
        "description": "Lista/filtra reuniones agendadas del calendario. Todos los parámetros son opcionales.",
        "parameters": {"type": "object", "properties": {
            "desde": {"type": "string", "description": "Fecha inicio YYYY-MM-DD."},
            "hasta": {"type": "string", "description": "Fecha fin YYYY-MM-DD (inclusive)."},
            "vendedor_nombre": {"type": "string", "description": "Vendedor asignado a la reunión."},
            "agendadora_nombre": {"type": "string", "description": "Quien agendó la reunión."},
            "estado": {"type": "string", "enum": ["exitosa", "no_show", "sin_exito", "pendiente"]},
            "solo_proximas": {"type": "boolean", "description": "Solo reuniones futuras (ordenadas ascendente)."},
            "limit": {"type": "integer", "description": "Máx. resultados (1-50, def. 20)."},
        }},
    }},
    {"type": "function", "function": {
        "name": "get_cobranza_metrics",
        "description": "Métricas de cobranza del sistema contable (dashboard analista): KPIs (cartera total, cobrado, % recuperación, cuotas vencidas/liquidadas), aging por antigüedad, promesas de pago, ranking de cobradores y comparativo por cartera. Úsala para cualquier pregunta sobre cobranza, cuotas, recaudación, morosidad o desempeño de cobradores.",
        "parameters": {"type": "object", "properties": {
            "period": {"type": "string", "description": "Mes en formato YYYY-MM (por defecto el mes actual)."},
            "desde": {"type": "string", "description": "Fecha inicio YYYY-MM-DD (alternativa a period)."},
            "hasta": {"type": "string", "description": "Fecha fin YYYY-MM-DD (alternativa a period)."},
        }},
    }},
    {"type": "function", "function": {
        "name": "get_team_performance",
        "description": "Rendimiento por persona del equipo comercial y de cobranza: vendedores (conversión, efectividad de reuniones, no-show, honorarios), agendadoras (leads creados/convertidos, reuniones agendadas, show rate) y cobradores (contactabilidad, efectividad, % recuperación). Úsala para comparar personas, rankings de desempeño o preguntas de productividad del equipo.",
        "parameters": {"type": "object", "properties": {
            "equipo": {"type": "string", "enum": ["vendedores", "agendadores", "cobradores", "todos"],
                        "description": "Qué equipo consultar (por defecto 'todos')."},
            "period": {"type": "string", "description": "Mes YYYY-MM (por defecto el mes actual)."},
            "desde": {"type": "string", "description": "Fecha inicio YYYY-MM-DD (alternativa a period)."},
            "hasta": {"type": "string", "description": "Fecha fin YYYY-MM-DD (alternativa a period)."},
        }},
    }},
    {"type": "function", "function": {
        "name": "get_copilot_insights",
        "description": "Alertas y oportunidades detectadas por el copiloto: duplicados, enfriamiento, oportunidades de cierre, datos huérfanos.",
        "parameters": {"type": "object", "properties": {}},
    }},
]


def _resolve_api_key(db: Session) -> str:
    key = os.getenv("OPENAI_API_KEY", "").strip()
    if not key:
        agent = db.query(models.AIAgent).filter(models.AIAgent.is_active == True).first()
        if agent:
            key = agent.openai_api_key
    return key


@router.post("/chat")
async def chat(
    body: NexinChatIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in ALLOWED_ROLES:
        raise HTTPException(status_code=403, detail="Nexin está disponible solo para superadmin en esta fase.")

    api_key = _resolve_api_key(db)
    if not api_key:
        raise HTTPException(status_code=503, detail="Nexin no está configurado (falta OPENAI_API_KEY).")

    # Solo pasamos roles válidos del historial; acotamos a los últimos 20 turnos.
    history = [
        {"role": m.role, "content": m.content}
        for m in body.messages
        if m.role in ("user", "assistant") and (m.content or "").strip()
    ][-20:]
    if not history:
        raise HTTPException(status_code=400, detail="Mensaje vacío.")

    messages = [{"role": "system", "content": SYSTEM_PROMPT}, *history]

    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=api_key)

    try:
        for _ in range(MAX_TOOL_ROUNDS):
            resp = await client.chat.completions.create(
                model=NEXIN_MODEL,
                messages=messages,
                tools=_TOOLS,
                tool_choice="auto",
                temperature=0.2,
            )
            msg = resp.choices[0].message
            if not msg.tool_calls:
                return {"reply": msg.content or "", "model": NEXIN_MODEL}

            messages.append({
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [{
                    "id": tc.id, "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                } for tc in msg.tool_calls],
            })
            for tc in msg.tool_calls:
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                result = _dispatch_tool(tc.function.name, args, db, current_user)
                messages.append({
                    "role": "tool", "tool_call_id": tc.id,
                    "content": json.dumps(result, ensure_ascii=False, default=str),
                })

        # Se agotaron las rondas de herramientas: pedir cierre sin más tools.
        final = await client.chat.completions.create(
            model=NEXIN_MODEL, messages=messages, temperature=0.2,
        )
        return {"reply": final.choices[0].message.content or "", "model": NEXIN_MODEL}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[nexin] error llamando a OpenAI: %s", exc)
        raise HTTPException(status_code=502, detail="Nexin no pudo procesar la consulta en este momento.")
