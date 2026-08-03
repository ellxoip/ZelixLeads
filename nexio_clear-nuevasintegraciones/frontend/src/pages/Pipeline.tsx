import { useState, useEffect, useCallback, useRef } from 'react'
import { getPipelineSummary, getGroups, moveLeadStage, getStageLabels, getPipelineStages, getAgendadoraFollowup, getLead, getAllAreas, getUsers, deleteLead, getInactiveLeads, getLeads } from '../api'
import { apiUrl } from '../api/client'
import { useRealtime } from '../contexts/RealtimeContext'
import { useDebouncedRealtime } from '../hooks/useDebouncedRealtime'
import type { Lead, Group, PaymentVerification } from '../types'
import { STAGE_LABELS } from '../types'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import {
  RefreshCw, FileText, AlertTriangle, Lock,
  Loader2, ChevronDown, ChevronRight, X, ArrowRight, Info, Clock,
  WifiOff, XCircle, CalendarPlus, Search, ClipboardList, MessageSquare, User, Trash2, RotateCcw, CalendarClock,
  LayoutGrid, Rows3, Hourglass, Eye
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/auth'
import VerifyModal from '../components/VerifyModal'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

import { MoveLeadModal, MAIN_STAGES, RECOVERY_STAGES } from '../components/MoveLeadModal'
import { WorkOrderModal } from '../components/WorkOrderModal'
import { NEXT_STAGE, PREV_STAGE, STAGE_PALETTE, getStagePalette, NEXT_ACTION, ADVANCE_NEEDS_MODAL } from '../lib/stages'
import { openLeadDrawer } from '../lib/leadDrawerBus'
import { onLeadChanged } from '../lib/leadEvents'
import KanbanColumn from '../components/kanban/KanbanColumn'
import KanbanBoard from '../components/kanban/KanbanBoard'
const COL_LIMIT       = 10

// NEXT_STAGE / PREV_STAGE / STAGE_PALETTE / getStagePalette / NEXT_ACTION viven
// ahora en la fuente única `../lib/stages` (ver import al inicio del archivo).

const COL_STYLE: Record<string, { dot: string; accent: string; count: string }> = {
  lead:                 { dot: 'bg-green-400',   accent: 'border-l-green-400',   count: 'bg-surface-2 text-white' },
  reunion:              { dot: 'bg-orange-400',  accent: 'border-l-orange-400',  count: 'bg-surface-2 text-white' },
  altamente_interesado: { dot: 'bg-blue-400',    accent: 'border-l-blue-400',    count: 'bg-surface-2 text-white' },
  cierre:               { dot: 'bg-brand-400',  accent: 'border-l-violet-400',  count: 'bg-surface-2 text-white' },
  pago_pendiente:       { dot: 'bg-amber-400',   accent: 'border-l-amber-400',   count: 'bg-surface-2 text-white' },
  pago_comprometido:    { dot: 'bg-red-400',     accent: 'border-l-red-400',     count: 'bg-surface-2 text-white' },
  pagado_reunion:       { dot: 'bg-orange-300',  accent: 'border-l-orange-300',  count: 'bg-surface-2 text-white' },
  pagado_confirmado:    { dot: 'bg-teal-400',    accent: 'border-l-teal-400',    count: 'bg-surface-2 text-white' },
  recuperacion_lead:    { dot: 'bg-danger',      accent: 'border-l-danger',      count: 'bg-surface-2 text-white' },
  recuperacion_reunion: { dot: 'bg-danger',      accent: 'border-l-danger',      count: 'bg-surface-2 text-white' },
  recuperacion_cierre:  { dot: 'bg-danger',      accent: 'border-l-danger',      count: 'bg-surface-2 text-white' },
  recuperacion_pago:    { dot: 'bg-danger',      accent: 'border-l-danger',      count: 'bg-surface-2 text-white' },
  papelera:             { dot: 'bg-gray-500',    accent: 'border-l-gray-500',    count: 'bg-surface-2 text-white' },
}

function fmt(n: number) { return `$${Math.round(n).toLocaleString('es-CL')}` }

const CARD_ACCENT: Record<string, { border: string }> = Object.fromEntries(
  Object.entries(STAGE_PALETTE).map(([stage, { hex }]) => [stage, { border: hex }])
)

/* ──────────────────── LeadCard ──────────────────── */
function LeadCard({ lead, canMove, showGroup, labels, canConfirmPago, onMoved, userRole, highlightSinOT }: {
  lead: Lead; canMove: boolean; showGroup: boolean
  labels: Record<string, string>
  canConfirmPago: boolean
  onMoved: (updated: Lead) => void
  userRole?: string
  highlightSinOT?: boolean
}) {
  const [showMoveModal, setShowMoveModal] = useState<{ target: string } | null>(null)
  const [showViewModal, setShowViewModal] = useState(false)
  // El Drawer se abre por el bus global (LeadDrawerHost en el Layout): sobrevive
  // a las recargas del tablero (SSE lead_update). Antes vivía en el estado local
  // de la carta y cualquier re-render del Pipeline lo cerraba a mitad de proceso.
  const openDrawer = (tab: 'resumen' | 'chat' | 'agenda' = 'resumen') => { openLeadDrawer(lead.id, tab) }
  const [showOTModal, setShowOTModal] = useState(false)
  const [deleteClicks, setDeleteClicks] = useState(0)
  const [showPapeleraConfirm, setShowPapeleraConfirm] = useState(false)
  const navigate = useNavigate()
  const nextStage = NEXT_STAGE[lead.current_stage]
  const prevStage = PREV_STAGE[lead.current_stage]

  const isAgendadora = userRole === 'agendadora'
  // Agendadoras cannot advance a lead that is in 'reunion' — only the vendor can do that
  const blockedAdvance = isAgendadora && lead.current_stage === 'reunion'
  // Lead atascado en 'reunion' sin reunión agendada (evento borrado / nunca creado):
  // el vendedor no tiene dónde registrar el resultado, así que ofrecemos reagendar
  // en vez del candado "Esperando resultado del vendedor" que da falsa calma.
  const reunionSinAgenda = lead.current_stage === 'reunion' && lead.has_reunion_scheduled === false

  const canShowArrow = canMove && nextStage && (nextStage !== 'pagado_confirmado' || canConfirmPago || lead.current_stage === 'pagado_reunion') && !blockedAdvance
  const canShowBack  = canMove && prevStage

  const isPaid           = lead.current_stage === 'pagado_confirmado'
  const isPagadoReunion  = lead.current_stage === 'pagado_reunion'
  const isRec     = lead.current_stage.startsWith('recuperacion')
  const isClosing = lead.current_stage === 'cierre' || lead.current_stage === 'pago_comprometido' || isPagadoReunion
  const isReunion = lead.current_stage === 'reunion'
  const isAlt     = lead.current_stage === 'altamente_interesado'

  // Stage-based color palette — unique per stage
  const _sp = getStagePalette(lead.current_stage)
  const palette = { bg: _sp.bg, border: _sp.border, accent: _sp.accent, avatarBg: _sp.countBg, avatarColor: _sp.accent, tagBg: _sp.countBg, tagColor: _sp.accent }

  const handleMove = async (stage: string, paymentDate?: string) => {
    try {
      const updated = await moveLeadStage(lead.id, { stage, ...(paymentDate ? { payment_commitment_date: paymentDate } : {}) })
      onMoved(updated)
      window.dispatchEvent(new CustomEvent('lead-stage-changed'))
      toast.success(`Movido a ${labels[stage] ?? stage}`)
      setShowMoveModal(null)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Error al mover')
    }
  }

  // Avance de 1 clic. Si la etapa destino requiere datos extra que solo el modal
  // captura (p. ej. fecha comprometida) se abre el modal directamente. Para el
  // resto se intenta mover de inmediato; si el backend pide algo que el modal
  // puede resolver, se abre el modal como fallback (nunca se salta una guarda).
  const [advancing, setAdvancing] = useState(false)
  const handleAdvance = async () => {
    if (!nextStage || advancing) return
    if (ADVANCE_NEEDS_MODAL.has(nextStage)) { setShowMoveModal({ target: nextStage }); return }
    setAdvancing(true)
    try {
      const updated = await moveLeadStage(lead.id, { stage: nextStage })
      onMoved(updated)
      window.dispatchEvent(new CustomEvent('lead-stage-changed'))
      toast.success(`Movido a ${labels[nextStage] ?? nextStage}`)
    } catch (err: any) {
      const detail = err?.response?.data?.detail || 'Error al mover'
      // El backend pide una fecha que el modal sí puede capturar → abrir modal.
      if (/fecha|comprometid/i.test(detail)) setShowMoveModal({ target: nextStage })
      else toast.error(detail)
    } finally {
      setAdvancing(false)
    }
  }

  const handleVerClick = (_e: React.MouseEvent) => {
    // Siempre navega al detalle del lead — el modal de verificación de pago ya no se usa aquí.
  }

  const daysIn = lead.created_at
    ? Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 86400000)
    : 0

  const isHot  = daysIn >= 5
  const isWarm = daysIn >= 2 && daysIn < 5

  // Recency badge: based on updated_at (stage changes, edits) or created_at
  const recencyTs  = lead.updated_at ?? lead.created_at
  const recencyMs  = recencyTs ? Date.now() - new Date(recencyTs).getTime() : Infinity
  const recencyMins = Math.floor(recencyMs / 60000)
  const isNew      = recencyMs < 3600000 * 3   // < 3h
  const isRecent   = !isNew && recencyMs < 86400000  // < 1d
  const recencyLabel = recencyMins < 60
    ? `hace ${recencyMins}m`
    : recencyMins < 1440
      ? `hace ${Math.floor(recencyMins/60)}h`
      : `hace ${Math.floor(recencyMins/1440)}d`

  const priorityColor = lead.priority === 'high' ? '#dc2626' : lead.priority === 'normal' ? '#60a5fa' : 'var(--text-muted)'

  const AVATAR_COLORS = [
    { bg: 'rgba(53,122,14,0.12)',  fg: 'var(--zx-accent-text)' },
    { bg: 'rgba(53,122,14,0.12)', fg: 'var(--zx-accent-text)' },
    { bg: 'rgba(8,145,178,0.12)',  fg: '#0891b2' },
    { bg: 'rgba(5,150,105,0.12)',  fg: '#059669' },
    { bg: 'rgba(217,119,6,0.12)',  fg: '#d97706' },
    { bg: 'rgba(220,38,38,0.12)',  fg: '#dc2626' },
  ]
  const avatarColor = AVATAR_COLORS[(lead.contact?.name?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length]

  const ca = lead.last_vendor_outcome === 'no_show'
    ? { border: '#f59e0b' }
    : (CARD_ACCENT[lead.current_stage] ?? CARD_ACCENT.lead)

  const needsOT = lead.current_stage === 'cierre' && !lead.has_ot
  const effectiveBorder = needsOT ? '#e11d48' : ca.border

  // Acción sugerida: qué toca hacer ahora con este lead, de un vistazo.
  // Se oculta cuando otra señal ya cubre el "qué hacer" (esperando vendedor,
  // pagado/confirmado, papelera) para no saturar la tarjeta.
  const suggestedAction = reunionSinAgenda
    ? 'Reagendar reunión'
    : needsOT ? 'Crear Orden de Trabajo (OT)' : NEXT_ACTION[lead.current_stage]
  // La acción sugerida se oculta cuando el vendedor tiene el turno (blockedAdvance),
  // salvo que la reunión esté sin agenda: ahí sí hay algo accionable (reagendar).
  const showSuggested = !!suggestedAction && !isPaid && lead.current_stage !== 'papelera'
    && (!blockedAdvance || reunionSinAgenda)

  return (
    <>
      <div className="group rounded-xl overflow-hidden transition-all duration-200"
        style={{
          background: '#ffffff',
          border: '1px solid #e6e1f0',
          borderLeft: `3px solid ${effectiveBorder}`,
          boxShadow: needsOT ? '0 0 0 2px rgba(225,29,72,0.18), 0 1px 4px rgba(0,0,0,0.06)' : '0 1px 4px rgba(0,0,0,0.06)',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 14px rgba(0,0,0,0.10)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = needsOT ? '0 0 0 2px rgba(225,29,72,0.18), 0 1px 4px rgba(0,0,0,0.06)' : '0 1px 4px rgba(0,0,0,0.06)'; (e.currentTarget as HTMLElement).style.transform = 'none' }}>

        {/* ── Top: special badge + priority + status badges ── */}
        <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
          {isPagadoReunion ? (
            <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full flex items-center gap-1"
              style={{ background: 'rgba(249,115,22,0.12)', color: '#ea580c', border: '1px solid rgba(249,115,22,0.30)' }}>
              <Hourglass size={9} /> Validando Pago Reunión
            </span>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-1.5 ml-auto">
            {!isPaid && (
              <button
                onClick={e => { e.stopPropagation(); setShowPapeleraConfirm(true) }}
                title="Enviar a papelera"
                className="danger-action flex items-center gap-1 px-1.5 py-0.5 rounded-lg transition-all text-[9px] font-semibold"
                style={{ background: 'rgba(107,114,128,0.08)', color: 'rgba(28,22,51,0.35)', border: '1px solid rgba(107,114,128,0.15)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.08)'; (e.currentTarget as HTMLElement).style.color = '#ef4444'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(239,68,68,0.25)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(107,114,128,0.08)'; (e.currentTarget as HTMLElement).style.color = 'rgba(28,22,51,0.35)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(107,114,128,0.15)' }}>
                <Trash2 size={9} />
              </button>
            )}
            {lead.priority === 'high' && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: 'rgba(220,38,38,0.10)', color: '#dc2626' }}>
                ↑ Alta
              </span>
            )}
            {needsOT && (
              <span className="flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: 'rgba(225,29,72,0.12)', color: '#e11d48' }}>
                <ClipboardList size={8} /> Sin OT
              </span>
            )}
            {isNew && (
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full animate-pulse"
                style={{ background: '#dcfce7', color: '#15803d', border: '1px solid #86efac' }}>
                NUEVO
              </span>
            )}
            {isRecent && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe' }}>
                {recencyLabel}
              </span>
            )}
            <span className="flex items-center gap-0.5 text-[9px] font-semibold"
              style={{ color: isHot ? '#dc2626' : isWarm ? '#d97706' : 'rgba(28,22,51,0.40)' }}>
              <Clock size={8} />
              {daysIn}d
            </span>
          </div>
        </div>

        <div className="px-3 pb-3 space-y-2.5">
          {/* ── Avatar + Name (click → detalle del lead) + Arrow ── */}
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={() => openDrawer('resumen')} title="Ver detalle del lead"
              className="flex items-center gap-2.5 min-w-0 flex-1 text-left group/detail">
              <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm"
                style={{ background: avatarColor.bg, color: avatarColor.fg }}>
                {lead.contact?.name?.charAt(0)?.toUpperCase() ?? '?'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-sm leading-tight truncate group-hover/detail:underline" style={{ color: '#1c1633' }}>
                  {lead.contact?.name ?? '—'}
                </p>
                <p className="text-[10px] truncate mt-0.5 font-medium" style={{ color: 'rgba(28,22,51,0.48)' }}>
                  {lead.area?.name ?? '—'}
                  {showGroup && lead.group?.name && (
                    <span style={{ color: palette.accent }}> · {lead.group.name}</span>
                  )}
                </p>
              </div>
            </button>
            {canShowArrow ? (
              <button onClick={handleAdvance}
                onContextMenu={e => { e.preventDefault(); setShowMoveModal({ target: nextStage }) }}
                disabled={advancing}
                title={`Avanzar a ${labels[nextStage] || nextStage} · clic derecho para más opciones`}
                className="danger-action flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all disabled:opacity-60"
                style={{
                  background: nextStage === 'pagado_confirmado' ? 'rgba(163,230,53,0.15)' : 'var(--surface-3)',
                  color: nextStage === 'pagado_confirmado' ? '#a3e635' : 'var(--text-muted)',
                  border: `1px solid ${nextStage === 'pagado_confirmado' ? 'rgba(163,230,53,0.30)' : 'var(--border)'}`,
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = nextStage === 'pagado_confirmado' ? 'rgba(163,230,53,0.28)' : 'var(--surface-4)'; (e.currentTarget as HTMLElement).style.color = nextStage === 'pagado_confirmado' ? '#a3e635' : 'var(--text)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = nextStage === 'pagado_confirmado' ? 'rgba(163,230,53,0.15)' : 'var(--surface-3)'; (e.currentTarget as HTMLElement).style.color = nextStage === 'pagado_confirmado' ? '#a3e635' : 'var(--text-muted)' }}>
                {advancing ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
              </button>
            ) : blockedAdvance ? (
              /* Locked — waiting for vendor result */
              <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
                title="Esperando resultado del vendedor"
                style={{ background: 'rgba(255,166,0,0.10)', border: '1px solid rgba(255,166,0,0.25)', color: '#ffa600' }}>
                <Lock size={11} />
              </div>
            ) : lead.current_stage === 'pago_comprometido' || lead.current_stage === 'pagado_confirmado' ? null : (
              <button type="button" onClick={() => openDrawer('resumen')} title="Ver detalle del lead"
                className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                style={{ background: 'var(--surface-3)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text)'; (e.currentTarget as HTMLElement).style.background = 'var(--surface-4)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)' }}>
                <Eye size={12} />
              </button>
            )}
          </div>

          {/* ── Phone → contacto en 1 clic (abre el Chat en contexto) ── */}
          {lead.contact?.phone && (
            <button type="button" onClick={() => openDrawer('chat')}
              title="Contactar por WhatsApp (abre el chat en contexto)"
              className="group/phone flex items-center gap-1.5 text-[10px] font-mono truncate transition-colors"
              style={{ color: 'rgba(28,22,51,0.45)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#16a34a' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(28,22,51,0.45)' }}>
              <MessageSquare size={10} className="flex-shrink-0" />
              <span className="truncate">{lead.contact.phone}</span>
            </button>
          )}

          {/* ── Acción sugerida (accionable en 1 clic) ──
              Agendar/Reagendar reunión deriva DIRECTO al panel de Nueva Reunión
              (Drawer + EventModal con disponibilidad del vendedor). El resto de
              etapas abre el Drawer en Resumen, donde vive el botón Avanzar con
              todas sus cascadas. */}
          {showSuggested && (
            <button type="button"
              onClick={() => openDrawer(/reuni/i.test(suggestedAction) && (reunionSinAgenda || ['lead', 'recuperacion_lead', 'recuperacion_reunion'].includes(lead.current_stage)) ? 'agenda' : 'resumen')}
              className="danger-action w-full flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-all cursor-pointer"
              style={{ background: `${effectiveBorder}0f`, border: `1px solid ${effectiveBorder}33` }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${effectiveBorder}22`; (e.currentTarget as HTMLElement).style.borderColor = `${effectiveBorder}66` }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = `${effectiveBorder}0f`; (e.currentTarget as HTMLElement).style.borderColor = `${effectiveBorder}33` }}
              title={suggestedAction}>
              <ArrowRight size={11} style={{ color: effectiveBorder, flexShrink: 0 }} />
              <span className="text-[10px] font-bold truncate" style={{ color: effectiveBorder }}>
                {suggestedAction}
              </span>
            </button>
          )}

          {/* ── Fecha compromiso de pago: chip fecha + badge cuenta regresiva ── */}
          {lead.payment_commitment_date ? (() => {
            const d = new Date(lead.payment_commitment_date + 'T00:00:00')
            const today = new Date(); today.setHours(0,0,0,0)
            const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000)
            const isToday    = diffDays === 0
            const isTomorrow = diffDays === 1
            const isOverdue  = diffDays < 0
            const badgeLabel = isOverdue ? `Vencido ${Math.abs(diffDays)}d`
              : isToday ? 'Hoy'
              : isTomorrow ? 'Mañana'
              : `En ${diffDays}d`
            const badgeBg    = isOverdue ? '#fee2e2' : isToday ? '#ffedd5' : isTomorrow ? '#fef9c3' : '#dcfce7'
            const badgeColor = isOverdue ? '#dc2626' : isToday ? '#c2410c' : isTomorrow ? '#a16207' : '#15803d'
            const badgeBorder= isOverdue ? '#fca5a5' : isToday ? '#fdba74' : isTomorrow ? '#fde047' : '#86efac'
            const dateStr = d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }).replace('.', '')
            return (
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 min-w-0"
                  style={{ background: '#faf9fd', border: '1px solid #e6e1f0' }}>
                  <CalendarClock size={12} style={{ color: 'rgba(28,22,51,0.50)', flexShrink: 0 }} />
                  <span className="text-[11px] font-semibold truncate" style={{ color: 'rgba(28,22,51,0.75)' }}>
                    Paga el {dateStr}
                  </span>
                </div>
                <span className="flex-shrink-0 text-[10px] font-bold px-2 py-1 rounded-full"
                  style={{ background: badgeBg, color: badgeColor, border: `1px solid ${badgeBorder}` }}>
                  {badgeLabel}
                </span>
              </div>
            )
          })() : lead.current_stage === 'pago_comprometido' && (
            <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
              style={{ background: '#fffbeb', border: '1px dashed #fde68a' }}>
              <CalendarClock size={12} style={{ color: '#b45309', flexShrink: 0 }} />
              <span className="text-[10px] font-bold" style={{ color: '#b45309' }}>
                Sin fecha de pago — asignar
              </span>
            </div>
          )}

          {/* ── No se conectó: badge naranja prominente ── */}
          {lead.last_vendor_outcome === 'no_show' && (
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
              style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.28)' }}>
              <WifiOff size={10} style={{ color: '#f59e0b', flexShrink: 0 }} />
              <span className="text-[9px] font-bold" style={{ color: '#f59e0b' }}>
                No se conectó — pendiente reagendar
              </span>
            </div>
          )}

          {/* ── Reunión sin agenda: lead atascado, ofrecer reagendar/devolver ── */}
          {reunionSinAgenda ? (
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)' }}>
              <CalendarClock size={10} style={{ color: '#ef4444', flexShrink: 0 }} />
              <span className="text-[9px] font-bold" style={{ color: '#ef4444' }}>
                Reunión sin agenda — reagendar o devolver
              </span>
            </div>
          ) : blockedAdvance && (
            /* ── Bloqueado: esperando resultado del vendedor ── */
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
              style={{ background: 'rgba(255,166,0,0.08)', border: '1px solid rgba(255,166,0,0.20)' }}>
              <Lock size={10} style={{ color: '#ffa600', flexShrink: 0 }} />
              <span className="text-[9px] font-bold" style={{ color: '#ffa600' }}>
                Esperando resultado del vendedor
              </span>
            </div>
          )}

          {/* ── Financiero — siempre visible ── */}
          <div className="pt-2 space-y-1.5 rounded-lg px-2.5 py-2"
            style={{ background: '#faf9fd', border: `1px solid #e6e1f0` }}>

            {/* Honorarios */}
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'rgba(28,22,51,0.42)' }}>
                Honorarios
              </span>
              {lead.honorarios > 0 ? (
                <span className="text-[12px] font-black" style={{ color: palette.accent }}>
                  {fmt(lead.honorarios)}
                </span>
              ) : (
                <span className="text-[9px] italic" style={{ color: 'rgba(28,22,51,0.35)' }}>Sin definir</span>
              )}
            </div>

            {/* Cuotas */}
            {lead.honorarios > 0 && lead.num_cuotas > 1 ? (
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'rgba(28,22,51,0.42)' }}>
                  {lead.num_cuotas} cuotas de
                </span>
                <span className="text-[10px] font-bold" style={{ color: '#1c1633' }}>
                  {fmt(lead.monto_cuota)}
                </span>
              </div>
            ) : lead.honorarios > 0 ? (
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'rgba(28,22,51,0.42)' }}>
                  Pago
                </span>
                <span className="text-[9px] font-semibold" style={{ color: 'rgba(28,22,51,0.60)' }}>
                  Único
                </span>
              </div>
            ) : null}

            {/* Cuota inicial distinta */}
            {lead.honorarios > 0 && lead.num_cuotas > 1 && lead.cuota_inicial > 0 && lead.cuota_inicial !== lead.monto_cuota && (
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'rgba(28,22,51,0.42)' }}>
                  Cuota inicial
                </span>
                <span className="text-[10px] font-bold" style={{ color: '#1c1633' }}>
                  {fmt(lead.cuota_inicial)}
                </span>
              </div>
            )}

            {/* Descripción del servicio */}
            {lead.service_description && (
              <p className="text-[9px] leading-relaxed mt-0.5 line-clamp-2"
                style={{ color: 'rgba(28,22,51,0.48)' }}>
                {lead.service_description}
              </p>
            )}

            {/* Fuente */}
            {lead.source && (
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'rgba(28,22,51,0.40)' }}>
                  Fuente
                </span>
                <span className="text-[9px] capitalize font-semibold" style={{ color: 'rgba(28,22,51,0.60)' }}>
                  {lead.source}
                </span>
              </div>
            )}
          </div>

          {/* ── Hover actions ── */}
          <div className="hidden group-hover:flex items-center gap-1 pt-2 mt-1"
            style={{ borderTop: '1px solid #e6e1f0' }}>
            <button onClick={() => openDrawer('chat')}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
              style={{ background: '#faf9fd', color: 'rgba(28,22,51,0.60)', border: '1px solid #e6e1f0' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = palette.tagBg; (e.currentTarget as HTMLElement).style.color = palette.tagColor }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#faf9fd'; (e.currentTarget as HTMLElement).style.color = 'rgba(28,22,51,0.60)' }}>
              <MessageSquare size={11} /> Chat
            </button>
            <Link to={`/leads/${lead.id}`} onClick={handleVerClick}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
              style={{ background: '#faf9fd', color: 'rgba(28,22,51,0.60)', border: '1px solid #e6e1f0' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#efecf6'; (e.currentTarget as HTMLElement).style.color = '#1c1633' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#faf9fd'; (e.currentTarget as HTMLElement).style.color = 'rgba(28,22,51,0.60)' }}>
              <User size={11} /> Lead
            </Link>
            {canShowBack && (
              <button onClick={() => setShowMoveModal({ target: prevStage })}
                className="danger-action flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
                style={{ background: '#faf9fd', color: 'rgba(28,22,51,0.55)', border: '1px solid #e6e1f0' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#efecf6'; (e.currentTarget as HTMLElement).style.color = '#1c1633' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#faf9fd'; (e.currentTarget as HTMLElement).style.color = 'rgba(28,22,51,0.55)' }}>
                <ChevronDown size={11} className="rotate-90" /> Retro
              </button>
            )}
            {isPaid && canConfirmPago && (
              <button
                onClick={async () => {
                  const next = deleteClicks + 1
                  setDeleteClicks(next)
                  if (next < 3) {
                    toast(`Confirma ${3 - next} vez${next === 2 ? '' : 'es'} más para archivar`, { icon: '⚠️' })
                  } else {
                    setDeleteClicks(0)
                    try {
                      const updated = await moveLeadStage(lead.id, { stage: 'papelera', notes: 'Archivado por verificador' })
                      onMoved(updated)
                      window.dispatchEvent(new CustomEvent('lead-stage-changed'))
                      toast.success('Lead enviado a papelera')
                    } catch (e: any) { toast.error(e?.response?.data?.detail || 'Error') }
                  }
                }}
                className="danger-action flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[10px] font-semibold transition-all"
                style={{ background: deleteClicks > 0 ? 'rgba(239,68,68,0.12)' : '#faf9fd', color: deleteClicks > 0 ? '#ef4444' : 'rgba(28,22,51,0.45)', border: `1px solid ${deleteClicks > 0 ? 'rgba(239,68,68,0.3)' : '#e6e1f0'}` }}
                title={deleteClicks === 0 ? 'Archivar (3 clics)' : `${3 - deleteClicks} clic${3 - deleteClicks !== 1 ? 's' : ''} más`}>
                <Trash2 size={11} />
              </button>
            )}
          </div>
        </div>
      </div>

      {showMoveModal && (
        <MoveLeadModal
          lead={lead}
          targetStage={showMoveModal.target}
          labels={labels}
          canConfirmPago={canConfirmPago || isPagadoReunion}
          userRole={userRole}
          onConfirm={handleMove}
          onClose={() => setShowMoveModal(null)}
        />
      )}

      {showOTModal && (
        <WorkOrderModal
          leadId={lead.id}
          honorarios={lead.honorarios}
          onClose={() => setShowOTModal(false)}
          onSaved={() => {
            setShowOTModal(false)
            getLead(lead.id).then(updated => onMoved(updated)).catch(() => {})
          }}
        />
      )}

      {showViewModal && (lead as any).payment_verification && (
        <VerifyModal
          pv={(lead as any).payment_verification}
          type="view"
          form={{}}
          setForm={() => {}}
          onConfirm={() => {}}
          onClose={() => setShowViewModal(false)}
        />
      )}

      {showPapeleraConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" style={{ background: '#ffffff', border: '1px solid #e6e1f0' }}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(107,114,128,0.10)' }}>
                <Trash2 size={16} style={{ color: '#6b7280' }} />
              </div>
              <div>
                <p className="font-bold text-sm" style={{ color: '#1c1633' }}>Enviar a papelera</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'rgba(28,22,51,0.55)' }}>{lead.contact?.name ?? 'Este lead'}</p>
              </div>
            </div>
            <div className="px-5 py-4 space-y-2">
              <p className="text-sm" style={{ color: 'rgba(28,22,51,0.75)' }}>
                El lead pasará a la <strong>Papelera</strong> y dejará de aparecer en el pipeline.
              </p>
              <p className="text-xs" style={{ color: 'rgba(28,22,51,0.50)' }}>
                Puedes recuperarlo desde la pestaña Papelera. Si no lo recuperas, se eliminará automáticamente después de <strong>30 días</strong>.
              </p>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
              <button onClick={() => setShowPapeleraConfirm(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors"
                style={{ background: '#faf9fd', color: 'rgba(28,22,51,0.60)', border: '1px solid #e6e1f0' }}>
                Cancelar
              </button>
              <button
                onClick={async () => {
                  setShowPapeleraConfirm(false)
                  try {
                    const updated = await moveLeadStage(lead.id, { stage: 'papelera', notes: 'Enviado a papelera' })
                    onMoved(updated)
                    window.dispatchEvent(new CustomEvent('lead-stage-changed'))
                    toast.success('Lead enviado a papelera')
                  } catch (e: any) { toast.error(e?.response?.data?.detail || 'Error') }
                }}
                className="danger-action flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors"
                style={{ background: '#6b7280', color: '#ffffff' }}>
                Sí, enviar a papelera
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ──────────────────── Column ──────────────────── */
function Column({ stage, leads, stageCount, canMove, showGroup, labels, canConfirmPago, onMoved, userRole, highlightSinOT, onLoadAll }: {
  stage: string; leads: Lead[]; stageCount: number
  canMove: boolean
  showGroup: boolean
  labels: Record<string, string>
  canConfirmPago: boolean
  onMoved: (updated: Lead) => void
  userRole?: string
  highlightSinOT?: boolean
  onLoadAll?: () => Promise<Lead[]>
}) {
  const [expandedLeads, setExpandedLeads] = useState<Lead[]>([])
  const [expanded, setExpanded]           = useState(false)
  const [expanding, setExpanding]         = useState(false)

  const handleExpand = async () => {
    if (!onLoadAll || expanding) return
    setExpanding(true)
    try {
      const all = await onLoadAll()
      setExpandedLeads(all)
      setExpanded(true)
    } catch { /* silent */ }
    finally { setExpanding(false) }
  }

  const displayLeads = expanded ? expandedLeads : leads
  const hidden       = expanded ? 0 : stageCount - leads.length

  const style    = COL_STYLE[stage] ?? COL_STYLE.lead
  const totalHon = displayLeads.reduce((a, l) => a + l.honorarios, 0)
  const isLocked = stage === 'pagado_confirmado' && !canConfirmPago

  const isPaid  = stage === 'pagado_confirmado'
  const isRec   = stage.startsWith('recuperacion')
  const isClose = stage === 'cierre' || stage === 'pago_comprometido'
  const isAlt   = stage === 'altamente_interesado'
  const isReu   = stage === 'reunion'

  // Color base de la etapa — el marco KanbanColumn deriva fondo/borde/contador.
  const colColor = (STAGE_PALETTE[stage] ?? STAGE_PALETTE.lead).hex

  const loadMore = hidden > 0 ? (
    <button
      onClick={handleExpand}
      disabled={expanding}
      className="w-full flex flex-col items-center justify-center py-3 rounded-xl transition-all"
      style={{ background: 'rgba(255,255,255,0.55)', border: '1px dashed #94a3b8', cursor: expanding ? 'wait' : 'pointer' }}
      onMouseEnter={e => { if (!expanding) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.85)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.55)' }}>
      <p className="text-xs font-bold" style={{ color: '#475569' }}>
        {expanding ? 'Cargando...' : `+${hidden} leads más`}
      </p>
      <p className="text-[10px] mt-0.5" style={{ color: '#94a3b8' }}>
        {expanding ? '⋯' : 'Ver todos ↓'}
      </p>
    </button>
  ) : null

  return (
    <KanbanColumn
      title={labels[stage] ?? stage}
      count={stageCount}
      color={colColor}
      subtitle={totalHon > 0 ? fmt(totalHon) : undefined}
      locked={isLocked}
      width={240}
      maxBodyHeight={expanded ? 'none' : 'calc(100vh - 270px)'}
      emptyLabel="Sin leads"
      footer={loadMore}
    >
      {displayLeads.map(l => (
        <LeadCard key={l.id} lead={l} canMove={canMove} showGroup={showGroup} labels={labels} canConfirmPago={canConfirmPago} onMoved={onMoved} userRole={userRole} highlightSinOT={highlightSinOT} />
      ))}
    </KanbanColumn>
  )
}

/* ──────────────────── SeguimientoTab ──────────────────── */
function SeguimientoTab({ items }: { items: any[] }) {
  const navigate                = useNavigate()
  const [sub, setSub]           = useState<'all' | 'no_show' | 'sin_exito'>('all')
  const [search, setSearch]     = useState('')

  const filtered = items.filter(item => {
    if (sub !== 'all' && item.vendor_status !== sub) return false
    if (search) {
      const q = search.toLowerCase()
      if (!item.contact_name?.toLowerCase().includes(q) && !item.vendor_name?.toLowerCase().includes(q) && !item.outcome_note?.toLowerCase().includes(q)) return false
    }
    return true
  })

  const countNo  = items.filter(i => i.vendor_status === 'no_show').length
  const countSin = items.filter(i => i.vendor_status === 'sin_exito').length

  return (
    <div className="space-y-4 flex-1 overflow-y-auto pb-4">
      {/* Sub-filtros + búsqueda */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 rounded-xl p-1"
          style={{ background: 'var(--surface-3)', border: '1px solid var(--border)' }}>
          {([['all','Todos',items.length],['no_show','No se conectó',countNo],['sin_exito','No cerró',countSin]] as ['all'|'no_show'|'sin_exito', string, number][]).map(([val, label, count]) => (
            <button key={val} onClick={() => setSub(val)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
              style={sub === val
                ? { background: 'var(--surface-1)', color: 'var(--primary)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
                : { color: 'var(--text-3)' }}>
              {label}
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{
                  background: sub === val ? 'var(--primary-dim)' : 'var(--surface-4)',
                  color: sub === val ? 'var(--primary)' : 'var(--text-muted)',
                }}>{count}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-[200px] rounded-xl px-3 py-2"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-2)' }}>
          <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar cliente, vendedor, nota..."
            className="flex-1 bg-transparent text-sm focus:outline-none"
            style={{ color: 'var(--text)' }} />
        </div>
      </div>

      {/* Lista */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center rounded-2xl"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <CalendarPlus size={32} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--text-3)' }}>
            {search || sub !== 'all' ? 'Sin resultados para este filtro' : 'Sin reuniones pendientes de reagendar'}
          </p>
          {(!search && sub === 'all') && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Las reuniones marcadas como fallidas por los vendedores aparecen aquí</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((item: any) => {
            const isNoShow   = item.vendor_status === 'no_show'
            const statusClr  = isNoShow ? 'var(--warn)'   : 'var(--danger)'
            const statusDim  = isNoShow ? 'rgba(245,158,11,0.10)' : 'rgba(225,29,72,0.10)'
            const statusBrd  = isNoShow ? 'rgba(245,158,11,0.22)' : 'rgba(225,29,72,0.22)'
            const statusLabel = isNoShow ? 'No se conectó' : 'Se conectó y no cerró'
            const StatusIcon  = isNoShow ? WifiOff : XCircle
            return (
              <div key={item.id} className="rounded-xl p-4 space-y-3 transition-all"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderLeft: `3px solid ${statusClr}`, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>

                {/* Top */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: statusDim, color: statusClr, border: `1px solid ${statusBrd}` }}>
                      <StatusIcon size={12} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-sm truncate" style={{ color: 'var(--text)' }}>{item.contact_name ?? '—'}</p>
                      <p className="text-[10px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>{item.title}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-1 rounded-lg flex-shrink-0"
                    style={{ background: statusDim, color: statusClr, border: `1px solid ${statusBrd}` }}>
                    {statusLabel}
                  </span>
                </div>

                {/* Detalles */}
                <div className="space-y-1 text-[11px]" style={{ color: 'var(--text-3)' }}>
                  <div className="flex items-center gap-2">
                    <span className="w-16 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Vendedor</span>
                    <span className="font-semibold" style={{ color: 'var(--text-2)' }}>{item.vendor_name ?? '—'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-16 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Reunión</span>
                    <span>{format(new Date(item.start_time), "d 'de' MMMM yyyy · HH:mm", { locale: es })}</span>
                  </div>
                  {item.lead_stage && (
                    <div className="flex items-center gap-2">
                      <span className="w-16 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Estado</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                        style={{ background: 'var(--surface-3)', color: 'var(--text-3)' }}>{item.lead_stage}</span>
                    </div>
                  )}
                </div>

                {/* Nota del vendedor */}
                {item.outcome_note && (
                  <div className="rounded-xl px-3 py-2.5"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Nota del vendedor</p>
                    <p className="text-[12px] leading-relaxed italic" style={{ color: 'var(--text-2)' }}>"{item.outcome_note}"</p>
                  </div>
                )}

                {/* Reagendar */}
                <button
                  onClick={() => navigate('/leads', { state: { openLeadId: item.lead_id } })}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-[12px] font-bold transition-all"
                  style={{ background: 'var(--primary-dim)', color: 'var(--primary)', border: '1px solid rgba(53,122,14,0.20)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--primary)'; (e.currentTarget as HTMLElement).style.color = '#fff' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--primary-dim)'; (e.currentTarget as HTMLElement).style.color = 'var(--primary)' }}>
                  <CalendarPlus size={13} /> Reagendar
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ──────────────────── PapeleraTab ──────────────────── */
function PapeleraTab({ leads, count, labels, onRestore, canDelete, onDelete }: {
  leads: Lead[]; count: number; labels: Record<string, string>
  onRestore: (lead: Lead) => void; canDelete: boolean
  onDelete?: (lead: Lead) => void
}) {
  const getDaysLeft = (lead: any) => {
    if (!lead.deleted_at) return 30
    const deletedAt = new Date(lead.deleted_at).getTime()
    const daysElapsed = Math.floor((Date.now() - deletedAt) / (1000 * 60 * 60 * 24))
    return Math.max(0, 30 - daysElapsed)
  }

  return (
    <div className="flex flex-col gap-4 flex-1 rounded-xl p-3" style={{ background: '#f1f5f9' }}>
      {/* Banner info */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
        style={{ background: '#f1f5f9', border: '1px solid #e6e1f0' }}>
        <Trash2 size={15} style={{ color: '#64748b', flexShrink: 0 }} />
        <div>
          <p className="text-sm font-bold" style={{ color: '#1c1633' }}>
            {count} lead{count !== 1 ? 's' : ''} en papelera
          </p>
          <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>
            Se eliminan automáticamente a los 30 días · Solo superadmin puede eliminar definitivamente
          </p>
        </div>
      </div>

      {leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 py-20"
          style={{ color: '#94a3b8' }}>
          <Trash2 size={36} />
          <p className="text-sm font-medium">Papelera vacía</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {leads.map(lead => {
            const daysLeft = getDaysLeft(lead)
            const urgent = daysLeft <= 5
            return (
              <div key={lead.id} className="rounded-xl p-4 flex flex-col gap-3"
                style={{
                  background: '#ffffff',
                  border: `1px solid ${urgent ? 'rgba(239,68,68,0.40)' : '#e6e1f0'}`,
                  boxShadow: '0 2px 8px rgba(28,22,51,0.08)',
                }}>
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate" style={{ color: '#1c1633' }}>
                      {lead.contact?.name ?? 'Sin nombre'}
                    </p>
                    <p className="text-[11px] mt-0.5 truncate font-mono" style={{ color: '#64748b' }}>
                      {lead.contact?.phone ?? '—'}
                    </p>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{
                      background: urgent ? 'rgba(239,68,68,0.12)' : '#f1f5f9',
                      color: urgent ? '#ef4444' : '#64748b',
                    }}>
                    {daysLeft}d
                  </span>
                </div>

                {/* Meta */}
                <div className="flex flex-col gap-1.5">
                  {lead.area?.name && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded self-start"
                      style={{ background: 'rgba(53,122,14,0.12)', color: 'var(--zx-accent-text)' }}>
                      {lead.area.name}
                    </span>
                  )}
                  <p className="text-[11px]" style={{ color: '#64748b' }}>
                    Etapa: <span style={{ color: '#1c1633', fontWeight: 600 }}>
                      {labels[lead.current_stage] ?? lead.current_stage}
                    </span>
                  </p>
                  {lead.agendadora && (
                    <p className="text-[11px]" style={{ color: '#94a3b8' }}>
                      Agendadora: <span style={{ color: '#475569' }}>{lead.agendadora.name}</span>
                    </p>
                  )}
                </div>

                {/* Acciones */}
                <div className="flex gap-2 mt-auto pt-1">
                  <button onClick={() => onRestore(lead)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-bold transition-all"
                    style={{ background: 'rgba(53,122,14,0.15)', color: '#818cf8', border: '1px solid rgba(53,122,14,0.25)' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(53,122,14,0.28)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(53,122,14,0.15)' }}>
                    <RotateCcw size={11} /> Recuperar
                  </button>
                  {onDelete && (
                    <button onClick={() => onDelete(lead)}
                      className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-[11px] font-bold transition-colors"
                      style={{ background: 'rgba(239,68,68,0.10)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.22)' }}
                      title="Eliminar definitivamente">
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ──────────────────── SectionsWarning popup ──────────────────── */
function SectionsWarningPopup({ recCount, segCount, papCount, onGo, onClose }: {
  recCount: number; segCount: number; papCount: number
  onGo: (tab: 'recovery' | 'seguimiento' | 'papelera') => void
  onClose: () => void
}) {
  const items = [
    recCount > 0 && {
      tab: 'recovery' as const, label: 'Recuperación', sub: 'Leads que requieren reactivación',
      count: recCount, color: '#ef4444', bg: 'rgba(239,68,68,0.07)', border: 'rgba(239,68,68,0.18)',
      Icon: RotateCcw,
    },
    segCount > 0 && {
      tab: 'seguimiento' as const, label: 'Seguimiento', sub: 'Compromisos de pago pendientes',
      count: segCount, color: '#f59e0b', bg: 'rgba(245,158,11,0.07)', border: 'rgba(245,158,11,0.18)',
      Icon: Clock,
    },
    papCount > 0 && {
      tab: 'papelera' as const, label: 'Papelera', sub: 'Leads archivados por revisar',
      count: papCount, color: '#64748b', bg: 'rgba(100,116,139,0.07)', border: 'rgba(100,116,139,0.18)',
      Icon: Trash2,
    },
  ].filter(Boolean) as { tab: 'recovery'|'seguimiento'|'papelera'; label: string; sub: string; count: number; color: string; bg: string; border: string; Icon: any }[]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)' }}>
      <div className="rounded-2xl w-full max-w-[360px] overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}>

        {/* Header */}
        <div className="px-6 pt-5 pb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[15px] font-bold text-white leading-tight">Revisión de secciones</p>
            <p className="text-[12px] text-white/40 mt-1">
              {items.length} sección{items.length !== 1 ? 'es' : ''} con actividad pendiente
            </p>
          </div>
          <button onClick={onClose} className="mt-0.5 p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors flex-shrink-0">
            <X size={15} className="text-white/35" />
          </button>
        </div>

        {/* Divider */}
        <div className="border-t border-white/[0.06] mx-6" />

        {/* Items */}
        <div className="px-4 py-3 space-y-2">
          {items.map(({ tab, label, sub, count, color, bg, border, Icon }) => (
            <button key={tab}
              onClick={() => { onGo(tab); onClose() }}
              className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-left transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
              style={{ background: bg, border: `1px solid ${border}` }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${color}18`, border: `1px solid ${color}30` }}>
                <Icon size={14} style={{ color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold leading-tight" style={{ color }}>{label}</p>
                <p className="text-[11px] text-white/38 mt-0.5 truncate">{sub}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-md" style={{ background: `${color}20`, color }}>
                  {count}
                </span>
                <ArrowRight size={12} style={{ color: `${color}80` }} />
              </div>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 pb-4 pt-1">
          <button onClick={onClose}
            className="w-full py-2.5 rounded-xl text-[13px] font-medium text-white/40 hover:text-white/60 hover:bg-white/[0.04] border border-white/[0.07] transition-colors">
            Continuar en Pipeline principal
          </button>
        </div>

      </div>
    </div>
  )
}

/* ──────────────────── InactiveWarning popup ──────────────────── */
function InactiveWarningPopup({ leads, onMoveAll, onClose }: {
  leads: Lead[]; onMoveAll: () => void; onClose: () => void
}) {
  const daysInactive = (l: Lead) => {
    const ts = (l as any).updated_at ?? l.created_at
    if (!ts) return null
    const iso = ts.endsWith('Z') || ts.includes('+') ? ts : ts + 'Z'
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,20,35,0.55)', backdropFilter: 'blur(4px)' }}>
      <div className="rounded-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[80vh]"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border-2)', boxShadow: '0 20px 50px rgba(28,22,51,0.25)' }}>
        <div className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(245,158,11,0.12)' }}>
            <AlertTriangle size={16} className="text-warn" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-sm" style={{ color: 'var(--text)' }}>{leads.length} lead{leads.length > 1 ? 's' : ''} inactivo{leads.length > 1 ? 's' : ''}</p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>Sin actividad por más de 10 días — revisa o archívalos</p>
          </div>
          <button onClick={onClose} className="ml-auto p-1.5 rounded-lg hover:bg-black/[0.05] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
            <X size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y" style={{ borderColor: 'var(--border)' }}>
          {leads.map(l => {
            const d = daysInactive(l)
            const pal = getStagePalette(l.current_stage)
            const name = l.contact?.name ?? 'Lead #' + l.id
            return (
              <div key={l.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-black/[0.02] transition-colors">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                  style={{ background: 'rgba(53,122,14,0.10)', color: 'var(--zx-accent-text)' }}>
                  {name.trim().charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text)' }}>{name}</p>
                  {d !== null && (
                    <p className="text-[10px]" style={{ color: d >= 20 ? '#dc2626' : 'var(--text-muted)' }}>
                      {d} día{d !== 1 ? 's' : ''} sin actividad
                    </p>
                  )}
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: pal.countBg, color: pal.countColor }}>
                  {STAGE_LABELS[l.current_stage] ?? l.current_stage}
                </span>
              </div>
            )
          })}
        </div>
        <div className="px-5 py-4 flex gap-2 flex-shrink-0" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors hover:bg-black/[0.04]"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-2)', color: 'var(--text-2)' }}>
            Ignorar por ahora
          </button>
          <button onClick={() => { onMoveAll(); onClose() }}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-colors flex items-center justify-center gap-2"
            style={{ background: '#e11d48' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#d90429'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#e11d48'}>
            <Trash2 size={13} /> Mover a papelera
          </button>
        </div>
      </div>
    </div>
  )
}

/* ──────────────────── Pipeline (main page) ──────────────────── */
export default function Pipeline() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const highlightSinOT = new URLSearchParams(location.search).get('sin_ot') === '1'
  const [summary, setSummary]         = useState<Record<string, { count: number; leads: Lead[] }>>({})
  const [groups, setGroups]           = useState<Group[]>([])
  const [labels, setLabels]           = useState<Record<string, string>>({})
  const [customStages, setCustomStages] = useState<{ key: string; name: string; color?: string }[]>([])
  const [negocioTipo, setNegocioTipo] = useState<string>('abogados')
  const [loading, setLoading]         = useState(true)
  const [filter, setFilter]           = useState<'main' | 'recovery' | 'seguimiento' | 'papelera'>('main')
  const [groupFilter, setGroupFilter] = useState<string>('')
  const [areaFilter, setAreaFilter]   = useState<string>('')
  const [userFilter, setUserFilter]   = useState<string>('')
  const [dateFrom, setDateFrom]       = useState<string>('')
  const [dateTo, setDateTo]           = useState<string>('')
  const [activePreset, setActivePreset] = useState<string>('')
  const [areas, setAreas]             = useState<any[]>([])
  const [pipelineUsers, setPipelineUsers] = useState<any[]>([])
  const [followupItems, setFollowupItems] = useState<any[]>([])
  const [inactiveLeads, setInactiveLeads] = useState<Lead[]>([])
  const [showInactiveWarning, setShowInactiveWarning] = useState(false)
  const inactiveShownRef = useRef(false)
  const [showSectionsWarning, setShowSectionsWarning] = useState(false)
  const sectionsShownRef = useRef(false)
  const [pipelineView, setPipelineView] = useState<'kanban' | 'compact'>(() => (localStorage.getItem('pipeline_view') as any) ?? 'kanban')

  const isAdmin        = user?.role === 'superadmin' || user?.role === 'subadmin'
  const isAgendadora   = user?.role === 'agendadora'
  const canConfirmPago = user?.role === 'verificador'
  const canMoveAny     = user?.role !== 'verificador'

  const isAbogados = negocioTipo === 'abogados'
  const stages = isAbogados
    ? (filter === 'main' ? MAIN_STAGES : RECOVERY_STAGES)
    : customStages.map(s => s.key)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: any = {}
      if (groupFilter) params.group_id = parseInt(groupFilter)
      if (areaFilter)  params.area_name = areaFilter
      if (userFilter)  params.agendadora_id = parseInt(userFilter)
      if (dateFrom)    params.created_from = dateFrom
      if (dateTo)      params.created_to   = dateTo

      if (isAdmin) {
        const [summaryData, labelsData, groupsData, customStagesData, followupData, areasData, usersData] = await Promise.all([
          getPipelineSummary(params),
          getStageLabels(),
          getGroups(),
          getPipelineStages().catch(() => []),
          getAgendadoraFollowup().catch(() => []),
          getAllAreas().catch(() => []),
          getUsers().catch(() => []),
        ])
        setSummary(summaryData)
        setLabels(labelsData)
        setGroups(groupsData)
        setCustomStages(customStagesData)
        setFollowupItems(followupData)
        setAreas(areasData)
        setPipelineUsers(usersData.filter((u: any) => ['agendadora', 'vendedor', 'subadmin'].includes(u.role) && u.is_active))
        const myGroup = groupsData.find((g: Group) => g.id === user?.group_id)
        setNegocioTipo((myGroup as any)?.tipo ?? 'abogados')
      } else {
        const [summaryData, labelsData, customStagesData, followupData, areasData] = await Promise.all([
          getPipelineSummary(params),
          getStageLabels(),
          getPipelineStages().catch(() => []),
          getAgendadoraFollowup().catch(() => []),
          getAllAreas().catch(() => []),
        ])
        setSummary(summaryData)
        setLabels(labelsData)
        setCustomStages(customStagesData)
        setFollowupItems(followupData)
        setAreas(areasData)
      }
    } catch { toast.error('Error cargando pipeline') }
    finally { setLoading(false) }
  }, [isAdmin, groupFilter, areaFilter, userFilter, dateFrom, dateTo, user?.group_id])

  useEffect(() => { load() }, [load])

  useDebouncedRealtime(['pipeline_refresh', 'lead_update'], () => load())

  // Refresco same-tab: cambios hechos dentro del Drawer (auto-llenar, editar
  // contacto, mover etapa) repintan las cartas sin esperar el round-trip SSE.
  useEffect(() => onLeadChanged(() => load()), [load])

  // Show sections warning once after first load
  useEffect(() => {
    if (loading || sectionsShownRef.current) return
    const rec = isAbogados ? RECOVERY_STAGES.reduce((a, s) => a + (summary[s]?.count ?? 0), 0) : 0
    const seg = followupItems.length
    const pap = (summary['_papelera_count'] as any) ?? summary['papelera']?.count ?? 0
    if (rec > 0 || seg > 0 || pap > 0) {
      setShowSectionsWarning(true)
      sectionsShownRef.current = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  // Detect inactive leads via dedicated endpoint — fires after pipeline data loads
  useEffect(() => {
    if (loading || inactiveShownRef.current) return
    const params: any = {}
    if (groupFilter) params.group_id = parseInt(groupFilter)
    getInactiveLeads(params).then(leads => {
      if (leads.length > 0 && !inactiveShownRef.current) {
        setInactiveLeads(leads)
        setShowInactiveWarning(true)
        inactiveShownRef.current = true
      }
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, groupFilter])

  const handleMoved = (updated: Lead) => {
    // If moved to/from papelera, do a full reload so counter updates correctly
    if (updated.current_stage === 'papelera') {
      load()
      return
    }
    setSummary(prev => {
      const next = { ...prev }
      for (const stage of Object.keys(next)) {
        if (!next[stage]?.leads) continue
        const idx = next[stage].leads.findIndex(l => l.id === updated.id)
        if (idx !== -1) {
          if (updated.current_stage === stage) {
            next[stage] = { ...next[stage], leads: next[stage].leads.map(l => l.id === updated.id ? updated : l) }
          } else {
            next[stage] = { count: next[stage].count - 1, leads: next[stage].leads.filter(l => l.id !== updated.id) }
            if (next[updated.current_stage]) {
              next[updated.current_stage] = {
                count: next[updated.current_stage].count + 1,
                leads: [updated, ...next[updated.current_stage].leads].slice(0, COL_LIMIT),
              }
            }
          }
          break
        }
      }
      return next
    })
  }

  const recoveryCount = isAbogados ? RECOVERY_STAGES.reduce((a, s) => a + (summary[s]?.count ?? 0), 0) : 0
  const totalLeads    = stages.reduce((a, s) => a + (summary[s]?.count ?? 0), 0)
  const showGroupBadge = isAdmin && !groupFilter

  // Merge custom stage names into labels map for non-abogados
  const effectiveLabels = isAbogados
    ? labels
    : { ...labels, ...Object.fromEntries(customStages.map(s => [s.key, s.name])) }

  const handleMoveInactiveToPapelera = async () => {
    for (const lead of inactiveLeads) {
      try {
        await moveLeadStage(lead.id, { stage: 'papelera', notes: 'Archivado automáticamente por inactividad (+10 días)' })
      } catch { /* continue */ }
    }
    load()
    toast.success(`${inactiveLeads.length} lead${inactiveLeads.length > 1 ? 's' : ''} movido${inactiveLeads.length > 1 ? 's' : ''} a papelera`)
  }

  // Date preset helpers (outside JSX to avoid re-creation)
  const _ld = (d: Date) => { const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}` }
  const _today = new Date()
  const _todayStr = _ld(_today)
  const _weekStart = new Date(_today); _weekStart.setDate(_today.getDate() - ((_today.getDay()+6)%7))
  const _monthStart = new Date(_today.getFullYear(), _today.getMonth(), 1)
  const _prevMonthStart = new Date(_today.getFullYear(), _today.getMonth()-1, 1)
  const _prevMonthEnd = new Date(_today.getFullYear(), _today.getMonth(), 0)
  const _datePresets = [
    { label: 'Hoy',         from: _todayStr,              to: _todayStr },
    { label: 'Esta semana', from: _ld(_weekStart),         to: _todayStr },
    { label: 'Este mes',    from: _ld(_monthStart),        to: _todayStr },
    { label: 'Mes ant.',    from: _ld(_prevMonthStart),    to: _ld(_prevMonthEnd) },
  ]

  return (
    <div className="flex flex-col h-full" style={{ gap: '12px' }}>

      {showSectionsWarning && (
        <SectionsWarningPopup
          recCount={recoveryCount}
          segCount={followupItems.length}
          papCount={(summary['_papelera_count'] as any) ?? summary['papelera']?.count ?? 0}
          onGo={tab => setFilter(tab)}
          onClose={() => setShowSectionsWarning(false)}
        />
      )}

      {showInactiveWarning && inactiveLeads.length > 0 && (
        <InactiveWarningPopup
          leads={inactiveLeads}
          onMoveAll={handleMoveInactiveToPapelera}
          onClose={() => setShowInactiveWarning(false)}
        />
      )}

      {/* ── Row 1: Title + meta + refresh ── */}
      <div className="flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl font-black tracking-tight" style={{ color: 'var(--text)', fontFamily: '"Space Grotesk", sans-serif' }}>Pipeline</h1>
              {isAdmin && (
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg border"
                  style={groupFilter
                    ? { background: 'var(--surface-3)', color: 'var(--text-2)', borderColor: 'var(--border-2)' }
                    : { background: 'var(--warn-dim)', color: 'var(--warn)', borderColor: 'rgba(245,158,11,0.25)' }}>
                  {groupFilter ? groups.find(g => g.id === parseInt(groupFilter))?.name ?? 'Grupo' : '⚠ Todos los grupos'}
                </span>
              )}
              {(dateFrom || dateTo) && (
                <span className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border"
                  style={{ background: 'var(--secondary-dim)', color: 'var(--secondary)', borderColor: 'rgba(6,182,212,0.30)' }}>
                  {dateFrom && dateTo ? `${dateFrom.slice(5)} → ${dateTo.slice(5)}` : dateFrom || dateTo}
                </span>
              )}
            </div>
            <p className="text-xs mt-0.5 font-medium" style={{ color: 'var(--text-muted)' }}>
              {loading ? 'Cargando…' : <>Embudo de ventas: arrastra cada lead entre etapas para reflejar su avance · <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>{totalLeads} expediente{totalLeads !== 1 ? 's' : ''} activos</span></>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Papelera */}
          {isAbogados && (
            <button onClick={() => setFilter(filter === 'papelera' ? 'main' : 'papelera')}
              title="Papelera"
              className="relative h-9 px-3 flex items-center gap-1.5 rounded-xl border text-[11px] font-bold transition-colors"
              style={filter === 'papelera'
                ? { background: '#6b7280', borderColor: '#6b7280', color: '#ffffff' }
                : { background: 'var(--surface-1)', borderColor: 'var(--border-2)', color: 'var(--text-muted)' }}>
              <Trash2 size={13} />
              {(summary['_papelera_count'] as any) > 0 && (
                <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full"
                  style={filter === 'papelera'
                    ? { background: 'rgba(255,255,255,0.20)', color: '#ffffff' }
                    : { background: 'rgba(107,114,128,0.12)', color: '#6b7280' }}>
                  {(summary['_papelera_count'] as any)}
                </span>
              )}
            </button>
          )}
          {/* Kanban view toggle */}
          <div className="flex items-center rounded-xl overflow-hidden"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-2)' }}>
            <button onClick={() => { setPipelineView('kanban'); localStorage.setItem('pipeline_view', 'kanban') }}
              title="Vista kanban"
              className="flex items-center justify-center w-9 h-9 transition-colors"
              style={pipelineView === 'kanban'
                ? { background: 'var(--primary-dim)', color: 'var(--primary)' }
                : { color: 'var(--text-muted)' }}>
              <LayoutGrid size={14} />
            </button>
            <button onClick={() => { setPipelineView('compact'); localStorage.setItem('pipeline_view', 'compact') }}
              title="Vista compacta"
              className="flex items-center justify-center w-9 h-9 transition-colors"
              style={pipelineView === 'compact'
                ? { background: 'var(--primary-dim)', color: 'var(--primary)' }
                : { color: 'var(--text-muted)' }}>
              <Rows3 size={14} />
            </button>
          </div>
          <button onClick={load}
            className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors flex-shrink-0"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-2)', color: 'var(--text-muted)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text)'; (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.background = 'var(--surface-1)' }}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* ── Row 2: View tabs (sin Papelera) ── */}
      {isAbogados && (
        <div className="flex items-center gap-2 flex-shrink-0 overflow-x-auto scrollbar-none -mx-1 px-1">
          <div className="flex rounded-xl p-1 flex-shrink-0" style={{ background: 'var(--surface-3)', border: '1px solid var(--border)' }}>
            <button onClick={() => setFilter('main')}
              className="px-4 py-2 rounded-lg text-xs font-bold transition-all duration-150 whitespace-nowrap"
              style={filter === 'main'
                ? { background: 'var(--surface-1)', color: 'var(--primary)', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
                : { color: 'var(--text-3)' }}>
              Embudo Principal
            </button>
            <button onClick={() => setFilter('recovery')}
              className="px-4 py-2 rounded-lg text-xs font-bold transition-all duration-150 flex items-center gap-1.5 whitespace-nowrap"
              style={filter === 'recovery'
                ? { background: 'var(--danger)', color: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
                : { color: 'var(--danger)' }}>
              {filter !== 'recovery' && recoveryCount > 0 && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--danger)' }} />}
              Recuperación
              {recoveryCount > 0 && (
                <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full"
                  style={filter === 'recovery'
                    ? { background: 'rgba(255,255,255,0.20)', color: '#ffffff' }
                    : { background: 'var(--danger-dim)', color: 'var(--danger)' }}>
                  {recoveryCount}
                </span>
              )}
            </button>
            <button onClick={() => setFilter('seguimiento')}
              className="px-4 py-2 rounded-lg text-xs font-bold transition-all duration-150 flex items-center gap-1.5 whitespace-nowrap"
              style={filter === 'seguimiento'
                ? { background: 'var(--warn)', color: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
                : { color: 'var(--warn)' }}>
              {filter !== 'seguimiento' && followupItems.length > 0 && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--warn)' }} />}
              Seguimiento
              {followupItems.length > 0 && (
                <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full"
                  style={filter === 'seguimiento'
                    ? { background: 'rgba(255,255,255,0.20)', color: '#ffffff' }
                    : { background: 'var(--warn-dim)', color: 'var(--warn)' }}>
                  {followupItems.length}
                </span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Row 3: Filters bar ── */}
      {filter !== 'papelera' && (
        <div className="flex flex-nowrap md:flex-wrap items-center gap-2 flex-shrink-0 rounded-xl px-3 py-2.5 overflow-x-auto md:overflow-x-visible scrollbar-none"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>

          {/* Dropdowns */}
          {isAdmin && groups.length > 0 && (
            <div className="relative flex-shrink-0">
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
              <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}
                className="appearance-none h-8 pl-3 pr-7 text-[11px] font-medium cursor-pointer rounded-lg border transition-colors outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border-2)', color: 'var(--text)', minWidth: 120 }}>
                <option value="">Todos los grupos</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          )}
          {(isAdmin || isAgendadora) && areas.length > 0 && (
            <div className="relative flex-shrink-0">
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
              <select value={areaFilter} onChange={e => setAreaFilter(e.target.value)}
                className="appearance-none h-8 pl-3 pr-7 text-[11px] font-medium cursor-pointer rounded-lg border transition-colors outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border-2)', color: 'var(--text)', minWidth: 120 }}>
                <option value="">Todas las áreas</option>
                {Array.from(new Map(areas.map((a: any) => [a.name, a])).values()).map((a: any) => (
                  <option key={a.name} value={a.name}>{a.name}</option>
                ))}
              </select>
            </div>
          )}
          {isAdmin && pipelineUsers.length > 0 && (
            <div className="relative flex-shrink-0">
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
              <select value={userFilter} onChange={e => setUserFilter(e.target.value)}
                className="appearance-none h-8 pl-3 pr-7 text-[11px] font-medium cursor-pointer rounded-lg border transition-colors outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border-2)', color: 'var(--text)', minWidth: 140 }}>
                <option value="">Todos los usuarios</option>
                {pipelineUsers.map((u: any) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                ))}
              </select>
            </div>
          )}

          {/* Divider */}
          {(isAdmin || isAgendadora) && <span className="w-px h-5 flex-shrink-0" style={{ background: 'var(--border-2)' }} />}

          {/* Date presets */}
          <span className="text-[10px] font-semibold uppercase tracking-wider flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Fecha</span>
          {_datePresets.map(preset => {
            const active = activePreset === preset.label
            return (
              <button key={preset.label}
                onClick={() => {
                  if (active) { setDateFrom(''); setDateTo(''); setActivePreset('') }
                  else { setDateFrom(preset.from); setDateTo(preset.to); setActivePreset(preset.label) }
                }}
                className="text-[11px] px-2.5 h-8 rounded-lg border transition-colors whitespace-nowrap flex-shrink-0"
                style={active
                  ? { background: 'var(--primary-dim)', borderColor: 'rgba(53,122,14,0.35)', color: 'var(--primary)', fontWeight: 700 }
                  : { background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text-3)' }}>
                {preset.label}
              </button>
            )
          })}

          {/* Custom date inputs */}
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setActivePreset('') }}
            className="h-8 text-[11px] px-2 rounded-lg border focus:outline-none focus:ring-1 flex-shrink-0"
            style={{ borderColor: 'var(--border-2)', background: 'var(--surface-1)', color: 'var(--text-2)', minWidth: 0, width: 130 }} />
          <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>→</span>
          <input type="date" value={dateTo} min={dateFrom} onChange={e => { setDateTo(e.target.value); setActivePreset('') }}
            className="h-8 text-[11px] px-2 rounded-lg border focus:outline-none focus:ring-1 flex-shrink-0"
            style={{ borderColor: 'var(--border-2)', background: 'var(--surface-1)', color: 'var(--text-2)', minWidth: 0, width: 130 }} />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); setActivePreset('') }}
              className="h-8 px-2.5 text-[11px] rounded-lg border transition-colors"
              style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--danger)' }}>
              ✕ Limpiar
            </button>
          )}
        </div>
      )}


      {loading ? (
        <div className="flex items-center justify-center flex-1">
          <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--primary)' }} />
        </div>
      ) : filter === 'seguimiento' ? (
        <SeguimientoTab items={followupItems} />
      ) : filter === 'papelera' ? (
        <PapeleraTab
          leads={summary['papelera']?.leads ?? []}
          count={summary['_papelera_count'] as any ?? summary['papelera']?.count ?? 0}
          labels={effectiveLabels}
          onRestore={async (lead) => {
            await moveLeadStage(lead.id, { stage: 'lead', notes: 'Restaurado desde papelera' })
            load()
            toast.success('Lead restaurado')
          }}
          canDelete={(isAdmin || user?.role === 'verificador')}
          onDelete={user?.role === 'superadmin' ? async (lead) => {
            if (!window.confirm(`¿Eliminar definitivamente a "${lead.contact?.name ?? 'este lead'}"? Esta acción no se puede deshacer.`)) return
            try {
              await deleteLead(lead.id)
              load()
              toast.success('Lead eliminado definitivamente')
            } catch { toast.error('Error al eliminar') }
          } : undefined}
        />
      ) : pipelineView === 'compact' ? (
        /* ── Compact kanban ── */
        <div className="flex gap-2.5 overflow-x-auto pb-4 flex-1 p-3 snap-x snap-proximity md:snap-none" style={{ background: '#f5f3fa', borderRadius: 16 }}>
          {stages.map(s => {
            const leads = summary[s]?.leads ?? []
            const count = summary[s]?.count ?? 0
            const label = effectiveLabels[s] ?? s
            const isRec = s.startsWith('recuperacion')
            const col = isRec ? '#ef4444' : s === 'lead' ? '#64748b' : s === 'reunion' ? '#f59e0b' : s === 'altamente_interesado' ? '#f59e0b' : s === 'cierre' ? 'var(--zx-accent-text)' : s === 'pago_comprometido' ? '#22c55e' : s === 'pagado_confirmado' ? '#22c55e' : '#64748b'
            const totalHon = leads.reduce((acc, l) => acc + (l.honorarios ? Number(l.honorarios) : 0), 0)
            const FLAT_AVATARS = [
              { bg: 'rgba(53,122,14,0.12)',  fg: 'var(--zx-accent-text)' },
              { bg: 'rgba(53,122,14,0.12)', fg: 'var(--zx-accent-text)' },
              { bg: 'rgba(8,145,178,0.12)',  fg: '#0891b2' },
              { bg: 'rgba(5,150,105,0.12)',  fg: '#059669' },
              { bg: 'rgba(217,119,6,0.12)',  fg: '#d97706' },
              { bg: 'rgba(220,38,38,0.12)',  fg: '#dc2626' },
            ]
            return (
              <div key={s} className="flex-shrink-0 flex flex-col rounded-xl snap-start" style={{ width: 178, background: '#ffffff', border: '1px solid #e6e1f0', borderTop: `3px solid ${col}` }}>
                {/* Column header */}
                <div className="px-3 pt-2.5 pb-2" style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[11px] font-bold truncate" style={{ color: '#1c1633', fontFamily: '"Space Grotesk", sans-serif' }}>{label}</span>
                    </div>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md flex-shrink-0" style={{ background: 'rgba(28,22,51,0.07)', color: 'rgba(28,22,51,0.55)' }}>{count}</span>
                  </div>
                  {totalHon > 0 && (
                    <p className="text-[10px] font-semibold" style={{ color: col }}>
                      ${totalHon.toLocaleString('es-CL')}
                    </p>
                  )}
                </div>
                {/* Cards */}
                <div className="flex flex-col gap-1 p-2 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
                  {leads.map(lead => {
                    const name = lead.contact?.name ?? 'Lead #' + lead.id
                    const hon = lead.honorarios ? `$${Number(lead.honorarios).toLocaleString('es-CL')}` : null
                    const Initial = name.trim().charAt(0).toUpperCase()
                    const av = FLAT_AVATARS[(name.charCodeAt(0) ?? 0) % FLAT_AVATARS.length]
                    const hasUnread = (lead as any).unread_count > 0
                    return (
                      <div key={lead.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all active:scale-[0.97]"
                        style={{ borderLeft: `2px solid ${col}20` }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#faf9fd' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                        onClick={() => navigate(`/leads?contact=${lead.contact_id}`)}>
                        <div className="relative flex-shrink-0">
                          <div className="w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px]" style={{ background: av.bg, color: av.fg }}>{Initial}</div>
                          {hasUnread && <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 border-2 border-white" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-semibold truncate leading-tight" style={{ color: '#1c1633' }}>{name}</p>
                          {hon
                            ? <p className="text-[10px] font-bold truncate" style={{ color: col }}>{hon}</p>
                            : <p className="text-[10px] truncate" style={{ color: 'rgba(28,22,51,0.35)' }}>Sin honorarios</p>
                          }
                        </div>
                      </div>
                    )
                  })}
                  {count > leads.length && (
                    <button className="text-center text-[10px] font-semibold py-1.5 rounded-lg transition-colors"
                      style={{ color: 'var(--text-muted)' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f1f5f9' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}>
                      +{count - leads.length} más
                    </button>
                  )}
                  {leads.length === 0 && count === 0 && (
                    <p className="text-center text-[10px] py-4" style={{ color: 'rgba(28,22,51,0.30)' }}>Vacío</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* ── Full kanban ── */
        <KanbanBoard layout="scroll">
          {highlightSinOT && (
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold shadow-lg"
              style={{ background: '#e11d48', color: '#fff' }}>
              <ClipboardList size={15} />
              Leads en Cierre sin OT marcados en rojo
            </div>
          )}
          {stages.map(s => (
            <Column
              key={s}
              stage={s}
              leads={summary[s]?.leads ?? []}
              stageCount={summary[s]?.count ?? 0}
              canMove={canMoveAny}
              canConfirmPago={canConfirmPago}
              showGroup={showGroupBadge}
              labels={effectiveLabels}
              onMoved={handleMoved}
              userRole={user?.role}
              highlightSinOT={highlightSinOT}
              onLoadAll={() => {
                const p: any = { stage: s, limit: 500 }
                if (groupFilter) p.group_id = parseInt(groupFilter)
                if (areaFilter)  p.area_name = areaFilter
                if (userFilter)  p.agendadora_id = parseInt(userFilter)
                if (dateFrom)    p.created_from = dateFrom
                if (dateTo)      p.created_to   = dateTo
                return getLeads(p)
              }}
            />
          ))}
        </KanbanBoard>
      )}
    </div>
  )
}
