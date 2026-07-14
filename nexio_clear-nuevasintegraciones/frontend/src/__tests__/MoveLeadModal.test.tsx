/**
 * Tests for MoveLeadModal — critical business logic:
 * 1. Agendadora cannot advance a lead in 'reunion' stage (only vendor can)
 * 2. PREV_STAGE for recovery stages routes back to main funnel correctly
 * 3. blockedReunionNoSchedule prevents moving to reunion without a scheduled meeting
 * 4. blockedPagoSinOT prevents advancing without an OT
 */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MoveLeadModal, MAIN_STAGES, RECOVERY_STAGES, PREV_STAGE, NEXT_STAGE } from '../components/MoveLeadModal'
import type { Lead } from '../types'

// ── Mock toast ─────────────────────────────────────────────────────────────────
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}))

// ── Base lead factory ─────────────────────────────────────────────────────────
function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 1,
    contact_id: 1,
    area_id: 1,
    group_id: 1,
    agendadora_id: 2,
    vendedor_id: 3,
    contact: { id: 1, name: 'Juan Test', phone: '+56912345678', email: 'juan@test.com', rut_persona: null, rut_empresa: null, razon_social: null, address: null, city: null, group_id: 1, notes: null, avatar_url: null, created_at: '2024-01-01' },
    area: { id: 1, name: 'Prescripción', group_id: 1, whatsapp_config_id: null, kpi_leads: 50, is_active: true },
    agendadora: { id: 2, name: 'Agendadora', role: 'agendadora', group_id: 1 },
    vendedor: { id: 3, name: 'Vendedor', role: 'vendedor', group_id: 1 },
    current_stage: 'lead',
    service_description: null,
    honorarios: 500000,
    cuota_inicial: 100000,
    num_cuotas: 4,
    monto_cuota: 100000,
    priority: 'normal',
    source: 'whatsapp',
    has_ot: false,
    has_reunion_scheduled: true,
    notes: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: null,
    at_informa_case_id: null,
    at_informa_status: null,
    legal_finance_contrato_id: null,
    pagacuotas_cliente_id: null,
    pagacuotas_status: null,
    ai_agent_id: null,
    ...overrides,
  } as Lead
}

const defaultLabels: Record<string, string> = {
  lead: 'Lead',
  reunion: 'Reunión',
  altamente_interesado: 'Altamente Interesado',
  cierre: 'Cierre',
  pago_comprometido: 'Pago Comprometido',
  pagado_confirmado: 'Pagado Confirmado',
  recuperacion_lead: 'Recuperación Lead',
  recuperacion_reunion: 'Recuperación Reunión',
  recuperacion_cierre: 'Recuperación Cierre',
  recuperacion_pago: 'Recuperación Pago',
}

const noop = async () => {}

// ── PREV_STAGE / NEXT_STAGE map tests (pure logic) ───────────────────────────

describe('PREV_STAGE recovery back-navigation', () => {
  it('recuperacion_lead maps back to lead', () => {
    expect(PREV_STAGE['recuperacion_lead']).toBe('lead')
  })

  it('recuperacion_reunion maps back to reunion', () => {
    expect(PREV_STAGE['recuperacion_reunion']).toBe('reunion')
  })

  it('recuperacion_cierre maps back to cierre', () => {
    expect(PREV_STAGE['recuperacion_cierre']).toBe('cierre')
  })

  it('recuperacion_pago maps back to pago_comprometido', () => {
    expect(PREV_STAGE['recuperacion_pago']).toBe('pago_comprometido')
  })
})

describe('NEXT_STAGE flow', () => {
  it('lead → reunion', () => {
    expect(NEXT_STAGE['lead']).toBe('reunion')
  })

  it('reunion → altamente_interesado', () => {
    expect(NEXT_STAGE['reunion']).toBe('altamente_interesado')
  })

  it('recuperacion_lead → reunion', () => {
    expect(NEXT_STAGE['recuperacion_lead']).toBe('reunion')
  })
})

