"""
Nexio Copilot — motor de inferencias proactivas.

Evalúa heurísticas deterministas sobre los leads ACTIVOS visibles de un usuario y
produce "insights" (tarjetas de recomendación). Diseñado para ser barato: usa
queries en bloque (IN) — nunca N+1 — sobre un conjunto pequeño (leads activos).

Se puede invocar on-read (scoped al usuario) o desde un barrido programado.
"""
from datetime import datetime, timedelta, timezone
import json
import re

from sqlalchemy import or_
from sqlalchemy.orm import joinedload

from . import models


# ── Detección de RUT (Módulo-11) para el trigger de datos huérfanos ──────────
_RUT_RE = re.compile(r"(\d{1,2}[.\s]?\d{3}[.\s]?\d{3})\s*[-–]\s*([0-9kK])")


def _rut_dv(body: str) -> str:
    s, m = 0, 2
    for ch in reversed(body):
        s += int(ch) * m
        m = 2 if m == 7 else m + 1
    r = 11 - (s % 11)
    return "0" if r == 11 else "K" if r == 10 else str(r)


def _detect_rut(text: str):
    """Devuelve el primer RUT válido (Módulo-11) del texto en formato XX.XXX.XXX-X, o None."""
    if not text:
        return None
    for mt in _RUT_RE.finditer(text):
        body = re.sub(r"[.\s]", "", mt.group(1))
        if _rut_dv(body) == mt.group(2).upper():
            dotted = re.sub(r"\B(?=(\d{3})+(?!\d))", ".", body)
            return f"{dotted}-{mt.group(2).upper()}"
    return None

# Etapas no terminales que vale la pena vigilar.
ACTIVE_STAGES = [
    "lead", "reunion", "altamente_interesado", "cierre",
    "pago_pendiente", "pago_comprometido",
    "recuperacion_lead", "recuperacion_reunion", "recuperacion_cierre", "recuperacion_pago",
]

# Palabras clave de intención de compra (sin acentos, texto en minúsculas).
BUY_INTENT = [
    "cuanto", "contratar", "como pago", "cómo pago", "me interesa", "quiero avanzar",
    "cuando empezamos", "cuándo empezamos", "si quiero", "sí quiero", "vamos", "cerremos",
    "acepto", "adelante", "procedamos", "necesito el servicio",
]

COOLING_HOURS = 24


def _now():
    return datetime.now(timezone.utc)


def _aware(dt):
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _conf(p: float) -> int:
    """Normaliza una probabilidad 0..1 a score de confianza entero (50..99).
    El score sale de la FUERZA REAL de la señal, no de un valor estático."""
    return int(round(max(0.5, min(0.99, p)) * 100))


_EMAIL_RE = re.compile(r"[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}", re.I)


def _detect_email(text: str):
    """Extrae el primer correo del texto libre del chat, o None."""
    if not text:
        return None
    m = _EMAIL_RE.search(text)
    return m.group(0).lower() if m else None


def _insight(itype, lead, priority, title, reason, action_label, action, user_id, score):
    contact = lead.contact
    return {
        "id": f"{itype}:{lead.id}",
        "lead_id": lead.id,
        "type": itype,
        "priority": priority,
        "score_confianza": int(score),      # confianza DINÁMICA de la inferencia
        "title": title,
        "reason": reason,
        "description": reason,              # alias estructurado para la UI
        "action_label": action_label,
        "action": action,
        "action_payload": action,          # alias estructurado para la UI
        "contact_name": (contact.name if contact else None),
        "created_at": _now().isoformat(),
        "user_id": user_id,
    }


