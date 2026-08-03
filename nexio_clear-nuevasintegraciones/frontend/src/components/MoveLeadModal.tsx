import { useState } from 'react'
import { ArrowRight, X, Lock, Loader2, CalendarClock, CheckCircle, Trash2, Bell } from 'lucide-react'
import toast from 'react-hot-toast'
import type { Lead } from '../types'
import { requestOt } from '../api'
import { MAIN_STAGES as STAGES_MAIN, RECOVERY_STAGES as STAGES_RECOVERY, NEXT_STAGE } from '../lib/stages'

// Fuente única de verdad del embudo: los valores viven en lib/stages.ts. Aquí se
// re-tipan a string[] (stages.ts los declara `as const`) para no romper los
// `.includes(string)` internos, y se re-exportan para los consumidores existentes
// (Pipeline, tests) sin duplicar literales.
export const MAIN_STAGES: string[] = [...STAGES_MAIN]
export const RECOVERY_STAGES: string[] = [...STAGES_RECOVERY]
export { NEXT_STAGE }

// PREV_STAGE se mantiene local: incluye retrocesos de etapas de recuperación
// (recuperacion_*) que lib/stages.ts omite a propósito (Pipeline no expone
// back-nav para recuperación). Unificarlo cambiaría el comportamiento del tablero.
export const PREV_STAGE: Record<string, string> = {
  reunion:              'lead',
  altamente_interesado: 'reunion',
  cierre:               'altamente_interesado',
  pago_pendiente:       'cierre',
  pago_comprometido:    'cierre',
  pagado_reunion:       'reunion',
  recuperacion_lead:    'lead',
  recuperacion_reunion: 'reunion',
  recuperacion_cierre:  'cierre',
  recuperacion_pago:    'pago_comprometido',
}