describe('MAIN_STAGES and RECOVERY_STAGES', () => {
  it('MAIN_STAGES includes all expected stages', () => {
    expect(MAIN_STAGES).toContain('lead')
    expect(MAIN_STAGES).toContain('pagado_confirmado')
    expect(MAIN_STAGES).not.toContain('recuperacion_lead')
  })

  it('RECOVERY_STAGES contains only recovery stages', () => {
    RECOVERY_STAGES.forEach(s => {
      expect(s).toMatch(/^recuperacion_/)
    })
  })
})

// ── Component rendering tests ─────────────────────────────────────────────────

describe('MoveLeadModal — rendering', () => {
  it('renders modal title', () => {
    render(
      <MoveLeadModal
        lead={makeLead()}
        targetStage="reunion"
        labels={defaultLabels}
        onConfirm={noop}
        onClose={noop}
        canConfirmPago={false}
        userRole="superadmin"
      />
    )
    expect(screen.getByRole('heading', { name: /Mover Lead/i })).toBeInTheDocument()
  })

  it('renders lead contact name', () => {
    render(
      <MoveLeadModal
        lead={makeLead()}
        targetStage="reunion"
        labels={defaultLabels}
        onConfirm={noop}
        onClose={noop}
        canConfirmPago={false}
        userRole="superadmin"
      />
    )
    expect(screen.getByText('Juan Test')).toBeInTheDocument()
  })

  it('renders the confirm input field', () => {
    render(
      <MoveLeadModal
        lead={makeLead()}
        targetStage="reunion"
        labels={defaultLabels}
        onConfirm={noop}
        onClose={noop}
        canConfirmPago={false}
        userRole="superadmin"
      />
    )
    expect(screen.getByPlaceholderText('confirmar')).toBeInTheDocument()
  })
})

// ── Agendadora — blocked advance from reunion ─────────────────────────────────

describe('MoveLeadModal — agendadora blocked from reunion advance', () => {
  it('shows blocking warning when agendadora on reunion stage', () => {
    render(
      <MoveLeadModal
        lead={makeLead({ current_stage: 'reunion' })}
        targetStage="altamente_interesado"
        labels={defaultLabels}
        onConfirm={noop}
        onClose={noop}
        canConfirmPago={false}
        userRole="agendadora"
      />
    )
    expect(screen.getByText(/Avance bloqueado/i)).toBeInTheDocument()
  })

  it('does NOT show blocking warning for superadmin on reunion stage', () => {
    render(
      <MoveLeadModal
        lead={makeLead({ current_stage: 'reunion' })}
        targetStage="altamente_interesado"
        labels={defaultLabels}
        onConfirm={noop}
        onClose={noop}
        canConfirmPago={false}
        userRole="superadmin"
      />
    )
    expect(screen.queryByText(/Avance bloqueado/i)).not.toBeInTheDocument()
  })

  it('agendadora on reunion still sees back/recovery stage options', () => {
    render(
      <MoveLeadModal
        lead={makeLead({ current_stage: 'reunion' })}
        targetStage="altamente_interesado"
        labels={defaultLabels}
        onConfirm={noop}
        onClose={noop}
        canConfirmPago={false}
        userRole="agendadora"
      />
    )
    // Should show 'Lead' (the prev stage) as an option — may appear in button + label
    expect(screen.getAllByText('Lead').length).toBeGreaterThan(0)
  })
})

// ── Reunion no schedule block ─────────────────────────────────────────────────

describe('MoveLeadModal — reunion no schedule block', () => {
  it('shows scheduling warning when no meeting is scheduled', () => {
    render(
      <MoveLeadModal
        lead={makeLead({ current_stage: 'lead', has_reunion_scheduled: false })}
        targetStage="reunion"
        labels={defaultLabels}
        onConfirm={noop}
        onClose={noop}
        canConfirmPago={false}
        userRole="agendadora"
      />
    )
    expect(screen.getByText(/Reunión no agendada/i)).toBeInTheDocument()
  })

  it('does NOT show scheduling warning when meeting is scheduled', () => {
    render(
      <MoveLeadModal
        lead={makeLead({ current_stage: 'lead', has_reunion_scheduled: true })}
        targetStage="reunion"
        labels={defaultLabels}
        onConfirm={noop}
        onClose={noop}
        canConfirmPago={false}
        userRole="agendadora"
      />
    )
    expect(screen.queryByText(/Reunión no agendada/i)).not.toBeInTheDocument()
  })
})

