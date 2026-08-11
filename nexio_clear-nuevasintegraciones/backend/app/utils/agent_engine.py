"""
AI Agent Engine — automated WhatsApp replies via OpenAI.

Flow:
  1. Contact writes outside business hours
  2. Agent auto-creates a lead in 'lead' stage (if none exists)
  3. Agent collects: name + reason for consultation
  4. Agent calls registrar_caso() → saves info to lead notes + notifies agendadora
  5. Agent tells client their case is registered and team will follow up
"""
import asyncio
import json
import logging
import random
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import httpx
from openai import AsyncOpenAI
from sqlalchemy.orm import Session

from .. import models
from ..models import area_phone_numbers

logger = logging.getLogger(__name__)

QR_SERVICE_URL = "http://localhost:3005"


# ── helpers ───────────────────────────────────────────────────────────────────

_CHILE_TZ = ZoneInfo("America/Santiago")

def _now_hhmm() -> str:
    """Return current time in Chile/Santiago timezone (where all businesses operate)."""
    return datetime.now(_CHILE_TZ).strftime("%H:%M")


def _within_hours(start: str | None, end: str | None) -> bool:
    if not start or not end:
        return True
    now = _now_hhmm()
    if start <= end:
        return start <= now <= end
    return now >= start or now <= end


def _get_or_create_state(db: Session, agent_id: int, contact_id: int) -> models.AIAgentContactState:
    state = (
        db.query(models.AIAgentContactState)
        .filter_by(agent_id=agent_id, contact_id=contact_id)
        .first()
    )
    if not state:
        state = models.AIAgentContactState(agent_id=agent_id, contact_id=contact_id, state="active")
        db.add(state)
        db.flush()
    return state


async def _send_via_cloud_api(db, config_id: int, phone: str, message: str) -> str | None:
    """
    Envío por la API oficial de Meta.

    Reemplaza a `_send_via_qr`, que hablaba con un servicio Node basado en
    @whiskeysockets/baileys (no oficial, por QR). Se retiró al fusionar con
    Zelix: la Cloud API ya hacía lo mismo sin poner en riesgo de baneo el número
    que atiende a los clientes.

    Devuelve el message_id, o None si no salió — quien llama decide qué hacer.
    """
    from ..routers.whatsapp import send_whatsapp_api  # import local: evita ciclo

    config = db.query(models.WhatsAppConfig).filter(models.WhatsAppConfig.id == config_id).first()
    if not config:
        logger.warning("envío WhatsApp: no existe la config %s", config_id)
        return None
    try:
        r = await send_whatsapp_api(config, phone, message)
        if r.get("status") == "sent":
            return r.get("message_id") or ""
        logger.warning("envío WhatsApp no salió (config %s, estado %s)", config_id, r.get("status"))
    except Exception as exc:  # noqa: BLE001 — un fallo de envío jamás tumba el flujo
        logger.warning("envío WhatsApp falló (config %s): %s", config_id, exc)
    return None


async def _send_via_channel(db, config_id: int, phone: str, message: str) -> str | None:
    """Despacha el envío. WhatsApp es el único canal del sistema."""
    return await _send_via_cloud_api(db, config_id, phone, message)


def _split_reply(text: str) -> list[str]:
    MAX = 4000
    if "---" in text:
        parts = [p.strip() for p in text.split("---") if p.strip()]
    else:
        parts = [p.strip() for p in text.split("\n\n") if p.strip()]
    if not parts:
        parts = [text.strip()]
    safe: list[str] = []
    for part in parts:
        while len(part) > MAX:
            cut = part.rfind(" ", 0, MAX)
            if cut == -1:
                cut = MAX
            safe.append(part[:cut].strip())
            part = part[cut:].strip()
        if part:
            safe.append(part)
    return safe


def _save_outbound(db: Session, contact: models.Contact, lead: models.Lead | None,
                   config_id: int, text: str, agent_id: int,
                   message_id: str | None = None) -> models.WhatsAppMessage:
    msg = models.WhatsAppMessage(
        contact_id=contact.id,
        lead_id=lead.id if lead else None,
        whatsapp_config_id=config_id,
        direction="out",
        message_type="text",
        content=text,
        status="sent",
        is_read=True,
        message_id=message_id or None,
    )
    db.add(msg)
    return msg


# ── lead auto-creation ────────────────────────────────────────────────────────

