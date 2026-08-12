from pydantic import BaseModel, EmailStr, field_validator, model_validator
from typing import Optional, List, Literal
from datetime import datetime, date


# ── AUTH ──────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    user: "UserOut"

# ── USER ──────────────────────────────────────────────────
_VALID_ROLES = Literal["superadmin", "subadmin", "agendadora", "vendedor", "verificador", "tecnico", "cobrador", "analista", "asistente_seguimiento"]

class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: _VALID_ROLES
    group_id: Optional[int] = None
    whatsapp_number: Optional[str] = None

class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    role: Optional[_VALID_ROLES] = None
    group_id: Optional[int] = None
    is_active: Optional[bool] = None
    whatsapp_number: Optional[str] = None

class UserOut(BaseModel):
    id: int
    name: str
    email: str
    role: str
    group_id: Optional[int]
    group_ids: List[int] = []
    is_active: bool
    whatsapp_number: Optional[str]
    at_informa_user_id: Optional[str] = None
    cobrador_area: Optional[str] = None
    created_at: datetime
    negocio_plan: Optional[str] = "basico"
    negocio_plan_limits: Optional[dict] = None
    class Config:
        from_attributes = True

class UserOutBasic(BaseModel):
    id: int
    name: str
    role: str
    group_id: Optional[int]
    class Config:
        from_attributes = True

# ── GROUP ──────────────────────────────────────────────────
class GroupCreate(BaseModel):
    name: str
    description: Optional[str] = None

class GroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

class GroupOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    tipo: str = "abogados"
    negocio_id: Optional[int] = None
    created_at: datetime
    class Config:
        from_attributes = True

# ── PIPELINE STAGES ───────────────────────────────────────
class PipelineStageCreate(BaseModel):
    key: str
    name: str
    color: Optional[str] = None
    order: int = 0

class PipelineStageUpdate(BaseModel):
    key: Optional[str] = None
    name: Optional[str] = None
    color: Optional[str] = None
    order: Optional[int] = None

class PipelineStageOut(BaseModel):
    id: int
    negocio_id: int
    key: str
    name: str
    color: Optional[str]
    order: int
    class Config:
        from_attributes = True

# ── AREA ──────────────────────────────────────────────────
class AreaCreate(BaseModel):
    name: str
    group_id: int
    whatsapp_config_id: Optional[int] = None
    whatsapp_config_ids: List[int] = []
    kpi_leads: int = 50

class AreaUpdate(BaseModel):
    name: Optional[str] = None
    whatsapp_config_id: Optional[int] = None
    whatsapp_config_ids: Optional[List[int]] = None
    kpi_leads: Optional[int] = None
    is_active: Optional[bool] = None

class AreaOut(BaseModel):
    id: int
    name: str
    group_id: int
    whatsapp_config_id: Optional[int]
    kpi_leads: int
    is_active: bool
    phone_configs: List['WhatsAppConfigOut'] = []
    users: List['UserOutBasic'] = []
    class Config:
        from_attributes = True

# ── WHATSAPP CONFIG ──────────────────────────────────────
class WhatsAppConfigCreate(BaseModel):
    name: str
    phone_number: str
    api_token: Optional[str] = None
    api_provider: str = "manual"
    phone_number_id: Optional[str] = None
    group_id: Optional[int] = None

class MiNumeroCreate(BaseModel):
    """Alta de un número propio. NO acepta group_id ni owner_user_id: los pone
    el servidor desde la sesión, para que nadie pueda vincular un número dentro
    del negocio de otro mandando un campo de más."""
    name: Optional[str] = None
    phone_number_id: str
    api_token: str


class WhatsAppConfigUpdate(BaseModel):
    name: Optional[str] = None
    phone_number: Optional[str] = None
    api_token: Optional[str] = None
    api_provider: Optional[str] = None
    phone_number_id: Optional[str] = None
    is_active: Optional[bool] = None

class WhatsAppConfigOut(BaseModel):
    id: int
    name: str
    phone_number: str
    phone_number_id: Optional[str]
    api_provider: str
    group_id: Optional[int]
    group_name: Optional[str] = None
    is_active: bool
    class Config:
        from_attributes = True

