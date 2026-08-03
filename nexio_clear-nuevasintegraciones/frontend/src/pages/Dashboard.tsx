import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Users, GitBranch, Calendar, TrendingUp, DollarSign,
  RefreshCw, Award, BarChart2, CreditCard, AlertCircle,
  Clock, ChevronRight, ChevronLeft, ChevronDown, Trash2, CheckCircle, XCircle,
  MessageSquare, AlertTriangle, Bell, ThumbsUp, ArrowRight,
  CalendarDays, Phone, WifiOff, CalendarPlus, X, Loader2, Bot, ClipboardList,
} from 'lucide-react'
import { getDashboardStats, getVendorPipeline, clearDashboard, getAgendadoraFollowup, getDashboardDetail, getAgentQueue } from '../api'
import { useAuthStore } from '../store/auth'
import { format, isToday, isTomorrow, addDays, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { Link, useNavigate } from 'react-router-dom'
import { onLeadChanged } from '../lib/leadEvents'
import { useDebouncedCallback } from '../hooks/useDebouncedRealtime'
import NexioCopilotWidget from '../components/copilot/NexioCopilotWidget'
import { EventModal } from '../components/EventModal'
import { STAGE_LABELS } from '../types'
import { parseDate as parseAsUTC, parseLocalDate } from '../utils/dates'
import { useRealtime } from '../contexts/RealtimeContext'

function fmt(n: number) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 }).format(n)
}

// Qué significa cada etapa del pipeline — visible para la agendadora
const STAGE_DESCRIPTIONS: Record<string, string> = {
  lead:                  'Cliente nuevo, aún sin reunión agendada',
  reunion:               'Ya tiene reunión agendada con un vendedor',
  altamente_interesado:  'Tuvo su reunión y quiere avanzar',
  cierre:                'Negociando el contrato y la forma de pago',
  pago_pendiente:        'Cerró el servicio, falta que pague',
  pago_comprometido:     'Se comprometió a pagar en una fecha',
  pagado_reunion:        'Declaró su pago, en validación',
  pagado_confirmado:     'Pago verificado y confirmado',
}

const METRIC_LABELS: Record<string, string> = {
  active:         'Leads Activos',
  cierre_sin_abono: 'Cierre Sin Abono',
  cierre_abonado:   'Cierre Abonado',
  convertidos:      'Leads Convertidos (Cierre + Pago)',
  recovery:         'En Recuperación',
  cuotas:           'Leads con Cuotas',
  pagos_unicos:     'Pagos Únicos',
  honorarios:       'Monto Total',
}

