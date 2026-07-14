export type PlanKey = 'basico' | 'pro' | 'enterprise'

export interface PlanLimits {
  label: string
  max_users: number          // -1 = unlimited
  max_wa_numbers: number
  max_leads: number
  max_ai_agents: number
  google_calendar: boolean
  export_csv: boolean
  seguimiento: boolean
  analytics_avanzados: boolean
  pdf_ot: boolean
  whatsapp_chat: boolean
}

export const PLAN_LIMITS: Record<PlanKey, PlanLimits> = {
  basico: {
    label: 'Básico',
    max_users: 5,
    max_wa_numbers: 1,
    max_leads: 300,
    max_ai_agents: 0,
    google_calendar: false,
    export_csv: false,
    seguimiento: false,
    analytics_avanzados: false,
    pdf_ot: true,
    whatsapp_chat: true,
  },
  pro: {
    label: 'Pro',
    max_users: 15,
    max_wa_numbers: 3,
    max_leads: 2000,
    max_ai_agents: 2,
    google_calendar: true,
    export_csv: true,
    seguimiento: true,
    analytics_avanzados: false,
    pdf_ot: true,
    whatsapp_chat: true,
  },
  enterprise: {
    label: 'Enterprise',
    max_users: -1,
    max_wa_numbers: -1,
    max_leads: -1,
    max_ai_agents: -1,
    google_calendar: true,
    export_csv: true,
    seguimiento: true,
    analytics_avanzados: true,
    pdf_ot: true,
    whatsapp_chat: true,
  },
}

// For badges / dark card backgrounds (subtle)
export const PLAN_COLORS: Record<PlanKey, { bg: string; text: string; border: string }> = {
  basico:     { bg: 'rgba(148,163,184,0.15)', text: '#94a3b8', border: 'rgba(148,163,184,0.3)' },
  pro:        { bg: 'rgba(124,58,237,0.18)',   text: '#a78bfa', border: 'rgba(124,58,237,0.35)' },
  enterprise: { bg: 'rgba(234,179,8,0.15)',   text: '#eab308', border: 'rgba(234,179,8,0.35)' },
}

// For light-theme modal selectors (solid active state)
export const PLAN_LIGHT: Record<PlanKey, { bg: string; text: string; border: string }> = {
  basico:     { bg: '#64748b', text: '#ffffff', border: '#64748b' },
  pro:        { bg: '#7c3aed', text: '#ffffff', border: '#7c3aed' },
  enterprise: { bg: '#d97706', text: '#ffffff', border: '#d97706' },
}

// For dark-theme modal selectors (higher opacity active state)
export const PLAN_DARK: Record<PlanKey, { bg: string; text: string; border: string }> = {
  basico:     { bg: 'rgba(100,116,139,0.30)', text: '#cbd5e1', border: 'rgba(100,116,139,0.55)' },
  pro:        { bg: 'rgba(124,58,237,0.38)',   text: '#93b4ff', border: 'rgba(124,58,237,0.65)' },
  enterprise: { bg: 'rgba(234,179,8,0.28)',   text: '#fcd34d', border: 'rgba(234,179,8,0.58)' },
}

export function getLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[(plan as PlanKey)] ?? PLAN_LIMITS.basico
}

export function canDo(plan: string, feature: keyof PlanLimits): boolean {
  const limits = getLimits(plan)
  const val = limits[feature]
  if (typeof val === 'boolean') return val
  if (typeof val === 'number') return val !== 0
  return false
}

export function withinLimit(plan: string, key: keyof PlanLimits, current: number): boolean {
  const max = getLimits(plan)[key] as number
  return max === -1 || current < max
}
