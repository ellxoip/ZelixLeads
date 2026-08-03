import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { XCircle, ThumbsUp, MoreVertical, Link2, RefreshCw, Phone, Calendar, Clock, FileText, ChevronDown, WifiOff, ClipboardList, CheckCircle, AlertCircle, MessageCircle, Banknote, Hourglass } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

import { parseLocalDate as parseAsUTC } from '../utils/dates'
import toast from 'react-hot-toast'
import { getVendorPipeline, updateVendorStatus, moveLeadStage, updateLead, getStageLabels } from '../api'
import { useRealtime } from '../contexts/RealtimeContext'
import { useDebouncedRealtime } from '../hooks/useDebouncedRealtime'
import { EventModal } from '../components/EventModal'
import { WorkOrderModal } from '../components/WorkOrderModal'
import KanbanColumn from '../components/kanban/KanbanColumn'
import KanbanBoard from '../components/kanban/KanbanBoard'

function fmt(n: number) { return `$${Math.round(n).toLocaleString('es-CL')}` }

const AVATAR_COLORS = [
  { bg: 'rgba(53,122,14,0.12)',  fg: 'var(--zx-accent-text)' },
  { bg: 'rgba(53,122,14,0.12)', fg: 'var(--zx-accent-text)' },
  { bg: 'rgba(8,145,178,0.12)',  fg: '#0891b2' },
  { bg: 'rgba(5,150,105,0.12)',  fg: '#059669' },
  { bg: 'rgba(217,119,6,0.12)',  fg: '#d97706' },
]