export function MoveLeadModal({ lead, targetStage, labels, onConfirm, onClose, canConfirmPago, userRole }: {
  lead: Lead
  targetStage: string
  labels: Record<string, string>
  onConfirm: (stage: string, paymentDate?: string) => Promise<void>
  onClose: () => void
  canConfirmPago: boolean
  userRole?: string
}) {
  const [confirmText, setConfirmText] = useState('')
  const [moving, setMoving] = useState(false)
  const [paymentDate, setPaymentDate] = useState<string>((lead as any).payment_commitment_date ?? '')
  // Flujo B.2 — Solicitud colaborativa de OT al vendedor (la agendadora NO crea la OT).
  const [otRequested, setOtRequested] = useState(false)
  const [requestingOt, setRequestingOt] = useState(false)

  const handleRequestOt = async () => {
    if (requestingOt || otRequested) return
    setRequestingOt(true)
    try {
      await requestOt(lead.id)
      setOtRequested(true)
      toast.success('Vendedor notificado — solicitud de OT enviada')
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'No se pudo enviar la solicitud')
    } finally {
      setRequestingOt(false)
    }
  }

  const isAgendadora = userRole === 'agendadora'
  const blockedAdvanceFromReunion = isAgendadora && lead.current_stage === 'reunion'
  const blockedPagoSinOT = isAgendadora && !lead.has_ot
  const cur = lead.current_stage

  // Agendadora cannot move to 'reunion' without a scheduled calendar event
  // Skip if lead already passed reunion (cierre or beyond means meeting already happened)
  const PAST_REUNION_STAGES = ['altamente_interesado', 'cierre', 'pago_pendiente', 'pago_comprometido', 'pagado_confirmado', 'pagado_reunion', 'reunion']
  const blockedReunionNoSchedule = isAgendadora && !lead.has_reunion_scheduled && !PAST_REUNION_STAGES.includes(cur)

  // All stages available for free movement; only pagado_confirmado is role-gated
  const availableStages = [...MAIN_STAGES, ...RECOVERY_STAGES, 'papelera'].filter(s => {
    if (s === cur) return false
    if (s === 'pagado_confirmado' && !canConfirmPago) return false
    if (s === 'papelera' && cur === 'papelera') return false
    // Agendadora: 'reunion' AND recuperación blocked until a meeting is scheduled
    if (blockedReunionNoSchedule && (s === 'reunion' || s.startsWith('recuperacion'))) return false
    if (blockedAdvanceFromReunion) {
      const allowedFromReunion = ['lead', 'recuperacion_lead', 'recuperacion_reunion', 'recuperacion_cierre', 'recuperacion_pago', 'papelera']
      return allowedFromReunion.includes(s)
    }
    return true
  })

  const defaultStage = targetStage && availableStages.includes(targetStage)
    ? targetStage
    : (NEXT_STAGE[cur] && availableStages.includes(NEXT_STAGE[cur]) ? NEXT_STAGE[cur] : availableStages[0] ?? '')
  const [selectedStage, setSelectedStage] = useState(defaultStage)

  const needsPaymentDate = selectedStage === 'pago_comprometido'

  const handleConfirm = async () => {
    if (confirmText.trim().toLowerCase() !== 'confirmar') {
      toast.error('Debes escribir "confirmar" para continuar')
      return
    }
    if (needsPaymentDate && !paymentDate) {
      toast.error('Debes indicar la fecha comprometida de pago')
      return
    }
    setMoving(true)
    try {
      await onConfirm(selectedStage, needsPaymentDate ? paymentDate : undefined)
    } finally {
      setMoving(false)
    }
  }

  const stageDot = (s: string) =>
    s === 'pagado_confirmado' ? 'bg-lime-500' :
    s === 'pagado_reunion' ? 'bg-emerald-400' :
    s.startsWith('recuperacion') ? 'bg-red-500' :
    s === 'papelera' ? 'bg-gray-500' :
    s === 'pago_pendiente' ? 'bg-amber-400' :
    s === 'pago_comprometido' ? 'bg-brand-500' :
    s === 'cierre' ? 'bg-brand-400' :
    s === 'altamente_interesado' ? 'bg-brand-500' :
    s === 'reunion' ? 'bg-blue-400' : 'bg-slate-400'

  const isReady = confirmText.trim().toLowerCase() === 'confirmar'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden flex flex-col max-h-[92vh]"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: '0 20px 50px rgba(28,22,51,0.25)' }}>

        <div className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--primary-dim)', border: '1px solid rgba(53,122,14,0.25)' }}>
              <ArrowRight size={15} style={{ color: 'var(--primary)' }} />
            </div>
            <h3 className="text-base font-bold" style={{ color: 'var(--text)' }}>Mover Lead</h3>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm"
              style={{ background: 'var(--primary-dim)', color: 'var(--primary)' }}>
              {lead.contact?.name?.charAt(0)?.toUpperCase() ?? '?'}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm truncate" style={{ color: 'var(--text)' }}>{lead.contact?.name ?? '—'}</p>
              <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {lead.area?.name} · {labels[lead.current_stage] ?? lead.current_stage}
              </p>
            </div>
          </div>

          {blockedAdvanceFromReunion && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl"
              style={{ background: 'var(--warn-dim)', border: '1px solid rgba(245,158,11,0.25)' }}>
              <Lock size={13} style={{ color: 'var(--warn)', flexShrink: 0, marginTop: 1 }} />
              <div>
                <p className="text-xs font-bold" style={{ color: 'var(--warn)' }}>Avance bloqueado — en Reunión</p>
                <p className="text-[10px] mt-0.5" style={{ color: 'rgba(245,158,11,0.80)' }}>
                  Solo el vendedor puede avanzar este lead. Puedes retrocederlo o enviarlo a recuperación.
                </p>
              </div>
            </div>
          )}

          {blockedReunionNoSchedule && !blockedAdvanceFromReunion && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl"
              style={{ background: 'rgba(53,122,14,0.07)', border: '1px solid rgba(53,122,14,0.25)' }}>
              <CalendarClock size={13} style={{ color: 'var(--zx-accent-text)', flexShrink: 0, marginTop: 1 }} />
              <div>
                <p className="text-xs font-bold" style={{ color: 'var(--zx-accent-text)' }}>Reunión no agendada</p>
                <p className="text-[10px] mt-0.5" style={{ color: 'rgba(53,122,14,0.80)' }}>
                  Agenda primero la reunión en el Calendario para poder mover este lead a la etapa Reunión.
                </p>
              </div>
            </div>
          )}

          {blockedPagoSinOT && (
            <div className="px-3 py-2.5 rounded-xl space-y-2.5"
              style={{ background: 'rgba(225,29,72,0.06)', border: '1px solid rgba(225,29,72,0.22)' }}>
              <div className="flex items-start gap-2.5">
                <Lock size={13} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />
                <div>
                  <p className="text-xs font-bold" style={{ color: 'var(--danger)' }}>OT pendiente — Pago Comprometido bloqueado</p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'rgba(225,29,72,0.75)' }}>
                    Solo el vendedor puede crear la Orden de Trabajo. Avísale para destrabar el pago.
                  </p>
                </div>
              </div>

              {!otRequested ? (
                <button onClick={handleRequestOt} disabled={requestingOt}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all disabled:opacity-60"
                  style={{ background: 'var(--danger)', color: '#fff' }}>
                  {requestingOt ? <Loader2 size={13} className="animate-spin" /> : <Bell size={13} />}
                  {requestingOt ? 'Enviando…' : 'Solicitar OT al Vendedor'}
                </button>
              ) : (
                <div className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold"
                  style={{ background: 'rgba(16,185,129,0.12)', color: '#059669', border: '1px solid rgba(16,185,129,0.30)' }}>
                  <CheckCircle size={14} /> Solicitud enviada — a la espera del vendedor
                </div>
              )}
            </div>
          )}

          <div className="space-y-3.5">
            {[
              { title: 'Embudo principal', stages: availableStages.filter(s => MAIN_STAGES.includes(s) || s === 'pagado_reunion') },
              { title: 'Recuperación',     stages: availableStages.filter(s => s.startsWith('recuperacion')) },
            ].filter(g => g.stages.length > 0).map(g => (
              <div key={g.title}>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
                  {g.title}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {g.stages.map(s => {
                    const active    = selectedStage === s
                    const isRec     = s.startsWith('recuperacion')
                    const isBlocked = s === 'pago_comprometido' && blockedPagoSinOT
                    return (
                      <button key={s}
                        onClick={() => !isBlocked && setSelectedStage(s)}
                        disabled={isBlocked}
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-xs transition-all"
                        style={{
                          background: isBlocked ? 'rgba(225,29,72,0.04)' : active ? (isRec ? 'rgba(225,29,72,0.07)' : 'rgba(53,122,14,0.08)') : 'var(--surface-1)',
                          border: isBlocked ? '1px solid rgba(225,29,72,0.25)' : active ? (isRec ? '1.5px solid rgba(225,29,72,0.45)' : '1.5px solid var(--zx-accent-text)') : '1px solid #e6e1f0',
                          color: isBlocked ? '#dc2626' : active ? (isRec ? '#dc2626' : 'var(--zx-accent-text)') : '#374151',
                          opacity: isBlocked ? 0.65 : 1,
                          cursor: isBlocked ? 'not-allowed' : 'pointer',
                          fontWeight: active ? 700 : 500,
                          boxShadow: active ? '0 1px 4px rgba(28,22,51,0.08)' : 'none',
                        }}>
                        {isBlocked
                          ? <Lock size={9} className="flex-shrink-0" />
                          : <span className={`w-2 h-2 rounded-full flex-shrink-0 ${stageDot(s)}`} />}
                        <span className="truncate">{labels[s] ?? s}</span>
                        {active && !isBlocked && <CheckCircle size={12} className="ml-auto flex-shrink-0" style={{ color: isRec ? '#dc2626' : 'var(--zx-accent-text)' }} />}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            {availableStages.includes('papelera') && (
              <button
                onClick={() => setSelectedStage('papelera')}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-xs transition-all"
                style={{
                  background: selectedStage === 'papelera' ? 'rgba(225,29,72,0.07)' : 'var(--surface-1)',
                  border: selectedStage === 'papelera' ? '1.5px solid rgba(225,29,72,0.45)' : '1px solid #e6e1f0',
                  color: selectedStage === 'papelera' ? '#dc2626' : 'var(--text-3)',
                  fontWeight: selectedStage === 'papelera' ? 700 : 500,
                }}>
                <Trash2 size={11} className="flex-shrink-0" />
                Enviar a papelera
                {selectedStage === 'papelera' && <CheckCircle size={12} className="ml-auto flex-shrink-0" style={{ color: '#dc2626' }} />}
              </button>
            )}
          </div>

          {needsPaymentDate && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                <CalendarClock size={11} style={{ color: '#0891b2' }} />
                Fecha comprometida de pago <span style={{ color: 'var(--danger)' }}>*</span>
              </p>
              <input
                type="date"
                value={paymentDate}
                min={new Date().toISOString().split('T')[0]}
                onChange={e => setPaymentDate(e.target.value)}
                className="w-full rounded-xl px-4 py-3 text-sm font-medium outline-none transition-all"
                style={{
                  background: '#faf9fd',
                  border: paymentDate ? '2px solid #0891b2' : '1.5px solid #d1d5db',
                  color: '#1c1633',
                  fontWeight: 600,
                }}
              />
              <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                El lead aparecerá en Pago Comprometido con esta fecha y su cuenta regresiva.
              </p>
            </div>
          )}

          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
              Escribe <span style={{ color: 'var(--primary)' }}>"confirmar"</span> para continuar
            </p>
            <input
              autoFocus
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleConfirm()}
              placeholder="confirmar"
              className="w-full rounded-xl px-4 py-3 text-sm font-medium outline-none transition-all"
              style={{
                background: '#faf9fd',
                border: isReady ? '2px solid var(--zx-accent-text)' : '1.5px solid #d1d5db',
                color: isReady ? 'var(--zx-accent-text)' : '#1c1633',
                boxShadow: isReady ? '0 0 0 3px rgba(53,122,14,0.10)' : 'none',
                fontWeight: 600,
              }}
            />
          </div>

          {selectedStage && (() => {
            const destructive = selectedStage === 'papelera' || selectedStage.startsWith('recuperacion')
            const accent = destructive ? '#dc2626' : 'var(--zx-accent-text)'
            return (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
                style={{ background: destructive ? 'rgba(225,29,72,0.05)' : '#f0f4ff', border: `1.5px solid ${destructive ? 'rgba(225,29,72,0.20)' : 'rgba(53,122,14,0.18)'}` }}>
                <span className="text-xs font-semibold" style={{ color: '#6b7280' }}>
                  {labels[lead.current_stage] ?? lead.current_stage}
                </span>
                <ArrowRight size={13} style={{ color: accent, flexShrink: 0 }} />
                <span className="text-xs font-bold" style={{ color: accent }}>
                  {selectedStage === 'papelera' ? 'Papelera' : (labels[selectedStage] ?? selectedStage)}
                </span>
              </div>
            )
          })()}
        </div>

        <div className="px-6 py-4 flex gap-3"
          style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border-2)', color: 'var(--text-2)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}>
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={moving || !isReady || (needsPaymentDate && !paymentDate)}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-30"
            style={{
              background: selectedStage === 'papelera'
                ? (isReady ? '#e11d48' : 'rgba(225,29,72,0.10)')
                : (isReady ? 'var(--primary)' : 'var(--primary-dim)'),
              color: isReady ? '#ffffff' : (selectedStage === 'papelera' ? '#dc2626' : 'var(--primary)'),
              boxShadow: isReady ? '0 2px 10px rgba(28,22,51,0.15)' : 'none',
            }}>
            {moving
              ? <><Loader2 size={14} className="animate-spin" /> Moviendo...</>
              : selectedStage === 'papelera' ? <><Trash2 size={13} /> Enviar a papelera</> : 'Mover Lead'}
          </button>
        </div>
      </div>
    </div>
  )
}