// ── OT blocking ───────────────────────────────────────────────────────────────

describe('MoveLeadModal — OT required block', () => {
  it('shows OT warning when agendadora and no OT on cierre stage', () => {
    render(
      <MoveLeadModal
        lead={makeLead({ current_stage: 'cierre', has_ot: false })}
        targetStage="pago_comprometido"
        labels={defaultLabels}
        onConfirm={noop}
        onClose={noop}
        canConfirmPago={false}
        userRole="agendadora"
      />
    )
    expect(screen.getByText(/OT pendiente/i)).toBeInTheDocument()
  })
})

// ── Confirm flow ──────────────────────────────────────────────────────────────

describe('MoveLeadModal — confirm interaction', () => {
  it('Mover Lead button is disabled when confirm text is empty', () => {
    render(
      <MoveLeadModal
        lead={makeLead()}
        targetStage="reunion"
        labels={defaultLabels}
        onConfirm={noop}
        onClose={noop}
        canConfirmPago={false}
        userRole="superadmin"
      />
    )
    const btn = screen.getByRole('button', { name: /Mover Lead/i })
    expect(btn).toBeDisabled()
  })

  it('Mover Lead button is enabled after typing "confirmar"', async () => {
    const user = userEvent.setup()
    render(
      <MoveLeadModal
        lead={makeLead()}
        targetStage="reunion"
        labels={defaultLabels}
        onConfirm={noop}
        onClose={noop}
        canConfirmPago={false}
        userRole="superadmin"
      />
    )
    const input = screen.getByPlaceholderText('confirmar')
    await user.type(input, 'confirmar')
    const btn = screen.getByRole('button', { name: /Mover Lead/i })
    expect(btn).not.toBeDisabled()
  })

  it('calls onClose when Cancelar is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <MoveLeadModal
        lead={makeLead()}
        targetStage="reunion"
        labels={defaultLabels}
        onConfirm={noop}
        onClose={onClose}
        canConfirmPago={false}
        userRole="superadmin"
      />
    )
    await user.click(screen.getByText('Cancelar'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onConfirm with selected stage when confirmed', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(
      <MoveLeadModal
        lead={makeLead()}
        targetStage="reunion"
        labels={defaultLabels}
        onConfirm={onConfirm}
        onClose={noop}
        canConfirmPago={false}
        userRole="superadmin"
      />
    )
    const input = screen.getByPlaceholderText('confirmar')
    await user.type(input, 'confirmar')
    const btn = screen.getByRole('button', { name: /Mover Lead/i })
    await user.click(btn)
    expect(onConfirm).toHaveBeenCalledWith('reunion', undefined)
  })

  it('requires a payment date when moving to pago_comprometido', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(
      <MoveLeadModal
        lead={makeLead()}
        targetStage="pago_comprometido"
        labels={defaultLabels}
        onConfirm={onConfirm}
        onClose={noop}
        canConfirmPago={false}
        userRole="superadmin"
      />
    )
    // Date field is visible
    expect(screen.getByText(/Fecha comprometida de pago/i)).toBeInTheDocument()
    const input = screen.getByPlaceholderText('confirmar')
    await user.type(input, 'confirmar')
    // Button stays disabled without a date
    const btn = screen.getByRole('button', { name: /Mover Lead/i })
    expect(btn).toBeDisabled()
    // Fill the date → button enables → confirm passes the date through
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement
    await user.type(dateInput, '2026-06-15')
    expect(btn).toBeEnabled()
    await user.click(btn)
    expect(onConfirm).toHaveBeenCalledWith('pago_comprometido', '2026-06-15')
  })
})