def _find_area_for_config(db: Session, config_id: int) -> models.Area | None:
    """Find the area that owns this WhatsApp number (primary or secondary)."""
    # Primary assignment: areas.whatsapp_config_id
    area = db.query(models.Area).filter(models.Area.whatsapp_config_id == config_id).first()
    if area:
        return area
    # Secondary assignment: area_phone_numbers many-to-many table
    area = (
        db.query(models.Area)
        .join(area_phone_numbers, models.Area.id == area_phone_numbers.c.area_id)
        .filter(area_phone_numbers.c.whatsapp_config_id == config_id)
        .first()
    )
    return area


def _get_system_user_id(db: Session) -> int:
    user = (
        db.query(models.User)
        .filter(models.User.role.in_(["tecnico", "superadmin"]))
        .order_by(models.User.id)
        .first()
    )
    return user.id if user else 1


def _ensure_lead(db: Session, contact: models.Contact, agent: models.AIAgent,
                 config_id: int) -> models.Lead | None:
    """Return existing lead for this contact, or create one in 'lead' stage.

    The area is resolved from the WhatsApp number that received the message,
    so the lead lands in the correct area and group automatically.
    """
    area = _find_area_for_config(db, config_id)
    if not area:
        logger.warning("Agent %s: no area found for config %s — cannot create lead", agent.id, config_id)
        return None

    group_id = area.group_id

    existing = (
        db.query(models.Lead)
        .filter(models.Lead.contact_id == contact.id, models.Lead.group_id == group_id)
        .order_by(models.Lead.created_at.desc())
        .first()
    )
    if existing:
        if existing.ai_agent_id is None:
            existing.ai_agent_id = agent.id
            db.flush()
        return existing

    agendadora = db.query(models.User).filter(
        models.User.group_id == group_id, models.User.role == "agendadora"
    ).first()
    vendedor = db.query(models.User).filter(
        models.User.group_id == group_id, models.User.role == "vendedor"
    ).first()

    if not agendadora or not vendedor:
        logger.warning("Agent %s: no agendadora/vendedor in group %s — cannot create lead", agent.id, group_id)
        return None

    lead = models.Lead(
        contact_id=contact.id,
        area_id=area.id,
        group_id=group_id,
        agendadora_id=agendadora.id,
        vendedor_id=vendedor.id,
        current_stage="lead",
        source="whatsapp",
        ai_agent_id=agent.id,
        notes="⏳ Pendiente de revisión — lead captado por agente IA fuera de horario.",
    )
    db.add(lead)
    db.flush()
    db.add(models.LeadHistory(
        lead_id=lead.id,
        from_stage=None,
        to_stage="lead",
        notes="Lead nuevo — ingresó vía WhatsApp fuera de horario (agente IA)",
        created_by=_get_system_user_id(db),
    ))
    db.flush()
    logger.info("Agent %s auto-created lead %s for contact %s", agent.id, lead.id, contact.id)
    return lead


# ── case registration tool ────────────────────────────────────────────────────

def _registrar_caso(db: Session, lead: models.Lead, agent: models.AIAgent,
                    nombre: str, motivo: str) -> str:
    """Save collected info to lead notes and notify the agendadora."""
    timestamp = datetime.now().strftime("%d/%m/%Y %H:%M")

    # Update contact name if agent collected it
    if nombre and lead.contact and lead.contact.name in ("", "Desconocido", lead.contact.phone):
        lead.contact.name = nombre

    # Append collected info to lead notes
    info_block = (
        f"\n\n--- Información recopilada por agente IA ({timestamp}) ---\n"
        f"Nombre: {nombre}\n"
        f"Motivo: {motivo}\n"
        f"Estado: Pendiente de contacto por agendadora"
    )
    lead.notes = (lead.notes or "") + info_block

    # Notify the agendadora
    agendadora_id = lead.agendadora_id
    if agendadora_id:
        contact_name = lead.contact.name if lead.contact else "Cliente"
        from .notifications import create_notification
        create_notification(
            db,
            user_id=agendadora_id,
            title="🤖 Lead nuevo — requiere atención",
            message=f"{contact_name} escribió fuera de horario. Motivo: {motivo}. Revisar a primera hora.",
            lead_id=lead.id,
        )

    db.flush()
    logger.info("Agent %s registered case for lead %s: %s", agent.id, lead.id, motivo)
    return "ok"


