import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import {
  getCalendarEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent,
  getGroupVendors, getGoogleStatus, getGoogleAuthUrl, disconnectGoogle, syncAllToGoogle, getGoogleEvents,
  syncEventToGoogle,
} from '../api'
import type { CalendarEvent } from '../types'
import { useAuthStore } from '../store/auth'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { parseLocalDate } from '../utils/dates'
import { Plus, X, Link2, Link2Off, RefreshCw, Clock, User, ChevronLeft, ChevronRight, Video } from 'lucide-react'
import { useConfirm } from '../components/ConfirmDialog'
import { useRealtime } from '../contexts/RealtimeContext'

const GC_CSS = `
.fc {
  font-family: 'Manrope', system-ui, sans-serif !important;
  --fc-border-color: rgba(28,22,51,0.08) !important;
  --fc-today-bg-color: rgba(124,58,237,0.05) !important;
  --fc-highlight-color: rgba(124,58,237,0.10) !important;
  --fc-non-business-color: rgba(0,0,0,0.02) !important;
}
/* Transparent containers so the card background shows uniformly —
   intentionally excludes table/td/th so daygrid event rows keep their colored backgrounds */
.fc .fc-view-harness,
.fc .fc-view,
.fc .fc-scroller,
.fc .fc-scroller-liquid-absolute,
.fc .fc-col-header,
.fc .fc-daygrid-body,
.fc .fc-timegrid-body,
.fc .fc-timegrid-slots,
.fc .fc-timegrid-cols,
.fc .fc-timegrid-axis,
.fc .fc-timegrid-col { background: transparent !important; }

/* Toolbar */
.fc .fc-toolbar { padding: 10px 16px 8px !important; margin: 0 !important; background: transparent !important; border-bottom: 1px solid rgba(28,22,51,0.07) !important; }
.fc .fc-toolbar-chunk { display: flex !important; align-items: center !important; gap: 4px !important; }
.fc .fc-toolbar-title { font-size: 1rem !important; font-weight: 500 !important; color: rgba(28,22,51,0.88) !important; letter-spacing: -0.01em !important; }
.fc .fc-button {
  background: transparent !important;
  border: 1px solid rgba(28,22,51,0.14) !important;
  color: rgba(28,22,51,0.75) !important;
  border-radius: 8px !important;
  font-size: 0.78rem !important; font-weight: 600 !important;
  padding: 4px 12px !important; box-shadow: none !important;
  transition: background 0.12s, color 0.12s !important;
}
.fc .fc-button:hover { background: rgba(28,22,51,0.05) !important; color: rgba(28,22,51,0.95) !important; }
.fc .fc-button:focus { box-shadow: none !important; outline: none !important; }
.fc .fc-button-active,
.fc .fc-button-primary:not(:disabled).fc-button-active {
  background: rgba(124,58,237,0.10) !important;
  color: #7c3aed !important;
  border-color: rgba(124,58,237,0.28) !important;
  font-weight: 700 !important;
}
.fc .fc-today-button { color: #7c3aed !important; border-color: rgba(124,58,237,0.35) !important; font-weight: 700 !important; }
.fc .fc-today-button:hover { background: rgba(124,58,237,0.07) !important; }
.fc .fc-prev-button, .fc .fc-next-button {
  width: 30px !important; height: 30px !important; padding: 0 !important;
  display: inline-flex !important; align-items: center !important; justify-content: center !important;
}
/* Grid borders */
.fc-theme-standard td, .fc-theme-standard th { border-color: rgba(28,22,51,0.07) !important; }
.fc-theme-standard .fc-scrollgrid { border: none !important; }
/* Column headers */
.fc .fc-col-header-cell { border-color: rgba(28,22,51,0.07) !important; padding: 0 !important; }
.fc .fc-col-header-cell-cushion { padding: 0 !important; text-decoration: none !important; width: 100% !important; }
/* Day grid */
.fc .fc-daygrid-day-number { color: rgba(28,22,51,0.65) !important; font-size: 12px !important; font-weight: 400 !important; padding: 6px 8px !important; text-decoration: none !important; }
.fc .fc-day-today .fc-daygrid-day-number { background: #7c3aed !important; color: #fff !important; border-radius: 50% !important; width: 26px !important; height: 26px !important; display: flex !important; align-items: center !important; justify-content: center !important; margin: 4px auto 0 !important; padding: 0 !important; }
.fc .fc-daygrid-day-top { justify-content: center !important; }
.fc .fc-daygrid-day.fc-day-today { background: rgba(124,58,237,0.04) !important; }
.fc .fc-daygrid-event { border-radius: 4px !important; margin: 1px 2px !important; }
.fc .fc-daygrid-event .fc-event-title { font-size: 11px !important; }
.fc .fc-daygrid-more-link { color: #7c3aed !important; font-size: 11px !important; font-weight: 600 !important; text-decoration: none !important; }
/* Time grid */
.fc .fc-timegrid-slot { height: 48px !important; border-color: rgba(28,22,51,0.05) !important; }
.fc .fc-timegrid-slot-minor { border-top-color: rgba(28,22,51,0.025) !important; }
.fc .fc-timegrid-axis { border-color: rgba(28,22,51,0.07) !important; width: 52px !important; }
.fc .fc-timegrid-axis-cushion { color: rgba(28,22,51,0.40) !important; font-size: 10px !important; font-weight: 500 !important; padding-right: 6px !important; letter-spacing: 0.03em !important; }
.fc .fc-day-today.fc-timegrid-col { background: rgba(124,58,237,0.03) !important; }
.fc .fc-timegrid-now-indicator-line { border-color: #e11d48 !important; border-width: 2px !important; z-index: 10 !important; }
.fc .fc-timegrid-now-indicator-arrow { border-top-color: #e11d48 !important; border-bottom-color: #e11d48 !important; border-width: 5px !important; left: -1px !important; }
/* Events */
.fc .fc-event { border: none !important; border-radius: 6px !important; cursor: pointer !important; transition: filter 0.12s, transform 0.1s !important; overflow: hidden !important; box-shadow: 0 1px 3px rgba(0,0,0,0.12) !important; }
.fc .fc-event:hover { filter: brightness(0.92) !important; transform: translateY(-1px) !important; box-shadow: 0 3px 8px rgba(0,0,0,0.18) !important; }
.fc .fc-timegrid-event { border-radius: 8px !important; padding: 4px 8px !important; min-height: 26px !important; }
.fc .fc-event-title { color: #fff !important; font-size: 12px !important; font-weight: 600 !important; line-height: 1.3 !important; }
.fc .fc-event-time { color: rgba(255,255,255,0.85) !important; font-size: 10.5px !important; }
.fc .fc-highlight { background: rgba(124,58,237,0.10) !important; border-radius: 4px !important; }
.fc .fc-scroller::-webkit-scrollbar { width: 5px !important; }
.fc .fc-scroller::-webkit-scrollbar-track { background: transparent !important; }
.fc .fc-scroller::-webkit-scrollbar-thumb { background: rgba(28,22,51,0.15) !important; border-radius: 3px !important; }
/* Time grid — remove visual "cut" between sticky header and scrollable body */
.fc .fc-scrollgrid-section-header > td { border-bottom: none !important; }
.fc .fc-timegrid-divider { padding: 0 !important; height: 1px !important; background: rgba(28,22,51,0.06) !important; }
`

