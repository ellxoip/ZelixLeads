"""
AI Agents — CRUD + contact-level control.

Permissions:
  CREATE / UPDATE (full) / DELETE  →  tecnico only
  LIST / VIEW logs                 →  tecnico (all) | superadmin/subadmin (own group only)
  TOGGLE active                    →  tecnico | superadmin | subadmin (own group)
  Contact-state (pause/resume)     →  any authenticated user
"""
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from .. import models
from ..auth import get_current_user
from ..plans import enforce_limit, _get_negocio

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai-agents", tags=["ai-agents"])


# ── Permission helpers ────────────────────────────────────────────────────────

def _is_tecnico(user: models.User) -> bool:
    return user.role == "tecnico"

def _is_admin(user: models.User) -> bool:
    return user.role in ("tecnico", "superadmin", "subadmin")

def _require_tecnico(user: models.User) -> None:
    if not _is_tecnico(user):
        raise HTTPException(status_code=403, detail="Solo el técnico puede realizar esta acción")

def _require_admin(user: models.User) -> None:
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="Acceso denegado")

def _can_manage_agent(user: models.User, agent: models.AIAgent) -> bool:
    """superadmin/subadmin can manage agents that belong to their group."""
    if _is_tecnico(user):
        return True
    if user.role in ("superadmin", "subadmin"):
        if user.group_id is None:  # global admin — same as tecnico for management
            return True
        return agent.group_id == user.group_id
    return False


# ── Schemas ───────────────────────────────────────────────────────────────────

class AgentCreate(BaseModel):
    name: str
    description: Optional[str] = None
    whatsapp_config_id: Optional[int] = None
    group_id: Optional[int] = None
    is_active: bool = True
    openai_api_key: str
    openai_model: str = "gpt-4o-mini"
    temperature: float = 0.7
    max_tokens: int = 500
    max_history_messages: int = 20
    system_prompt: str
    response_delay_seconds: int = 2
    escalation_keywords: list[str] = []
    business_hours_start: Optional[str] = None
    business_hours_end: Optional[str] = None


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    whatsapp_config_id: Optional[int] = None
    group_id: Optional[int] = None
    is_active: Optional[bool] = None
    openai_api_key: Optional[str] = None
    openai_model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    max_history_messages: Optional[int] = None
    system_prompt: Optional[str] = None
    response_delay_seconds: Optional[int] = None
    escalation_keywords: Optional[list[str]] = None
    business_hours_start: Optional[str] = None
    business_hours_end: Optional[str] = None


def _load_agent_configs(db: Session, agent_id: int) -> list[dict]:
    """Query ai_agent_configs directly to avoid lazy-load issues."""
    rows = (
        db.query(models.WhatsAppConfig)
        .join(
            models.ai_agent_configs,
            models.ai_agent_configs.c.whatsapp_config_id == models.WhatsAppConfig.id,
        )
        .options(joinedload(models.WhatsAppConfig.group))
        .filter(models.ai_agent_configs.c.agent_id == agent_id)
        .all()
    )
    return [
        {
            "id": c.id,
            "name": c.name,
            "phone_number": c.phone_number,
            "group_id": c.group_id,
            "group_name": c.group.name if c.group else None,
        }
        for c in rows
    ]


