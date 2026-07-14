from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey, Date, Index, Table, event
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base
from .search_utils import norm_text, phone_digits

# Many-to-many: Area ↔ WhatsAppConfig (1 number can serve multiple areas)
area_phone_numbers = Table(
    "area_phone_numbers",
    Base.metadata,
    Column("area_id", Integer, ForeignKey("areas.id", ondelete="CASCADE"), primary_key=True),
    Column("whatsapp_config_id", Integer, ForeignKey("whatsapp_configs.id", ondelete="CASCADE"), primary_key=True),
)

# Many-to-many: Area ↔ User (multiple agendadoras/vendedores per area)
area_users = Table(
    "area_users",
    Base.metadata,
    Column("area_id", Integer, ForeignKey("areas.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id",  Integer, ForeignKey("users.id",  ondelete="CASCADE"), primary_key=True),
)

# Many-to-many: Group ↔ User (user can belong to multiple groups)
group_users = Table(
    "group_users",
    Base.metadata,
    Column("group_id", Integer, ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id",  Integer, ForeignKey("users.id",  ondelete="CASCADE"), primary_key=True),
)

# Many-to-many: AIAgent ↔ WhatsAppConfig (1 agent can serve multiple numbers, fully isolated by config_id)
ai_agent_configs = Table(
    "ai_agent_configs",
    Base.metadata,
    Column("agent_id", Integer, ForeignKey("ai_agents.id", ondelete="CASCADE"), primary_key=True),
    Column("whatsapp_config_id", Integer, ForeignKey("whatsapp_configs.id", ondelete="CASCADE"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    password_hash = Column(String(200), nullable=False)
    # superadmin, subadmin, vendedor, agendadora, dante
    role = Column(String(30), nullable=False)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    whatsapp_number = Column(String(30), nullable=True)
    avatar_url = Column(String(200), nullable=True)
    at_informa_user_id = Column(String(100), nullable=True)  # UUID del usuario en AT Informa
    cobrador_area = Column(Text, nullable=True)  # comma-separated area names this cobrador handles
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    dashboard_clear_at = Column(DateTime(timezone=True), nullable=True)
    # ISO 27001 A.9.4.2 — brute-force protection
    failed_login_attempts = Column(Integer, default=0, nullable=False)
    locked_until = Column(DateTime(timezone=True), nullable=True)

    group = relationship("Group", back_populates="members")
    member_groups = relationship("Group", secondary=group_users, back_populates="member_users")
    leads_as_agendadora = relationship("Lead", foreign_keys="Lead.agendadora_id", back_populates="agendadora")
    leads_as_vendedor = relationship("Lead", foreign_keys="Lead.vendedor_id", back_populates="vendedor")
    notifications = relationship("Notification", back_populates="user")
    payment_verifications = relationship("PaymentVerification", back_populates="assigned_to_user")
    calendar_events = relationship("CalendarEvent", foreign_keys="CalendarEvent.created_by", back_populates="creator")
    google_token = relationship("GoogleCalendarToken", back_populates="user", uselist=False)

    @property
    def group_ids(self) -> list:
        try:
            return [g.id for g in self.member_groups]
        except Exception:
            return []


class Group(Base):
    __tablename__ = "groups"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    negocio_id = Column(Integer, ForeignKey("groups.id"), nullable=True)
    # tipo: 'abogados' keeps hardcoded pipeline + AT/LF integrations; others use custom stages
    tipo = Column(String(50), nullable=False, server_default="abogados")
    # plan: basico | pro | enterprise
    plan = Column(String(20), nullable=False, server_default="basico")
    plan_expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    members = relationship("User", back_populates="group")
    member_users = relationship("User", secondary=group_users, back_populates="member_groups")
    areas = relationship("Area", back_populates="group")
    whatsapp_configs = relationship("WhatsAppConfig", back_populates="group")
    leads = relationship("Lead", back_populates="group")
    sub_groups = relationship("Group", foreign_keys="Group.negocio_id",
                              primaryjoin="Group.id == foreign(Group.negocio_id)")
    pipeline_stages = relationship("PipelineStage", back_populates="negocio",
                                   foreign_keys="PipelineStage.negocio_id",
                                   order_by="PipelineStage.order")


class PipelineStage(Base):
    __tablename__ = "pipeline_stages"
    id = Column(Integer, primary_key=True, index=True)
    negocio_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    key = Column(String(100), nullable=False)   # slug used as current_stage value
    name = Column(String(100), nullable=False)  # display label
    color = Column(String(50), nullable=True)   # hex or tailwind token
    order = Column(Integer, default=0)

    negocio = relationship("Group", back_populates="pipeline_stages", foreign_keys=[negocio_id])


class Area(Base):
    __tablename__ = "areas"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    whatsapp_config_id = Column(Integer, ForeignKey("whatsapp_configs.id"), nullable=True)
    kpi_leads = Column(Integer, default=50)
    is_active = Column(Boolean, default=True)

    group = relationship("Group", back_populates="areas")
    whatsapp_config = relationship("WhatsAppConfig", foreign_keys=[whatsapp_config_id], back_populates="areas")
    phone_configs = relationship("WhatsAppConfig", secondary=area_phone_numbers)
    leads = relationship("Lead", back_populates="area")
    users = relationship("User", secondary=area_users, lazy="select")


class WhatsAppConfig(Base):
    __tablename__ = "whatsapp_configs"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    phone_number = Column(String(30), nullable=False)
    api_token = Column(String(500), nullable=True)
    api_provider = Column(String(30), default="manual")  # meta, twilio, manual, qr
    phone_number_id = Column(String(100), nullable=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # agendadora who owns this QR session
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    group = relationship("Group", back_populates="whatsapp_configs")
    owner = relationship("User", foreign_keys=[owner_user_id])
    areas = relationship("Area", foreign_keys="[Area.whatsapp_config_id]", back_populates="whatsapp_config")
    messages = relationship("WhatsAppMessage", back_populates="whatsapp_config")


class Contact(Base):
    __tablename__ = "contacts"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    rut_persona = Column(String(20), nullable=True)
    rut_empresa = Column(String(20), nullable=True)
    razon_social = Column(String(200), nullable=True)
    email = Column(String(100), nullable=True)
    phone = Column(String(30), nullable=False)
    address = Column(String(200), nullable=True)
    city = Column(String(100), nullable=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    notes = Column(Text, nullable=True)
    avatar_url = Column(String(500), nullable=True)
    # Buscador Global 360 — columnas derivadas e indexadas (sargables).
    # Aditivas y nullable: no rompen registros existentes. Se mantienen
    # automáticamente vía los event listeners de abajo.
    search_name = Column(String(200), index=True, nullable=True)  # norm_text(name + razon_social)
    phone_norm  = Column(String(40),  index=True, nullable=True)  # phone_digits(phone)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    leads = relationship("Lead", back_populates="contact", cascade="all, delete-orphan")
    whatsapp_messages = relationship("WhatsAppMessage", back_populates="contact", cascade="all, delete-orphan")
    creator = relationship("User", foreign_keys=[created_by])


@event.listens_for(Contact, "before_insert")
@event.listens_for(Contact, "before_update")
def _contact_search_sync(_mapper, _connection, target: "Contact") -> None:
    """Mantiene search_name / phone_norm al día en cada escritura del Contact.

    Garantiza que contactos nuevos o editados queden buscables sin tener que
    tocar cada endpoint que crea/actualiza contactos.
    """
    full_name = " ".join(p for p in (target.name, target.razon_social) if p)
    target.search_name = norm_text(full_name)
    target.phone_norm = phone_digits(target.phone)


class Lead(Base):
    __tablename__ = "leads"
    id = Column(Integer, primary_key=True, index=True)
    contact_id = Column(Integer, ForeignKey("contacts.id"), nullable=False)
    area_id = Column(Integer, ForeignKey("areas.id"), nullable=False)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    agendadora_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    vendedor_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    # Stages: lead, reunion, cierre, pagado, pagado_confirmado
    # Recovery: recuperacion_lead, recuperacion_reunion, recuperacion_cierre
    current_stage = Column(String(50), default="lead", nullable=False)
    service_description = Column(Text, nullable=True)
    honorarios = Column(Float, default=0)
    cuota_inicial = Column(Float, default=0)
    num_cuotas = Column(Integer, default=1)
    monto_cuota = Column(Float, default=0)
    notes = Column(Text, nullable=True)
    priority = Column(String(20), default="normal")  # low, normal, high
    source = Column(String(50), nullable=True)  # whatsapp, referido, etc.
    at_informa_case_id = Column(String(100), nullable=True)
    at_informa_status = Column(String(50), nullable=True)
    legal_finance_contrato_id = Column(Integer, nullable=True)
    pagacuotas_cliente_id = Column(String(100), nullable=True)
    pagacuotas_status = Column(String(20), nullable=True)  # pending, created, failed
    pagacuotas_link = Column(String(500), nullable=True)
    hive_service_case_id = Column(String(100), nullable=True)
    hive_service_status = Column(String(30), nullable=True)
    # Tracks the last vendor meeting outcome; cleared when a new meeting is scheduled.
    # 'sin_exito' leads are hidden from the pipeline kanban (only in Seguimiento).
    # 'no_show' leads remain visible in the kanban with a warning badge.
    last_vendor_outcome = Column(String(30), nullable=True)
    # Payment commitment tracking (used by AsistenteSeguimiento panel)
    payment_commitment_date = Column(Date, nullable=True)
    payment_reminder_sent_at = Column(Date, nullable=True)
    seguimiento_status = Column(String(30), nullable=True)  # en_seguimiento, contactado, repactado, pagado, perdido
    ai_agent_id = Column(Integer, ForeignKey("ai_agents.id"), nullable=True)
    # Papelera: set when lead moves to 'papelera' stage; auto-deleted after 30 days
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_leads_current_stage', 'current_stage'),
        Index('ix_leads_group_id', 'group_id'),
        Index('ix_leads_agendadora_id', 'agendadora_id'),
        Index('ix_leads_vendedor_id', 'vendedor_id'),
        Index('ix_leads_created_at', 'created_at'),
        Index('ix_leads_stage_group', 'current_stage', 'group_id'),
    )

    contact = relationship("Contact", back_populates="leads")
    area = relationship("Area", back_populates="leads")
    group = relationship("Group", back_populates="leads")
    agendadora = relationship("User", foreign_keys=[agendadora_id], back_populates="leads_as_agendadora")
    vendedor = relationship("User", foreign_keys=[vendedor_id], back_populates="leads_as_vendedor")
    history     = relationship("LeadHistory", back_populates="lead", order_by="LeadHistory.created_at", cascade="all, delete-orphan")
    work_orders = relationship("WorkOrder", back_populates="lead", order_by="WorkOrder.created_at", cascade="all, delete-orphan")
    payment_verification = relationship("PaymentVerification", back_populates="lead", uselist=False, cascade="all, delete-orphan")

    @property
    def has_ot(self) -> bool:
        return bool(self.work_orders)

    calendar_events = relationship("CalendarEvent", back_populates="lead", cascade="all, delete-orphan")
    whatsapp_messages = relationship("WhatsAppMessage", back_populates="lead", cascade="all, delete-orphan")


class LeadHistory(Base):
    __tablename__ = "lead_history"
    id = Column(Integer, primary_key=True, index=True)
    lead_id = Column(Integer, ForeignKey("leads.id"), nullable=False)
    from_stage = Column(String(50), nullable=True)
    to_stage = Column(String(50), nullable=False)
    result = Column(String(20), nullable=True)  # success, failed, pending
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    lead = relationship("Lead", back_populates="history")
    creator = relationship("User", foreign_keys=[created_by])


class PaymentVerification(Base):
    __tablename__ = "payment_verifications"
    id = Column(Integer, primary_key=True, index=True)
    lead_id = Column(Integer, ForeignKey("leads.id"), nullable=False, unique=True)
    assigned_to = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(String(30), default="pendiente")  # pendiente, pago_exitoso, rechazado
    payment_amount = Column(Float, nullable=True)
    payment_method = Column(String(50), nullable=True)
    payment_date = Column(Date, nullable=True)
    payment_reference = Column(String(100), nullable=True)
    invoice_url = Column(String(1000), nullable=True)
    notes = Column(Text, nullable=True)
    confirmed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    lead = relationship("Lead", back_populates="payment_verification")
    assigned_to_user = relationship("User", back_populates="payment_verifications")


class CalendarEvent(Base):
    __tablename__ = "calendar_events"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    lead_id = Column(Integer, ForeignKey("leads.id", ondelete="CASCADE"), nullable=True)
    contact_id = Column(Integer, ForeignKey("contacts.id", ondelete="SET NULL"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    assigned_to = Column(Integer, ForeignKey("users.id"), nullable=True)
    start_time = Column(DateTime(timezone=True), nullable=False)
    end_time = Column(DateTime(timezone=True), nullable=False)
    event_type = Column(String(30), default="reunion")  # reunion, llamada, seguimiento, tarea
    notes = Column(Text, nullable=True)
    is_completed = Column(Boolean, default=False)
    color = Column(String(20), default="#3B82F6")
    google_event_id = Column(String(200), nullable=True)
    vendor_status = Column(String(30), nullable=True)  # espera_cliente, sin_exito, altamente_interesado
    ai_summary = Column(Text, nullable=True)  # resumen IA de la conversación, cacheado para el evento de Google
    meet_link = Column(String(500), nullable=True)  # enlace de Google Meet generado al pushear el evento
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    lead = relationship("Lead", back_populates="calendar_events")
    creator = relationship("User", foreign_keys=[created_by], back_populates="calendar_events")
    assigned_user = relationship("User", foreign_keys=[assigned_to])


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(200), nullable=False)
    message = Column(Text, nullable=False)
    lead_id = Column(Integer, ForeignKey("leads.id", ondelete="CASCADE"), nullable=True)
    event_id = Column(Integer, ForeignKey("calendar_events.id", ondelete="CASCADE"), nullable=True)
    notification_type = Column(String(30), default="general")
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="notifications")


class AppSetting(Base):
    __tablename__ = "app_settings"
    id  = Column(Integer, primary_key=True, index=True)
    key = Column(String(100), unique=True, nullable=False)
    value = Column(Text, nullable=False)


class WhatsAppMessage(Base):
    __tablename__ = "whatsapp_messages"
    id = Column(Integer, primary_key=True, index=True)
    lead_id = Column(Integer, ForeignKey("leads.id"), nullable=True)
    contact_id = Column(Integer, ForeignKey("contacts.id"), nullable=False)
    whatsapp_config_id = Column(Integer, ForeignKey("whatsapp_configs.id"), nullable=True)
    direction = Column(String(10), nullable=False)  # in, out
    message_type = Column(String(20), default="text")  # text, pdf, image, template
    content = Column(Text, nullable=False)
    status = Column(String(20), default="sent")  # sent, delivered, read, failed
    sent_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    message_id = Column(String(100), nullable=True, unique=True)  # wamid for dedup
    is_read = Column(Boolean, default=False)
    media_url = Column(String(1000), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    lead = relationship("Lead", back_populates="whatsapp_messages")
    contact = relationship("Contact", back_populates="whatsapp_messages")
    whatsapp_config = relationship("WhatsAppConfig", back_populates="messages")
    sender = relationship("User", foreign_keys=[sent_by])


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    endpoint = Column(Text, nullable=False, unique=True)
    p256dh = Column(Text, nullable=False)
    auth = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", foreign_keys=[user_id])


class PagaCuotasCliente(Base):
    __tablename__ = "pagacuotas_clientes"
    id = Column(Integer, primary_key=True, index=True)
    crm_lead_id = Column(Integer, nullable=True, unique=True)
    nombre = Column(String(200), nullable=False)
    rut = Column(String(30), nullable=True)
    razon_social = Column(String(200), nullable=True)
    email = Column(String(100), nullable=True)
    phone = Column(String(30), nullable=True)
    honorarios = Column(Float, default=0)
    cuota_inicial = Column(Float, default=0)
    num_cuotas = Column(Integer, default=1)
    monto_cuota = Column(Float, default=0)
    tipo_servicio = Column(String(200), nullable=True)
    area_name = Column(String(100), nullable=True)
    vendedor_name = Column(String(100), nullable=True)
    access_token = Column(String(64), unique=True, nullable=False, index=True)
    cuotas_pagadas = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    pagos = relationship("PagaCuotasPago", back_populates="cliente", cascade="all, delete-orphan")


class PagaCuotasPago(Base):
    __tablename__ = "pagacuotas_pagos"
    id = Column(Integer, primary_key=True, index=True)
    cliente_id = Column(Integer, ForeignKey("pagacuotas_clientes.id"), nullable=False)
    monto = Column(Float, nullable=False)
    metodo = Column(String(50), nullable=True)
    referencia = Column(String(100), nullable=True)
    notas = Column(Text, nullable=True)
    status = Column(String(30), default="pendiente")  # pendiente, confirmado, rechazado
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    cliente = relationship("PagaCuotasCliente", back_populates="pagos")


class AIAgent(Base):
    """AI agent configuration — one per WhatsApp number (or shared across several)."""
    __tablename__ = "ai_agents"
    id                      = Column(Integer, primary_key=True, index=True)
    name                    = Column(String(100), nullable=False)
    description             = Column(Text, nullable=True)
    whatsapp_config_id      = Column(Integer, ForeignKey("whatsapp_configs.id"), nullable=True)
    group_id                = Column(Integer, ForeignKey("groups.id"), nullable=True)
    is_active               = Column(Boolean, default=True)
    # OpenAI settings
    openai_api_key          = Column(String(200), nullable=False)
    openai_model            = Column(String(50), default="gpt-4o-mini")
    temperature             = Column(Float, default=0.7)
    max_tokens              = Column(Integer, default=500)
    max_history_messages    = Column(Integer, default=20)
    # Prompts
    system_prompt           = Column(Text, nullable=False)
    # Behaviour
    response_delay_seconds  = Column(Integer, default=2)
    # Escalation
    escalation_keywords     = Column(Text, default='[]')   # JSON array of strings
    # Business hours (HH:MM strings, nullable = always active)
    business_hours_start    = Column(String(5), nullable=True)   # e.g. "09:00"
    business_hours_end      = Column(String(5), nullable=True)   # e.g. "18:00"
    # Stats
    total_messages_sent     = Column(Integer, default=0)
    created_at              = Column(DateTime(timezone=True), server_default=func.now())
    updated_at              = Column(DateTime(timezone=True), onupdate=func.now())

    whatsapp_config = relationship("WhatsAppConfig", foreign_keys=[whatsapp_config_id])
    configs         = relationship("WhatsAppConfig", secondary=lambda: ai_agent_configs, lazy="select", viewonly=False)
    group           = relationship("Group")
    contact_states  = relationship("AIAgentContactState", back_populates="agent", cascade="all, delete-orphan")
    logs            = relationship("AIAgentLog", back_populates="agent", cascade="all, delete-orphan")


class AIAgentContactState(Base):
    """Per-contact override of agent behaviour (pause / hand-off)."""
    __tablename__ = "ai_agent_contact_states"
    id          = Column(Integer, primary_key=True, index=True)
    agent_id    = Column(Integer, ForeignKey("ai_agents.id", ondelete="CASCADE"), nullable=False)
    contact_id  = Column(Integer, ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False)
    # active | paused | handed_off
    state       = Column(String(20), default="active", nullable=False)
    updated_at  = Column(DateTime(timezone=True), onupdate=func.now())
    created_at  = Column(DateTime(timezone=True), server_default=func.now())

    agent   = relationship("AIAgent", back_populates="contact_states")
    contact = relationship("Contact")


class AIAgentLog(Base):
    """Audit trail for every AI response generated."""
    __tablename__ = "ai_agent_logs"
    id              = Column(Integer, primary_key=True, index=True)
    agent_id        = Column(Integer, ForeignKey("ai_agents.id", ondelete="CASCADE"), nullable=False)
    contact_id      = Column(Integer, ForeignKey("contacts.id", ondelete="SET NULL"), nullable=True)
    lead_id         = Column(Integer, ForeignKey("leads.id"), nullable=True)
    input_message   = Column(Text, nullable=True)
    output_message  = Column(Text, nullable=True)
    tokens_used     = Column(Integer, default=0)
    model_used      = Column(String(50), nullable=True)
    latency_ms      = Column(Integer, default=0)
    error           = Column(Text, nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())

    agent = relationship("AIAgent", back_populates="logs")


class WorkOrder(Base):
    __tablename__ = "work_orders"
    id          = Column(Integer, primary_key=True, index=True)
    lead_id     = Column(Integer, ForeignKey("leads.id"), nullable=False)
    ot_type     = Column(String(50), nullable=False)
    fields_json = Column(Text, nullable=False, default='{}')
    status      = Column(String(20), default="draft")  # draft, final
    is_copy     = Column(Boolean, default=False, nullable=False)
    created_by  = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), onupdate=func.now())

    lead    = relationship("Lead", back_populates="work_orders")
    creator = relationship("User", foreign_keys=[created_by])


class GoogleCalendarToken(Base):
    __tablename__ = "google_calendar_tokens"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    access_token = Column(Text, nullable=False)
    refresh_token = Column(Text, nullable=True)
    token_expiry = Column(DateTime, nullable=True)
    google_email = Column(String(200), nullable=True)
    google_calendar_id = Column(String(200), default="primary")
    # Gmail fields (separate OAuth grant with gmail.send scope)
    gmail_access_token = Column(Text, nullable=True)
    gmail_refresh_token = Column(Text, nullable=True)
    gmail_token_expiry = Column(DateTime, nullable=True)
    gmail_email = Column(String(200), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", back_populates="google_token")


class CobradorLead(Base):
    __tablename__ = "cobrador_leads"
    id          = Column(Integer, primary_key=True, index=True)
    cobrador_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    contact_id  = Column(Integer, ForeignKey("contacts.id"), nullable=True)
    nombre      = Column(String(150), nullable=False)
    rut         = Column(String(20), nullable=True)
    empresa     = Column(String(200), nullable=True)
    telefono    = Column(String(30), nullable=True)
    email       = Column(String(100), nullable=True)
    monto_deuda   = Column(Float, default=0)
    monto_pagado  = Column(Float, default=0)
    num_cuotas    = Column(Integer, default=1)
    cuota_inicial = Column(Float, default=0)
    monto_cuota   = Column(Float, default=0)
    descripcion   = Column(Text, nullable=True)
    stage         = Column(String(50), default="lead_moroso", nullable=False)
    notes         = Column(Text, nullable=True)
    # Legal Finance source IDs (for upsert sync)
    lf_cliente_id          = Column(Integer, nullable=True, index=True)
    lf_contrato_id         = Column(Integer, nullable=True, index=True)
    lf_cuotas_vencidas     = Column(Integer, nullable=True)
    lf_total_facturado     = Column(Float, nullable=True)
    lf_total_pagado        = Column(Float, nullable=True)
    proxima_cuota_fecha    = Column(String(20), nullable=True)
    proxima_cuota_monto    = Column(Float, nullable=True)
    pagacuotas_cliente_id  = Column(Integer, ForeignKey("pagacuotas_clientes.id"), nullable=True)
    is_new          = Column(Boolean, default=True, nullable=False, server_default="true")
    is_contactado   = Column(Boolean, default=False, nullable=False, server_default="false")
    contactado_at   = Column(DateTime(timezone=True), nullable=True)
    pagado_at       = Column(DateTime(timezone=True), nullable=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), onupdate=func.now())

    cobrador         = relationship("User", foreign_keys=[cobrador_id])
    contact          = relationship("Contact")
    pagacuotas       = relationship("PagaCuotasCliente", foreign_keys=[pagacuotas_cliente_id])


class SecurityAuditLog(Base):
    """ISO 27001 A.12.4.1 — immutable audit trail for security-relevant events."""
    __tablename__ = "security_audit_logs"
    id            = Column(Integer, primary_key=True, index=True)
    user_id       = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    actor_email   = Column(String(100), nullable=True)   # preserved even if user deleted
    action        = Column(String(100), nullable=False, index=True)
    resource_type = Column(String(50), nullable=True)
    resource_id   = Column(Integer, nullable=True)
    ip_address    = Column(String(45), nullable=True)
    user_agent    = Column(String(500), nullable=True)
    details       = Column(Text, nullable=True)
    severity      = Column(String(20), default="info", nullable=False)  # info | warning | critical
    created_at    = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    user = relationship("User", foreign_keys=[user_id])


class WebhookInbox(Base):
    __tablename__ = "webhook_inbox"
    id              = Column(Integer, primary_key=True, index=True)
    source          = Column(String(40), nullable=False, index=True)
    event_type      = Column(String(80), nullable=True)
    idempotency_key = Column(String(200), nullable=True, unique=True, index=True)
    payload_json    = Column(Text, nullable=False)
    status          = Column(String(20), nullable=True, index=True)
    attempts        = Column(Integer, default=0)
    max_attempts    = Column(Integer, default=5)
    last_error      = Column(Text, nullable=True)
    next_retry_at   = Column(DateTime(timezone=True), nullable=True, index=True)
    request_id      = Column(String(80), nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ── Nexio Copilot — motor de recomendaciones proactivas ──────────────────────
class Insight(Base):
    """Sugerencia proactiva pre-calculada para un lead. Idempotente por
    (lead_id, type): id = f"{type}:{lead_id}"."""
    __tablename__ = "insights"
    id           = Column(String(80), primary_key=True)  # `${type}:${lead_id}`
    lead_id      = Column(Integer, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id      = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)  # actor sugerido
    type         = Column(String(40), nullable=False)
    priority     = Column(Integer, default=0)
    payload_json = Column(Text, nullable=False)  # Insight completo serializado
    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        Index("uq_insight_lead_type", "lead_id", "type", unique=True),
    )


class InsightDismissal(Base):
    """Silencia una tarjeta (por clave `${type}:${lead_id}`) para un usuario
    hasta `until`. Sobrevive a la re-evaluación del motor."""
    __tablename__ = "insight_dismissals"
    id          = Column(Integer, primary_key=True, index=True)
    user_id     = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    insight_key = Column(String(80), nullable=False)
    until       = Column(DateTime(timezone=True), nullable=False)
    __table_args__ = (
        Index("uq_dismissal_user_key", "user_id", "insight_key", unique=True),
    )