# ── CONTACT ──────────────────────────────────────────────
class ContactCreate(BaseModel):
    name: str
    rut_persona: Optional[str] = None
    rut_empresa: Optional[str] = None
    razon_social: Optional[str] = None
    email: Optional[str] = None
    phone: str
    address: Optional[str] = None
    city: Optional[str] = None
    group_id: Optional[int] = None
    notes: Optional[str] = None

class ContactUpdate(BaseModel):
    name: Optional[str] = None
    rut_persona: Optional[str] = None
    rut_empresa: Optional[str] = None
    razon_social: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    notes: Optional[str] = None

class ContactOut(BaseModel):
    id: int
    name: str
    rut_persona: Optional[str]
    rut_empresa: Optional[str]
    razon_social: Optional[str]
    email: Optional[str]
    phone: str
    address: Optional[str]
    city: Optional[str]
    group_id: Optional[int]
    notes: Optional[str]
    avatar_url: Optional[str] = None
    created_at: datetime
    class Config:
        from_attributes = True

# ── LEAD ──────────────────────────────────────────────────
class LeadCreate(BaseModel):
    contact_id: int
    area_id: int
    group_id: int
    agendadora_id: int
    vendedor_id: int
    service_description: Optional[str] = None
    honorarios: float = 0
    cuota_inicial: float = 0
    num_cuotas: int = 1
    monto_cuota: float = 0
    notes: Optional[str] = None
    priority: Literal["low", "normal", "high"] = "normal"
    source: Optional[str] = None

class LeadUpdate(BaseModel):
    service_description: Optional[str] = None
    honorarios: Optional[float] = None
    cuota_inicial: Optional[float] = None
    num_cuotas: Optional[int] = None
    monto_cuota: Optional[float] = None
    notes: Optional[str] = None
    priority: Optional[Literal["low", "normal", "high"]] = None
    area_id: Optional[int] = None
    vendedor_id: Optional[int] = None
    agendadora_id: Optional[int] = None

class LeadStageUpdate(BaseModel):
    result: Literal["success", "failed"]
    notes: Optional[str] = None

class LeadMoveStage(BaseModel):
    stage: str
    notes: Optional[str] = None
    payment_commitment_date: Optional[date] = None

class LeadOut(BaseModel):
    id: int
    contact_id: int
    area_id: int
    group_id: int
    agendadora_id: int
    vendedor_id: int
    current_stage: str
    service_description: Optional[str]
    honorarios: float
    cuota_inicial: Optional[float] = 0
    num_cuotas: Optional[int] = 1
    monto_cuota: Optional[float] = 0
    notes: Optional[str]
    priority: Optional[str] = "normal"
    source: Optional[str]
    at_informa_case_id: Optional[str] = None
    at_informa_status: Optional[str] = None
    legal_finance_contrato_id: Optional[int] = None
    pagacuotas_cliente_id: Optional[str] = None
    pagacuotas_status: Optional[str] = None
    pagacuotas_link: Optional[str] = None
    hive_service_case_id: Optional[str] = None
    hive_service_status: Optional[str] = None
    last_vendor_outcome: Optional[str] = None
    payment_commitment_date: Optional[date] = None
    seguimiento_status: Optional[str] = None
    ai_agent_id: Optional[int] = None
    has_ot: bool = False
    has_reunion_scheduled: bool = False
    created_at: datetime
    updated_at: Optional[datetime]
    unread_count: int = 0
    contact: Optional[ContactOut]
    agendadora: Optional[UserOutBasic]
    vendedor: Optional[UserOutBasic]
    area: Optional[AreaOut]
    group: Optional[GroupOut] = None
    payment_verification: Optional["PaymentVerificationOutBasic"] = None
    class Config:
        from_attributes = True

# ── PAYMENT VERIFICATION ──────────────────────────────────
class PaymentVerificationOutBasic(BaseModel):
    id: int
    lead_id: int
    status: str
    payment_amount: Optional[float]
    payment_method: Optional[str]
    payment_date: Optional[date]
    payment_reference: Optional[str]
    invoice_url: Optional[str]
    notes: Optional[str]
    confirmed_at: Optional[datetime]
    created_at: datetime
    class Config:
        from_attributes = True

# ── LEAD HISTORY ──────────────────────────────────────────
class LeadHistoryOut(BaseModel):
    id: int
    lead_id: int
    from_stage: Optional[str]
    to_stage: str
    result: Optional[str]
    notes: Optional[str]
    created_by: int
    created_at: datetime
    creator: Optional[UserOutBasic]
    class Config:
        from_attributes = True