def _agent_out(a: models.AIAgent, hide_sensitive: bool = False, db: Session = None) -> dict:
    configs = _load_agent_configs(db, a.id) if db else []
    return {
        "id": a.id,
        "name": a.name,
        "description": a.description,
        "whatsapp_config_id": a.whatsapp_config_id,
        "whatsapp_config_name": a.whatsapp_config.name if a.whatsapp_config else None,
        "whatsapp_phone": a.whatsapp_config.phone_number if a.whatsapp_config else None,
        "configs": configs,
        "group_id": a.group_id,
        "group_name": a.group.name if a.group else None,
        "is_active": a.is_active,
        "openai_api_key_hint": "***" + (a.openai_api_key or "")[-4:] if a.openai_api_key else "",
        "openai_model": a.openai_model,
        "temperature": a.temperature,
        "max_tokens": a.max_tokens,
        "max_history_messages": a.max_history_messages,
        "system_prompt": a.system_prompt if not hide_sensitive else None,
        "response_delay_seconds": a.response_delay_seconds,
        "escalation_keywords": json.loads(a.escalation_keywords or "[]"),
        "business_hours_start": a.business_hours_start,
        "business_hours_end": a.business_hours_end,
        "total_messages_sent": a.total_messages_sent,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


# ── CRUD (tecnico only for write) ─────────────────────────────────────────────

@router.get("")
def list_agents(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _require_admin(current_user)
    q = db.query(models.AIAgent)
    if not _is_tecnico(current_user) and current_user.group_id is not None:
        # Business admins with a group see only their group's agents
        q = q.filter(models.AIAgent.group_id == current_user.group_id)
    # Superadmins with no group (global admins) see all agents, like tecnico
    agents = q.order_by(models.AIAgent.id).all()
    hide = not _is_tecnico(current_user)
    return [_agent_out(a, hide_sensitive=hide, db=db) for a in agents]


@router.post("")
def create_agent(
    body: AgentCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _require_tecnico(current_user)
    if body.whatsapp_config_id:
        cfg = db.query(models.WhatsAppConfig).get(body.whatsapp_config_id)
        if not cfg:
            raise HTTPException(status_code=404, detail="Configuración WhatsApp no encontrada")

    # Plan limit: count agents already assigned to the target negocio
    if body.group_id:
        negocio = _get_negocio(db, body.group_id)
        if negocio:
            all_group_ids_q = db.query(models.Group.id).filter(
                (models.Group.id == negocio.id) | (models.Group.negocio_id == negocio.id)
            ).subquery()
            agent_count = db.query(models.AIAgent).filter(
                models.AIAgent.group_id.in_(all_group_ids_q),
            ).count()
            enforce_limit(db, body.group_id, "max_ai_agents", agent_count)

    agent = models.AIAgent(
        name=body.name,
        description=body.description,
        whatsapp_config_id=body.whatsapp_config_id,
        group_id=body.group_id,
        is_active=body.is_active,
        openai_api_key=body.openai_api_key,
        openai_model=body.openai_model,
        temperature=body.temperature,
        max_tokens=body.max_tokens,
        max_history_messages=body.max_history_messages,
        system_prompt=body.system_prompt,
        response_delay_seconds=body.response_delay_seconds,
        escalation_keywords=json.dumps(body.escalation_keywords),
        business_hours_start=body.business_hours_start or None,
        business_hours_end=body.business_hours_end or None,
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return _agent_out(agent, db=db)


@router.put("/{agent_id}")
def update_agent(
    agent_id: int,
    body: AgentUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _require_tecnico(current_user)
    agent = db.query(models.AIAgent).get(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agente no encontrado")

    for field, val in body.model_dump(exclude_none=True).items():
        if field == "escalation_keywords":
            setattr(agent, field, json.dumps(val))
        elif field in ("business_hours_start", "business_hours_end"):
            setattr(agent, field, val or None)
        else:
            setattr(agent, field, val)

    db.commit()
    db.refresh(agent)
    return _agent_out(agent, db=db)


class AssignWhatsApp(BaseModel):
    whatsapp_config_id: Optional[int] = None  # None = desasignar


@router.patch("/{agent_id}/assign-whatsapp")
def assign_whatsapp(
    agent_id: int,
    body: AssignWhatsApp,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Admin can assign/unassign a WA config to an agent of their group."""
    _require_admin(current_user)
    agent = db.query(models.AIAgent).get(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agente no encontrado")
    if not _can_manage_agent(current_user, agent):
        raise HTTPException(status_code=403, detail="No tienes permiso sobre este agente")
    if body.whatsapp_config_id:
        cfg = db.query(models.WhatsAppConfig).get(body.whatsapp_config_id)
        if not cfg:
            raise HTTPException(status_code=404, detail="Configuración WhatsApp no encontrada")
    agent.whatsapp_config_id = body.whatsapp_config_id
    db.commit()
    return {"ok": True, "whatsapp_config_id": agent.whatsapp_config_id}


class AgentSchedule(BaseModel):
    business_hours_start: Optional[str] = None   # "HH:MM" o null para 24/7
    business_hours_end: Optional[str] = None


@router.patch("/{agent_id}/schedule")
def update_agent_schedule(
    agent_id: int,
    body: AgentSchedule,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    superadmin/subadmin can configure the activation schedule (business hours)
    of an agent that belongs to their group.
    Both start and end must be set together, or both null (= 24/7).
    """
    _require_admin(current_user)
    agent = db.query(models.AIAgent).get(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agente no encontrado")
    if not _can_manage_agent(current_user, agent):
        raise HTTPException(status_code=403, detail="No tienes permiso sobre este agente")

    start = body.business_hours_start or None
    end   = body.business_hours_end or None

    # Either both set or both null
    if bool(start) != bool(end):
        raise HTTPException(
            status_code=400,
            detail="Debes indicar tanto la hora de inicio como la de fin (o dejar ambas vacías para activar 24/7).",
        )

    agent.business_hours_start = start
    agent.business_hours_end   = end
    db.commit()
    db.refresh(agent)
    return {
        "ok": True,
        "business_hours_start": agent.business_hours_start,
        "business_hours_end": agent.business_hours_end,
    }


@router.patch("/{agent_id}/toggle")
def toggle_agent(
    agent_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """superadmin/subadmin can enable or disable an agent that belongs to their group."""
    _require_admin(current_user)
    agent = db.query(models.AIAgent).get(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agente no encontrado")
    if not _can_manage_agent(current_user, agent):
        raise HTTPException(status_code=403, detail="No tienes permiso sobre este agente")
    agent.is_active = not agent.is_active
    db.commit()
    return {"ok": True, "is_active": agent.is_active}


@router.delete("/{agent_id}")
def delete_agent(
    agent_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _require_tecnico(current_user)
    agent = db.query(models.AIAgent).get(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agente no encontrado")
    db.delete(agent)
    db.commit()
    return {"ok": True}


# ── Multi-config management ───────────────────────────────────────────────────

class AddConfig(BaseModel):
    whatsapp_config_id: int

@router.post("/{agent_id}/configs")
def add_config(
    agent_id: int,
    body: AddConfig,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Add a WhatsApp number to this agent (max 10)."""
    _require_admin(current_user)
    agent = db.query(models.AIAgent).get(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agente no encontrado")
    if not _can_manage_agent(current_user, agent):
        raise HTTPException(status_code=403, detail="No tienes permiso sobre este agente")
    cfg = db.query(models.WhatsAppConfig).get(body.whatsapp_config_id)
    if not cfg:
        raise HTTPException(status_code=404, detail="Configuración WhatsApp no encontrada")
    if len(agent.configs) >= 10:
        raise HTTPException(status_code=400, detail="Máximo 10 números por agente")
    if cfg not in agent.configs:
        agent.configs.append(cfg)
        db.commit()
    db.refresh(agent)
    return _agent_out(agent, db=db)


@router.delete("/{agent_id}/configs/{config_id}")
def remove_config(
    agent_id: int,
    config_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Remove a WhatsApp number from this agent."""
    _require_admin(current_user)
    agent = db.query(models.AIAgent).get(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agente no encontrado")
    if not _can_manage_agent(current_user, agent):
        raise HTTPException(status_code=403, detail="No tienes permiso sobre este agente")
    cfg = db.query(models.WhatsAppConfig).get(config_id)
    if cfg and cfg in agent.configs:
        agent.configs.remove(cfg)
        db.commit()
    db.refresh(agent)
    return _agent_out(agent, db=db)


# ── Logs ──────────────────────────────────────────────────────────────────────

@router.get("/{agent_id}/logs")
def get_agent_logs(
    agent_id: int,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _require_admin(current_user)
    agent = db.query(models.AIAgent).get(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agente no encontrado")
    if not _can_manage_agent(current_user, agent):
        raise HTTPException(status_code=403, detail="No tienes permiso sobre este agente")

    logs = (
        db.query(models.AIAgentLog)
        .filter(models.AIAgentLog.agent_id == agent_id)
        .order_by(models.AIAgentLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": l.id,
            "contact_id": l.contact_id,
            "lead_id": l.lead_id,
            "input_message": l.input_message,
            "output_message": l.output_message,
            "tokens_used": l.tokens_used,
            "model_used": l.model_used,
            "latency_ms": l.latency_ms,
            "error": l.error,
            "created_at": l.created_at.isoformat() if l.created_at else None,
        }
        for l in logs
    ]


# ── Contact-level control (any authenticated user) ───────────────────────────

@router.get("/contact-state/{contact_id}")
def get_contact_agent_state(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    msg = (
        db.query(models.WhatsAppMessage)
        .filter(models.WhatsAppMessage.contact_id == contact_id)
        .order_by(models.WhatsAppMessage.created_at.desc())
        .first()
    )
    config_id = msg.whatsapp_config_id if msg else None

    agent = None
    if config_id:
        agent = (
            db.query(models.AIAgent)
            .filter(
                models.AIAgent.whatsapp_config_id == config_id,
                models.AIAgent.is_active == True,
            )
            .first()
        )

    if not agent:
        return {"agent": None, "state": None}

    state = (
        db.query(models.AIAgentContactState)
        .filter_by(agent_id=agent.id, contact_id=contact_id)
        .first()
    )
    return {
        "agent": {"id": agent.id, "name": agent.name},
        "state": state.state if state else "active",
    }


class ContactStateUpdate(BaseModel):
    state: str  # active | paused | handed_off


@router.post("/{agent_id}/contact/{contact_id}/state")
def set_contact_state(
    agent_id: int,
    contact_id: int,
    body: ContactStateUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if body.state not in ("active", "paused", "handed_off"):
        raise HTTPException(status_code=400, detail="Estado inválido")

    agent = db.query(models.AIAgent).get(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agente no encontrado")

    state = (
        db.query(models.AIAgentContactState)
        .filter_by(agent_id=agent_id, contact_id=contact_id)
        .first()
    )
    if not state:
        state = models.AIAgentContactState(
            agent_id=agent_id, contact_id=contact_id, state=body.state
        )
        db.add(state)
    else:
        state.state = body.state

    db.commit()
    return {"ok": True, "state": body.state}