def evaluate_leads(db, leads):
    """Evalúa los 3 triggers sobre una lista de leads (ya cargados con .contact).
    Devuelve una lista de dicts Insight. Solo lecturas en bloque."""
    if not leads:
        return []

    lead_ids = [l.id for l in leads]
    now = _now()
    cutoff_24h = now - timedelta(hours=COOLING_HOURS)

    # Bulk 1: leads con reunión agendada (CalendarEvent type=reunion).
    reunion_ids = {
        r[0] for r in db.query(models.CalendarEvent.lead_id).filter(
            models.CalendarEvent.lead_id.in_(lead_ids),
            models.CalendarEvent.event_type == "reunion",
        ).all()
    }

    # Bulk 2: leads con OT.
    ot_ids = {
        r[0] for r in db.query(models.WorkOrder.lead_id).filter(
            models.WorkOrder.lead_id.in_(lead_ids)
        ).all()
    }

    # Bulk 3: leads con nota de gestión (LeadHistory.notes) en las últimas 24h.
    recent_note_ids = {
        r[0] for r in db.query(models.LeadHistory.lead_id).filter(
            models.LeadHistory.lead_id.in_(lead_ids),
            models.LeadHistory.notes.isnot(None),
            models.LeadHistory.created_at >= cutoff_24h,
        ).all()
    }

    # Bulk 4: texto reciente de WhatsApp entrante por lead (intención de compra
    #         + RUT huérfano mencionado en el chat). 1 query acotada, sin N+1.
    intent_count = {}   # lead_id -> nº de señales de intención de compra (para score)
    orphan_data = {}    # lead_id -> {"rut_persona": ..., "email": ...} extraídos del chat
    rows = db.query(models.WhatsAppMessage.lead_id, models.WhatsAppMessage.content).filter(
        models.WhatsAppMessage.lead_id.in_(lead_ids),
        models.WhatsAppMessage.direction == "in",
        models.WhatsAppMessage.created_at >= now - timedelta(days=14),
    ).all()
    for lid, content in rows:
        if not content:
            continue
        n = sum(1 for k in BUY_INTENT if k in content.lower())
        if n:
            intent_count[lid] = max(intent_count.get(lid, 0), n)
        _r = _detect_rut(content)
        _em = _detect_email(content)
        if _r or _em:
            d = orphan_data.setdefault(lid, {})
            if _r and "rut_persona" not in d:
                d["rut_persona"] = _r
            if _em and "email" not in d:
                d["email"] = _em

    # Bulk 5: DUPLICADOS — leads en etapas avanzadas cuyo contacto comparte
    #         phone_norm (INDEXADO → sargable) o RUT con los leads evaluados.
    #         IN acotado a los leads activos → sin full-table scan.
    phone_norms = {c.phone_norm for l in leads if (c := l.contact) and c.phone_norm}
    ruts = {r for l in leads if (c := l.contact) for r in (c.rut_persona, c.rut_empresa) if r}
    dup_by_phone, dup_by_rut = {}, {}
    if phone_norms or ruts:
        conds = []
        if phone_norms:
            conds.append(models.Contact.phone_norm.in_(phone_norms))
        if ruts:
            conds.append(models.Contact.rut_persona.in_(ruts))
            conds.append(models.Contact.rut_empresa.in_(ruts))
        dup_q = (
            db.query(
                models.Lead.id, models.Contact.phone_norm,
                models.Contact.rut_persona, models.Contact.rut_empresa, models.User.name,
            )
            .join(models.Contact, models.Lead.contact_id == models.Contact.id)
            .outerjoin(models.User, models.Lead.vendedor_id == models.User.id)
            .filter(
                models.Lead.current_stage.in_(("altamente_interesado", "cierre")),
                models.Lead.deleted_at.is_(None),
                or_(*conds),
            )
        )
        for lid, pn, rp, re_, vname in dup_q.all():
            if pn and pn not in dup_by_phone:
                dup_by_phone[pn] = (lid, vname)
            for r in (rp, re_):
                if r and r not in dup_by_rut:
                    dup_by_rut[r] = (lid, vname)

    out = []
    for lead in leads:
        stage = lead.current_stage
        contact = lead.contact
        updated = _aware(getattr(lead, "updated_at", None)) or _aware(getattr(lead, "created_at", None))

        # 1) Enfriamiento — altamente_interesado, sin gestión en 24h.
        #    Confianza dinámica: crece con las horas de inactividad.
        if stage == "altamente_interesado" and lead.id not in recent_note_ids:
            if updated is None or updated < cutoff_24h:
                hrs = int((now - updated).total_seconds() // 3600) if updated else COOLING_HOURS
                out.append(_insight(
                    "cooling", lead, 80,
                    "Alerta de enfriamiento",
                    f"Detectado por inactividad · {hrs} h sin gestión",
                    "Enviar WhatsApp de seguimiento",
                    {"kind": "drawer", "leadId": lead.id, "tab": "chat"},
                    lead.vendedor_id,
                    _conf(0.6 + hrs / 100.0),
                ))

        # 2) Falta de agenda — en 'reunion' pero sin CalendarEvent (ausencia certera).
        if stage == "reunion" and lead.id not in reunion_ids:
            out.append(_insight(
                "missing_meeting", lead, 90,
                "Reunión sin agendar",
                "Movido a Reunión pero no hay evento en el calendario",
                "Agendar reunión ahora",
                {"kind": "agenda", "leadId": lead.id},
                lead.agendadora_id,
                _conf(0.96),
            ))

        # 3) Oportunidad de cierre — RUT + intención semántica + sin OT.
        #    Confianza dinámica: sube con el nº de señales de intención en el chat.
        has_rut = bool((contact.rut_persona or contact.rut_empresa) if contact else None)
        _n_intent = intent_count.get(lead.id, 0)
        if has_rut and lead.id not in ot_ids and _n_intent > 0 \
                and stage in ("altamente_interesado", "cierre"):
            out.append(_insight(
                "close_opportunity", lead, 95,
                "Oportunidad de cierre",
                f"RUT registrado + {_n_intent} señal(es) de intención de compra en el chat",
                "Enviar Orden de Trabajo",
                {"kind": "work_order", "leadId": lead.id},
                lead.vendedor_id,
                _conf(0.65 + 0.08 * _n_intent),
            ))

        # 4a) DUPLICADO (rojo) — conflicto duro por RUT/teléfono con etapa avanzada.
        pn = contact.phone_norm if contact else None
        rut = (contact.rut_persona or contact.rut_empresa) if contact else None
        dup, matched_by = None, None
        if pn and pn in dup_by_phone and dup_by_phone[pn][0] != lead.id:
            dup, matched_by = dup_by_phone[pn], "teléfono"
        elif rut and rut in dup_by_rut and dup_by_rut[rut][0] != lead.id:
            dup, matched_by = dup_by_rut[rut], "RUT"

        if dup:
            tgt_id, tgt_vendor = dup
            out.append(_insight(
                "duplicate", lead, 88,
                "Posible duplicado",
                f"Mismo {matched_by} que el Lead #{tgt_id}"
                + (f" asignado a {tgt_vendor}" if tgt_vendor else ""),
                "Ver lead en conflicto",
                {"kind": "drawer", "leadId": tgt_id, "tab": "resumen"},
                lead.agendadora_id,
                _conf(0.95 if matched_by == "RUT" else 0.90),
            ))

        # 4b) HUÉRFANO (ámbar) — dato extraído semánticamente del chat, no guardado.
        elif stage in ("lead", "recuperacion_lead") and lead.id in orphan_data:
            od = orphan_data[lead.id]
            _fields = {}
            _r = od.get("rut_persona")
            _em = od.get("email")
            if _r and _r not in (getattr(contact, "rut_persona", None), getattr(contact, "rut_empresa", None)):
                _fields["rut_persona"] = _r
            if _em and not (getattr(contact, "email", None) or "").strip():
                _fields["email"] = _em
            if _fields:
                _piezas = []
                if "rut_persona" in _fields:
                    _piezas.append(f"RUT {_fields['rut_persona']}")
                if "email" in _fields:
                    _piezas.append(f"correo {_fields['email']}")
                out.append(_insight(
                    "orphan", lead, 78,
                    "Dato huérfano detectado",
                    f"{' y '.join(_piezas)} extraído(s) del chat, sin guardar en el contacto",
                    "Auto-llenar contacto",
                    {"kind": "autofill", "leadId": lead.id, "contactId": lead.contact_id, "fields": _fields},
                    lead.agendadora_id,
                    # RUT validado por Módulo-11 → 99% de confianza; correo → 90%.
                    _conf(0.99 if "rut_persona" in _fields else 0.90),
                ))

    return out


def evaluate_for_user(db, current_user, visible_leads_fn):
    """Evalúa los insights de los leads ACTIVOS visibles del usuario y los
    persiste (upsert idempotente). Devuelve la lista de dicts Insight vigentes
    (excluyendo los silenciados por dismiss)."""
    q = db.query(models.Lead).options(joinedload(models.Lead.contact)).filter(
        models.Lead.current_stage.in_(ACTIVE_STAGES),
        models.Lead.deleted_at.is_(None),
    )
    q = visible_leads_fn(q, current_user, db)
    leads = q.all()

    computed = evaluate_leads(db, leads)
    computed_ids = {i["id"] for i in computed}
    lead_ids = [l.id for l in leads]

    # Upsert idempotente en la tabla insights (para persistencia + dismiss).
    for i in computed:
        row = db.query(models.Insight).filter(models.Insight.id == i["id"]).first()
        payload = json.dumps({k: v for k, v in i.items() if k != "user_id"})
        if row:
            row.priority = i["priority"]; row.payload_json = payload; row.user_id = i["user_id"]
        else:
            db.add(models.Insight(
                id=i["id"], lead_id=i["lead_id"], user_id=i["user_id"],
                type=i["type"], priority=i["priority"], payload_json=payload,
            ))
    # Limpia insights obsoletos de estos leads (ya no se cumplen).
    if lead_ids:
        stale = db.query(models.Insight).filter(
            models.Insight.lead_id.in_(lead_ids),
            models.Insight.id.notin_(computed_ids) if computed_ids else True,
        ).all()
        for s in stale:
            db.delete(s)
    db.commit()

    # Filtra los silenciados (dismiss vigente).
    now = _now()
    dismissed = {
        d.insight_key for d in db.query(models.InsightDismissal).filter(
            models.InsightDismissal.user_id == current_user.id,
            models.InsightDismissal.until > now,
        ).all()
    }
    result = [i for i in computed if i["id"] not in dismissed]
    result.sort(key=lambda x: x["priority"], reverse=True)
    # No exponemos user_id interno en el payload de salida.
    for i in result:
        i.pop("user_id", None)
    return result