function DashboardDetailModal({ metric, period, dateFrom, dateTo, groupId, vendorId, onClose, titleOverride, subtitle }: {
  metric: string; period: string; dateFrom?: string; dateTo?: string; groupId?: string; vendorId?: number; onClose: () => void; titleOverride?: string; subtitle?: string
}) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    setLoading(true)
    const params: any = (dateFrom || dateTo)
      ? { date_from: dateFrom || undefined, date_to: dateTo || undefined, group_id: groupId || undefined, vendor_id: vendorId || undefined }
      : { period, group_id: groupId || undefined, vendor_id: vendorId || undefined }
    getDashboardDetail(metric, params)
      .then(setRows)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [metric, period, dateFrom, dateTo, groupId, vendorId])

  const showMoney = ['cuotas', 'pagos_unicos', 'honorarios', 'cierre_abonado', 'cierre_sin_abono'].includes(metric)

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border-2)' }}>
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <p className="font-bold text-base" style={{ color: 'var(--text)' }}>{titleOverride ?? METRIC_LABELS[metric] ?? metric}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{rows.length} registros{subtitle ? ` · ${subtitle}` : ''}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg"
            style={{ color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin" style={{ color: 'var(--primary)' }} />
            </div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Sin datos para este período</div>
          ) : (
            <table className="w-full text-sm min-w-[500px]">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Cliente</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Área</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Vendedor</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Etapa</th>
                  {showMoney && <>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Total</th>
                    {['cuotas','cierre_abonado'].includes(metric) && <th className="text-right px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Cuota</th>}
                  </>}
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--surface-2)' }}>
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-sm" style={{ color: 'var(--text)' }}>{r.contact_name}</p>
                      {r.contact_phone && <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{r.contact_phone}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-3)' }}>{r.area}</td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-3)' }}>{r.vendedor}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: 'var(--surface-3)', color: 'var(--text-3)' }}>
                        {STAGE_LABELS[r.stage] ?? r.stage}
                      </span>
                    </td>
                    {showMoney && <>
                      <td className="px-4 py-2.5 text-right text-xs font-bold" style={{ color: 'var(--primary)' }}>
                        {fmt(r.honorarios)}
                      </td>
                      {['cuotas','cierre_abonado'].includes(metric) && (
                        <td className="px-4 py-2.5 text-right text-xs" style={{ color: 'var(--text-3)' }}>
                          {r.num_cuotas > 1 ? `${r.num_cuotas}×${fmt(r.monto_cuota)}` : '—'}
                        </td>
                      )}
                    </>}
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => { onClose(); navigate('/leads', { state: { openLeadId: r.id } }) }}
                        className="text-[10px] font-bold px-2.5 py-1 rounded-lg"
                        style={{ background: 'var(--primary-dim)', color: 'var(--primary)' }}>
                        Ver
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {showMoney && rows.length > 0 && (
          <div className="px-5 py-3 flex items-center justify-between flex-shrink-0"
            style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
            <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Total</span>
            <span className="text-sm font-black" style={{ color: 'var(--primary)' }}>
              {fmt(rows.reduce((s, r) => s + r.honorarios, 0))}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function fmtAction(action: string) {
  const parts = action.split(' → ')
  if (parts.length === 2) return `${STAGE_LABELS[parts[0].trim()] || parts[0]} → ${STAGE_LABELS[parts[1].trim()] || parts[1]}`
  return STAGE_LABELS[action.trim()] || action
}

function eventDayLabel(iso: string) {
  const d = parseLocalDate(iso)
  if (isToday(d)) return 'Hoy'
  if (isTomorrow(d)) return 'Mañana'
  return format(d, "EEEE d 'de' MMMM", { locale: es })
}

function EventRow({ ev, onClick }: { ev: any; onClick?: () => void }) {
  const now = new Date()
  const start = parseLocalDate(ev.start_time)
  const end = parseLocalDate(ev.end_time)
  const isPast = start < now
  const isNow = start <= now && end > now

  // Color accent based on event type or vendor status
  const barColor = ev.vendor_status === 'altamente_interesado' ? '#a3e635'
    : (ev.vendor_status === 'sin_exito' || ev.vendor_status === 'no_show') ? '#ff0055'
    : isNow ? '#00f0ff'
    : isPast ? 'var(--text-muted)'
    : '#a3e635'

  return (
    <div
      onClick={onClick}
      title={onClick ? 'Click para ver el detalle completo de la reunión' : undefined}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${onClick ? 'cursor-pointer hover:border-white/20 hover:bg-surface-0' : ''} ${
        isNow ? 'border-neon/25 bg-neon/[0.04]' : isPast ? 'border-white/[0.06] opacity-60' : 'border-white/[0.08] bg-surface-1'
      }`}
    >
      <div className="w-1.5 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: barColor }} />
      <div className="w-12 text-right flex-shrink-0">
        <p className={`text-xs font-bold ${isNow ? 'text-neon' : isPast ? 'text-white/52' : 'text-white/85'}`}>
          {format(start, 'HH:mm')}
        </p>
        <p className="text-[9px] text-white/45">a {format(end, 'HH:mm')}</p>
        {isNow && <p className="text-[9px] text-neon font-bold uppercase">Ahora</p>}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-white truncate">{ev.title}</p>
        {ev.contact_name && (
          <p className="text-[10px] text-white/55 truncate mt-0.5">{ev.contact_name}</p>
        )}
        {ev.contact_phone && (
          <p className="text-[10px] text-white/45 flex items-center gap-1 mt-0.5 truncate">
            <Phone size={9} className="flex-shrink-0" />{ev.contact_phone}
          </p>
        )}
      </div>
      {ev.vendor_status === 'altamente_interesado' && (
        <span className="text-[9px] font-bold text-lime bg-lime/15 border border-lime/25 px-1.5 py-0.5 rounded-full flex-shrink-0" title="La reunión se realizó y el cliente quiere avanzar">Exitosa</span>
      )}
      {ev.vendor_status === 'sin_exito' && (
        <span className="text-[9px] font-bold text-danger bg-danger/15 border border-danger/25 px-1.5 py-0.5 rounded-full flex-shrink-0" title="La reunión se realizó pero el cliente no cerró">Sin éxito</span>
      )}
      {ev.vendor_status === 'no_show' && (
        <span className="text-[9px] font-bold text-warn bg-warn/15 border border-warn/25 px-1.5 py-0.5 rounded-full flex-shrink-0" title="El cliente no se conectó a la reunión">No se conectó</span>
      )}
      {!ev.vendor_status && isPast && !isNow && (
        <span className="text-[9px] font-bold text-warn bg-warn/15 border border-warn/25 px-1.5 py-0.5 rounded-full flex-shrink-0" title="La reunión ya pasó pero aún no registras el resultado">Sin marcar</span>
      )}
      {!ev.vendor_status && !isPast && !isNow && (
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: 'rgba(6,182,212,0.10)', color: 'var(--zx-lime)', border: '1px solid rgba(6,182,212,0.30)' }} title="Reunión agendada que aún no ocurre">Programada</span>
      )}
    </div>
  )
}

function AlertBanner({ icon: Icon, title, sub, to, color = 'warn', state }: { icon: any; title: string; sub: string; to: string; color?: 'warn' | 'danger' | 'neon'; state?: any }) {
  const c = {
    warn:   { outer: 'border-warn/20 bg-warn/[0.05] hover:bg-warn/[0.09]',     icon: 'bg-warn/15 text-warn' },
    danger: { outer: 'border-danger/20 bg-danger/[0.05] hover:bg-danger/[0.09]', icon: 'bg-danger/15 text-danger' },
    neon:   { outer: 'border-neon/20 bg-neon/[0.05] hover:bg-neon/[0.09]',     icon: 'bg-neon/15 text-neon' },
  }[color]
  return (
    <Link to={to} state={state} className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${c.outer} text-white/90`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${c.icon}`}>
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold leading-tight">{title}</p>
        <p className="text-[11px] opacity-70 mt-0.5">{sub}</p>
      </div>
      <ArrowRight size={14} className="flex-shrink-0 opacity-55" />
    </Link>
  )
}

const PIPELINE_STAGES = [
  { stage: 'lead',                 dot: 'bg-slate-400',     bar: '#94a3b8', label_color: 'text-white/65' },
  { stage: 'reunion',              dot: 'bg-blue-400',      bar: '#60a5fa', label_color: 'text-white/65' },
  { stage: 'altamente_interesado', dot: 'bg-brand-400',    bar: '#a78bfa', label_color: 'text-white/65' },
  { stage: 'cierre',               dot: 'bg-brand-500',      bar: 'var(--zx-lime)', label_color: 'text-white/65' },
  { stage: 'pago_pendiente',       dot: 'bg-brand-400',       bar: '#0ea5e9', label_color: 'text-white/65' },
  { stage: 'pago_comprometido',    dot: 'bg-emerald-500',   bar: '#10b981', label_color: 'text-white/65' },
  { stage: 'pagado_reunion',       dot: 'bg-orange-400',    bar: '#f97316', label_color: 'text-white/65' },
  { stage: 'pagado_confirmado',    dot: 'bg-lime',          bar: 'var(--zx-accent-text)', label_color: 'text-white/65' },
]

type Period = 'day' | 'week' | 'month'
const PERIODS: { value: Period; label: string }[] = [
  { value: 'day',   label: 'Hoy' },
  { value: 'week',  label: 'Últimos 7 días' },
  { value: 'month', label: 'Mes' },
]

// ── Bandeja "Hoy / Mi día" ────────────────────────────────────────
type DashView = 'hoy' | 'metricas'

function DashTabs({ view, onChange }: { view: DashView; onChange: (v: DashView) => void }) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-xl w-fit"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
      {(['hoy', 'metricas'] as const).map(v => (
        <button key={v} onClick={() => onChange(v)}
          className="px-4 py-1.5 rounded-lg text-xs font-bold transition-colors"
          style={view === v ? { background: 'var(--primary)', color: '#fff' } : { color: 'var(--text-muted)' }}>
          {v === 'hoy' ? 'Hoy' : 'Métricas'}
        </button>
      ))}
    </div>
  )
}

function HoyHeader({ todayLabel, lastRefresh, loading, onRefresh, view, onView }: {
  todayLabel: string; lastRefresh: Date; loading: boolean; onRefresh: () => void
  view: DashView; onView: (v: DashView) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>Hoy</h1>
        <p className="text-xs mt-0.5 capitalize" style={{ color: 'var(--text-3)' }}>
          {todayLabel} · Actualizado {format(lastRefresh, 'HH:mm')}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <DashTabs view={view} onChange={onView} />
        <button onClick={onRefresh} disabled={loading}
          className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors flex-shrink-0"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
    </div>
  )
}

const INBOX_TONES: Record<string, { bg: string; fg: string }> = {
  primary: { bg: 'rgba(53,122,14,0.08)',  fg: 'var(--zx-accent-text)' },
  warn:    { bg: 'rgba(245,158,11,0.10)', fg: '#d97706' },
  danger:  { bg: 'rgba(239,68,68,0.09)',  fg: '#ef4444' },
  ok:      { bg: 'rgba(16,185,129,0.09)', fg: '#10b981' },
}

function InboxRow({ icon: Icon, label, count, to, tone = 'primary' }: {
  icon: any; label: string; count: number | string; to: string; tone?: 'primary' | 'warn' | 'danger' | 'ok'
}) {
  const t = INBOX_TONES[tone]
  return (
    <Link to={to}
      className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all hover:shadow-md"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: t.bg, color: t.fg }}>
        <Icon size={17} />
      </div>
      <span className="flex-1 text-sm font-semibold" style={{ color: 'var(--text)' }}>{label}</span>
      <span className="text-lg font-black tabular-nums" style={{ color: t.fg }}>{count}</span>
      <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
    </Link>
  )
}

function InboxEmpty() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 rounded-2xl"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
        style={{ background: 'rgba(16,185,129,0.10)', color: '#10b981' }}>
        <CheckCircle size={28} />
      </div>
      <p className="text-base font-bold" style={{ color: 'var(--text)' }}>Todo al día ✨</p>
      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>No tienes acciones pendientes ahora mismo.</p>
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [stats, setStats] = useState<any>(null)
  const [vendorPipeline, setVendorPipeline] = useState<any>(null)
  const [followupItems, setFollowupItems] = useState<any[]>([])
  const [agentQueueCount, setAgentQueueCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [showEventModal, setShowEventModal] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<any>(null)
  const [clearingActivity, setClearingActivity] = useState(false)
  const [period, setPeriod] = useState<Period>('month')
  const [periodOpen, setPeriodOpen] = useState(false)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo]     = useState('')
  const [activePreset, setActivePreset] = useState('')
  const [detailModal, setDetailModal] = useState<string | null>(null)
  const [agendaDate, setAgendaDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const agendaDateInputRef = useRef<HTMLInputElement>(null)
  // Detalle de KPI con contexto extra (agendadora + admin): métrica, rango y filtros de grupo/vendedor
  const [agDetail, setAgDetail] = useState<{ metric: string; title: string; subtitle?: string; dateFrom?: string; dateTo?: string; groupId?: string; vendorId?: number } | null>(null)
  const agendaSectionRef = useRef<HTMLDivElement>(null)

  const [dashView, setDashView] = useState<DashView>('hoy')
  const isVendedor  = user?.role === 'vendedor'
  const isSuperAdmin= user?.role === 'superadmin'
  const isSubAdmin  = user?.role === 'subadmin'
  const isAdmin     = isSuperAdmin || isSubAdmin
  const isDante     = user?.role === 'verificador'
  const isAgendadora= user?.role === 'agendadora'

  const fetchDashboard = useCallback(async (isSilent = false, overridePeriod?: Period, overrideAgendaDate?: string) => {
    if (!isSilent) setLoading(true)
    try {
      const p = overridePeriod ?? period
      const ad = overrideAgendaDate ?? agendaDate
      const _todayStr = format(new Date(), 'yyyy-MM-dd')
      const params: any = customFrom || customTo
        ? { ...(customFrom ? { date_from: customFrom } : {}), ...(customTo ? { date_to: customTo } : {}), agenda_date: ad }
        : ad !== _todayStr
          ? { date_from: ad, date_to: ad, agenda_date: ad }
          : { period: p, agenda_date: ad }
      const calls: Promise<any>[] = [getDashboardStats(params)]
      let vpIdx = -1
      let fuIdx = -1
      let aqIdx = -1
      if (isVendedor)   { vpIdx = calls.length; calls.push(getVendorPipeline(params)) }
      if (isAgendadora) { fuIdx = calls.length; calls.push(getAgendadoraFollowup()) }
      if (isAgendadora) { aqIdx = calls.length; calls.push(getAgentQueue().catch(() => ({ count: 0, leads: [] }))) }
      const results = await Promise.all(calls)
      setStats(results[0])
      if (vpIdx >= 0) setVendorPipeline(results[vpIdx])
      if (fuIdx >= 0) setFollowupItems(results[fuIdx] ?? [])
      if (aqIdx >= 0) setAgentQueueCount(results[aqIdx]?.count ?? 0)
      setLastRefresh(new Date())
    } catch (e) {
      console.error(e)
    } finally {
      if (!isSilent) setLoading(false)
    }
  }, [isVendedor, isAgendadora, period, customFrom, customTo, agendaDate])

  useEffect(() => {
    fetchDashboard()
    const id = setInterval(() => fetchDashboard(true), 30000)
    return () => clearInterval(id)
  }, [fetchDashboard])

  // Un único refetch debounced alimentado por AMBOS canales (SSE multi-usuario
  // + bus same-tab). Coalesce el eco del SSE con la emisión local en una sola
  // petición → cero refetch-storm aunque varios usuarios muevan leads a la vez.
  const refreshDashboard = useDebouncedCallback(() => fetchDashboard(true), 350)
  useRealtime(['lead_update', 'pipeline_refresh', 'calendar_update'], refreshDashboard)
  useEffect(() => onLeadChanged(refreshDashboard), [refreshDashboard])

  const handleClearActivity = async () => {
    setClearingActivity(true)
    try {
      await clearDashboard()
      await fetchDashboard()
      toast.success('Actividad limpiada')
    } catch {
      toast.error('Error al limpiar')
    } finally {
      setClearingActivity(false)
    }
  }

  if (loading && !stats) return (
    <div className="flex items-center justify-center h-48">
      <div className="w-8 h-8 border-2 border-lime border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (!stats) return (
    <div className="p-8 text-center text-white/62">Error al cargar datos. Actualiza la página.</div>
  )

  const by = stats.by_stage ?? {}
  const total = stats.total_leads ?? 0
  const totalAll = stats.total_leads_all ?? total
  const todayList: any[] = stats.today_events_list ?? []
  const pastUnmarked: any[] = stats.past_unmarked_events ?? []
  const recoveryCount: number = stats.recovery_count ?? 0
  const unreadMessages: number = stats.unread_messages ?? 0
  const firstUnreadLeadId: number | null = stats.first_unread_lead_id ?? null
  const leadsSinOT: number = stats.leads_sin_ot_count ?? 0

  const now = new Date()
  const todayStr = format(now, 'yyyy-MM-dd')
  const isViewingToday = agendaDate === todayStr
  // Reference point for past/active/future — real time only when viewing today
  const agendaRef = isViewingToday
    ? now
    : agendaDate < todayStr
      ? new Date(agendaDate + 'T23:59:59')
      : new Date(agendaDate + 'T00:00:00')
  const todayPast   = todayList.filter(e => parseLocalDate(e.end_time) < agendaRef)
  const todayActive = todayList.filter(e => parseLocalDate(e.start_time) <= agendaRef && parseLocalDate(e.end_time) >= agendaRef)
  const todayFuture = todayList.filter(e => parseLocalDate(e.start_time) > agendaRef)

  const todayLabel = format(now, "EEEE d 'de' MMMM", { locale: es })

  const navigateAgendaDate = (delta: number) => {
    const newDate = format(addDays(parseISO(agendaDate), delta), 'yyyy-MM-dd')
    setAgendaDate(newDate)
  }

  // Date range presets — shared by vendedor + admin filter bars
  const _dld = (d: Date) => { const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}` }
  const _dtoday = new Date(); const _dtodayStr = _dld(_dtoday)
  const _dweekStart = new Date(_dtoday); _dweekStart.setDate(_dtoday.getDate() - ((_dtoday.getDay()+6)%7))
  const _dmonthStart = new Date(_dtoday.getFullYear(), _dtoday.getMonth(), 1)
  const _dprevMonthStart = new Date(_dtoday.getFullYear(), _dtoday.getMonth()-1, 1)
  const _dprevMonthEnd = new Date(_dtoday.getFullYear(), _dtoday.getMonth(), 0)
  const _dPresets = [
    { label: 'Hoy',         from: _dtodayStr,            to: _dtodayStr },
    { label: 'Esta semana', from: _dld(_dweekStart),      to: _dtodayStr },
    { label: 'Este mes',    from: _dld(_dmonthStart),     to: _dtodayStr },
    { label: 'Mes ant.',    from: _dld(_dprevMonthStart), to: _dld(_dprevMonthEnd) },
  ]

  // ── DANTE ──────────────────────────────────────────────────────
  if (isDante) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Dashboard</h1>
            <p className="text-xs text-white/62 mt-0.5 capitalize">
              {todayLabel} · Actualizado {format(lastRefresh, 'HH:mm')}
            </p>
          </div>
          <button onClick={() => fetchDashboard()} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-surface-1 border border-white/10 rounded-xl font-semibold text-sm hover:bg-surface-0">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Actualizar
          </button>
        </div>

        {(stats.pending_payments ?? 0) > 0 ? (
          <Link to="/pagos"
            className="flex items-center gap-4 p-6 bg-lime/[0.07] border border-lime/25 rounded-2xl hover:bg-lime/10 transition-all shadow-lime/10 shadow-md">
            <div className="w-14 h-14 rounded-2xl bg-lime/15 flex items-center justify-center flex-shrink-0">
              <CreditCard size={26} className="text-white" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold uppercase tracking-widest text-white/52 mb-1">Accion requerida</p>
              <p className="text-3xl font-black text-white leading-none">
                {stats.pending_payments} {stats.pending_payments === 1 ? 'pago pendiente' : 'pagos pendientes'}
              </p>
              <p className="text-sm text-white/52 mt-1">Haz clic para verificar ahora</p>
            </div>
            <ChevronRight size={20} className="text-white/62 flex-shrink-0" />
          </Link>
        ) : (
          <div className="flex items-center gap-4 p-6 bg-surface-0 border border-white/10 rounded-2xl">
            <div className="w-14 h-14 rounded-2xl bg-lime/15 flex items-center justify-center flex-shrink-0">
              <CheckCircle size={26} className="text-white/62" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-white/52 mb-1">Al dia</p>
              <p className="text-2xl font-black text-white/90">Sin pagos pendientes</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-warn/[0.06] rounded-2xl border border-warn/20 p-5 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/52 mb-1">Por verificar</p>
            <p className="text-4xl font-black text-warn">{stats.pending_payments ?? 0}</p>
          </div>
          <div className="bg-lime/[0.06] rounded-2xl border border-lime/20 p-5 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/52 mb-1">Confirmados</p>
            <p className="text-4xl font-black text-lime">{stats.confirmed_payments ?? 0}</p>
          </div>
          <div className="bg-danger/[0.06] rounded-2xl border border-danger/20 p-5 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/52 mb-1">Rechazados</p>
            <p className="text-4xl font-black text-danger">{stats.rejected_payments ?? 0}</p>
          </div>
        </div>

        {stats.payments_by_group?.length > 0 && (
          <div className="bg-surface-1 rounded-2xl border border-white/10 shadow-sm p-5">
            <h2 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <Bell size={15} className="text-warn/70" /> Pendientes por grupo
            </h2>
            <div className="space-y-2">
              {stats.payments_by_group.map((g: any) => (
                <Link key={g.id} to={`/pagos?group_id=${g.id}`}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-0 border border-white/[0.07] hover:bg-surface-2 transition-colors group">
                  <p className="flex-1 text-sm font-semibold text-white/90">{g.name}</p>
                  <span className="text-sm font-bold text-white/85">{g.pending} {g.pending === 1 ? 'pago' : 'pagos'}</span>
                  <ChevronRight size={14} className="text-white/52" />
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── VENDEDOR ───────────────────────────────────────────────────
  if (isVendedor) {
    const pendingMarkCount: number = stats.past_unmarked_count ?? 0
    // Filtered counts matching Mi Pipeline's visibleMeetingItems logic
    const _leadIdsWithStage = new Set([
      ...(vendorPipeline?.cierre ?? []),
      ...(vendorPipeline?.pago_comprometido ?? []),
      ...(vendorPipeline?.pago_pendiente ?? []),
      ...(vendorPipeline?.pagado_reunion ?? []),
    ].map((l: any) => l.lead_id))
    const _normalizePhone = (p?: string | null) => (p ?? '').replace(/\D/g, '')
    const _meetingCaseKey = (ev: any) => ev.lead_id ? `lead:${ev.lead_id}` : _normalizePhone(ev.contact_phone) ? `phone:${_normalizePhone(ev.contact_phone)}` : `event:${ev.id}`
    const _allMeetingEvts = [
      ...(vendorPipeline?.espera_cliente ?? []),
      ...(vendorPipeline?.altamente_interesado ?? []),
      ...(vendorPipeline?.con_exito_pagada ?? []),
      ...(vendorPipeline?.sin_exito ?? []),
      ...(vendorPipeline?.no_show ?? []),
    ].sort((a: any, b: any) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
    const _latestMeetingIds = new Set<number>()
    const _seenCases = new Set<string>()
    _allMeetingEvts.forEach((ev: any) => {
      const key = _meetingCaseKey(ev)
      if (!_seenCases.has(key)) { _seenCases.add(key); _latestMeetingIds.add(ev.id) }
    })
    const _visibleCount = (items: any[]) => items.filter((ev: any) => !_leadIdsWithStage.has(ev.lead_id) && _latestMeetingIds.has(ev.id)).length

    const espera: number = _visibleCount(vendorPipeline?.espera_cliente ?? [])

    if (dashView === 'hoy') {
      const _cierres = vendorPipeline?.cierre?.length ?? 0
      const items = ([
        todayList.length > 0 && <InboxRow key="m" icon={CalendarDays} label="Reuniones de hoy" count={todayList.length} to="/mi-pipeline" tone="primary" />,
        pendingMarkCount > 0 && <InboxRow key="u" icon={CheckCircle} label="Reuniones por marcar resultado" count={pendingMarkCount} to="/mi-pipeline" tone="warn" />,
        _cierres > 0 && <InboxRow key="c" icon={DollarSign} label="Cierres en proceso" count={_cierres} to="/mi-pipeline" tone="ok" />,
        leadsSinOT > 0 && <InboxRow key="ot" icon={ClipboardList} label="Leads sin Orden de Trabajo" count={leadsSinOT} to="/mi-pipeline" tone="danger" />,
      ] as any[]).filter(Boolean)
      return (
        <div className="space-y-3">
          <HoyHeader todayLabel={todayLabel} lastRefresh={lastRefresh} loading={loading} onRefresh={() => fetchDashboard()} view={dashView} onView={setDashView} />
          <NexioCopilotWidget />
          {items.length ? <div className="space-y-2.5">{items}</div> : <InboxEmpty />}
        </div>
      )
    }

    return (
      <div className="space-y-3">
        <DashTabs view={dashView} onChange={setDashView} />
        {/* ── Row 1: Title + refresh ── */}
        <div className="flex items-center justify-between gap-3 flex-shrink-0">
          <div>
            <h1 className="text-xl font-black text-white tracking-tight">Dashboard</h1>
            <p className="text-xs text-white/45 mt-0.5 font-medium capitalize">
              {todayLabel} · Actualizado {format(lastRefresh, 'HH:mm')}
              {(customFrom || customTo) && (
                <span className="ml-2 px-2 py-0.5 rounded-md text-[10px] font-bold bg-neon/15 text-neon border border-neon/25">
                  {customFrom && customTo ? `${customFrom.slice(5)} → ${customTo.slice(5)}` : customFrom || customTo}
                </span>
              )}
            </p>
          </div>
          <button onClick={() => fetchDashboard()} disabled={loading}
            className="w-9 h-9 flex items-center justify-center border border-white/10 rounded-xl bg-surface-1 text-white/50 hover:text-white/85 hover:bg-surface-0 transition-colors flex-shrink-0">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* ── Row 2: Filter bar ── */}
        <div className="flex flex-wrap items-center gap-2 flex-shrink-0 rounded-xl px-3 py-2.5"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: '0 1px 3px rgba(28,22,51,0.05)' }}>

          {/* Period dropdown */}
          <div className="relative">
            <button onClick={() => setPeriodOpen(o => !o)}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-semibold border border-white/10 bg-surface-1 text-white/70 hover:bg-surface-0 transition-colors">
              <CalendarDays size={12} />
              {PERIODS.find(p => p.value === period)?.label ?? 'Período'}
              <ChevronDown size={10} className={`transition-transform ${periodOpen ? 'rotate-180' : ''}`} />
            </button>
            {periodOpen && (
              <div className="absolute left-0 mt-1.5 w-36 rounded-xl z-50 overflow-hidden shadow-xl"
                style={{ background: 'var(--surface-1)', border: '1px solid rgba(255,255,255,0.1)' }}>
                {PERIODS.map(({ value, label }) => (
                  <button key={value} onClick={() => { setPeriod(value as any); setPeriodOpen(false); setCustomFrom(''); setCustomTo(''); setActivePreset(''); fetchDashboard(false, value as any) }}
                    className={`w-full text-left px-3 py-2.5 text-[11px] transition-colors ${period === value && !customFrom && !customTo ? 'font-bold text-neon bg-neon/10' : 'text-white/70 hover:bg-white/5'}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="w-px h-5 bg-white/10 flex-shrink-0" />

          {/* Date presets */}
          <span className="text-[10px] text-white/30 font-semibold uppercase tracking-wider flex-shrink-0">Rango</span>
          {_dPresets.map(p => {
            const active = activePreset === p.label
            return (
              <button key={p.label}
                onClick={() => {
                  if (active) { setCustomFrom(''); setCustomTo(''); setActivePreset('') }
                  else { setCustomFrom(p.from); setCustomTo(p.to); setActivePreset(p.label) }
                }}
                className={`text-[11px] px-2.5 h-8 rounded-lg border transition-colors whitespace-nowrap ${active ? 'bg-neon/20 border-neon/40 text-neon font-bold' : 'border-white/10 bg-surface-1 text-white/50 hover:text-white/80 hover:border-white/20'}`}>
                {p.label}
              </button>
            )
          })}

          {/* Custom date inputs */}
          <input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setActivePreset('') }}
            className="h-8 text-[11px] px-2 rounded-lg border border-white/10 bg-surface-1 text-white/70 focus:outline-none focus:ring-1 focus:ring-neon/40" />
          <span className="text-white/25 text-xs flex-shrink-0">→</span>
          <input type="date" value={customTo} min={customFrom} onChange={e => { setCustomTo(e.target.value); setActivePreset('') }}
            className="h-8 text-[11px] px-2 rounded-lg border border-white/10 bg-surface-1 text-white/70 focus:outline-none focus:ring-1 focus:ring-neon/40" />
          {(customFrom || customTo) && (
            <button onClick={() => { setCustomFrom(''); setCustomTo(''); setActivePreset('') }}
              className="h-8 px-2.5 text-[11px] rounded-lg border border-white/10 bg-surface-1 text-danger/60 hover:text-danger hover:border-danger/30 transition-colors">
              ✕ Limpiar
            </button>
          )}
        </div>

        {/* Alertas urgentes */}
        {(pendingMarkCount > 0 || leadsSinOT > 0) && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/52">Requiere tu atencion</p>
            {pendingMarkCount > 0 && (
              <AlertBanner
                icon={AlertTriangle}
                title={`${pendingMarkCount} reunion${pendingMarkCount > 1 ? 'es' : ''} sin marcar`}
                sub="Tienes reuniones pasadas que no marcaste como Exitosas o Sin exito"
                to="/mi-pipeline"
                color="warn"
              />
            )}
            {leadsSinOT > 0 && (
              <AlertBanner
                icon={ClipboardList}
                title={`${leadsSinOT} lead${leadsSinOT > 1 ? 's' : ''} sin Orden de Trabajo`}
                sub="Tienes leads en Cierre sin OT — créala antes de avanzar"
                to="/mi-pipeline?sin_ot=1"
                color="danger"
              />
            )}
          </div>
        )}

        {/* KPIs compactos */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            {
              to: '/mi-pipeline', label: 'En proceso de reunión', value: espera, icon: Clock, color: '#f59e0b', dim: 'rgba(245,158,11,0.12)',
              sub: 'Clientes con reunión agendada que aún no se realiza',
              action: 'Click para verlos en Mi Pipeline',
            },
            {
              to: '/mi-pipeline', label: 'Altamente Interesado', value: _visibleCount(vendorPipeline?.altamente_interesado ?? []), icon: ThumbsUp, color: 'var(--zx-accent-text)', dim: 'rgba(53,122,14,0.12)',
              sub: 'Tuvieron su reunión y quieren avanzar — hay que cerrarlos',
              action: 'Click para verlos en Mi Pipeline',
            },
            {
              to: '/agenda', label: 'Reuniones hoy', value: todayList.length, icon: CalendarDays, color: 'var(--zx-lime)', dim: 'rgba(6,182,212,0.12)',
              sub: 'Reuniones agendadas para hoy en tu agenda',
              action: 'Click para ir a la agenda',
            },
          ].map(({ to, label, value, icon: Icon, color, dim, sub, action }) => (
            <Link key={label} to={to}
              className="rounded-xl px-4 py-3.5 flex items-start gap-3.5 transition-all hover:shadow-card-lg hover:-translate-y-0.5 group"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: '0 1px 3px rgba(28,22,51,0.05)' }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: dim }}>
                <Icon size={16} style={{ color }} />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-black leading-none" style={{ color }}>{value}</p>
                <p className="text-[11px] font-bold mt-1 leading-tight" style={{ color: 'var(--text-2)' }}>{label}</p>
                <p className="text-[10px] font-medium mt-0.5 leading-snug" style={{ color: 'var(--text-3)' }}>{sub}</p>
                <p className="text-[9px] font-bold mt-1 flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity" style={{ color }}>
                  {action} <ArrowRight size={9} />
                </p>
              </div>
            </Link>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Columna izquierda: Mi Pipeline */}
          <div className="space-y-4">
            <div className="bg-surface-1 rounded-2xl border border-white/10 shadow-sm p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="font-semibold text-sm flex items-center gap-2">
                    <GitBranch size={15} className="text-lime/70" /> Mi Pipeline
                  </h2>
                  <p className="text-[11px] text-white/52 mt-0.5">En qué etapa del proceso está cada uno de tus clientes</p>
                </div>
                <Link to="/mi-pipeline" className="text-xs text-white/52 hover:text-white/85 flex items-center gap-1 flex-shrink-0 mt-0.5">
                  Ver completo <ChevronRight size={11} />
                </Link>
              </div>
              <div className="space-y-2">
                {[
                  { key: 'espera_cliente',       label: 'En proceso de reunión', dot: 'bg-warn',        count: _visibleCount(vendorPipeline?.espera_cliente ?? []), desc: 'Reunión agendada, aún no se realiza' },
                  { key: 'altamente_interesado', label: 'Altamente Interesado',  dot: 'bg-lime',        count: _visibleCount(vendorPipeline?.altamente_interesado ?? []), desc: 'Tuvo su reunión y quiere avanzar — ciérralo' },
                  { key: 'cierre',               label: 'Cierre',                dot: 'bg-brand-400',    count: vendorPipeline?.cierre?.length ?? 0, desc: 'Negociando el contrato y la forma de pago' },
                  { key: 'pago_comprometido',    label: 'Pago Comprometido',     dot: 'bg-neon',        count: vendorPipeline?.pago_comprometido?.length ?? 0, desc: 'Se comprometió a pagar en una fecha' },
                  { key: 'pago_pendiente',       label: 'Pago Pendiente',        dot: 'bg-brand-400',     count: vendorPipeline?.pago_pendiente?.length ?? 0, desc: 'Cerró el servicio, falta que pague' },
                  { key: 'pagado_reunion',       label: 'Validando Pago Reunión', dot: 'bg-emerald-400', count: vendorPipeline?.pagado_reunion?.length ?? 0, desc: 'Declaró su pago, en validación' },
                ].map(row => (
                  <Link key={row.key} to="/mi-pipeline" title={row.desc} className="block px-3 py-2 rounded-xl bg-surface-0 border border-white/[0.07] hover:bg-surface-2 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${row.dot}`} />
                        <span className="text-xs font-bold text-white/85">{row.label}</span>
                      </div>
                      <span className="text-sm font-bold text-white/85">{row.count}</span>
                    </div>
                    <p className="text-[10px] text-white/45 leading-snug pl-4 mt-0.5">{row.desc}</p>
                  </Link>
                ))}
                {(() => {
                  const n = _visibleCount(vendorPipeline?.sin_exito ?? []) + _visibleCount(vendorPipeline?.no_show ?? [])
                  return n > 0 ? (
                    <Link to="/mi-pipeline" title="Reuniones que fallaron — la agendadora debe reagendar" className="block px-3 py-2 rounded-xl bg-surface-0 border border-danger/20 hover:bg-surface-2 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full flex-shrink-0 bg-danger" />
                          <span className="text-xs font-bold text-danger/85">Sin éxito / No conectó</span>
                        </div>
                        <span className="text-sm font-bold text-danger/85">{n}</span>
                      </div>
                      <p className="text-[10px] text-white/45 leading-snug pl-4 mt-0.5">Reunión fallida o cliente no se conectó — se reagendará</p>
                    </Link>
                  ) : null
                })()}
              </div>
            </div>

            {/* Actividad reciente */}
            <div className="bg-surface-1 rounded-2xl border border-white/10 shadow-sm p-5">
              <h2 className="font-semibold text-sm flex items-center gap-2">
                <Clock size={15} className="text-neon/70" /> Actividad reciente
              </h2>
              <p className="text-[11px] text-white/52 mt-0.5 mb-3">Últimos movimientos de etapa de tus leads</p>
              <div className="space-y-2 max-h-[260px] overflow-y-auto">
                {stats.recent_activity?.length > 0 ? stats.recent_activity.map((a: any) => (
                  <div key={a.id} className="p-2.5 bg-surface-0 rounded-xl border border-white/[0.07]">
                    <p className="text-[11px] text-white/95">
                      <span className="font-bold">{a.user}</span>
                      {' · '}
                      <span className="text-white/62">{fmtAction(a.action)}</span>
                    </p>
                    <p className="text-[9px] text-white/65 mt-0.5">
                      {a.contact_name} · {format(parseAsUTC(a.time), "d MMM HH:mm", { locale: es })}
                    </p>
                  </div>
                )) : (
                  <p className="text-center py-6 text-[10px] text-white/38">Sin actividad registrada.</p>
                )}
              </div>
            </div>
          </div>

          {/* Columna derecha: Agenda + Reuniones sin marcar */}
          <div className="space-y-4">
            <div className="bg-surface-1 rounded-2xl border border-white/10 shadow-sm p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="font-semibold text-sm flex items-center gap-2">
                    <CalendarDays size={15} className="text-white/52" />
                    <span className="capitalize">Hoy — {format(now, "d 'de' MMMM", { locale: es })}</span>
                  </h2>
                  <p className="text-[11px] text-white/52 mt-0.5">
                    {todayList.length === 0
                      ? 'Tus reuniones de hoy'
                      : `${todayList.length} reunion${todayList.length !== 1 ? 'es' : ''}` +
                        (todayFuture.length > 0 ? ` · ${todayFuture.length} por realizar` : '') +
                        (todayActive.length > 0 ? ` · ${todayActive.length} en curso` : '') +
                        (todayPast.length > 0 ? ` · ${todayPast.length} ya pasaron` : '')}
                  </p>
                </div>
                <Link to="/agenda" className="text-xs text-white/52 hover:text-white/85 flex items-center gap-1 flex-shrink-0 mt-0.5">
                  Agenda completa <ChevronRight size={11} />
                </Link>
              </div>
              {todayList.length === 0 ? (
                <div className="py-8 text-center">
                  <CalendarDays size={28} className="mx-auto text-white/15 mb-2" />
                  <p className="text-xs text-white/52">Sin reuniones programadas para hoy</p>
                  <Link to="/agenda" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-white/78 hover:underline">
                    Ir a agenda <ChevronRight size={11} />
                  </Link>
                </div>
              ) : (
                <>
                <div className="space-y-1.5">
                  {[...todayActive, ...todayFuture, ...todayPast].map(ev => (
                    <EventRow key={ev.id} ev={ev} onClick={() => { setSelectedEvent(ev); setShowEventModal(true) }} />
                  ))}
                </div>
                {/* Leyenda de estados */}
                <div className="mt-3 pt-3 flex items-center gap-x-3 gap-y-1 flex-wrap border-t border-white/[0.07]">
                  <p className="text-[9px] font-bold uppercase tracking-wide text-white/38">Qué significa cada estado:</p>
                  <span className="text-[10px] text-white/52"><span className="font-bold" style={{ color: 'var(--zx-lime)' }}>Programada</span> = aún no ocurre</span>
                  <span className="text-[10px] text-white/52"><span className="font-bold text-lime">Exitosa</span> = cliente quiere avanzar</span>
                  <span className="text-[10px] text-white/52"><span className="font-bold text-danger">Sin éxito</span> = no cerró</span>
                  <span className="text-[10px] text-white/52"><span className="font-bold text-warn">Sin marcar</span> = falta registrar resultado</span>
                </div>
                </>
              )}
            </div>

            {/* Reuniones sin marcar */}
            {pastUnmarked.length > 0 && (
              <div className="bg-surface-1 rounded-2xl border border-white/10 shadow-sm p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="font-semibold text-sm flex items-center gap-2 text-white/85">
                      <AlertTriangle size={15} className="text-white/52" />
                      Reuniones pasadas sin marcar
                    </h2>
                    <p className="text-[11px] text-white/52 mt-0.5">Ya ocurrieron pero no registraste el resultado — márcalas Exitosa o Sin éxito para que el lead avance</p>
                  </div>
                  <Link to="/mi-pipeline" className="text-xs font-semibold text-white/78 hover:text-white flex items-center gap-1 flex-shrink-0 mt-0.5">
                    Marcar ahora <ChevronRight size={11} />
                  </Link>
                </div>
                <div className="space-y-1.5">
                  {pastUnmarked.slice(0, 5).map((ev: any) => (
                    <div key={ev.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-surface-0 border border-white/[0.07]">
                      <AlertTriangle size={13} className="text-white/52 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white/90 truncate">{ev.title}</p>
                        <p className="text-[10px] text-white/62">
                          {ev.contact_name && <>{ev.contact_name} · </>}
                          {format(parseLocalDate(ev.start_time), "d MMM, HH:mm", { locale: es })}
                        </p>
                      </div>
                      <Link to="/mi-pipeline" className="text-[10px] font-bold text-white/78 hover:text-white flex-shrink-0">
                        Marcar
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {showEventModal && (
          <EventModal
            event={selectedEvent}
            vendors={[]}
            onClose={() => setShowEventModal(false)}
            onSaved={() => { setShowEventModal(false); fetchDashboard() }}
          />
        )}
        {detailModal && (
          <DashboardDetailModal
            metric={detailModal}
            period={period}
            dateFrom={customFrom}
            dateTo={customTo}
            onClose={() => setDetailModal(null)}
          />
        )}
      </div>
    )
  }

  // ── AGENDADORA ─────────────────────────────────────────────────
  if (isAgendadora) {
    const urgentCount = (agentQueueCount > 0 ? 1 : 0) + (leadsSinOT > 0 ? 1 : 0) + (recoveryCount > 0 ? 1 : 0) + (unreadMessages > 0 ? 1 : 0) + (stats.cold_leads_count > 0 ? 1 : 0)
    const hasFollowups = followupItems.length > 0
    const meetingsOrdered = [...todayActive, ...todayFuture, ...todayPast]

    if (dashView === 'hoy') {
      const _newLeads = by.lead ?? 0
      const _chatTo = firstUnreadLeadId ? `/leads?chat=${firstUnreadLeadId}` : '/leads'
      const items = ([
        _newLeads > 0 && <InboxRow key="nl" icon={Users} label="Leads nuevos sin agendar" count={_newLeads} to="/pipeline" tone="primary" />,
        unreadMessages > 0 && <InboxRow key="ch" icon={MessageSquare} label="Chats sin responder" count={unreadMessages} to={_chatTo} tone="warn" />,
        agentQueueCount > 0 && <InboxRow key="ia" icon={Bot} label="Leads del Agente IA por revisar" count={agentQueueCount} to="/agente-ia" tone="primary" />,
        meetingsOrdered.length > 0 && <InboxRow key="mt" icon={CalendarDays} label="Reuniones de hoy" count={meetingsOrdered.length} to="/calendario" tone="primary" />,
        followupItems.length > 0 && <InboxRow key="fu" icon={Clock} label="Seguimientos pendientes" count={followupItems.length} to="/seguimiento" tone="warn" />,
        recoveryCount > 0 && <InboxRow key="rc" icon={AlertCircle} label="Leads en recuperación" count={recoveryCount} to="/pipeline" tone="danger" />,
      ] as any[]).filter(Boolean)
      return (
        <div className="space-y-3">
          <HoyHeader todayLabel={todayLabel} lastRefresh={lastRefresh} loading={loading} onRefresh={() => fetchDashboard()} view={dashView} onView={setDashView} />
          <NexioCopilotWidget />
          {items.length ? <div className="space-y-2.5">{items}</div> : <InboxEmpty />}
        </div>
      )
    }

    return (
      <div className="space-y-6 pb-4">

        <DashTabs view={dashView} onChange={setDashView} />
        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>Dashboard</h1>
            <p className="text-xs mt-0.5 capitalize" style={{ color: 'var(--text-3)' }}>
              {todayLabel} · Actualizado {format(lastRefresh, 'HH:mm')}
            </p>
          </div>
          {/* Date navigator + Actualizar */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="flex items-center rounded-xl overflow-hidden flex-shrink-0"
              style={{ border: '1.5px solid var(--border-2)', background: 'var(--surface-1)' }}>
              <button
                onClick={() => navigateAgendaDate(-1)}
                className="px-3 py-2.5 transition-colors hover:bg-black/[0.05] flex items-center"
                style={{ color: 'var(--text-2)', borderRight: '1px solid var(--border)' }}
                title="Día anterior"
              >
                <ChevronLeft size={15} />
              </button>
              <div
                className="relative px-5 py-2 cursor-pointer hover:bg-black/[0.03] transition-colors select-none"
                onClick={() => agendaDateInputRef.current?.showPicker()}
              >
                <div className="flex items-center gap-2">
                  {isViewingToday && (
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(6,182,212,0.12)', color: 'var(--zx-lime)' }}>Hoy</span>
                  )}
                  <span className="text-sm font-semibold capitalize" style={{ color: 'var(--text)' }}>
                    {format(parseISO(agendaDate), "EEEE d 'de' MMMM", { locale: es })}
                  </span>
                  <CalendarDays size={13} style={{ color: 'var(--text-3)' }} />
                </div>
                <input
                  ref={agendaDateInputRef}
                  type="date"
                  value={agendaDate}
                  max={todayStr}
                  onChange={e => e.target.value && setAgendaDate(e.target.value)}
                  className="absolute opacity-0 pointer-events-none"
                  style={{ top: '100%', left: 0 }}
                />
              </div>
              <button
                onClick={() => navigateAgendaDate(+1)}
                disabled={agendaDate >= todayStr}
                className="px-3 py-2.5 transition-colors hover:bg-black/[0.05] flex items-center disabled:opacity-25"
                style={{ color: 'var(--text-2)', borderLeft: '1px solid var(--border)' }}
                title="Día siguiente"
              >
                <ChevronRight size={15} />
              </button>
            </div>
            {!isViewingToday && (
              <button
                onClick={() => setAgendaDate(todayStr)}
                className="px-3 py-2.5 rounded-xl text-xs font-bold text-white transition-all hover:opacity-90 flex-shrink-0"
                style={{ background: 'var(--zx-lime)' }}
              >
                Ir a hoy
              </button>
            )}
            <button
              onClick={() => fetchDashboard()}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-colors flex-shrink-0"
              style={{ background: 'var(--surface-1)', borderColor: 'var(--border-2)', color: 'var(--text-2)' }}
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              Actualizar
            </button>
          </div>
        </div>

        {/* ── KPIs ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: 'Total de leads', value: totalAll, icon: Users, numColor: 'var(--text)',
              sub: 'Todos los clientes registrados en el sistema, en cualquier etapa',
              action: 'Click para ver la lista completa',
              iconBg: 'rgba(28,22,51,0.07)', iconColor: 'var(--text-2)',
              onClick: () => setAgDetail({ metric: 'active', title: 'Total de leads en el sistema', subtitle: 'todos los clientes registrados', dateFrom: '2000-01-01', dateTo: todayStr }),
            },
            {
              label: 'Nuevos hoy', value: stats.today_leads ?? 0, icon: TrendingUp, numColor: 'var(--zx-accent-text)',
              sub: 'Leads que ingresaron hoy y aún no tienen reunión',
              action: 'Click para ver quiénes son',
              iconBg: 'rgba(53,122,14,0.12)', iconColor: 'var(--zx-accent-text)',
              onClick: () => setAgDetail({ metric: 'active', title: 'Leads nuevos de hoy', subtitle: `ingresaron el ${format(now, "d 'de' MMMM", { locale: es })}`, dateFrom: todayStr, dateTo: todayStr }),
            },
            {
              label: 'En recuperación', value: recoveryCount, icon: AlertTriangle, numColor: '#e11d48',
              sub: 'Clientes que se perdieron en el proceso — hay que reagendarlos',
              action: 'Click para ver cuáles son',
              iconBg: 'rgba(225,29,72,0.10)', iconColor: '#e11d48',
              onClick: () => setAgDetail({ metric: 'recovery', title: 'Leads en recuperación', subtitle: 'necesitan una nueva reunión', dateFrom: '2000-01-01', dateTo: todayStr }),
            },
            {
              label: 'Reuniones hoy', value: todayList.length, icon: CalendarDays, numColor: 'var(--zx-lime)',
              sub: `Reuniones agendadas para ${isViewingToday ? 'hoy' : 'el día seleccionado'} en tu agenda`,
              action: 'Click para ir a la agenda',
              iconBg: 'rgba(6,182,212,0.12)', iconColor: 'var(--zx-lime)',
              onClick: () => agendaSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
            },
          ].map(({ label, value, icon: Icon, numColor, sub, action, iconBg, iconColor, onClick }) => (
            <button key={label} onClick={onClick}
              className="rounded-xl p-4 flex flex-col gap-2 text-left transition-all hover:shadow-md hover:-translate-y-0.5 cursor-pointer group"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: '0 1px 3px rgba(28,22,51,0.05)' }}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold leading-tight" style={{ color: 'var(--text-2)' }}>{label}</p>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: iconBg }}>
                  <Icon size={15} style={{ color: iconColor }} />
                </div>
              </div>
              <p className="text-3xl font-black leading-none" style={{ color: numColor }}>{value}</p>
              <p className="text-[11px] font-medium leading-snug" style={{ color: 'var(--text-3)' }}>{sub}</p>
              <p className="text-[10px] font-bold flex items-center gap-1 mt-auto opacity-60 group-hover:opacity-100 transition-opacity" style={{ color: iconColor === 'var(--text-2)' ? 'var(--text-3)' : iconColor }}>
                {action} <ArrowRight size={10} />
              </p>
            </button>
          ))}
        </div>

        {/* ── Alertas urgentes ── */}
        {urgentCount > 0 && (
          <div className="rounded-2xl overflow-hidden" style={{ border: '1.5px solid rgba(255,165,0,0.45)', background: 'rgba(255,165,0,0.07)' }}>
            <div className="flex items-center gap-3 px-5 py-3" style={{ borderBottom: '1px solid rgba(255,165,0,0.25)', background: 'rgba(255,165,0,0.12)' }}>
              <Bell size={16} className="text-warn flex-shrink-0" />
              <p className="text-sm font-bold text-warn">Requiere tu atención</p>
              <span className="ml-auto w-6 h-6 rounded-full bg-warn text-black text-xs font-black flex items-center justify-center">{urgentCount}</span>
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {agentQueueCount > 0 && (
                <Link to="/agente-ia" className="flex items-center gap-4 px-5 py-4 hover:bg-black/[0.03] transition-colors group">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(53,122,14,0.14)' }}>
                    <Bot size={18} style={{ color: 'var(--zx-accent-text)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>{agentQueueCount} lead{agentQueueCount > 1 ? 's' : ''} del Agente IA esperando</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Clientes atendidos fuera de horario — dar seguimiento</p>
                  </div>
                  <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg text-white flex-shrink-0" style={{ background: 'var(--zx-accent-text)' }}>
                    Revisar <ArrowRight size={12} />
                  </span>
                </Link>
              )}
              {unreadMessages > 0 && (
                <Link
                  to={firstUnreadLeadId ? '/leads' : '/whatsapp'}
                  state={firstUnreadLeadId ? { openLeadId: firstUnreadLeadId } : undefined}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-black/[0.03] transition-colors group"
                >
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(6,182,212,0.14)' }}>
                    <MessageSquare size={18} style={{ color: 'var(--zx-lime)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>{unreadMessages} mensaje{unreadMessages > 1 ? 's' : ''} sin leer</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Clientes esperando respuesta en WhatsApp</p>
                  </div>
                  <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg text-white flex-shrink-0" style={{ background: 'var(--zx-lime)' }}>
                    Responder <ArrowRight size={12} />
                  </span>
                </Link>
              )}
              {recoveryCount > 0 && (
                <Link to="/leads" className="flex items-center gap-4 px-5 py-4 hover:bg-black/[0.03] transition-colors group">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(225,29,72,0.10)' }}>
                    <AlertTriangle size={18} className="text-danger" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>{recoveryCount} lead{recoveryCount > 1 ? 's' : ''} en recuperación</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Casos urgentes — agenda nueva reunión lo antes posible</p>
                  </div>
                  <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg text-danger flex-shrink-0 border border-danger/30 bg-danger/10">
                    Ver <ArrowRight size={12} />
                  </span>
                </Link>
              )}
              {leadsSinOT > 0 && (
                <Link to="/pipeline?sin_ot=1" className="flex items-center gap-4 px-5 py-4 hover:bg-black/[0.03] transition-colors group">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(225,29,72,0.10)' }}>
                    <ClipboardList size={18} className="text-danger" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>{leadsSinOT} lead{leadsSinOT > 1 ? 's' : ''} sin Orden de Trabajo</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>En Cierre sin OT — el vendedor debe crearla antes de avanzar</p>
                  </div>
                  <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg text-danger flex-shrink-0 border border-danger/30 bg-danger/10">
                    Ver <ArrowRight size={12} />
                  </span>
                </Link>
              )}
              {stats.cold_leads_count > 0 && (
                <Link to="/leads" className="flex items-center gap-4 px-5 py-4 hover:bg-black/[0.03] transition-colors group">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(245,158,11,0.10)' }}>
                    <Clock size={18} className="text-warn" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>{stats.cold_leads_count} lead{stats.cold_leads_count > 1 ? 's' : ''} sin interacción por más de 3 días</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Sin ninguna acción registrada — revisar estado</p>
                  </div>
                  <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg text-warn flex-shrink-0 border border-warn/30 bg-warn/10">
                    Ver <ArrowRight size={12} />
                  </span>
                </Link>
              )}
            </div>
          </div>
        )}

        {/* ── Layout principal ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Columna izquierda + centro: Agenda + Reagendar */}
          <div className="lg:col-span-2 space-y-5">

            {/* Agenda del día */}
            <div ref={agendaSectionRef} className="rounded-2xl overflow-hidden scroll-mt-4" style={{ background: 'var(--surface-1)', border: '1.5px solid var(--border-2)' }}>
              <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(6,182,212,0.14)' }}>
                    <CalendarDays size={17} style={{ color: 'var(--zx-lime)' }} />
                  </div>
                  <div>
                    <h2 className="text-base font-bold leading-tight" style={{ color: 'var(--text)' }}>
                      {isViewingToday ? 'Agenda de hoy' : 'Agenda'}
                    </h2>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                      <span className="capitalize">{format(parseISO(agendaDate), "EEEE d 'de' MMMM", { locale: es })}</span>
                      {meetingsOrdered.length > 0 && (
                        <span> · {meetingsOrdered.length} reunion{meetingsOrdered.length !== 1 ? 'es' : ''}
                          {todayFuture.length > 0 && ` · ${todayFuture.length} por realizar`}
                          {todayActive.length > 0 && ` · ${todayActive.length} en curso`}
                          {todayPast.length > 0 && ` · ${todayPast.length} ya pasaron`}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <Link
                  to="/calendario"
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all hover:opacity-90"
                  style={{ background: 'var(--zx-lime)', color: '#fff', border: '1.5px solid var(--zx-lime)' }}
                >
                  <Calendar size={13} /> Ver calendario
                </Link>
              </div>

              {meetingsOrdered.length === 0 ? (
                <div className="py-12 text-center flex flex-col items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'var(--surface-3)' }}>
                    <CalendarDays size={24} style={{ color: 'var(--text-muted)' }} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-2)' }}>Sin reuniones programadas para hoy</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Las reuniones agendadas aparecerán aquí</p>
                  </div>
                </div>
              ) : (
                <>
                <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {meetingsOrdered.map(ev => {
                    const start = parseLocalDate(ev.start_time)
                    const end = parseLocalDate(ev.end_time)
                    const isNowEv = parseLocalDate(ev.start_time) <= now && parseLocalDate(ev.end_time) >= now
                    const isPastEv = parseLocalDate(ev.end_time) < now
                    const isSuccess = ev.vendor_status === 'altamente_interesado'
                    const isFail = ev.vendor_status === 'sin_exito'
                    const isNoShow = ev.vendor_status === 'no_show'
                    const isUnmarked = isPastEv && !ev.vendor_status
                    const accent = isNowEv ? 'var(--zx-lime)' : isSuccess ? 'var(--zx-accent-text)' : (isFail || isNoShow) ? '#e11d48' : isPastEv ? 'rgba(28,22,51,0.25)' : 'var(--zx-accent-text)'
                    return (
                      <div
                        key={ev.id}
                        onClick={() => { setSelectedEvent(ev); setShowEventModal(true) }}
                        className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-black/[0.03] transition-colors"
                        style={{ opacity: isPastEv && !isNowEv ? 0.70 : 1 }}
                        title="Click para ver el detalle completo de la reunión"
                      >
                        <div className="w-1.5 h-14 rounded-full flex-shrink-0" style={{ background: accent }} />
                        <div className="w-16 text-center flex-shrink-0">
                          <p className="text-xl font-black leading-tight" style={{ color: isNowEv ? 'var(--zx-lime)' : 'var(--text)' }}>
                            {format(start, 'HH:mm')}
                          </p>
                          <p className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                            hasta {format(end, 'HH:mm')}
                          </p>
                          {isNowEv && (
                            <span className="text-[10px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full" style={{ background: 'var(--zx-lime)', color: '#fff' }}>AHORA</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold truncate" style={{ color: 'var(--text)' }}>{ev.contact_name || ev.title}</p>
                          {ev.title && ev.contact_name && (
                            <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-3)' }}>{ev.title}</p>
                          )}
                          <p className="text-[11px] mt-0.5 flex items-center gap-x-2.5 gap-y-0.5 flex-wrap" style={{ color: 'var(--text-muted)' }}>
                            {ev.contact_phone && <span className="inline-flex items-center gap-1"><Phone size={9} /> {ev.contact_phone}</span>}
                            {ev.vendor_name && <span>Vendedor: <span className="font-semibold" style={{ color: 'var(--text-3)' }}>{ev.vendor_name}</span></span>}
                            {ev.area && <span>Área: <span className="font-semibold" style={{ color: 'var(--text-3)' }}>{ev.area}</span></span>}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {isSuccess && <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-lime/20 text-lime border border-lime/40" title="La reunión se realizó y el cliente quiere avanzar">Exitosa</span>}
                          {isFail && <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-danger/20 text-danger border border-danger/40" title="La reunión se realizó pero el cliente no cerró">Sin éxito</span>}
                          {isNoShow && <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-warn/20 text-warn border border-warn/40" title="El cliente no se conectó a la reunión">No se conectó</span>}
                          {isUnmarked && <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-warn/20 text-warn border border-warn/40" title="La reunión ya pasó pero el vendedor aún no registra el resultado">Sin marcar</span>}
                          {!isPastEv && !isNowEv && !ev.vendor_status && <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(6,182,212,0.10)', color: 'var(--zx-lime)', border: '1px solid rgba(6,182,212,0.30)' }} title="Reunión agendada que aún no ocurre">Programada</span>}
                          <ChevronRight size={15} style={{ color: 'var(--text-muted)' }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
                {/* Leyenda de estados */}
                <div className="px-5 py-3 flex items-center gap-x-4 gap-y-1 flex-wrap" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Qué significa cada estado:</p>
                  <span className="text-[11px]" style={{ color: 'var(--text-3)' }}><span className="font-bold" style={{ color: 'var(--zx-lime)' }}>Programada</span> = aún no ocurre</span>
                  <span className="text-[11px]" style={{ color: 'var(--text-3)' }}><span className="font-bold text-lime">Exitosa</span> = cliente quiere avanzar</span>
                  <span className="text-[11px]" style={{ color: 'var(--text-3)' }}><span className="font-bold text-danger">Sin éxito</span> = no cerró</span>
                  <span className="text-[11px]" style={{ color: 'var(--text-3)' }}><span className="font-bold text-warn">Sin marcar</span> = vendedor no registró resultado</span>
                </div>
                </>
              )}
            </div>

            {/* Reagendar reuniones */}
            {hasFollowups && (
              <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1.5px solid rgba(245,158,11,0.40)' }}>
                <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(245,158,11,0.25)', background: 'rgba(245,158,11,0.08)' }}>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(245,158,11,0.18)' }}>
                      <CalendarPlus size={17} className="text-warn" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold leading-tight" style={{ color: 'var(--text)' }}>Reuniones para reagendar</h2>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Clientes que necesitan nueva cita</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full bg-warn text-white text-sm font-black flex items-center justify-center">{followupItems.length}</span>
                    <Link to="/seguimiento" className="text-xs font-bold hover:underline transition-colors" style={{ color: 'var(--text-3)' }}>
                      Ver todos
                    </Link>
                  </div>
                </div>
                <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {followupItems.slice(0, 6).map((item: any) => {
                    const isNoShow = item.vendor_status === 'no_show'
                    return (
                      <div key={item.id} className="flex items-start gap-4 px-5 py-4">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${isNoShow ? 'bg-warn/15' : 'bg-danger/15'}`}>
                          {isNoShow ? <WifiOff size={17} className="text-warn" /> : <XCircle size={17} className="text-danger" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>{item.contact_name ?? item.title}</p>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isNoShow ? 'bg-warn/15 text-warn border border-warn/25' : 'bg-danger/15 text-danger border border-danger/25'}`}>
                              {isNoShow ? 'No se conectó' : 'No cerró'}
                            </span>
                          </div>
                          {item.vendor_name && (
                            <p className="text-xs" style={{ color: 'var(--text-3)' }}>Vendedor: <span className="font-semibold" style={{ color: 'var(--text-2)' }}>{item.vendor_name}</span></p>
                          )}
                          {item.outcome_note && (
                            <p className="text-xs mt-1 italic leading-relaxed" style={{ color: 'var(--text-3)' }}>"{item.outcome_note}"</p>
                          )}
                          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{format(new Date(item.start_time), "d 'de' MMMM · HH:mm", { locale: es })}</p>
                        </div>
                        {item.lead_id && (
                          <button
                            onClick={() => navigate('/leads', { state: { openLeadId: item.lead_id } })}
                            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold flex-shrink-0 mt-0.5 transition-all hover:opacity-90 text-white"
                            style={{ background: '#10b981', border: '1px solid #10b981' }}
                          >
                            <CalendarPlus size={13} /> Reagendar
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
                {followupItems.length > 6 && (
                  <Link to="/seguimiento"
                    className="flex items-center justify-center gap-2 py-3 text-sm font-semibold hover:bg-black/[0.03] transition-colors"
                    style={{ borderTop: '1px solid var(--border)', color: 'var(--text-2)' }}
                  >
                    Ver los {followupItems.length - 6} restantes <ChevronRight size={14} />
                  </Link>
                )}
              </div>
            )}

            {/* Actividad reciente */}
            <div className="rounded-2xl p-5" style={{ background: 'var(--surface-1)', border: '1.5px solid var(--border-2)' }}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-base font-bold flex items-center gap-2" style={{ color: 'var(--text)' }}>
                    <Clock size={16} className="text-neon" /> Actividad reciente
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Últimos movimientos del equipo sobre los leads</p>
                </div>
                <button
                  onClick={handleClearActivity}
                  disabled={clearingActivity || !stats.recent_activity?.length}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold hover:text-danger transition-colors disabled:opacity-25"
                  style={{ color: 'var(--text-muted)', border: '1px solid var(--border-2)' }}
                >
                  <Trash2 size={11} /> Limpiar
                </button>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {stats.recent_activity?.length > 0 ? stats.recent_activity.map((a: any) => (
                  <div key={a.id} className="px-3 py-2.5 rounded-xl" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                    <p className="text-xs font-bold" style={{ color: 'var(--text)' }}>
                      {a.user} <span className="font-normal" style={{ color: 'var(--text-3)' }}>· {fmtAction(a.action)}</span>
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {a.contact_name} · {format(parseAsUTC(a.time), "d MMM · HH:mm", { locale: es })}
                    </p>
                  </div>
                )) : (
                  <div className="py-8 text-center">
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sin actividad registrada</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Columna derecha: Acciones rápidas + Pipeline */}
          <div className="space-y-5">

            {/* Acciones rápidas */}
            <div className="rounded-2xl p-5" style={{ background: 'var(--surface-1)', border: '1.5px solid var(--border-2)' }}>
              <h2 className="text-base font-bold flex items-center gap-2" style={{ color: 'var(--text)' }}>
                <ThumbsUp size={16} className="text-lime" /> Acciones rápidas
              </h2>
              <p className="text-xs mt-0.5 mb-4" style={{ color: 'var(--text-3)' }}>Atajos a tus tareas más frecuentes</p>
              <div className="space-y-2">
                {[
                  { to: '/calendario', icon: CalendarPlus, label: 'Nueva reunión', sub: 'Agendar cita con cliente', accent: 'var(--zx-accent-text)', bg: 'rgba(53,122,14,0.08)', border: 'rgba(53,122,14,0.28)', iconBg: 'rgba(53,122,14,0.14)' },
                  { to: '/whatsapp', icon: MessageSquare, label: 'WhatsApp', sub: unreadMessages > 0 ? `${unreadMessages} mensajes sin leer` : 'Chat con clientes', accent: 'var(--zx-lime)', bg: 'rgba(6,182,212,0.08)', border: 'rgba(6,182,212,0.28)', iconBg: 'rgba(6,182,212,0.14)', badge: unreadMessages > 0 ? unreadMessages : 0 },
                  { to: '/agente-ia', icon: Bot, label: 'Agente IA', sub: agentQueueCount > 0 ? `${agentQueueCount} leads pendientes` : 'Leads fuera de horario', accent: '#6366f1', bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.28)', iconBg: 'rgba(99,102,241,0.14)', badge: agentQueueCount > 0 ? agentQueueCount : 0 },
                  { to: '/leads', icon: Users, label: 'Ver todos los leads', sub: `${totalAll} leads en total`, accent: 'var(--text)', bg: 'var(--surface-2)', border: 'var(--border-2)', iconBg: 'var(--surface-3)' },
                  { to: '/pipeline', icon: GitBranch, label: 'Pipeline del grupo', sub: 'Ver embudo de ventas', accent: 'var(--text)', bg: 'var(--surface-2)', border: 'var(--border-2)', iconBg: 'var(--surface-3)' },
                ].map(({ to, icon: Icon, label, sub, accent, bg, border, iconBg, badge }) => (
                  <Link key={to + label} to={to}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all hover:brightness-95 relative"
                    style={{ background: bg, border: `1.5px solid ${border}` }}
                  >
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: iconBg }}>
                      <Icon size={16} style={{ color: accent }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold" style={{ color: accent }}>{label}</p>
                      <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>{sub}</p>
                    </div>
                    {(badge as number) > 0 && (
                      <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-black text-white flex-shrink-0" style={{ background: accent as string }}>
                        {badge as number > 9 ? '9+' : badge as number}
                      </span>
                    )}
                    <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} className="flex-shrink-0" />
                  </Link>
                ))}
              </div>
            </div>

            {/* Pipeline resumen */}
            <div className="rounded-2xl p-5" style={{ background: 'var(--surface-1)', border: '1.5px solid var(--border-2)' }}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-base font-bold flex items-center gap-2" style={{ color: 'var(--text)' }}>
                    <GitBranch size={16} className="text-lime" /> Pipeline del grupo
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>En qué etapa del proceso de venta está cada lead</p>
                </div>
                <Link to="/pipeline" className="text-xs font-bold hover:underline transition-colors flex-shrink-0 mt-1" style={{ color: 'var(--text-3)' }}>
                  Ver todo
                </Link>
              </div>
              <div className="space-y-1">
                {PIPELINE_STAGES.map(({ stage, dot, bar }) => {
                  const count = by[stage] ?? 0
                  const max = Math.max(...PIPELINE_STAGES.map(s => by[s.stage] ?? 0), 1)
                  const pct = Math.round((count / max) * 100)
                  return (
                    <Link key={stage} to="/pipeline"
                      className="block px-3 py-2 rounded-xl hover:bg-black/[0.03] transition-colors group"
                      title={STAGE_DESCRIPTIONS[stage]}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dot}`} />
                        <span className="text-xs font-bold flex-1 min-w-0 truncate transition-colors" style={{ color: 'var(--text-2)' }}>{STAGE_LABELS[stage]}</span>
                        <div className="w-16 h-1.5 rounded-full overflow-hidden flex-shrink-0" style={{ background: 'var(--surface-3)' }}>
                          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: bar }} />
                        </div>
                        <span className="text-sm font-bold w-6 text-right flex-shrink-0" style={{ color: 'var(--text)' }}>{count}</span>
                      </div>
                      <p className="text-[10px] leading-snug pl-[22px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{STAGE_DESCRIPTIONS[stage]}</p>
                    </Link>
                  )
                })}
                {recoveryCount > 0 && (
                  <Link to="/pipeline"
                    className="block px-3 py-2 rounded-xl hover:bg-black/[0.03] transition-colors"
                    title="Clientes que se perdieron en alguna etapa — hay que reagendar una reunión"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-danger" />
                      <span className="text-xs font-bold text-danger flex-1">Recuperación</span>
                      <span className="text-sm font-bold text-danger">{recoveryCount}</span>
                    </div>
                    <p className="text-[10px] leading-snug pl-[22px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Se perdieron en el camino — agendar nueva reunión</p>
                  </Link>
                )}
              </div>
            </div>

          </div>
        </div>

        {showEventModal && (
          <EventModal
            event={selectedEvent}
            vendors={[]}
            onClose={() => setShowEventModal(false)}
            onSaved={() => { setShowEventModal(false); fetchDashboard() }}
          />
        )}

        {agDetail && (
          <DashboardDetailModal
            metric={agDetail.metric}
            period="month"
            dateFrom={agDetail.dateFrom}
            dateTo={agDetail.dateTo}
            titleOverride={agDetail.title}
            subtitle={agDetail.subtitle}
            onClose={() => setAgDetail(null)}
          />
        )}
      </div>
    )
  }

  // ── ADMIN (superadmin / subadmin) ──────────────────────────────
  if (dashView === 'hoy') {
    const _cold = stats.cold_leads_count ?? 0
    const _pending = stats.pending_payments ?? 0
    const items = ([
      _pending > 0 && <InboxRow key="pp" icon={CreditCard} label="Pagos por confirmar" count={_pending} to="/pagos" tone="warn" />,
      recoveryCount > 0 && <InboxRow key="rc" icon={AlertCircle} label="Leads en recuperación" count={recoveryCount} to="/pipeline" tone="danger" />,
      leadsSinOT > 0 && <InboxRow key="ot" icon={ClipboardList} label="Cierres sin Orden de Trabajo" count={leadsSinOT} to="/pipeline" tone="danger" />,
      _cold > 0 && <InboxRow key="cl" icon={WifiOff} label="Leads fríos (sin movimiento)" count={_cold} to="/pipeline" tone="warn" />,
      unreadMessages > 0 && <InboxRow key="ch" icon={MessageSquare} label="Chats sin responder" count={unreadMessages} to="/leads" tone="warn" />,
      todayList.length > 0 && <InboxRow key="mt" icon={CalendarDays} label="Reuniones de hoy (todos los grupos)" count={todayList.length} to="/calendario" tone="primary" />,
    ] as any[]).filter(Boolean)
    return (
      <div className="space-y-3">
        <HoyHeader todayLabel={todayLabel} lastRefresh={lastRefresh} loading={loading} onRefresh={() => fetchDashboard()} view={dashView} onView={setDashView} />
        <NexioCopilotWidget />
        {items.length ? <div className="space-y-2.5">{items}</div> : <InboxEmpty />}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <DashTabs view={dashView} onChange={setDashView} />
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white">Dashboard</h1>
          <p className="text-xs text-white/62 mt-0.5">
            <span className="capitalize">{todayLabel}</span> · Actualizado {format(lastRefresh, 'HH:mm')} · Visión general de todos los grupos: leads, ventas, pagos y reuniones
            {(customFrom || customTo) && (
              <span className="ml-2 px-2 py-0.5 rounded-md text-[10px] font-bold" style={{ background: 'var(--primary-dim)', color: 'var(--primary)', border: '1px solid rgba(53,122,14,0.25)' }}>
                {customFrom && customTo ? `${customFrom.slice(5)} → ${customTo.slice(5)}` : customFrom || customTo}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Period dropdown */}
          <div className="relative">
            <button
              onClick={() => setPeriodOpen(o => !o)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm transition-colors"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-2)', color: 'var(--text-2)' }}
            >
              <Calendar size={13} />
              <span className="font-bold">
                {PERIODS.find(p => p.value === period)?.label}
              </span>
              <ChevronDown size={13} className={`transition-transform duration-200 ${periodOpen ? 'rotate-180' : ''}`} />
            </button>
            {periodOpen && (
              <div
                className="absolute right-0 mt-2 w-44 rounded-xl z-50 overflow-hidden"
                style={{
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border-2)',
                  boxShadow: '0 8px 24px rgba(28,22,51,0.12)',
                }}
              >
                {PERIODS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => {
                      setPeriod(value)
                      setPeriodOpen(false)
                      fetchDashboard(false, value)
                    }}
                    className="w-full text-left px-3.5 py-2.5 text-sm font-medium transition-colors flex items-center justify-between gap-2"
                    style={period === value
                      ? { background: 'var(--primary-dim)', color: 'var(--primary)', fontWeight: 700 }
                      : { color: 'var(--text-2)' }}
                  >
                    <span>{label}</span>
                    {period === value && <CheckCircle size={13} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => fetchDashboard()} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-surface-1 border border-white/10 rounded-xl font-semibold text-sm hover:bg-surface-0">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualizar
          </button>
        </div>
      </div>

      {/* Filtro por rango de fechas */}
      <div className="flex flex-nowrap md:flex-wrap items-center gap-2 rounded-xl px-3 py-2.5 overflow-x-auto md:overflow-x-visible scrollbar-none"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: '0 1px 3px rgba(28,22,51,0.05)' }}>
        <span className="text-[10px] font-semibold uppercase tracking-wider flex-shrink-0" style={{ color: 'var(--text-muted)' }} title="Filtra los números del dashboard por fecha de ingreso del lead">Rango</span>
        {_dPresets.map(p => {
          const active = activePreset === p.label
          return (
            <button key={p.label}
              onClick={() => {
                if (active) { setCustomFrom(''); setCustomTo(''); setActivePreset('') }
                else { setCustomFrom(p.from); setCustomTo(p.to); setActivePreset(p.label) }
              }}
              title="Filtra los KPIs por fecha de ingreso del lead"
              className="text-[11px] px-2.5 h-8 rounded-lg border transition-colors whitespace-nowrap flex-shrink-0"
              style={active
                ? { background: 'var(--primary-dim)', borderColor: 'rgba(53,122,14,0.35)', color: 'var(--primary)', fontWeight: 700 }
                : { background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text-3)' }}>
              {p.label}
            </button>
          )
        })}
        <input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setActivePreset('') }}
          className="h-8 text-[11px] px-2 rounded-lg border focus:outline-none focus:ring-1 flex-shrink-0"
          style={{ borderColor: 'var(--border-2)', background: 'var(--surface-1)', color: 'var(--text-2)', width: 130 }} />
        <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>→</span>
        <input type="date" value={customTo} min={customFrom} onChange={e => { setCustomTo(e.target.value); setActivePreset('') }}
          className="h-8 text-[11px] px-2 rounded-lg border focus:outline-none focus:ring-1 flex-shrink-0"
          style={{ borderColor: 'var(--border-2)', background: 'var(--surface-1)', color: 'var(--text-2)', width: 130 }} />
        {(customFrom || customTo) && (
          <button onClick={() => { setCustomFrom(''); setCustomTo(''); setActivePreset('') }}
            className="h-8 px-2.5 text-[11px] rounded-lg border transition-colors flex-shrink-0"
            style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--danger)' }}>
            ✕ Limpiar
          </button>
        )}
      </div>

      {/* Alertas urgentes */}
      {(recoveryCount > 0 || stats.cold_leads_count > 0 || (unreadMessages > 0 && isAgendadora) || (stats.pending_payments ?? 0) > 0 || leadsSinOT > 0) && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/52">Alertas del sistema</p>
          {leadsSinOT > 0 && (
            <AlertBanner
              icon={ClipboardList}
              title={`${leadsSinOT} lead${leadsSinOT > 1 ? 's' : ''} sin Orden de Trabajo`}
              sub="Leads en Cierre sin OT — vendedores deben actuar"
              to="/pipeline?sin_ot=1"
              color="danger"
            />
          )}
          {(stats.pending_payments ?? 0) > 0 && (
            <AlertBanner
              icon={CreditCard}
              title={`${stats.pending_payments} pago${stats.pending_payments > 1 ? 's' : ''} esperando verificacion`}
              sub="Dante debe revisar estos pagos"
              to="/pagos"
              color="warn"
            />
          )}
          {recoveryCount > 0 && (
            <AlertBanner
              icon={AlertTriangle}
              title={`${recoveryCount} lead${recoveryCount > 1 ? 's' : ''} en recuperacion`}
              sub="Casos con reuniones fallidas que necesitan nueva accion"
              to="/pipeline"
              color="danger"
            />
          )}
          {stats.cold_leads_count > 0 && (
            <AlertBanner
              icon={Clock}
              title={`${stats.cold_leads_count} lead${stats.cold_leads_count > 1 ? 's' : ''} sin interacción hace más de 3 días`}
              sub="No hubo ninguna acción sobre estos leads en los últimos 3 días"
              to="/leads"
              color="warn"
            />
          )}
          {unreadMessages > 0 && isAgendadora && (
            <AlertBanner
              icon={MessageSquare}
              title={`${unreadMessages} mensaje${unreadMessages > 1 ? 's' : ''} de WhatsApp sin leer`}
              sub="Clientes esperando respuesta"
              to={firstUnreadLeadId ? '/leads' : '/whatsapp'}
              state={firstUnreadLeadId ? { openLeadId: firstUnreadLeadId } : undefined}
              color="neon"
            />
          )}
        </div>
      )}

      {/* KPIs principales */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { onClick: () => setDetailModal('active'), label: 'Leads del período', value: total, icon: Users, color: 'var(--zx-accent-text)', iconBg: 'rgba(53,122,14,0.12)', sub: `Leads que ingresaron en el período filtrado — hoy entraron ${stats.today_leads ?? 0}, en todo el sistema hay ${totalAll}`, action: 'Click para ver quiénes son', big: true },
          { onClick: () => setDetailModal('convertidos'), label: 'Conversión', value: `${stats.conversion_rate ?? 0}%`, icon: TrendingUp, color: 'var(--zx-lime)', iconBg: 'rgba(6,182,212,0.12)', sub: `% de leads del período que llegaron a Cierre o Pago — ${stats.cierre_sin_abono ?? 0} en cierre y ${stats.cierre_abonado ?? 0} en proceso de pago`, action: 'Click para ver los convertidos', big: true },
          { onClick: () => setDetailModal('cuotas'), label: 'Total cuotas', value: fmt(stats.total_cuotas ?? 0), icon: CreditCard, color: 'var(--text)', iconBg: 'rgba(28,22,51,0.07)', sub: 'Suma de los planes de cuotas pactados por clientes que pagan en cuotas', action: 'Click para ver el detalle por cliente', big: false },
          { onClick: () => setDetailModal('honorarios'), label: 'Monto Total', value: fmt(stats.total_honorarios ?? 0), icon: DollarSign, color: 'var(--text)', iconBg: 'rgba(28,22,51,0.07)', sub: 'Honorarios totales comprometidos por clientes en Cierre o en etapas de pago', action: 'Click para ver el detalle por cliente', big: false },
        ].map(({ onClick, label, value, icon: Icon, color, iconBg, sub, action, big }) => (
          <button key={label} onClick={onClick} disabled={!onClick}
            className="rounded-xl p-4 text-left transition-shadow hover:shadow-card-lg disabled:cursor-default flex flex-col"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: '0 1px 3px rgba(28,22,51,0.05)' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold" style={{ color: 'var(--text-2)' }}>{label}</p>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: iconBg }}>
                <Icon size={15} style={{ color: color === 'var(--text)' ? 'var(--text-2)' : color }} />
              </div>
            </div>
            <p className={`${big ? 'text-3xl' : 'text-xl'} font-black leading-none truncate`} style={{ color }}>{value}</p>
            <p className="text-[11px] font-medium mt-1.5 leading-snug" style={{ color: 'var(--text-muted)' }}>{sub}</p>
            {action && (
              <p className="text-[10px] font-bold mt-1.5 flex items-center gap-1" style={{ color: color === 'var(--text)' ? 'var(--text-3)' : color }}>
                {action} <ArrowRight size={9} />
              </p>
            )}
          </button>
        ))}
      </div>

      {/* Cierre + Recuperación cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { metric: 'cierre_sin_abono', label: 'En Cierre', value: stats.cierre_sin_abono ?? 0, color: '#0ea5e9', iconBg: 'rgba(14,165,233,0.12)', icon: GitBranch, sub: 'Negociando contrato y forma de pago — aún no abonan nada' },
          { metric: 'cierre_abonado', label: 'En Proceso de Pago', value: stats.cierre_abonado ?? 0, color: '#10b981', iconBg: 'rgba(16,185,129,0.12)', icon: CreditCard, sub: 'Ya comprometieron o realizaron pago: Pago Pendiente + Comprometido + Validando + Confirmado' },
          { metric: 'recovery', label: 'En Recuperación', value: recoveryCount, color: '#e11d48', iconBg: 'rgba(225,29,72,0.10)', icon: AlertTriangle, sub: 'Se perdieron en alguna etapa — la agendadora debe reagendar reunión' },
        ].map(({ metric, label, value, color, iconBg, icon: Icon, sub }) => (
          <button key={metric} onClick={() => setDetailModal(metric)}
            className="rounded-xl p-4 text-left transition-shadow hover:shadow-card-lg flex flex-col"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: '0 1px 3px rgba(28,22,51,0.05)' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold" style={{ color: 'var(--text-2)' }}>{label}</p>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: iconBg }}>
                <Icon size={15} style={{ color }} />
              </div>
            </div>
            <p className="text-3xl font-black leading-none" style={{ color }}>{value}</p>
            <p className="text-[11px] font-medium mt-1.5 leading-snug" style={{ color: 'var(--text-muted)' }}>{sub}</p>
            <p className="text-[10px] font-bold mt-1.5 flex items-center gap-1" style={{ color }}>
              Click para ver cuáles son <ArrowRight size={9} />
            </p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Izquierda: Pipeline + Hoy + Grupos */}
        <div className="lg:col-span-2 space-y-5">

          {/* Pipeline completo */}
          <div className="bg-surface-1 rounded-2xl border border-white/10 shadow-sm p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="font-semibold text-sm flex items-center gap-2">
                  <GitBranch size={15} className="text-lime/70" /> Estado del Pipeline
                </h2>
                <p className="text-[11px] text-white/52 mt-0.5">Cuántos leads hay en cada etapa del proceso de venta, sumando todos los grupos — pasa el cursor sobre una etapa para ver qué significa</p>
              </div>
              <Link to="/pipeline" className="text-xs text-white/52 hover:text-white/85 flex items-center gap-1 flex-shrink-0 mt-0.5">
                Ver detalle <ChevronRight size={11} />
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2 mb-3">
              {PIPELINE_STAGES.map(({ stage, dot, label_color }) => (
                <Link key={stage} to="/pipeline" title={STAGE_DESCRIPTIONS[stage]}
                  className="flex flex-col items-center bg-surface-0 rounded-xl p-3 border border-white/[0.07] hover:border-white/10 hover:bg-surface-2 transition-colors text-center">
                  <p className="text-xl font-bold text-white">{by[stage] ?? 0}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                    <p className={`text-[9px] leading-tight font-semibold ${label_color}`}>{STAGE_LABELS[stage]}</p>
                  </div>
                </Link>
              ))}
            </div>
            {recoveryCount > 0 && (
              <Link to="/pipeline" title="Clientes que se perdieron en alguna etapa — la agendadora debe reagendar"
                className="flex items-center gap-2 bg-surface-0 rounded-xl px-4 py-2.5 border border-white/10 hover:bg-surface-2 transition-colors">
                <span className="w-2 h-2 rounded-full bg-white/30 flex-shrink-0" />
                <span className="text-xs text-white/78 font-semibold">Recuperación</span>
                <span className="text-[10px] text-white/45">— se perdieron en el camino, requieren nueva reunión</span>
                <span className="ml-auto text-sm font-bold text-white/85">{recoveryCount}</span>
                <ChevronRight size={12} className="text-white/52" />
              </Link>
            )}
          </div>

          {/* Hoy en el sistema */}
          {todayList.length > 0 && (
            <div className="bg-surface-1 rounded-2xl border border-white/10 shadow-sm p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="font-semibold text-sm flex items-center gap-2">
                    <CalendarDays size={15} className="text-white/52" />
                    Reuniones de hoy ({todayList.length})
                  </h2>
                  <p className="text-[11px] text-white/52 mt-0.5">
                    Todas las reuniones agendadas hoy en los grupos
                    {todayFuture.length > 0 && ` · ${todayFuture.length} por realizar`}
                    {todayActive.length > 0 && ` · ${todayActive.length} en curso`}
                    {todayPast.length > 0 && ` · ${todayPast.length} ya pasaron`}
                  </p>
                </div>
                <Link to="/calendario" className="text-xs text-white/52 hover:text-white/85 flex items-center gap-1 flex-shrink-0 mt-0.5">
                  Calendario <ChevronRight size={11} />
                </Link>
              </div>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {[...todayActive, ...todayFuture, ...todayPast].map(ev => (
                  <EventRow key={ev.id} ev={ev} onClick={() => { setSelectedEvent(ev); setShowEventModal(true) }} />
                ))}
              </div>
              <div className="mt-3 pt-3 flex items-center gap-x-3 gap-y-1 flex-wrap border-t border-white/[0.07]">
                <p className="text-[9px] font-bold uppercase tracking-wide text-white/38">Qué significa cada estado:</p>
                <span className="text-[10px] text-white/52"><span className="font-bold" style={{ color: 'var(--zx-lime)' }}>Programada</span> = aún no ocurre</span>
                <span className="text-[10px] text-white/52"><span className="font-bold text-lime">Exitosa</span> = cliente quiere avanzar</span>
                <span className="text-[10px] text-white/52"><span className="font-bold text-danger">Sin éxito</span> = no cerró</span>
                <span className="text-[10px] text-white/52"><span className="font-bold text-warn">Sin marcar</span> = vendedor no registró resultado</span>
              </div>
            </div>
          )}

          {/* Por grupo */}
          {stats.by_group?.length > 0 && (
            <div className="bg-surface-1 rounded-2xl border border-black/[0.06] shadow-card p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text)' }}>
                    <BarChart2 size={15} className="text-lime" /> Rendimiento por Grupo
                  </h2>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Leads del período por grupo y cuántos llegaron a Pago Confirmado — la barra es su % del total</p>
                </div>
                <span className="text-[10px] font-medium flex-shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }}>leads · en Pago Confirmado</span>
              </div>
              <div className="space-y-1">
                {stats.by_group.map((g: any) => (
                  <button key={g.id}
                    onClick={() => setAgDetail({ metric: 'active', title: `Leads de ${g.name}`, subtitle: 'leads del período en este grupo — click en Ver para abrir cada uno', groupId: String(g.id) })}
                    title={`Click para ver los ${g.total} leads de ${g.name}`}
                    className="w-full text-left space-y-1.5 px-2 py-2 rounded-xl hover:bg-black/[0.04] transition-colors cursor-pointer">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-semibold truncate max-w-[9rem]" style={{ color: 'var(--text)' }}>{g.name}</span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{g.total} lead{g.total !== 1 ? 's' : ''}</span>
                        {g.pagado > 0 && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" title="Leads que llegaron a la etapa Pago Confirmado"
                            style={{ background: 'rgba(53,122,14,0.10)', color: 'var(--zx-accent-text)' }}>
                            {g.pagado} en Pago Confirmado
                          </span>
                        )}
                        <ChevronRight size={11} style={{ color: 'var(--text-muted)' }} />
                      </div>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: '#efecf6' }}>
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: total > 0 ? `${Math.max(Math.round(g.total / total * 100), g.total > 0 ? 4 : 0)}%` : '0%',
                          background: 'linear-gradient(90deg, var(--zx-accent-text), var(--zx-lime))'
                        }} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Derecha: Top vendedores + Actividad */}
        <div className="space-y-5">
          {stats.top_vendedores?.length > 0 && (
            <div className="bg-surface-1 rounded-2xl border border-white/10 shadow-sm p-5">
              <h2 className="font-semibold text-sm flex items-center gap-2">
                <Award size={15} className="text-warn/70" /> Vendedores
                <span className="ml-auto text-[10px] text-white/52 font-normal">cierres</span>
              </h2>
              <p className="text-[11px] text-white/52 mt-0.5 mb-3">Ranking por pagos confirmados en el período — click en un vendedor para ver sus leads</p>
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {stats.top_vendedores.slice(0, 8).map((v: any, i: number) => (
                  <button key={v.id ?? i}
                    onClick={() => setAgDetail({ metric: 'active', title: `Leads de ${v.name}`, subtitle: `vendedor de ${v.group} — ${v.closed} con pago confirmado de ${v.total} leads del período`, vendorId: v.id })}
                    title={`Click para ver los leads de ${v.name}`}
                    className="w-full flex items-center gap-3 p-2.5 bg-surface-0 rounded-xl border border-white/[0.07] hover:border-white/12 transition-colors text-left cursor-pointer">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black flex-shrink-0"
                      style={{
                        background: i === 0 ? 'rgba(53,122,14,0.14)' : i === 2 ? 'rgba(245,158,11,0.14)' : 'var(--surface-3)',
                        color: i === 0 ? 'var(--zx-accent-text)' : i === 2 ? '#f59e0b' : 'var(--text-muted)',
                      }}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold text-white truncate leading-none mb-0.5">{v.name}</p>
                      <p className="text-[9px] text-white/52 truncate">{v.group} · {v.total} lead{v.total !== 1 ? 's' : ''} en el período</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-black leading-none" style={{ color: i === 0 ? 'var(--zx-accent-text)' : 'var(--text-2)' }}>{v.closed}</p>
                      <p className="text-[8px] text-white/45 mt-0.5">pagos conf.</p>
                    </div>
                    <ChevronRight size={11} className="text-white/40 flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="bg-surface-1 rounded-2xl border border-white/10 shadow-sm p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="font-semibold text-sm flex items-center gap-2">
                  <Clock size={15} className="text-neon/70" /> Actividad Reciente
                </h2>
                <p className="text-[11px] text-white/52 mt-0.5">Últimos movimientos de leads en todos los grupos: quién hizo qué y cuándo</p>
              </div>
              <button onClick={handleClearActivity} disabled={clearingActivity || !stats.recent_activity?.length}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-white/52 hover:text-danger border border-white/10 hover:border-danger/30 rounded-lg transition-colors disabled:opacity-30 flex-shrink-0 mt-0.5">
                <Trash2 size={10} /> Limpiar
              </button>
            </div>
            <div className="space-y-2 max-h-[360px] overflow-y-auto">
              {stats.recent_activity?.length > 0 ? stats.recent_activity.map((a: any) => (
                <div key={a.id}
                  onClick={a.lead_id ? () => navigate('/leads', { state: { openLeadId: a.lead_id } }) : undefined}
                  title={a.lead_id ? 'Click para abrir la ficha del lead' : undefined}
                  className={`p-2.5 bg-surface-0 rounded-xl border border-white/[0.07] flex items-center gap-2 ${a.lead_id ? 'cursor-pointer hover:border-white/15 transition-colors' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-white/95 leading-normal">
                      <span className="font-bold">{a.user}</span>
                      {' · '}
                      <span className="text-white/62">{fmtAction(a.action)}</span>
                    </p>
                    <p className="text-[9px] text-white/65 mt-0.5">
                      {a.contact_name} · {format(parseAsUTC(a.time), "d MMM HH:mm", { locale: es })}
                    </p>
                  </div>
                  {a.lead_id && <ChevronRight size={11} className="text-white/35 flex-shrink-0" />}
                </div>
              )) : (
                <p className="text-center py-6 text-[10px] text-white/38">Sin actividad reciente.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {detailModal && (
        <DashboardDetailModal
          metric={detailModal}
          period={period}
          dateFrom={customFrom}
          dateTo={customTo}
          onClose={() => setDetailModal(null)}
        />
      )}

      {agDetail && (
        <DashboardDetailModal
          metric={agDetail.metric}
          period={period}
          dateFrom={agDetail.dateFrom ?? customFrom}
          dateTo={agDetail.dateTo ?? customTo}
          groupId={agDetail.groupId}
          vendorId={agDetail.vendorId}
          titleOverride={agDetail.title}
          subtitle={agDetail.subtitle}
          onClose={() => setAgDetail(null)}
        />
      )}

      {showEventModal && (
        <EventModal
          event={selectedEvent}
          vendors={[]}
          onClose={() => setShowEventModal(false)}
          onSaved={() => { setShowEventModal(false); fetchDashboard() }}
        />
      )}
    </div>
  )
}