# ── PAYMENT VERIFICATION ──────────────────────────────────
class PaymentVerificationUpdate(BaseModel):
    status: Literal["pago_exitoso", "rechazado"]
    payment_amount: Optional[float] = None
    payment_method: Optional[str] = None
    payment_date: Optional[date] = None
    payment_reference: Optional[str] = None
    invoice_url: Optional[str] = None
    notes: Optional[str] = None

class PaymentVerificationOut(PaymentVerificationOutBasic):
    assigned_to: int
    lead: Optional[LeadOut]
    class Config:
        from_attributes = True

# ── CALENDAR ──────────────────────────────────────────────
class CalendarEventCreate(BaseModel):
    title: str
    lead_id: Optional[int] = None
    contact_id: Optional[int] = None
    assigned_to: Optional[int] = None
    start_time: datetime
    end_time: datetime
    event_type: str = "reunion"
    notes: Optional[str] = None
    color: str = "#3B82F6"

    @model_validator(mode='after')
    def check_times(self) -> 'CalendarEventCreate':
        if self.end_time <= self.start_time:
            raise ValueError('end_time debe ser posterior a start_time')
        return self

class CalendarEventUpdate(BaseModel):
    title: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    event_type: Optional[str] = None
    notes: Optional[str] = None
    is_completed: Optional[bool] = None
    color: Optional[str] = None

class CalendarEventOut(BaseModel):
    id: int
    title: str
    lead_id: Optional[int]
    contact_id: Optional[int]
    created_by: int
    assigned_to: Optional[int]
    start_time: datetime
    end_time: datetime
    event_type: str
    notes: Optional[str]
    is_completed: bool
    color: str
    vendor_status: Optional[str] = None
    meet_link: Optional[str] = None
    created_at: datetime
    creator: Optional[UserOutBasic] = None
    class Config:
        from_attributes = True

# ── NOTIFICATION ──────────────────────────────────────────
class NotificationOut(BaseModel):
    id: int
    user_id: int
    title: str
    message: str
    lead_id: Optional[int]
    event_id: Optional[int]
    notification_type: str
    is_read: bool
    created_at: datetime
    class Config:
        from_attributes = True

# ── WHATSAPP MESSAGE ──────────────────────────────────────
class WhatsAppSendMessage(BaseModel):
    contact_id: int
    lead_id: Optional[int] = None
    whatsapp_config_id: int
    message: str
    message_type: str = "text"

class WhatsAppMessageOut(BaseModel):
    id: int
    lead_id: Optional[int] = None
    contact_id: Optional[int] = None
    whatsapp_config_id: Optional[int] = None
    direction: str
    message_type: str = "text"
    content: Optional[str] = ""
    status: str = "sent"
    is_read: bool = False
    media_url: Optional[str] = None
    created_at: Optional[datetime] = None
    class Config:
        from_attributes = True

# ── PAGACUOTAS ────────────────────────────────────────────
class PagaCuotasPagoOut(BaseModel):
    id: int
    cliente_id: int
    monto: float
    metodo: Optional[str]
    referencia: Optional[str]
    notas: Optional[str]
    status: str
    created_at: datetime
    class Config:
        from_attributes = True

class PagaCuotasClienteOut(BaseModel):
    id: int
    crm_lead_id: Optional[int]
    nombre: str
    rut: Optional[str]
    razon_social: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    honorarios: float
    cuota_inicial: float
    num_cuotas: int
    monto_cuota: float
    tipo_servicio: Optional[str]
    area_name: Optional[str]
    vendedor_name: Optional[str]
    access_token: str
    cuotas_pagadas: int
    is_active: bool
    created_at: datetime
    pagos: List[PagaCuotasPagoOut] = []
    class Config:
        from_attributes = True

class PagaCuotasClienteCreate(BaseModel):
    crm_lead_id: Optional[int] = None
    nombre: str
    rut: Optional[str] = None
    razon_social: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    honorarios: float = 0
    cuota_inicial: float = 0
    num_cuotas: int = 1
    monto_cuota: float = 0
    tipo_servicio: Optional[str] = None
    area_name: Optional[str] = None
    vendedor_name: Optional[str] = None

# Fix forward reference
Token.model_rebuild()
LeadOut.model_rebuild()