function LeadPipelineCard({ lead, onOT }: { lead: any; onOT: (leadId: number) => void }) {
  const avatarColor = AVATAR_COLORS[(lead.contact_name?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length]
  const stage = lead.current_stage
  const isPagado    = stage === 'pagado_reunion'
  const isPago      = stage === 'pago_comprometido'
  const isPendiente = stage === 'pago_pendiente'
  const isCierre    = stage === 'cierre'

  const borderColor = isPagado ? '#34d399' : isPago ? '#22c55e' : isPendiente ? '#0ea5e9' : 'var(--zx-accent-text)'
  const accent      = isPagado ? '#059669' : isPago ? '#16a34a' : isPendiente ? '#0369a1' : 'var(--zx-accent-text)'
  const tagBg       = isPagado ? 'rgba(52,211,153,0.12)' : isPago ? 'rgba(34,197,94,0.12)' : isPendiente ? 'rgba(14,165,233,0.12)' : 'rgba(53,122,14,0.12)'
  const tagColor    = isPagado ? '#059669' : isPago ? '#16a34a' : isPendiente ? '#0369a1' : 'var(--zx-accent-text)'
  const tagLabel    = isPagado ? 'Validando Pago' : isPago ? 'Pago Comprometido' : isPendiente ? 'Pago Pendiente' : 'Cierre'

  const daysIn = lead.created_at
    ? Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 86400000)
    : 0
  const isHot  = daysIn >= 5
  const isWarm = daysIn >= 2 && daysIn < 5

  const payBanner = (() => {
    if ((!isPago && !isPendiente) || !lead.payment_commitment_date) return null
    const today = new Date(); today.setHours(0,0,0,0)
    const pDate = new Date(lead.payment_commitment_date + 'T00:00:00')
    const diff = Math.round((pDate.getTime() - today.getTime()) / 86400000)
    const label = pDate.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })
    if (diff < 0)  return { bg: '#fef2f2', color: '#dc2626', border: '#fca5a5', text: `Vencido hace ${Math.abs(diff)}d` }
    if (diff === 0) return { bg: '#fff7ed', color: '#c2410c', border: '#fdba74', text: 'Paga hoy' }
    if (diff <= 2)  return { bg: '#fffbeb', color: '#b45309', border: '#fcd34d', text: `Paga en ${diff}d — ${label}` }
    return { bg: '#f0fdf4', color: '#15803d', border: '#86efac', text: `Paga el ${label}` }
  })()

  const waHref = lead.contact_phone
    ? `https://wa.me/${lead.contact_phone.replace(/\D/g, '')}`
    : null

  return (
    <div className="rounded-xl overflow-hidden transition-shadow duration-200"
      style={{
        background: '#ffffff',
        border: '1px solid rgba(28,22,51,0.08)',
        borderLeft: `3px solid ${borderColor}`,
        boxShadow: '0 1px 3px rgba(28,22,51,0.05)',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(28,22,51,0.08)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(28,22,51,0.05)' }}>

      {/* Stage tag row */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
          style={{ background: tagBg, color: tagColor }}>
          {tagLabel}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-0.5 text-[9px] font-semibold"
            style={{ color: isHot ? '#dc2626' : isWarm ? '#d97706' : 'rgba(28,22,51,0.35)' }}>
            <Clock size={8} />{daysIn}d
          </span>
          <Link to={`/leads/${lead.lead_id}`}
            className="w-6 h-6 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(28,22,51,0.05)', color: 'rgba(28,22,51,0.38)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(28,22,51,0.10)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(28,22,51,0.05)' }}>
            <Link2 size={10} />
          </Link>
        </div>
      </div>

      {/* Pagado reunion special banner */}
      {isPagado && (
        <div className="mx-2 mb-1 px-3 py-1.5 rounded-lg text-center text-[11px] font-bold"
          style={{ background: 'rgba(52,211,153,0.10)', color: '#059669', border: '1px solid rgba(52,211,153,0.25)' }}>
          <Hourglass size={10} className="inline mr-1.5 -mt-0.5" />Esperando confirmación de pago
        </div>
      )}

      {payBanner && (
        <div className="mx-2 mb-1 px-3 py-1.5 rounded-lg text-center text-[11px] font-bold"
          style={{ background: payBanner.bg, color: payBanner.color, border: `1px solid ${payBanner.border}` }}>
          <Calendar size={10} className="inline mr-1.5 -mt-0.5" />{payBanner.text}
        </div>
      )}

      <div className="px-3 pb-3 space-y-2">
        {/* Avatar + name + phone + WA */}
        <div className="flex items-start gap-2.5">
          <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center font-bold text-sm"
            style={{ background: avatarColor.bg, color: avatarColor.fg }}>
            {lead.contact_name?.charAt(0)?.toUpperCase() ?? '?'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm leading-tight truncate" style={{ color: '#1c1633' }}>
              {lead.contact_name ?? '—'}
            </p>
            {lead.contact_phone && (
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] font-mono" style={{ color: 'rgba(28,22,51,0.48)' }}>
                  {lead.contact_phone}
                </span>
                {waHref && (
                  <a href={waHref} target="_blank" rel="noopener noreferrer"
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded-md flex-shrink-0"
                    style={{ background: '#dcfce7', color: '#16a34a' }}
                    onClick={e => e.stopPropagation()}>
                    WA
                  </a>
                )}
              </div>
            )}
            {lead.service_description && (
              <p className="text-[10px] truncate mt-0.5" style={{ color: 'rgba(28,22,51,0.45)' }}>
                {lead.service_description}
              </p>
            )}
          </div>
        </div>

        {/* Financial block */}
        <div className="rounded-lg px-2.5 py-2" style={{ background: '#faf9fd', border: '1px solid #e6e1f0' }}>
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase tracking-wide flex items-center gap-1" style={{ color: 'rgba(28,22,51,0.42)' }}>
              <Banknote size={9} />Honorarios
            </span>
            {lead.honorarios > 0
              ? <span className="text-[13px] font-black" style={{ color: accent }}>{fmt(lead.honorarios)}</span>
              : <span className="text-[9px] italic" style={{ color: 'rgba(28,22,51,0.35)' }}>Sin definir</span>
            }
          </div>
          {lead.honorarios > 0 && lead.num_cuotas > 1 && (
            <div className="flex items-center justify-between mt-1 pt-1" style={{ borderTop: '1px solid #e8ecf0' }}>
              <span className="text-[9px] font-semibold" style={{ color: 'rgba(28,22,51,0.42)' }}>{lead.num_cuotas} cuotas</span>
              <span className="text-[10px] font-bold" style={{ color: '#1c1633' }}>{fmt(lead.monto_cuota)}/cuota</span>
            </div>
          )}
          {lead.honorarios > 0 && lead.cuota_inicial > 0 && lead.cuota_inicial !== lead.monto_cuota && lead.num_cuotas > 1 && (
            <div className="flex items-center justify-between mt-1">
              <span className="text-[9px] font-semibold" style={{ color: 'rgba(28,22,51,0.42)' }}>Cuota inicial</span>
              <span className="text-[10px] font-bold" style={{ color: '#1c1633' }}>{fmt(lead.cuota_inicial)}</span>
            </div>
          )}
        </div>

        {/* OT button — only for cierre/pago_comprometido */}
        {(isCierre || isPago) && (
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest mb-1 px-0.5 flex items-center gap-1"
              style={{ color: lead.has_ot ? '#16a34a' : '#dc2626' }}>
              {lead.has_ot ? <CheckCircle size={9} /> : <AlertCircle size={9} />}
              {lead.has_ot ? 'OT lista' : 'Requiere OT'}
            </p>
            <button onClick={() => onOT(lead.lead_id)}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-bold transition-colors"
              style={{
                background: lead.has_ot ? 'rgba(34,197,94,0.10)' : 'var(--zx-accent-text)',
                color: lead.has_ot ? '#16a34a' : '#ffffff',
                border: `1px solid ${lead.has_ot ? 'rgba(34,197,94,0.25)' : 'var(--zx-accent-text)'}`,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = lead.has_ot ? 'rgba(34,197,94,0.18)' : '#3651d4' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = lead.has_ot ? 'rgba(34,197,94,0.10)' : 'var(--zx-accent-text)' }}>
              {lead.has_ot ? <CheckCircle size={11} /> : <ClipboardList size={11} />}
              {lead.has_ot ? 'Ver / Editar OT' : 'Agregar OT'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const DEFAULT_VENDOR_LABELS: Record<string, string> = {
  espera_cliente:       'En proceso de reunión',
  altamente_interesado: 'Altamente Interesado',
  sin_exito:            'Sin Éxito / No Conectó',
  pagado_reunion:       'Validando Pago Reunión',
  cierre:               'Cierre',
  pago_comprometido:    'Pago Comprometido',
}

function buildCols(labels: Record<string, string>) {
  const l = (k: string) => labels[k] ?? DEFAULT_VENDOR_LABELS[k]
  return [
    { key: 'espera_cliente',       label: l('espera_cliente'),       dot: 'bg-warn',   header: 'bg-surface-1 border-black/[0.08] shadow-sm', badge: 'bg-warn/15 text-warn' },
    { key: 'altamente_interesado', label: l('altamente_interesado'), dot: 'bg-lime',   header: 'bg-surface-1 border-black/[0.08] shadow-sm', badge: 'bg-lime/15 text-lime' },
    { key: 'sin_exito',            label: l('sin_exito'),            dot: 'bg-danger', header: 'bg-surface-1 border-black/[0.08] shadow-sm', badge: 'bg-danger/15 text-danger' },
  ]
}

const OUTCOME_CONFIG: Record<string, { label: string; desc: string; color: string; btnClass: string; badgeClass: string; icon: React.ReactNode }> = {
  no_show:              { label: 'No se conectó',        desc: 'El cliente no se presentó a la reunión.',                color: 'warn',   btnClass: 'hover:bg-warn/10 hover:text-warn border-warn/30 text-warn',            badgeClass: 'bg-warn/10 text-warn border-warn/20',             icon: <WifiOff size={10}/> },
  sin_exito:            { label: 'Se conectó y no cerró',desc: 'El cliente asistió pero no se llegó a un cierre.',       color: 'danger', btnClass: 'hover:bg-danger/10 hover:text-danger border-danger/30 text-danger',    badgeClass: 'bg-danger/10 text-danger border-danger/20',       icon: <XCircle size={10}/> },
  altamente_interesado: { label: 'Con éxito sin pago',   desc: 'El cliente cerró pero pagará después.',                 color: 'lime',   btnClass: 'hover:bg-lime/10 hover:text-lime border-lime/30 text-lime',             badgeClass: 'bg-lime/10 text-lime border-lime/20',             icon: <ThumbsUp size={10}/> },
  con_exito_pagada:     { label: 'Con éxito pagada',     desc: 'El cliente cerró y pagó en la reunión.',                color: 'emerald',btnClass: 'hover:bg-emerald-400/10 hover:text-emerald-400 border-emerald-400/30 text-emerald-400', badgeClass: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20', icon: <CheckCircle size={10}/> },
}

type AltFlowMode = 'normal' | 'fecha_pago' | 'pago_hoy' | 'pagada'

const ALT_MODES: { key: AltFlowMode; label: string; desc: string; color: string; textColor: string; dimColor: string; borderColor: string }[] = [
  { key: 'normal',     label: 'Seguir flujo normal',        desc: 'El lead avanza en el pipeline sin acción adicional.',       color: '#475569', textColor: '#130d26', dimColor: '#f1f5f9', borderColor: '#94a3b8' },
  { key: 'fecha_pago', label: 'Ingresar fecha de pago',     desc: 'El cliente se compromete a pagar en una fecha específica.', color: '#c2410c', textColor: '#7c2d12', dimColor: '#fff7ed', borderColor: '#f97316' },
  { key: 'pago_hoy',   label: 'Pagará hoy (fuera reunión)', desc: 'El cliente confirmó que pagará más tarde hoy.',             color: '#0369a1', textColor: '#0c4a6e', dimColor: '#f0f9ff', borderColor: '#38bdf8' },
]

function OutcomeModal({ outcome, onConfirm, onCancel, clientName, clientPhone }: {
  outcome: string
  onConfirm: (notes: string, mode?: AltFlowMode, paymentDate?: string) => Promise<void>
  onCancel: () => void
  clientName?: string
  clientPhone?: string
}) {
  const [notes, setNotes]             = useState('')
  const [saving, setSaving]           = useState(false)
  const [altMode, setAltMode]         = useState<AltFlowMode>('normal')
  const [paymentDate, setPaymentDate] = useState('')
  const cfg    = OUTCOME_CONFIG[outcome]
  const isAlt  = outcome === 'altamente_interesado'
  const canConfirm = !isAlt || altMode !== 'fecha_pago' || !!paymentDate

  const confirm = async () => {
    if (!canConfirm) { toast.error('Selecciona una fecha de pago'); return }
    setSaving(true)
    try {
      await onConfirm(notes, isAlt ? altMode : undefined, isAlt && altMode === 'fecha_pago' ? paymentDate : undefined)
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}>
      <div className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl" style={{ background: '#ffffff', border: '1px solid #e6e1f0' }}>

        {/* Header */}
        <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid #f1f5f9' }}>
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.badgeClass} border`}>
            {cfg.icon}
          </div>
          <div>
            <p className="font-bold text-sm" style={{ color: '#130d26' }}>{cfg.label}</p>
            <p className="text-[11px] mt-0.5" style={{ color: '#64748b' }}>{cfg.desc}</p>
          </div>
        </div>

        {/* Cliente al que se le marca el resultado */}
        {clientName && (
          <div className="px-5 py-2.5 flex items-center gap-2.5" style={{ background: '#faf9fd', borderBottom: '1px solid #f1f5f9' }}>
            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-black text-white" style={{ background: '#6366f1' }}>
              {clientName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold truncate" style={{ color: '#130d26' }}>{clientName}</p>
              <p className="text-[10px]" style={{ color: '#64748b' }}>{clientPhone ? `${clientPhone} · ` : ''}Estás registrando el resultado de la reunión con este cliente</p>
            </div>
          </div>
        )}

        <div className="px-5 py-4 space-y-4">
          {/* 4 opciones solo para altamente_interesado */}
          {isAlt && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-2.5" style={{ color: '#475569' }}>¿Qué deseas hacer?</p>
              <div className="space-y-2">
                {ALT_MODES.map(m => {
                  const active = altMode === m.key
                  return (
                    <button key={m.key} onClick={() => setAltMode(m.key)}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all"
                      style={{
                        background: active ? m.dimColor : '#faf9fd',
                        border: `2px solid ${active ? m.borderColor : '#e6e1f0'}`,
                        boxShadow: active ? `0 0 0 3px ${m.borderColor}30` : 'none',
                      }}>
                      <span className="w-4.5 h-4.5 rounded-full flex-shrink-0 flex items-center justify-center transition-all"
                        style={{
                          width: 18, height: 18,
                          border: `2.5px solid ${active ? m.color : '#94a3b8'}`,
                          background: active ? m.color : 'transparent',
                        }}>
                        {active && <span className="w-2 h-2 rounded-full bg-white" style={{ width: 7, height: 7 }} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold leading-tight" style={{ color: active ? m.textColor : '#1e293b' }}>{m.label}</p>
                        <p className="text-[11px] mt-0.5 leading-snug font-medium" style={{ color: active ? m.color : '#64748b' }}>{m.desc}</p>
                      </div>
                    </button>
                  )
                })}
              </div>

              {altMode === 'fecha_pago' && (
                <div className="mt-3 rounded-xl overflow-hidden" style={{ border: '1.5px solid rgba(251,146,60,0.40)', background: 'rgba(251,146,60,0.05)' }}>
                  <label className="block px-3.5 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#c2650a' }}>
                    Fecha comprometida de pago
                  </label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={e => setPaymentDate(e.target.value)}
                    autoFocus
                    className="w-full px-3.5 pb-2.5 text-sm font-semibold bg-transparent focus:outline-none"
                    style={{ color: '#c2650a' }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Notas */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: '#475569' }}>
              Notas del resultado
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Ej: El cliente pidió más tiempo para decidir..."
              rows={3}
              autoFocus={!isAlt}
              className="w-full rounded-xl px-3.5 py-2.5 text-sm resize-none focus:outline-none transition-colors"
              style={{ background: '#faf9fd', border: '1.5px solid #e6e1f0', color: '#1e293b' }}
              onFocus={e => { e.currentTarget.style.borderColor = '#94a3b8' }}
              onBlur={e => { e.currentTarget.style.borderColor = '#e6e1f0' }}
            />
          </div>

          {/* Botones */}
          <div className="flex gap-2.5">
            <button onClick={onCancel} disabled={saving}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors"
              style={{ background: '#f1f5f9', border: '1px solid #e6e1f0', color: '#64748b' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#e6e1f0' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#f1f5f9' }}>
              Cancelar
            </button>
            <button onClick={confirm} disabled={saving || !canConfirm}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all border ${cfg.badgeClass} disabled:opacity-35`}>
              {saving ? 'Guardando...' : 'Confirmar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function EventCard({ ev, onMark, onEdit, onOTRequired, onOT, onBeginMeeting, isEsperaCliente }: {
  ev: any
  onMark: (id: number, s: string, notes?: string) => Promise<void>
  onEdit: (ev: any) => void
  onOTRequired: (leadId: number, honorarios: number, outcome: string, notes: string, mode?: AltFlowMode, paymentDate?: string) => void
  onOT?: (leadId: number, honorarios: number) => void
  onBeginMeeting?: (eventId: number, leadId: number, honorarios: number, hasOT?: boolean) => void
  isEsperaCliente?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [pendingOutcome, setPendingOutcome] = useState<string | null>(null)

  const SUCCESS_OUTCOMES = ['altamente_interesado', 'con_exito_pagada']

  const handleConfirm = async (notes: string, mode?: AltFlowMode, paymentDate?: string) => {
    const outcome = pendingOutcome!
    setPendingOutcome(null)

    // Todos los outcomes exitosos requieren OT primero — sin excepción
    if (outcome === 'altamente_interesado' && ev.lead_id) {
      onOTRequired(ev.lead_id, ev.honorarios ?? 0, outcome, notes, mode, paymentDate)
      return
    }

    if (SUCCESS_OUTCOMES.includes(outcome) && ev.lead_id) {
      onOTRequired(ev.lead_id, ev.honorarios ?? 0, outcome, notes)
    } else {
      await onMark(ev.id, outcome, notes || undefined)
    }
  }

  const start = parseAsUTC(ev.start_time)
  const end   = parseAsUTC(ev.end_time)
  const meetingStarted = start.getTime() <= Date.now()

  const avatarColor = AVATAR_COLORS[(ev.contact_name?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length]

  const meetingBadge = (() => {
    const today = new Date(); today.setHours(0,0,0,0)
    const meetDate = new Date(start); meetDate.setHours(0,0,0,0)
    const diff = Math.round((meetDate.getTime() - today.getTime()) / 86400000)
    if (diff < -1) return { text: `${Math.abs(diff)}d atrás`, bg: '#fef2f2', color: '#dc2626', border: '#fca5a5' }
    if (diff === -1) return { text: 'Ayer', bg: '#fef2f2', color: '#dc2626', border: '#fca5a5' }
    if (diff === 0)  return { text: 'HOY', bg: '#fff7ed', color: '#c2410c', border: '#fdba74' }
    if (diff === 1)  return { text: 'Mañana', bg: '#fffbeb', color: '#b45309', border: '#fcd34d' }
    return { text: `En ${diff}d`, bg: '#f0fdf4', color: '#15803d', border: '#86efac' }
  })()

  const waHref = ev.contact_phone
    ? `https://wa.me/${ev.contact_phone.replace(/\D/g, '')}`
    : null

  const leftColor = ev.vendor_status === 'sin_exito' ? '#e11d48'  // danger
    : ev.vendor_status === 'no_show' ? '#e11d48'                  // danger (misma columna)
    : ev.vendor_status === 'altamente_interesado' ? 'var(--zx-accent-text)'     // lime (azul)
    : ev.vendor_status === 'con_exito_pagada' ? 'var(--zx-accent-text)'         // lime
    : isEsperaCliente ? '#f59e0b'                                 // warn (naranja)
    : 'var(--zx-accent-text)'

  return (
    <div className="rounded-xl overflow-hidden transition-shadow duration-200"
      style={{
        background: '#ffffff',
        border: '1px solid rgba(28,22,51,0.08)',
        borderLeft: `3px solid ${leftColor}`,
        boxShadow: '0 1px 3px rgba(28,22,51,0.05)',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(28,22,51,0.08)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(28,22,51,0.05)' }}>

      <div className="p-3 space-y-2.5">

        {/* Contact header */}
        <div className="flex items-start gap-2.5">
          <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center font-bold text-sm"
            style={{ background: avatarColor.bg, color: avatarColor.fg }}>
            {ev.contact_name?.charAt(0)?.toUpperCase() ?? '?'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm leading-tight truncate" style={{ color: '#1c1633' }}>
              {ev.contact_name ?? ev.title ?? '—'}
            </p>
            {ev.contact_phone ? (
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] font-mono" style={{ color: 'rgba(28,22,51,0.48)' }}>{ev.contact_phone}</span>
                {waHref && (
                  <a href={waHref} target="_blank" rel="noopener noreferrer"
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded-md flex-shrink-0"
                    style={{ background: '#dcfce7', color: '#16a34a' }}
                    onClick={e => e.stopPropagation()}>WA</a>
                )}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {ev.lead_id && (
              <Link to={`/leads/${ev.lead_id}`}
                className="w-6 h-6 rounded-lg flex items-center justify-center"
                style={{ background: 'rgba(28,22,51,0.04)', color: 'rgba(28,22,51,0.38)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(28,22,51,0.10)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(28,22,51,0.04)'}>
                <Link2 size={10} />
              </Link>
            )}
            <button onClick={() => onEdit(ev)}
              className="w-6 h-6 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(28,22,51,0.04)', color: 'rgba(28,22,51,0.38)' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(28,22,51,0.10)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(28,22,51,0.04)'}>
              <MoreVertical size={10} />
            </button>
          </div>
        </div>

        {/* Honorarios */}
        {ev.honorarios > 0 && (
          <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg"
            style={{ background: 'rgba(53,122,14,0.05)', border: '1px solid rgba(53,122,14,0.10)' }}>
            <span className="text-[9px] font-bold uppercase tracking-wide flex items-center gap-1" style={{ color: 'rgba(28,22,51,0.42)' }}>
              <Banknote size={9} />Honorarios
            </span>
            <span className="text-[13px] font-black" style={{ color: 'var(--zx-accent-text)' }}>{fmt(ev.honorarios)}</span>
          </div>
        )}

        {/* Meeting date + urgency */}
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
            style={{ background: '#faf9fd', border: '1px solid #e8ecf0' }}>
            <Calendar size={10} style={{ color: 'rgba(28,22,51,0.38)', flexShrink: 0 }} />
            <span className="text-[11px] font-semibold truncate" style={{ color: '#374151' }}>
              {format(start, "d MMM", { locale: es })} · {format(start, 'HH:mm')}–{format(end, 'HH:mm')}
            </span>
          </div>
          <span className="text-[10px] font-bold px-1.5 py-1 rounded-lg whitespace-nowrap flex-shrink-0"
            style={{ background: meetingBadge.bg, color: meetingBadge.color, border: `1px solid ${meetingBadge.border}` }}>
            {meetingBadge.text}
          </span>
        </div>

        {/* Notes */}
        {ev.notes && (
          <div className="text-[10px] leading-relaxed" style={{ color: 'rgba(28,22,51,0.52)' }}>
            {expanded ? (
              <>
                <p className="whitespace-pre-wrap">{ev.notes}</p>
                <button onClick={() => setExpanded(false)} className="text-[10px] font-semibold mt-0.5"
                  style={{ color: 'var(--zx-accent-text)' }}>menos ▲</button>
              </>
            ) : (
              <button onClick={() => setExpanded(true)}
                className="flex items-start gap-1 text-left w-full transition-colors"
                style={{ color: 'rgba(28,22,51,0.52)' }}>
                <FileText size={10} className="flex-shrink-0 mt-0.5" />
                <span className="line-clamp-2">{ev.notes}</span>
              </button>
            )}
          </div>
        )}

        {/* Creator + agendadora */}
        {ev.creator_name && (
          <p className="text-[10px]" style={{ color: 'rgba(28,22,51,0.32)' }}>Agendado por {ev.creator_name}</p>
        )}

        {/* Status badge for resolved events */}
        {ev.vendor_status && OUTCOME_CONFIG[ev.vendor_status] && (
          <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border ${OUTCOME_CONFIG[ev.vendor_status].badgeClass}`}>
            {OUTCOME_CONFIG[ev.vendor_status].icon}
            {OUTCOME_CONFIG[ev.vendor_status].label}
          </div>
        )}

        {/* OT button for altamente_interesado */}
        {ev.vendor_status === 'altamente_interesado' && ev.lead_id && onOT && (
          <button onClick={() => onOT(ev.lead_id, ev.honorarios ?? 0)}
            className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-[10px] font-bold transition-all"
            style={{ background: 'rgba(52,211,153,0.10)', color: '#059669', border: '1px solid rgba(52,211,153,0.25)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(52,211,153,0.20)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(52,211,153,0.10)'}>
            <ClipboardList size={11} /> Ver / Editar OT
          </button>
        )}

        {/* Action buttons — only for unmarked events */}
        {!ev.vendor_status && (
          <div className="space-y-1.5 pt-1.5" style={{ borderTop: '1px solid rgba(28,22,51,0.06)' }}>
            {!meetingStarted ? (
              <div className="flex items-start gap-1.5 px-2.5 py-2 rounded-lg text-[10px] font-semibold leading-snug"
                style={{ background: '#faf9fd', border: '1px dashed #cbd5e1', color: '#64748b' }}>
                <Clock size={11} className="flex-shrink-0 mt-0.5" />
                <span>
                  La reunión aún no comienza — podrás registrar el resultado desde el{' '}
                  {format(start, "d MMM 'a las' HH:mm", { locale: es })}.
                </span>
              </div>
            ) : isEsperaCliente && ev.lead_id ? (
              <>
                <button onClick={() => setPendingOutcome('no_show')}
                  className="w-full text-[11px] py-1.5 px-3 rounded-lg font-semibold flex items-center gap-2 transition-colors"
                  style={{ background: 'rgba(245,158,11,0.06)', color: '#b45309', border: '1px solid rgba(245,158,11,0.18)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(245,158,11,0.12)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(245,158,11,0.06)'}>
                  <WifiOff size={10} /> No se conectó
                </button>
                <button onClick={() => onBeginMeeting!(ev.id, ev.lead_id, ev.honorarios ?? 0, !!ev.has_ot)}
                  className="w-full text-[12px] py-2.5 px-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors"
                  style={{ background: '#059669', color: '#fff', border: 'none', boxShadow: '0 1px 2px rgba(28,22,51,0.08)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#047857'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#059669'}>
                  <CheckCircle size={13} /> Comenzar Reunión
                </button>
              </>
            ) : (
              (['no_show', 'sin_exito', 'altamente_interesado', 'con_exito_pagada'] as const).map(key => (
                <button key={key} onClick={() => setPendingOutcome(key)}
                  className={`w-full text-[11px] py-1.5 px-3 rounded-lg font-semibold flex items-center gap-2 transition-colors border ${OUTCOME_CONFIG[key].btnClass}`}
                  style={{ background: 'rgba(28,22,51,0.02)' }}>
                  {OUTCOME_CONFIG[key].icon}
                  {OUTCOME_CONFIG[key].label}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {pendingOutcome && (
        <OutcomeModal
          outcome={pendingOutcome}
          onConfirm={handleConfirm}
          onCancel={() => setPendingOutcome(null)}
          clientName={ev.contact_name ?? ev.title}
          clientPhone={ev.contact_phone}
        />
      )}
    </div>
  )
}

function PostMeetingModal({
  onConfirm, onCancel, clientName, clientPhone,
}: {
  onConfirm: (outcome: 'altamente_interesado' | 'con_exito_pagada' | 'sin_exito', notes: string, mode?: AltFlowMode, paymentDate?: string) => Promise<void>
  onCancel: () => void
  clientName?: string
  clientPhone?: string
}) {
  const [topChoice, setTopChoice] = useState<'sin_pago' | 'pagada' | 'sin_exito' | null>(null)
  const [altMode, setAltMode] = useState<AltFlowMode>('normal')
  const [paymentDate, setPaymentDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const canConfirm = topChoice !== null && (topChoice !== 'sin_pago' || altMode !== 'fecha_pago' || !!paymentDate)

  const confirm = async () => {
    if (!canConfirm || saving) return
    setSaving(true)
    try {
      if (topChoice === 'sin_pago') {
        await onConfirm('altamente_interesado', notes, altMode, altMode === 'fecha_pago' ? paymentDate : undefined)
      } else if (topChoice === 'pagada') {
        await onConfirm('con_exito_pagada', notes)
      } else {
        await onConfirm('sin_exito', notes)
      }
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.60)', backdropFilter: 'blur(6px)' }}>
      <div className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl" style={{ background: '#ffffff', border: '1px solid #e6e1f0' }}>

        {/* Header */}
        <div className="px-5 py-3.5 flex items-center gap-2.5" style={{ borderBottom: '1px solid #f1f5f9' }}>
          <CheckCircle size={18} className="text-emerald-600 flex-shrink-0" />
          <div>
            <p className="font-bold text-sm" style={{ color: '#130d26' }}>Resultado de la reunión</p>
            <p className="text-[11px]" style={{ color: '#64748b' }}>¿Cómo terminó?</p>
          </div>
        </div>

        {/* Cliente al que se le marca el resultado */}
        {clientName && (
          <div className="px-5 py-2.5 flex items-center gap-2.5" style={{ background: '#faf9fd', borderBottom: '1px solid #f1f5f9' }}>
            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-black text-white" style={{ background: '#6366f1' }}>
              {clientName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold truncate" style={{ color: '#130d26' }}>{clientName}</p>
              <p className="text-[10px]" style={{ color: '#64748b' }}>{clientPhone ? `${clientPhone} · ` : ''}Estás registrando el resultado de la reunión con este cliente</p>
            </div>
          </div>
        )}

        <div className="px-4 pt-3 pb-4 space-y-3">
          {/* Top-level choice — 3 botones */}
          <div className="grid grid-cols-3 gap-2">
            {([
              { key: 'sin_pago'   as const, label: 'Con éxito\nsin pago',  bg: '#f0fdf4', border: '#4ade80', textColor: '#14532d', activeColor: '#15803d' },
              { key: 'pagada'     as const, label: 'Con éxito\npagada',    bg: '#f0f9ff', border: '#38bdf8', textColor: '#0c4a6e', activeColor: '#0369a1' },
              { key: 'sin_exito'  as const, label: 'Sin éxito',            bg: '#fff1f2', border: '#fca5a5', textColor: '#7f1d1d', activeColor: '#dc2626' },
            ] as const).map(opt => {
              const active = topChoice === opt.key
              return (
                <button key={opt.key} onClick={() => setTopChoice(opt.key)}
                  className="flex flex-col items-center justify-center gap-1 px-3 py-3 rounded-xl text-center transition-all"
                  style={{
                    background: active ? opt.bg : '#faf9fd',
                    border: `2px solid ${active ? opt.border : '#e6e1f0'}`,
                    boxShadow: active ? `0 0 0 3px ${opt.border}30` : 'none',
                  }}>
                  <span className="flex-shrink-0"
                    style={{ width: 16, height: 16, borderRadius: '50%', border: `2.5px solid ${active ? opt.activeColor : '#94a3b8'}`, background: active ? opt.activeColor : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {active && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', display: 'block' }} />}
                  </span>
                  <p className="text-xs font-bold whitespace-pre-line leading-tight" style={{ color: active ? opt.textColor : '#1e293b' }}>{opt.label}</p>
                </button>
              )
            })}
          </div>

          {/* Sub-options for "sin pago" */}
          {topChoice === 'sin_pago' && (
            <div className="rounded-xl overflow-hidden" style={{ border: '1.5px solid #e6e1f0' }}>
              {ALT_MODES.map((m, i) => {
                const active = altMode === m.key
                return (
                  <button key={m.key} onClick={() => setAltMode(m.key)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-all"
                    style={{
                      background: active ? m.dimColor : (i % 2 === 0 ? '#fafafa' : '#ffffff'),
                      borderBottom: i < ALT_MODES.length - 1 ? '1px solid #f1f5f9' : 'none',
                    }}>
                    <span className="flex-shrink-0" style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${active ? m.color : '#94a3b8'}`, background: active ? m.color : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {active && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff', display: 'block' }} />}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold leading-tight" style={{ color: active ? m.textColor : '#1e293b' }}>{m.label}</p>
                      <p className="text-[10px]" style={{ color: active ? m.color : '#94a3b8' }}>{m.desc}</p>
                    </div>
                  </button>
                )
              })}
              {altMode === 'fecha_pago' && (
                <div className="px-3 py-2" style={{ background: 'rgba(251,146,60,0.05)', borderTop: '1px solid rgba(251,146,60,0.25)' }}>
                  <label className="text-[10px] font-bold uppercase tracking-widest block mb-1" style={{ color: '#c2650a' }}>Fecha comprometida</label>
                  <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} autoFocus
                    className="w-full text-sm font-semibold bg-transparent focus:outline-none" style={{ color: '#c2650a' }} />
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: '#475569' }}>Notas</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Ej: El cliente confirmó que pagará esta semana..."
              rows={2} className="w-full rounded-xl px-3.5 py-2.5 text-sm resize-none focus:outline-none transition-colors"
              style={{ background: '#faf9fd', border: '1.5px solid #e6e1f0', color: '#1e293b' }} />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-2">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors"
            style={{ background: '#f1f5f9', color: '#64748b', border: '1px solid #e6e1f0' }}>
            Cancelar
          </button>
          <button onClick={confirm} disabled={!canConfirm || saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all"
            style={{ background: canConfirm ? '#15803d' : '#e6e1f0', color: canConfirm ? '#fff' : '#94a3b8', border: 'none' }}>
            {saving ? 'Guardando...' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function HistorialTable({ items }: { items: any[] }) {
  const [open, setOpen] = useState(false)
  if (!items.length) return null
  return (
    <div className="mt-6">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 bg-surface-1 text-sm font-semibold text-white/70 hover:text-white hover:bg-surface-0 transition-all w-full"
      >
        <ChevronDown size={14} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        <span>Historial (últimas 24h+)</span>
        <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full bg-white/10 text-white/60">{items.length}</span>
      </button>

      {open && (
        <div className="mt-3 rounded-xl overflow-hidden border border-white/[0.07]">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                <th className="text-left px-4 py-2.5 font-bold text-white/45 uppercase tracking-widest text-[10px]">Fecha</th>
                <th className="text-left px-4 py-2.5 font-bold text-white/45 uppercase tracking-widest text-[10px]">Cliente</th>
                <th className="text-left px-4 py-2.5 font-bold text-white/45 uppercase tracking-widest text-[10px]">Reunión</th>
                <th className="text-left px-4 py-2.5 font-bold text-white/45 uppercase tracking-widest text-[10px]">Resultado</th>
                <th className="text-left px-4 py-2.5 font-bold text-white/45 uppercase tracking-widest text-[10px]">Agendó</th>
              </tr>
            </thead>
            <tbody>
              {items.map((ev, i) => {
                const isExitoso = ev.vendor_status === 'altamente_interesado'
                const isNoShow = ev.vendor_status === 'no_show'
                return (
                  <tr key={ev.id}
                    style={{
                      background: i % 2 === 0 ? 'var(--surface-2)' : 'transparent',
                      borderBottom: '1px solid var(--border)',
                    }}>
                    <td className="px-4 py-2.5 text-white/55 whitespace-nowrap">
                      {format(new Date(ev.start_time), "d MMM yyyy HH:mm", { locale: es })}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[9px] font-bold text-white/70 flex-shrink-0">
                          {ev.contact_name?.charAt(0)?.toUpperCase() ?? '?'}
                        </div>
                        <span className="font-semibold text-white/80 truncate max-w-[120px]">{ev.contact_name ?? '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-white/60 truncate max-w-[140px] block">{ev.title}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        isExitoso ? 'bg-lime/15 text-lime' : isNoShow ? 'bg-warn/15 text-warn' : 'bg-danger/15 text-danger'
                      }`}>
                        {isExitoso ? <ThumbsUp size={9} /> : isNoShow ? <WifiOff size={9} /> : <XCircle size={9} />}
                        {isExitoso ? 'Exitoso' : isNoShow ? 'No conectó' : 'Sin éxito'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-white/40">{ev.creator_name ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function VendorPipeline() {
  const [pipeline, setPipeline] = useState<any>(null)
  const [loading, setLoading]   = useState(true)
  const [selectedEvent, setSelectedEvent] = useState<any>(null)
  const [showModal, setShowModal]         = useState(false)
  const [otLead, setOtLead] = useState<{ id: number; honorarios: number } | null>(null)
  const skipOTClose = useRef(false)
  // OT from reunion outcome: after OT saved → mark the outcome + optional stage move
  const [pendingOTOutcome, setPendingOTOutcome] = useState<{ eventId: number; outcome: string; notes: string; mode?: AltFlowMode; paymentDate?: string } | null>(null)
  // "Comenzar Reunión" flow: OT first, then PostMeetingModal
  const [pendingMeetingStart, setPendingMeetingStart] = useState<{ eventId: number; leadId: number } | null>(null)

  const [vendorLabels, setVendorLabels] = useState<Record<string, string>>(DEFAULT_VENDOR_LABELS)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try { setPipeline(await getVendorPipeline()) }
    catch { toast.error('Error cargando pipeline') }
    finally { if (!silent) setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    getStageLabels().then(labels => setVendorLabels(prev => ({ ...prev, ...labels }))).catch(() => {})
    const id = setInterval(() => load(true), 30000)
    return () => clearInterval(id)
  }, [load])

  useDebouncedRealtime(['lead_update', 'pipeline_refresh', 'calendar_update'], () => load(true))

  const handleMark = async (id: number, status: string, notes?: string) => {
    await updateVendorStatus(id, status, notes)
    await load(true)
  }

  const handleBeginMeeting = (eventId: number, leadId: number, honorarios: number, hasOT?: boolean) => {
    setPendingMeetingStart({ eventId, leadId })
    // OT ya existe → directo al modal de resultado; si no, OT primero
    if (!hasOT) setOtLead({ id: leadId, honorarios })
  }

  // Si el vendedor creó la OT pero cerró sin marcar el resultado de la reunión,
  // reabrir PostMeetingModal automáticamente para el evento pendiente
  const dismissedReopen = useRef<Set<number>>(new Set())
  useEffect(() => {
    if (!pipeline || pendingMeetingStart || pendingOTOutcome || otLead !== null || showModal) return
    const stagedLeadIds = new Set(
      [
        ...(pipeline.cierre ?? []),
        ...(pipeline.pago_comprometido ?? []),
        ...(pipeline.pago_pendiente ?? []),
        ...(pipeline.pagado_reunion ?? []),
      ].map((l: any) => l.lead_id)
    )
    const ev = (pipeline.espera_cliente ?? []).find((e: any) =>
      e.lead_id && e.has_ot && !e.vendor_status &&
      parseAsUTC(e.start_time).getTime() <= Date.now() &&  // solo si la reunión ya comenzó
      !stagedLeadIds.has(e.lead_id) && !dismissedReopen.current.has(e.id)
    )
    if (ev) setPendingMeetingStart({ eventId: ev.id, leadId: ev.lead_id })
  }, [pipeline, pendingMeetingStart, pendingOTOutcome, otLead, showModal])

  const handlePostMeetingConfirm = async (
    outcome: 'altamente_interesado' | 'con_exito_pagada' | 'sin_exito',
    notes: string,
    mode?: AltFlowMode,
    paymentDate?: string
  ) => {
    const { eventId, leadId } = pendingMeetingStart!
    if (outcome === 'sin_exito') {
      try { await updateVendorStatus(eventId, 'sin_exito', notes || undefined) }
      catch (e: any) { toast.error(e?.response?.data?.detail || 'Error al marcar resultado', { duration: 6000 }) }
      setPendingMeetingStart(null)
      load(true)
      return
    }
    if (outcome === 'altamente_interesado') {
      try { await updateVendorStatus(eventId, 'altamente_interesado', notes || undefined) }
      catch (e: any) { toast.error(e?.response?.data?.detail || 'Error al marcar resultado', { duration: 6000 }) }
      if (mode === 'fecha_pago' || mode === 'pago_hoy') {
        const today = new Date().toISOString().split('T')[0]
        const dateStr = mode === 'fecha_pago' ? paymentDate! : today
        const targetStage = mode === 'pago_hoy' ? 'pago_pendiente' : 'pago_comprometido'
        try {
          await moveLeadStage(leadId, {
            stage: targetStage,
            payment_commitment_date: dateStr,
            notes: mode === 'fecha_pago'
              ? `Pago comprometido para el ${dateStr}${notes ? '. ' + notes : ''}`
              : `Pagará hoy ${dateStr}${notes ? '. ' + notes : ''}`,
          })
          await updateLead(leadId, { payment_commitment_date: dateStr })
          toast.success(mode === 'pago_hoy' ? 'Lead movido a Pago Pendiente' : 'Lead movido a Pago Comprometido')
        } catch (e: any) {
          toast.error(e?.response?.data?.detail || 'No se pudo mover el lead', { duration: 6000 })
        }
      }
    } else {
      // con_exito_pagada → pagado_reunion
      // 1) moveLeadStage primero: crea PaymentVerification + envía WA pagacuotas
      // 2) updateVendorStatus('con_exito_pagada') después: solo actualiza badge del evento
      //    (pagado_reunion NO está en EXITOSO_STAGES → no mueve el lead de nuevo)
      const today = new Date().toISOString().split('T')[0]
      try {
        await moveLeadStage(leadId, { stage: 'pagado_reunion', notes: `Pagado en reunión — validando pago${notes ? '. ' + notes : ''}` })
        await updateLead(leadId, { payment_commitment_date: today })
        toast.success('¡Lead en Validando Pago Reunión — link enviado por WhatsApp!')
      } catch (e: any) {
        toast.error(e?.response?.data?.detail || 'No se pudo completar', { duration: 6000 })
      }
      try { await updateVendorStatus(eventId, 'con_exito_pagada', notes || undefined) }
      catch { toast('El lead avanzó, pero el evento quedó sin badge de resultado', { icon: '⚠️' }) }
    }
    setPendingMeetingStart(null)
    load(true)
  }

  const handleOTRequired = (leadId: number, honorarios: number, outcome: string, notes: string, mode?: AltFlowMode, paymentDate?: string) => {
    const allEvents = [
      ...(pipeline?.espera_cliente ?? []),
      ...(pipeline?.altamente_interesado ?? []),
      ...(pipeline?.con_exito_pagada ?? []),
    ]
    const ev = allEvents.find((e: any) => e.lead_id === leadId)
    if (!ev) return
    setPendingOTOutcome({ eventId: ev.id, outcome, notes, mode, paymentDate })
    setOtLead({ id: leadId, honorarios })
  }

  const handleEdit = (ev: any) => { setSelectedEvent(ev); setShowModal(true) }

  const cierreLeads: any[]        = pipeline?.cierre ?? []
  const pagoLeads: any[]          = pipeline?.pago_comprometido ?? []
  const pagadoReunionLeads: any[] = pipeline?.pagado_reunion ?? []
  const pagoPendienteLeads: any[] = pipeline?.pago_pendiente ?? []
  const sinOTCount = [...cierreLeads, ...pagoLeads].filter((l: any) => !l.has_ot).length
  const totalLeads = cierreLeads.length + pagoLeads.length + pagadoReunionLeads.length

  // Leads already shown in lead columns — hide their calendar events from meeting columns
  const leadIdsWithStage = new Set(
    [...cierreLeads, ...pagoLeads, ...pagadoReunionLeads, ...pagoPendienteLeads].map((l: any) => l.lead_id)
  )
  const normalizePhone = (phone?: string | null) => (phone ?? '').replace(/\D/g, '')
  const meetingCaseKey = (ev: any) => ev.lead_id ? `lead:${ev.lead_id}` : (normalizePhone(ev.contact_phone) ? `phone:${normalizePhone(ev.contact_phone)}` : `event:${ev.id}`)
  const allMeetingEvents: any[] = [
    ...(pipeline?.espera_cliente ?? []),
    ...(pipeline?.altamente_interesado ?? []),
    ...(pipeline?.con_exito_pagada ?? []),
    ...(pipeline?.sin_exito ?? []),
    ...(pipeline?.no_show ?? []),
  ].sort((a: any, b: any) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
  const latestMeetingIds = new Set<number>()
  const seenMeetingCases = new Set<string>()
  allMeetingEvents.forEach((ev: any) => {
    const key = meetingCaseKey(ev)
    if (seenMeetingCases.has(key)) return
    seenMeetingCases.add(key)
    latestMeetingIds.add(ev.id)
  })
  const visibleMeetingItems = (items: any[]) => items.filter((ev: any) => (
    !leadIdsWithStage.has(ev.lead_id) &&
    latestMeetingIds.has(ev.id)
  ))
  const totalEvents: number =
    visibleMeetingItems(pipeline?.espera_cliente ?? []).length +
    visibleMeetingItems(pipeline?.altamente_interesado ?? []).length +
    visibleMeetingItems([...(pipeline?.no_show ?? []), ...(pipeline?.sin_exito ?? [])]).length

  const vl = (k: string) => vendorLabels[k] ?? DEFAULT_VENDOR_LABELS[k]
  const COLS = buildCols(vendorLabels)
  const LEAD_COLS = [
    { key: 'cierre',            label: vl('cierre'),            items: cierreLeads,        accent: '#38bdf8', accentDim: 'rgba(14,165,233,0.12)', border: 'rgba(14,165,233,0.30)' },
    { key: 'pago_comprometido', label: vl('pago_comprometido'), items: pagoLeads,          accent: '#22c55e', accentDim: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.30)' },
    { key: 'pago_pendiente',    label: vl('pago_pendiente'),    items: pagoPendienteLeads, accent: '#0ea5e9', accentDim: 'rgba(14,165,233,0.12)', border: 'rgba(14,165,233,0.30)' },
    { key: 'pagado_reunion',    label: vl('pagado_reunion'),    items: pagadoReunionLeads, accent: '#34d399', accentDim: 'rgba(52,211,153,0.12)', border: 'rgba(52,211,153,0.30)' },
  ]

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-xl font-black text-white tracking-tight">Mi Pipeline</h1>
          <p className="text-xs text-white/62 mt-0.5">
            {totalLeads} lead{totalLeads !== 1 ? 's' : ''} · {totalEvents} reunión{totalEvents !== 1 ? 'es' : ''}
            {sinOTCount > 0 && <span className="ml-2 text-danger font-bold">· {sinOTCount} sin OT</span>}
          </p>
        </div>
        <button onClick={() => load()} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-surface-1 border border-white/10 rounded-xl font-semibold text-sm hover:bg-surface-0 transition-colors shadow-sm">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      {loading && !pipeline ? (
        <div className="flex items-center justify-center flex-1">
          <div className="w-6 h-6 border-2 border-lime border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <KanbanBoard layout="scroll">

          {/* ── En proceso de reunión ── */}
          {(() => {
            const col = COLS[0] // espera_cliente
            const items = visibleMeetingItems((pipeline?.[col.key] as any[]) ?? [])
            return (
              <KanbanColumn key={col.key} title={col.label} count={items.length} color="#f59e0b" width={260} emptyLabel="Sin eventos">
                {items.map((ev: any) => <EventCard key={ev.id} ev={ev} onMark={handleMark} onEdit={ev2 => { setSelectedEvent(ev2); setShowModal(true) }} onOTRequired={handleOTRequired} onOT={(id, hon) => setOtLead({ id, honorarios: hon })} isEsperaCliente onBeginMeeting={handleBeginMeeting} />)}
              </KanbanColumn>
            )
          })()}

          {/* ── Altamente Interesado (Con éxito sin pago) ── */}
          {(() => {
            const col = COLS[1] // altamente_interesado
            const items = visibleMeetingItems((pipeline?.[col.key] as any[]) ?? [])
            return (
              <KanbanColumn key={col.key} title={col.label} count={items.length} color="#84cc16" width={260} emptyLabel="Sin eventos">
                {items.map((ev: any) => <EventCard key={ev.id} ev={ev} onMark={handleMark} onEdit={ev2 => { setSelectedEvent(ev2); setShowModal(true) }} onOTRequired={handleOTRequired} onOT={(id, hon) => setOtLead({ id, honorarios: hon })} />)}
              </KanbanColumn>
            )
          })()}

          {/* ── Cierre + Pago Comprometido ── */}
          {LEAD_COLS.map(col => (
            <KanbanColumn key={col.key} title={col.label} count={col.items.length} color={col.accent} width={260} emptyLabel="Sin leads">
              {col.items.map((lead: any) => (
                <LeadPipelineCard key={lead.lead_id} lead={lead} onOT={id => setOtLead({ id, honorarios: lead.honorarios ?? 0 })} />
              ))}
            </KanbanColumn>
          ))}

          {/* ── Sin Éxito / No Conectó ── */}
          {(() => {
            const col = COLS[2] // sin_exito + no_show combinados
            const items = visibleMeetingItems([...(pipeline?.sin_exito ?? []), ...(pipeline?.no_show ?? [])])
            return (
              <KanbanColumn key={col.key} title={col.label} count={items.length} color="#ef4444" width={260} emptyLabel="Sin eventos">
                {items.map((ev: any) => <EventCard key={ev.id} ev={ev} onMark={handleMark} onEdit={ev2 => { setSelectedEvent(ev2); setShowModal(true) }} onOTRequired={handleOTRequired} />)}
              </KanbanColumn>
            )
          })()}

        </KanbanBoard>
      )}

      {pendingMeetingStart && otLead === null && (() => {
        const _pmEv = [
          ...(pipeline?.espera_cliente ?? []),
          ...(pipeline?.altamente_interesado ?? []),
          ...(pipeline?.con_exito_pagada ?? []),
        ].find((e: any) => e.id === pendingMeetingStart.eventId)
        return (
          <PostMeetingModal
            clientName={_pmEv?.contact_name ?? _pmEv?.title}
            clientPhone={_pmEv?.contact_phone}
            onConfirm={handlePostMeetingConfirm}
            onCancel={() => {
              dismissedReopen.current.add(pendingMeetingStart.eventId)
              setPendingMeetingStart(null)
              load(true)
            }}
          />
        )
      })()}

      <HistorialTable items={pipeline?.historial ?? []} />

      {showModal && (
        <EventModal
          event={selectedEvent}
          vendors={[]}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(true) }}
          onDeleted={() => { setShowModal(false); load(true) }}
        />
      )}

      {otLead !== null && (
        <WorkOrderModal
          leadId={otLead.id}
          honorarios={otLead.honorarios}
          autoClose
          onClose={() => {
            if (skipOTClose.current) { skipOTClose.current = false; return }
            setPendingOTOutcome(null)
            setPendingMeetingStart(null)
            setOtLead(null)
            load(true)
          }}
          onSaved={async () => {
            if (pendingMeetingStart) {
              // "Comenzar Reunión" flow: OT done → show PostMeetingModal
              // Flag onClose to be skipped (autoClose fires it 400ms after onSaved)
              skipOTClose.current = true
              setOtLead(null)
              return
            }
            if (pendingOTOutcome) {
              try {
                await updateVendorStatus(pendingOTOutcome.eventId, pendingOTOutcome.outcome, pendingOTOutcome.notes || undefined)
              } catch (e: any) { toast.error(e?.response?.data?.detail || 'Error al marcar resultado', { duration: 6000 }) }
              // Stage move for fecha_pago / pago_hoy after OT confirmed
              const { mode, paymentDate, eventId } = pendingOTOutcome
              const leadId = otLead?.id
              if (leadId && (mode === 'fecha_pago' || mode === 'pago_hoy')) {
                const today = new Date().toISOString().split('T')[0]
                const dateStr = mode === 'fecha_pago' ? paymentDate! : today
                const targetStage = mode === 'pago_hoy' ? 'pago_pendiente' : 'pago_comprometido'
                try {
                  await moveLeadStage(leadId, {
                    stage: targetStage,
                    payment_commitment_date: dateStr,
                    notes: mode === 'fecha_pago'
                      ? `Pago comprometido para el ${dateStr}${pendingOTOutcome.notes ? '. ' + pendingOTOutcome.notes : ''}`
                      : `Pagará hoy ${dateStr}${pendingOTOutcome.notes ? '. ' + pendingOTOutcome.notes : ''}`,
                  })
                  await updateLead(leadId, { payment_commitment_date: dateStr })
                  toast.success(mode === 'pago_hoy' ? 'Lead movido a Pago Pendiente' : 'Lead movido a Pago Comprometido')
                } catch (e: any) {
                  const msg = e?.response?.data?.detail || `No se pudo mover el lead a ${targetStage === 'pago_pendiente' ? 'Pago Pendiente' : 'Pago Comprometido'}`
                  toast.error(msg, { duration: 6000 })
                }
              }
              setPendingOTOutcome(null)
            }
            setOtLead(null)
            load(true)
          }}
        />
      )}
    </div>
  )
}