# ── tool definition ───────────────────────────────────────────────────────────

_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "registrar_caso",
            "description": (
                "Llama a esta función cuando hayas recopilado el nombre del cliente y el motivo "
                "de su consulta. Registra el caso para que la agendadora lo atienda mañana."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "nombre": {
                        "type": "string",
                        "description": "Nombre completo del cliente",
                    },
                    "motivo": {
                        "type": "string",
                        "description": "Motivo o tema de la consulta (ej: deuda SII, TGR, factura falsa)",
                    },
                },
                "required": ["nombre", "motivo"],
            },
        },
    }
]


# ── public entry point ────────────────────────────────────────────────────────

async def maybe_run_agent(
    db: Session,
    config_id: int,
    contact: models.Contact,
    lead: models.Lead | None,
    incoming_msg: models.WhatsAppMessage,
) -> None:
    # 1. Find active agent for this WA number (via M2M ai_agent_configs)
    from sqlalchemy import text as _text
    agent: models.AIAgent | None = (
        db.query(models.AIAgent)
        .join(
            models.ai_agent_configs,
            models.ai_agent_configs.c.agent_id == models.AIAgent.id,
        )
        .filter(
            models.ai_agent_configs.c.whatsapp_config_id == config_id,
            models.AIAgent.is_active == True,
        )
        .first()
    )
    if not agent:
        return

    # 2. Contact state gate
    state = _get_or_create_state(db, agent.id, contact.id)
    if state.state in ("paused", "handed_off"):
        logger.info("Agent %s skipped — contact %s is %s", agent.id, contact.id, state.state)
        return

    # 3. Business hours gate
    if not _within_hours(agent.business_hours_start, agent.business_hours_end):
        logger.info("Agent %s outside business hours, skipping", agent.id)
        return

    # 4. Tag existing lead with ai_agent_id.
    #    New leads are only created inside registrar_caso() — after the person confirms.
    if lead is not None and lead.ai_agent_id is None:
        lead.ai_agent_id = agent.id
        db.flush()

    # 5. Build conversation history
    history = (
        db.query(models.WhatsAppMessage)
        .filter(models.WhatsAppMessage.contact_id == contact.id)
        .order_by(models.WhatsAppMessage.created_at.desc())
        .limit(agent.max_history_messages + 1)
        .all()
    )
    history = list(reversed(history))

    now_str = datetime.now().strftime("%A %d/%m/%Y %H:%M")
    system_content = (
        f"{agent.system_prompt}\n\n"
        f"Fecha y hora actual: {now_str}."
    )
    openai_messages: list[dict] = [{"role": "system", "content": system_content}]

    for m in history:
        if m.id == incoming_msg.id:
            continue
        if not (m.content or "").strip():
            continue
        openai_messages.append({"role": "user" if m.direction == "in" else "assistant", "content": m.content})

    user_text = (incoming_msg.content or "").strip()
    if not user_text:
        return
    openai_messages.append({"role": "user", "content": user_text})

    # 6. Typing delay
    if agent.response_delay_seconds and agent.response_delay_seconds > 0:
        await asyncio.sleep(min(agent.response_delay_seconds, 10))

    # 7. Call OpenAI
    start_ts = time.time()
    reply_text = ""
    tokens_used = 0
    error_text: str | None = None

    try:
        client = AsyncOpenAI(api_key=agent.openai_api_key)
        response = await client.chat.completions.create(
            model=agent.openai_model,
            messages=openai_messages,
            tools=_TOOLS,
            tool_choice="auto",
            temperature=agent.temperature,
            max_tokens=agent.max_tokens,
        )

        choice = response.choices[0]
        tokens_used = response.usage.total_tokens if response.usage else 0

        if choice.finish_reason == "tool_calls" and choice.message.tool_calls:
            tool_call = choice.message.tool_calls[0]
            if tool_call.function.name == "registrar_caso":
                try:
                    args = json.loads(tool_call.function.arguments)
                except Exception:
                    args = {}

                # Create the lead now — person just confirmed they want to register
                if lead is None:
                    lead = _ensure_lead(db, contact, agent, config_id)

                if lead:
                    _registrar_caso(
                        db, lead, agent,
                        nombre=args.get("nombre", contact.name or ""),
                        motivo=args.get("motivo", "consulta tributaria"),
                    )

                # Give model the tool result so it writes the farewell message
                followup_messages = openai_messages + [
                    {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [{
                            "id": tool_call.id,
                            "type": "function",
                            "function": {
                                "name": tool_call.function.name,
                                "arguments": tool_call.function.arguments,
                            },
                        }],
                    },
                    {"role": "tool", "tool_call_id": tool_call.id, "content": "ok"},
                ]
                followup = await client.chat.completions.create(
                    model=agent.openai_model,
                    messages=followup_messages,
                    temperature=agent.temperature,
                    max_tokens=agent.max_tokens,
                )
                reply_text = (followup.choices[0].message.content or "").strip()
                tokens_used += followup.usage.total_tokens if followup.usage else 0
        else:
            reply_text = (choice.message.content or "").strip()

    except Exception as exc:
        error_text = str(exc)
        logger.error("OpenAI error for agent %s: %s", agent.id, exc)
        db.add(models.AIAgentLog(
            agent_id=agent.id, contact_id=contact.id,
            lead_id=lead.id if lead else None,
            input_message=user_text, output_message=None,
            tokens_used=0, model_used=agent.openai_model,
            latency_ms=int((time.time() - start_ts) * 1000), error=error_text,
        ))
        db.commit()
        return

    latency_ms = int((time.time() - start_ts) * 1000)
    if not reply_text:
        return

    # 8. Escalation keywords check
    try:
        esc_keywords: list[str] = json.loads(agent.escalation_keywords or "[]")
    except Exception:
        esc_keywords = []
    needs_escalation = any(kw.lower() in reply_text.lower() for kw in esc_keywords if kw.strip())

    # 9. Send reply
    chunks = _split_reply(reply_text)
    sent_chunks: list[tuple[str, str | None]] = []

    for i, chunk in enumerate(chunks):
        if i > 0:
            # Typing delay: 1s base + ~20 chars/sec + random jitter, capped a 8s
            delay = 1.0 + len(chunk) / 20.0
            delay = min(delay, 8.0)
            delay += random.uniform(-0.3, 0.5)
            delay = max(delay, 1.0)
            await asyncio.sleep(delay)
        mid = await _send_via_channel(db, config_id, contact.phone, chunk)
        if mid is not None:
            sent_chunks.append((chunk, mid))
        else:
            error_text = f"Delivery failed chunk {i+1}/{len(chunks)}"
            logger.error("Agent %s failed chunk %d/%d to %s", agent.id, i + 1, len(chunks), contact.phone)

    if not sent_chunks:
        db.add(models.AIAgentLog(
            agent_id=agent.id, contact_id=contact.id,
            lead_id=lead.id if lead else None,
            input_message=user_text, output_message=reply_text,
            tokens_used=tokens_used, model_used=agent.openai_model,
            latency_ms=latency_ms, error="All chunks failed to deliver",
        ))
        db.commit()
        return

    # 10. Persist messages
    from ..broadcaster import wa_broadcaster
    out_msgs: list[models.WhatsAppMessage] = []
    for chunk, mid in sent_chunks:
        out_msgs.append(_save_outbound(db, contact, lead, config_id, chunk, agent.id, message_id=mid or None))

    if needs_escalation:
        state.state = "handed_off"
        logger.info("Agent %s handing off contact %s to human", agent.id, contact.id)

    agent.total_messages_sent = (agent.total_messages_sent or 0) + len(sent_chunks)
    db.add(models.AIAgentLog(
        agent_id=agent.id, contact_id=contact.id,
        lead_id=lead.id if lead else None,
        input_message=user_text, output_message="\n\n".join(c for c, _ in sent_chunks),
        tokens_used=tokens_used, model_used=agent.openai_model,
        latency_ms=latency_ms, error=error_text,
    ))
    db.commit()

    # 11. Broadcast
    for out_msg in out_msgs:
        db.refresh(out_msg)
        await wa_broadcaster.broadcast("new_message", {
            "contact_id": contact.id,
            "message": {
                "id": out_msg.id, "contact_id": out_msg.contact_id,
                "lead_id": out_msg.lead_id, "whatsapp_config_id": out_msg.whatsapp_config_id,
                "direction": "out", "message_type": "text", "content": out_msg.content,
                "media_url": None, "status": "sent", "is_read": True,
                "created_at": out_msg.created_at.isoformat() if out_msg.created_at else None,
            },
        })
