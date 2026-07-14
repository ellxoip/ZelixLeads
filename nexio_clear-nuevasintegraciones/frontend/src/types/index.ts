export interface User {
  id: number
  name: string
  email: string
  role: string
  group_id: number | null
  group_ids: number[]
  is_active: boolean
  whatsapp_number: string | null
  created_at: string
  at_informa_user_id: string | null
}

export interface Group {
  id: number
  name: string
  description: string | null
  tipo: string
  negocio_id: number | null
  created_at: string
}

export interface Area {
  id: number
  name: string
  group_id: number
  whatsapp_config_id: number | null
  kpi_leads: number
  is_active: boolean
  phone_configs?: WhatsAppConfig[]
}

export interface WhatsAppConfig {
  id: number
  name: string
  phone_number: string
  api_provider: string
  group_id: number
  is_active: boolean
}

export interface Contact {
  id: number
  name: string
  rut_persona: string | null
  rut_empresa: string | null
  razon_social: string | null
  email: string | null
  phone: string
  address: string | null
  city: string | null
  group_id: number | null
  notes: string | null
  avatar_url: string | null
  created_at: string
}

export interface Lead {
  id: number
  contact_id: number
  area_id: number
  group_id: number
  agendadora_id: number
  vendedor_id: number
  current_stage: string
  service_description: string | null
  honorarios: number
  cuota_inicial: number
  num_cuotas: number
  monto_cuota: number
  notes: string | null
  priority: string
  source: string | null
  created_at: string
  updated_at: string | null
  unread_count?: number
  last_vendor_outcome?: string | null
  payment_commitment_date?: string | null
  seguimiento_status?: string | null
  has_ot?: boolean
  has_reunion_scheduled?: boolean
  at_informa_case_id: string | null
  at_informa_status: string | null
  legal_finance_contrato_id: number | null
  pagacuotas_cliente_id: string | null
  pagacuotas_status: string | null
  pagacuotas_link: string | null
  ai_agent_id: number | null
  contact: Contact | null
  agendadora: { id: number; name: string; role: string; group_id: number | null } | null
  vendedor: { id: number; name: string; role: string; group_id: number | null } | null
  area: Area | null
  group?: { id: number; name: string; description: string | null } | null
}

export interface LeadHistory {
  id: number
  lead_id: number
  from_stage: string | null
  to_stage: string
  result: string | null
  notes: string | null
  created_by: number
  created_at: string
  creator: { id: number; name: string; role: string; group_id: number | null } | null
}

export interface PaymentVerification {
  id: number
  lead_id: number
  assigned_to: number
  status: string
  payment_amount: number | null
  payment_method: string | null
  payment_date: string | null
  payment_reference: string | null
  invoice_url: string | null
  notes: string | null
  confirmed_at: string | null
  created_at: string
  lead: Lead | null
}

export interface CalendarEvent {
  id: number
  title: string
  lead_id: number | null
  contact_id: number | null
  created_by: number
  assigned_to: number | null
  start_time: string
  end_time: string
  event_type: string
  notes: string | null
  is_completed: boolean
  color: string
  vendor_status: string | null
  meet_link?: string | null
  created_at: string
  creator?: { id: number; name: string; role: string } | null
}

export interface Notification {
  id: number
  user_id: number
  title: string
  message: string
  lead_id: number | null
  event_id: number | null
  notification_type: string
  is_read: boolean
  created_at: string
}

export const STAGE_LABELS: Record<string, string> = {
  lead:                  'Lead',
  reunion:               'Reunión',
  altamente_interesado:  'Altamente Interesado',
  cierre:                'Cierre',
  pago_pendiente:        'Pago Pendiente',
  pago_comprometido:     'Pago Comprometido',
  pagado_reunion:        'Validando Pago Reunión',
  pagado_confirmado:     'Pago Confirmado',
  recuperacion_lead:     'Recuperación Lead',
  recuperacion_reunion:  'Recuperación Reunión',
  recuperacion_cierre:   'Recuperación Cierre',
  recuperacion_pago:     'Recuperación Pago',
  papelera:              'Papelera',
}

export const STAGE_COLORS: Record<string, string> = {
  lead:                  'bg-white/5 text-white/62 border-white/10',
  reunion:               'bg-white/5 text-white/78 border-white/10',
  altamente_interesado:  'bg-white/8 text-white/85 border-white/15',
  cierre:                'bg-white/8 text-white/80 border-white/15',
  pago_pendiente:        'bg-warn/10 text-warn border-warn/25',
  pago_comprometido:     'bg-neon/10 text-neon border-neon/25',
  pagado_reunion:        'bg-emerald-400/10 text-emerald-400 border-emerald-400/25',
  pagado_confirmado:     'bg-lime/10 text-lime border-lime/30',
  recuperacion_lead:     'bg-danger/10 text-danger border-danger/25',
  recuperacion_reunion:  'bg-danger/10 text-danger border-danger/25',
  recuperacion_cierre:   'bg-danger/10 text-danger border-danger/25',
  recuperacion_pago:     'bg-danger/10 text-danger border-danger/25',
  papelera:              'bg-gray-500/10 text-gray-400 border-gray-500/25',
}

export const STAGE_DOT: Record<string, string> = {
  lead:                  'bg-white/25',
  reunion:               'bg-white/35',
  altamente_interesado:  'bg-white/50',
  cierre:                'bg-white/65',
  pago_pendiente:        'bg-warn',
  pago_comprometido:     'bg-neon',
  pagado_reunion:        'bg-emerald-400',
  pagado_confirmado:     'bg-lime',
  recuperacion_lead:     'bg-danger',
  recuperacion_reunion:  'bg-danger',
  recuperacion_cierre:   'bg-danger',
  recuperacion_pago:     'bg-danger',
  papelera:              'bg-gray-500',
}

export const PRIORITY_COLORS: Record<string, string> = {
  low:    'bg-white/5 text-white/62 border-white/8',
  normal: 'bg-white/5 text-white/78 border-white/8',
  high:   'bg-danger/10 text-danger border-danger/25',
}

// Flujo y paleta de etapas centralizados en ../lib/stages — re-exportados aquí
// para que las pantallas puedan importarlos junto a STAGE_LABELS sin duplicar.
export { NEXT_STAGE, PREV_STAGE, NEXT_ACTION, STAGE_PALETTE, getStagePalette } from '../lib/stages'

export const PAYMENT_STATUS_COLORS: Record<string, string> = {
  pendiente:    'bg-warn/10 text-warn border-warn/25',
  pago_exitoso: 'bg-lime/10 text-lime border-lime/30',
  rechazado:    'bg-danger/10 text-danger border-danger/25',
}