const EVENT_TYPES = [
  { value: 'reunion',     label: 'Reunión',     color: '#3B82F6' },
  { value: 'llamada',     label: 'Llamada',     color: '#10B981' },
  { value: 'seguimiento', label: 'Seguimiento', color: '#F59E0B' },
  { value: 'tarea',       label: 'Tarea',       color: '#8B5CF6' },
]

const toDateTimeLocal = (value?: string | Date | null, fallbackHour = 9) => {
  const pad = (n: number) => n.toString().padStart(2, '0')
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T${pad(fallbackHour)}:00`
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const addMinutesLocal = (value: string, minutes: number) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  date.setMinutes(date.getMinutes() + minutes)
  return toDateTimeLocal(date)
}

// ── Mini calendar ────────────────────────────────────────────────
function MiniCalendar({
  onDayClick,
  eventDates,
  selectedDate,
}: {
  onDayClick: (date: Date) => void
  eventDates: Set<string>
  selectedDate: string
}) {
  const [viewDate, setViewDate] = useState(new Date())
  const today = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d
  }, [])

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const monthLabel = viewDate.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })

  const cells: (number | null)[] = Array(firstWeekday).fill(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const prev = () => setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  const next = () => setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-white/70 capitalize tracking-wide">{monthLabel}</span>
        <div className="flex gap-0.5">
          <button onClick={prev} className="w-6 h-6 rounded-full hover:bg-white/10 flex items-center justify-center text-white/45 hover:text-white/90 transition-colors">
            <ChevronLeft size={13} />
          </button>
          <button onClick={next} className="w-6 h-6 rounded-full hover:bg-white/10 flex items-center justify-center text-white/45 hover:text-white/90 transition-colors">
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {['L','M','X','J','V','S','D'].map((d, i) => (
          <div key={i} className="text-center text-[9px] font-semibold text-white/32 py-1 tracking-wider">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((day, i) => {
          if (day === null) return <div key={i} className="h-7" />
          const date = new Date(year, month, day)
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const isToday = date.getTime() === today.getTime()
          const isSelected = dateStr === selectedDate
          const hasEvent = eventDates.has(dateStr)
          return (
            <button
              key={i}
              onClick={() => onDayClick(date)}
              className={`relative w-7 h-7 mx-auto rounded-full text-[12px] font-medium transition-all flex items-center justify-center
                ${isSelected
                  ? 'bg-blue-600 text-white font-bold shadow-lg shadow-blue-600/30'
                  : isToday
                    ? 'text-blue-400 font-bold hover:bg-blue-500/10'
                    : 'text-white/60 hover:bg-white/10 hover:text-white/90'
                }`}
            >
              {day}
              {hasEvent && !isSelected && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-blue-400/70" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Event modal ──────────────────────────────────────────────────
function EventModal({
  event, vendors, onClose, onSaved, onDeleted, defaultDate, defaultEndDate, googleConnected,
}: {
  event: CalendarEvent | null
  vendors: any[]
  onClose: () => void
  onSaved: (savedId?: number) => void
  onDeleted?: () => void
  defaultDate?: string
  defaultEndDate?: string
  googleConnected?: boolean
}) {
  const { user: me } = useAuthStore()
  const { confirm, dialog: confirmDialog } = useConfirm()

  const addThirtyMin = (startStr: string): string => {
    const [datePart, timePart] = startStr.split('T')
    if (!datePart || !timePart) return startStr
    const [h, m] = timePart.split(':').map(Number)
    const pad = (n: number) => n.toString().padStart(2, '0')
    const total = h * 60 + m + 30
    return `${datePart}T${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`
  }

  const defaultStart = defaultDate ? toDateTimeLocal(defaultDate) : ''
  const defaultEnd = defaultEndDate ? toDateTimeLocal(defaultEndDate) : ''
  const initStart = event?.start_time ? toDateTimeLocal(event.start_time) : defaultStart
  const initEnd = event?.end_time ? toDateTimeLocal(event.end_time) : (defaultEnd || (initStart ? addThirtyMin(initStart) : ''))
  const [form, setForm] = useState({
    title: event?.title ?? '',
    start_time: initStart,
    end_time: initEnd,
    event_type: event?.event_type ?? 'reunion',
    notes: event?.notes ?? '',
    color: event?.color ?? '#3B82F6',
    assigned_to: event?.assigned_to?.toString() ?? (vendors[0]?.id?.toString() ?? ''),
  })
  const [saving, setSaving] = useState(false)

  const set = (k: string, v: string) => setForm(f => {
    const updated = { ...f, [k]: v }
    if (k === 'start_time' && v) updated.end_time = addThirtyMin(v)
    return updated
  })

  useEffect(() => {
    const found = EVENT_TYPES.find(t => t.value === form.event_type)
    if (found) set('color', found.color)
  }, [form.event_type])

  const toUtcIso = (localStr: string): string => {
    if (!localStr) return localStr
    const d = new Date(localStr)
    return isNaN(d.getTime()) ? localStr : d.toISOString()
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title || !form.start_time || !form.end_time) {
      toast.error('Completa título y horario'); return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        start_time: toUtcIso(form.start_time),
        end_time: toUtcIso(form.end_time),
        assigned_to: form.assigned_to ? parseInt(form.assigned_to) : null,
      }
      let savedId: number | undefined
      if (event) {
        const updated = await updateCalendarEvent(event.id, payload)
        savedId = updated?.id ?? event.id
        toast.success('Reunión actualizada')
      } else {
        const created = await createCalendarEvent(payload)
        savedId = created?.id
        toast.success(payload.assigned_to ? 'Reunión agendada — vendedor notificado' : 'Reunión agendada')
      }
      onSaved(savedId)
      if (googleConnected && savedId) syncEventToGoogle(savedId).catch(() => {})
    } catch { toast.error('Error al guardar') }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!event) return
    const ok = await confirm('¿Eliminar esta reunión? Esta acción no se puede deshacer.', { title: 'Eliminar reunión', confirmLabel: 'Eliminar' })
    if (!ok) return
    try {
      await deleteCalendarEvent(event.id)
      toast.success('Reunión eliminada')
      onDeleted?.()
    } catch { toast.error('Error al eliminar') }
  }

  const typeColor = EVENT_TYPES.find(t => t.value === form.event_type)?.color ?? form.color

  return (
    <>
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-surface-1 w-full sm:rounded-2xl sm:max-w-lg shadow-2xl max-h-[95vh] overflow-y-auto border border-white/[0.08]">
        {/* Header with colored top accent */}
        <div className="h-1 rounded-t-2xl" style={{ background: typeColor }} />
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07] sticky top-0 bg-surface-1 z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: typeColor }} />
            <h2 className="text-base font-semibold text-white/90">
              {event ? 'Editar Reunión' : 'Nueva Reunión'}
            </h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface-2 rounded-xl text-white/42 hover:text-white/90 transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-4">

          {/* Google Meet: botón de unirse, estilo evento nativo de Google */}
          {event?.meet_link && (
            <div className="flex items-center gap-3 px-3 py-3 rounded-xl bg-surface-0 border border-white/[0.07]">
              <a href={event.meet_link} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors flex-shrink-0">
                <Video size={16} />
                Unirse con Google Meet
              </a>
              <span className="text-[11px] text-white/40 truncate min-w-0">{event.meet_link.replace('https://', '')}</span>
            </div>
          )}

          {/* Superadmin: info del dueño del evento */}
          {event && me?.role === 'superadmin' && (
            <div className="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-surface-0 border border-white/[0.07]">
              <User size={14} className="text-white/40 mt-0.5 flex-shrink-0" />
              <div className="text-xs space-y-0.5 min-w-0">
                {event.creator && (
                  <p className="text-white/55">
                    <span className="text-white/35 mr-1">Creado por</span>
                    <span className="font-semibold text-white/80">{event.creator.name}</span>
                    <span className="text-white/35 ml-1">({event.creator.role})</span>
                  </p>
                )}
                {event.assigned_to && (() => {
                  const assignedVendor = vendors.find(v => v.id === event.assigned_to)
                  return assignedVendor ? (
                    <p className="text-white/55">
                      <span className="text-white/35 mr-1">Asignado a</span>
                      <span className="font-semibold text-white/80">{assignedVendor.name}</span>
                      <span className="text-white/35 ml-1">({assignedVendor.role})</span>
                    </p>
                  ) : null
                })()}
              </div>
            </div>
          )}

          <div>
            <label className="input-label">Título *</label>
            <input className="input" value={form.title}
              onChange={e => set('title', e.target.value)}
              placeholder="Reunión con cliente, Llamada de seguimiento..." required />
          </div>

          {vendors.length > 0 && (
            <div>
              <label className="input-label">Agendar para</label>
              <select className="input" value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)}>
                <option value="">Solo en mi agenda</option>
                {vendors.map(v => (
                  <option key={v.id} value={v.id}>{v.name} ({v.role})</option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="input-label">Inicio *</label>
              <input type="datetime-local" className="input" value={form.start_time}
                onChange={e => set('start_time', e.target.value)} required />
            </div>
            <div>
              <label className="input-label">Fin *</label>
              <input type="datetime-local" className="input" value={form.end_time}
                onChange={e => set('end_time', e.target.value)} required />
            </div>
          </div>

          <div>
            <label className="input-label">Tipo de reunión</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {EVENT_TYPES.map(t => (
                <button key={t.value} type="button"
                  onClick={() => set('event_type', t.value)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                    form.event_type === t.value
                      ? 'border-white/25 bg-surface-0 text-white shadow-sm'
                      : 'border-white/08 text-white/65 hover:border-white/18 hover:bg-surface-0'
                  }`}>
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="input-label">Notas y detalles</label>
            <div className="space-y-2">
              <textarea className="input" rows={4} value={form.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="Links de Meet, dirección, instrucciones para el vendedor..." />
              {form.notes && (
                <div className="p-3 bg-surface-0 rounded-xl border border-white/[0.06]">
                  <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">Links detectados</p>
                  <div className="text-xs text-white/72 break-words">
                    {form.notes.split(/(\s+)/).map((part, i) => {
                      if (part.match(/^https?:\/\/[^\s]+$/))
                        return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline hover:text-blue-300 break-all">{part}</a>
                      return part
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>


          <div className="flex gap-3 pt-2">
            {event && (
              <button type="button" onClick={handleDelete}
                className="px-4 py-2.5 border border-white/10 hover:bg-danger/10 hover:border-danger/30 hover:text-danger text-white/45 rounded-xl text-sm font-medium transition-colors">
                Eliminar
              </button>
            )}
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? 'Guardando...' : event ? 'Actualizar' : 'Agendar'}
            </button>
          </div>
        </form>
      </div>
    </div>
    {confirmDialog}
    </>
  )
}

// ── Main component ───────────────────────────────────────────────
export default function Agenda() {
  const { user: me } = useAuthStore()
  const { confirm: confirmMain, dialog: confirmMainDialog } = useConfirm()
  const [searchParams] = useSearchParams()
  const calRef = useRef<any>(null)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [googleEvents, setGoogleEvents] = useState<any[]>([])
  const [googleStatus, setGoogleStatus] = useState<any>(null)
  const [vendors, setVendors] = useState<any[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null)
  const [defaultDate, setDefaultDate] = useState('')
  const [defaultEndDate, setDefaultEndDate] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  const [currentView, setCurrentView] = useState<string>(
    window.innerWidth < 768 ? 'dayGridMonth' : 'timeGridWeek'
  )
  const [selectedDate, setSelectedDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const h = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches)
      if (e.matches) setCurrentView('dayGridMonth')
    }
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])

  const load = useCallback(async () => {
    try { setEvents(await getCalendarEvents()) } catch {}
  }, [])

  const loadGoogle = useCallback(async () => {
    try {
      const s = await getGoogleStatus()
      setGoogleStatus(s)
      if (s.connected) setGoogleEvents(await getGoogleEvents())
      else setGoogleEvents([])
    } catch {}
  }, [])

  useEffect(() => {
    load()
    loadGoogle()
    getGroupVendors().then(setVendors).catch(() => {})
  }, [])

  // Auto-open event from notification URL param
  useEffect(() => {
    const eid = searchParams.get('event_id')
    if (eid && events.length > 0) {
      const found = events.find(e => e.id === parseInt(eid))
      if (found) openEdit(found)
    }
  }, [events])

  // Auto-refresh every 30s — picks up Google Calendar changes without page reload
  useEffect(() => {
    const id = setInterval(() => {
      load()
      if (googleStatus?.connected) {
        getGoogleEvents().then(setGoogleEvents).catch(() => {})
      }
    }, 30_000)
    return () => clearInterval(id)
  }, [googleStatus?.connected, load])

  useRealtime(['calendar_update', 'lead_update', 'pipeline_refresh'], () => load())

  const handleConnect = async () => {
    try {
      const { url } = await getGoogleAuthUrl()
      const popup = window.open(url, 'google-auth', 'width=500,height=650')
      const h = async (e: MessageEvent) => {
        if (e.data?.googleCalendar === 'connected') {
          window.removeEventListener('message', h)
          popup?.close()
          toast.success('Google Calendar conectado')
          await loadGoogle()
          try {
            setSyncing(true)
            const r = await syncAllToGoogle()
            if (r.synced > 0) toast.success(`${r.synced} reuniones sincronizadas`)
          } catch {} finally { setSyncing(false) }
        }
      }
      window.addEventListener('message', h)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Google Calendar no configurado')
    }
  }

  const handleDisconnect = async () => {
    const ok = await confirmMain('Se perderá la sincronización con Google Calendar.', { title: 'Desconectar Google Calendar', confirmLabel: 'Desconectar' })
    if (!ok) return
    try {
      await disconnectGoogle()
      setGoogleStatus((s: any) => s ? { ...s, connected: false } : s)
      setGoogleEvents([])
      toast.success('Desconectado')
    } catch {}
  }

  const handleSyncAll = async () => {
    setSyncing(true)
    try {
      const r = await syncAllToGoogle()
      toast.success(`${r.synced} eventos sincronizados`)
    } catch { toast.error('Error al sincronizar') }
    finally { setSyncing(false) }
  }

  const openCreate = (startStr?: string, endStr?: string) => {
    setEditEvent(null)
    setDefaultDate(startStr ? toDateTimeLocal(startStr) : toDateTimeLocal(new Date()))
    setDefaultEndDate(endStr ? toDateTimeLocal(endStr) : '')
    setShowModal(true)
  }

  const openEdit = (ev: CalendarEvent) => {
    setEditEvent(ev)
    setDefaultDate('')
    setDefaultEndDate('')
    setShowModal(true)
  }

  const goToDate = (date: Date) => {
    setSelectedDate(format(date, 'yyyy-MM-dd'))
    const api = calRef.current?.getApi()
    if (api) {
      api.changeView('timeGridDay', date)
      setCurrentView('timeGridDay')
    }
  }

  const crmFcEvents = events.map(ev => {
    let bgColor = ev.color
    let borderColor = ev.color
    if (ev.vendor_status === 'altamente_interesado') { bgColor = '#10b981'; borderColor = '#059669' }
    else if (ev.vendor_status === 'sin_exito') { bgColor = '#ef4444'; borderColor = '#dc2626' }
    return {
      id: ev.id.toString(),
      title: ev.title,
      start: ev.start_time,
      end: ev.end_time,
      backgroundColor: bgColor,
      borderColor,
      textColor: '#fff',
      extendedProps: { event: ev, isVendorEvent: ev.created_by !== me?.id },
    }
  })

  const googleFcEvents = googleEvents.map(ev => ({
    id: `g_${ev.id}`,
    title: ev.title,
    start: ev.start,
    end: ev.end,
    allDay: ev.allDay,
    backgroundColor: '#4285f4',
    borderColor: '#1a73e8',
    textColor: '#fff',
    extendedProps: { googleEvent: ev },
  }))

  const allEvents = [...crmFcEvents, ...googleFcEvents]

  const eventDates = useMemo(() => {
    const s = new Set<string>()
    events.forEach(e => s.add(e.start_time.slice(0, 10)))
    return s
  }, [events])

  const today = format(new Date(), 'yyyy-MM-dd')
  const todayEvents = events.filter(e => e.start_time.startsWith(today))
  const upcomingEvents = events.filter(e => parseLocalDate(e.start_time) > new Date()).slice(0, 5)

  return (
    <div className={`flex gap-0 ${isMobile ? 'flex-col' : 'items-start'}`}>
      <style>{GC_CSS}</style>

      {/* ── Left sidebar ──────────────────────────────────── */}
      {!isMobile && (
        <div className="w-60 flex-shrink-0 flex flex-col gap-5 pr-4 pt-1 sticky top-4">
          {/* New event button */}
          <button
            onClick={() => openCreate()}
            className="flex items-center gap-2.5 w-full px-5 py-3.5 rounded-2xl bg-surface-1 border border-white/[0.08] hover:border-white/15 shadow-md hover:shadow-lg text-white/88 font-semibold text-sm transition-all hover:bg-surface-0 group"
          >
            <div className="w-8 h-8 rounded-full bg-blue-600 group-hover:bg-blue-500 flex items-center justify-center transition-colors flex-shrink-0">
              <Plus size={16} className="text-white" />
            </div>
            Nueva Reunión
          </button>

          {/* Mini calendar */}
          <div className="bg-surface-1 border border-white/[0.07] rounded-2xl p-4">
            <MiniCalendar onDayClick={goToDate} eventDates={eventDates} selectedDate={selectedDate} />
          </div>

          {/* Today stats */}
          <div className="bg-surface-1 border border-white/[0.07] rounded-2xl p-4 space-y-2">
            <p className="text-[10px] font-bold text-white/35 uppercase tracking-widest">Hoy</p>
            {todayEvents.length === 0 ? (
              <p className="text-xs text-white/42">Sin reuniones hoy</p>
            ) : todayEvents.map(ev => (
              <button key={ev.id} onClick={() => openEdit(ev)}
                className="w-full flex items-center gap-2.5 text-left hover:bg-surface-0 rounded-lg p-1.5 -mx-1.5 transition-colors group">
                <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: ev.color }} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-white/80 truncate group-hover:text-white/95">{ev.title}</p>
                  <p className="text-[10px] text-white/40 flex items-center gap-1">
                    <Clock size={9} />
                    {format(parseLocalDate(ev.start_time), 'HH:mm')}
                  </p>
                </div>
              </button>
            ))}
          </div>

          {/* Event type legend */}
          <div className="bg-surface-1 border border-white/[0.07] rounded-2xl p-4 space-y-2">
            <p className="text-[10px] font-bold text-white/35 uppercase tracking-widest mb-3">Tipos de evento</p>
            {EVENT_TYPES.map(t => (
              <div key={t.value} className="flex items-center gap-2.5">
                <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: t.color }} />
                <span className="text-xs text-white/62">{t.label}</span>
              </div>
            ))}
          </div>

          {/* Google Calendar status */}
          {googleStatus && (
            <div className="bg-surface-1 border border-white/[0.07] rounded-2xl p-4 space-y-2.5">
              <p className="text-[10px] font-bold text-white/35 uppercase tracking-widest">Google Calendar</p>
              {googleStatus.connected ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-lime flex-shrink-0" />
                    <span className="text-xs text-white/72 truncate">{googleStatus.google_email}</span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <button onClick={handleSyncAll} disabled={syncing}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl border border-white/10 bg-surface-0 text-white/72 hover:bg-surface-2 transition-colors w-full justify-center">
                      <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
                      {syncing ? 'Sincronizando...' : 'Sincronizar'}
                    </button>
                    <button onClick={handleDisconnect}
                      className="text-xs text-white/35 hover:text-danger/70 transition-colors text-center py-1">
                      Desconectar
                    </button>
                  </div>
                </>
              ) : googleStatus.configured ? (
                <button onClick={handleConnect}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl border border-blue-500/25 text-blue-400 bg-blue-500/8 hover:bg-blue-500/15 transition-colors w-full justify-center">
                  <Link2 size={12} /> Conectar
                </button>
              ) : (
                <p className="text-[11px] text-white/32 flex items-center gap-1.5">
                  <Link2Off size={11} /> No configurado
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Main calendar area ────────────────────────────── */}
      <div className="flex-1 min-w-0">
        {/* Mobile header */}
        {isMobile && (
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-xl font-semibold text-white/90">
                {me?.role === 'vendedor' ? 'Mi Agenda' : 'Agenda'}
              </h1>
              <p className="text-xs text-white/45 mt-0.5">
                {todayEvents.length > 0 ? `${todayEvents.length} reunión${todayEvents.length !== 1 ? 'es' : ''} hoy` : 'Sin reuniones hoy'}
              </p>
            </div>
            <button onClick={() => openCreate()} className="btn-primary text-sm">
              <Plus size={15} /> Reunión
            </button>
          </div>
        )}

        {/* Mobile: upcoming */}
        {isMobile && upcomingEvents.length > 0 && (
          <div className="bg-surface-1 rounded-2xl border border-white/[0.07] divide-y divide-white/5 mb-3">
            <div className="px-4 py-2.5">
              <p className="text-[10px] font-bold text-white/38 uppercase tracking-widest">Próximas reuniones</p>
            </div>
            {upcomingEvents.map(ev => (
              <button key={ev.id} onClick={() => openEdit(ev)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-0 transition-colors">
                <div className="w-1 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: ev.color }} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-white/88 text-sm truncate">{ev.title}</p>
                  <p className="text-xs text-white/45 flex items-center gap-1 mt-0.5">
                    <Clock size={10} />
                    {format(parseLocalDate(ev.start_time), "d MMM · HH:mm", { locale: es })}
                  </p>
                </div>
                {ev.assigned_to && (
                  <div className="w-7 h-7 rounded-full bg-surface-3 flex items-center justify-center flex-shrink-0">
                    <User size={12} className="text-white/55" />
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {/* FullCalendar */}
        <div className="bg-surface-1 rounded-2xl border border-white/[0.07] shadow-sm overflow-hidden">
          <FullCalendar
            ref={calRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView={currentView}
            locale="es"
            firstDay={1}
            events={allEvents}
            headerToolbar={isMobile ? {
              left: 'prev,next',
              center: 'title',
              right: 'today',
            } : {
              left: 'prev,next today',
              center: 'title',
              right: 'dayGridMonth,timeGridWeek,timeGridDay',
            }}
            buttonText={{ today: 'Hoy', month: 'Mes', week: 'Semana', day: 'Día' }}
            timeZone="local"
            allDaySlot={false}
            selectable
            selectMirror
            dayMaxEvents={3}
            height={isMobile ? 460 : 700}
            nowIndicator
            scrollTime={new Date().getHours() > 0 ? `${new Date().getHours() - 1}:00:00` : '07:00:00'}
            viewDidMount={info => setCurrentView(info.view.type)}
            select={info => openCreate(info.startStr, info.endStr)}
            eventClick={info => {
              if (info.event.extendedProps.googleEvent) {
                const link = info.event.extendedProps.googleEvent.htmlLink
                if (link) window.open(link, '_blank')
                info.jsEvent.preventDefault()
                return
              }
              openEdit(info.event.extendedProps.event as CalendarEvent)
            }}
            dayHeaderContent={arg => {
              const isToday = arg.isToday
              const dayName = arg.date.toLocaleDateString('es-CL', { weekday: 'short' }).toUpperCase().slice(0, 3)
              const dayNum = arg.date.getDate()
              const isMonth = arg.view.type === 'dayGridMonth'
              if (isMonth) {
                return (
                  <div className="py-2 text-center">
                    <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em',
                      color: isToday ? '#7c3aed' : '#70757a' }}>
                      {dayName}
                    </span>
                  </div>
                )
              }
              return (
                <div className="flex flex-col items-center py-2 gap-1">
                  <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em',
                    color: isToday ? '#7c3aed' : '#70757a' }}>
                    {dayName}
                  </span>
                  <span style={{
                    width: 32, height: 32, borderRadius: '50%', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: '14px',
                    fontWeight: isToday ? 700 : 400,
                    background: isToday ? '#7c3aed' : 'transparent',
                    color: isToday ? '#fff' : '#3c4043',
                  }}>
                    {dayNum}
                  </span>
                </div>
              )
            }}
            eventContent={arg => {
              const isGoogle = !!arg.event.extendedProps.googleEvent
              const isVendor = arg.event.extendedProps.isVendorEvent
              const hasMeet = !!(arg.event.extendedProps.event as CalendarEvent | undefined)?.meet_link
              const isTimeGrid = arg.view.type.includes('timeGrid')
              return (
                <div style={{
                  display: 'flex',
                  gap: isTimeGrid ? 1 : 4,
                  overflow: 'hidden',
                  width: '100%',
                  minWidth: 0,
                  padding: isTimeGrid ? '0' : '2px 5px',
                  flexDirection: isTimeGrid ? 'column' : 'row',
                  alignItems: isTimeGrid ? 'flex-start' : 'center',
                }}>
                  {isGoogle && <span style={{ fontSize: 9, opacity: 0.9, flexShrink: 0, fontWeight: 800, color: '#fff', lineHeight: '13px' }}>G</span>}
                  {hasMeet && <Video size={isTimeGrid ? 11 : 10} style={{ color: '#fff', opacity: 0.9, flexShrink: 0, marginTop: isTimeGrid ? 2 : 0 }} />}
                  {isVendor && !isGoogle && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,0.65)', flexShrink: 0, marginTop: isTimeGrid ? 2 : 0 }} />}
                  <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                    fontWeight: 600, fontSize: isTimeGrid ? 12 : 11, color: '#fff', minWidth: 0,
                    lineHeight: 1.25 }}>
                    {arg.event.title}
                  </span>
                  {isTimeGrid && arg.timeText && (
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.82)' }}>{arg.timeText}</span>
                  )}
                </div>
              )
            }}
          />
        </div>
      </div>

      {showModal && (
        <EventModal
          event={editEvent}
          vendors={vendors}
          defaultDate={defaultDate}
          defaultEndDate={defaultEndDate}
          googleConnected={!!googleStatus?.connected}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load() }}
          onDeleted={() => { setShowModal(false); load() }}
        />
      )}
      {confirmMainDialog}
    </div>
  )
}
