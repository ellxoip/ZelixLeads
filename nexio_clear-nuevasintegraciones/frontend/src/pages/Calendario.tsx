import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import {
  getCalendarEvents, createCalendarEvent, deleteCalendarEvent, updateCalendarEvent, getUsers,
  getGoogleStatus, getGoogleAuthUrl, disconnectGoogle, getGoogleEvents, syncAllToGoogle,
  getGroupVendors,
} from '../api'
import type { CalendarEvent } from '../types'
import toast from 'react-hot-toast'
import { X, Plus, ChevronLeft, ChevronRight, RefreshCw, Link2, Link2Off, Search, User } from 'lucide-react'
import { useConfirm } from '../components/ConfirmDialog'
import { format } from 'date-fns'
import { useAuthStore } from '../store/auth'
import { useRealtime } from '../contexts/RealtimeContext'


/* ── Mini calendar ────────────────────────────────────────────────────────── */
const DAYS = ['L','M','X','J','V','S','D']
const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                   'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

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

function MiniCalendar({ eventDates, selectedDate, onDayClick }: {
  eventDates: Set<string>
  selectedDate: string
  onDayClick: (d: Date) => void
}) {
  const [cur, setCur] = useState(() => {
    const d = new Date(); d.setDate(1); return d
  })
  const today = new Date()

  const year = cur.getFullYear()
  const month = cur.getMonth()
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const dayKey = (d: number) => `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`

  const isTodayCell = (d: number) =>
    d === today.getDate() && month === today.getMonth() && year === today.getFullYear()

  const isSelectedCell = (d: number) => dayKey(d) === selectedDate

  const hasEvent = (d: number) => eventDates.has(dayKey(d))

  const prev = () => setCur(new Date(year, month - 1, 1))
  const next = () => setCur(new Date(year, month + 1, 1))

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-xs font-semibold text-white/75 tracking-wide">
          {MONTHS_ES[month]} {year}
        </span>
        <div className="flex gap-0.5">
          <button onClick={prev}
            className="p-1 rounded hover:bg-white/8 text-white/52 hover:text-white/90 transition-colors">
            <ChevronLeft size={13} />
          </button>
          <button onClick={next}
            className="p-1 rounded hover:bg-white/8 text-white/52 hover:text-white/90 transition-colors">
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-0">
        {DAYS.map(d => (
          <div key={d} className="text-center text-[10px] font-semibold text-white/35 py-1">{d}</div>
        ))}
        {cells.map((d, i) => (
          <div key={i} className="flex items-center justify-center">
            {d ? (
              <button
                onClick={() => onDayClick(new Date(year, month, d))}
                className={`relative w-6 h-6 rounded-full text-[11px] font-medium flex items-center justify-center transition-colors
                  ${isSelectedCell(d)
                    ? 'bg-blue-500 text-white font-bold shadow-sm shadow-blue-500/30'
                    : isTodayCell(d)
                      ? 'text-blue-400 font-bold hover:bg-blue-500/10'
                      : 'text-white/70 hover:bg-white/10'
                  }`}
              >
                {d}
                {hasEvent(d) && !isSelectedCell(d) && (
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-blue-400" />
                )}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════ */
export default function Calendario() {
  const { user: me } = useAuthStore()
  const { confirm, dialog: confirmDialog } = useConfirm()
  const isAdmin = me?.role === 'superadmin' || me?.role === 'subadmin'
  const [searchParams] = useSearchParams()

  const calRef = useRef<any>(null)

  const [events, setEvents]             = useState<CalendarEvent[]>([])
  const [googleEvents, setGoogleEvents] = useState<any[]>([])
  const [googleStatus, setGoogleStatus] = useState<{ configured: boolean; connected: boolean; google_email: string | null } | null>(null)
  const [syncing, setSyncing]           = useState(false)
  const [users, setUsers]               = useState<any[]>([])
  const [viewUserId, setViewUserId]     = useState<number | null>(null)
  const [userSearch, setUserSearch]     = useState('')
  const [showPicker, setShowPicker]     = useState(false)
  const [showModal, setShowModal]       = useState(false)
  const [editEvent, setEditEvent]       = useState<CalendarEvent | null>(null)
  const [form, setForm]                 = useState({
    title: '', start_time: '', end_time: '',
    event_type: 'reunion', notes: '', color: '#7c3aed', assigned_to: '',
  })
  const [groupVendors, setGroupVendors] = useState<any[]>([])
  const [loading, setLoading]           = useState(false)
  const [isMobile, setIsMobile]         = useState(() => window.innerWidth < 768)
  const [selectedDate, setSelectedDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const pickerRef                       = useRef<HTMLDivElement>(null)
  const isAgendadora                    = me?.role === 'agendadora'

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node))
        setShowPicker(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const load = useCallback(async (uid: number | null = viewUserId) => {
    try {
      const params = isAdmin && uid ? { user_id: uid } : undefined
      setEvents(await getCalendarEvents(params))
    } catch {
      toast.error('Error cargando eventos')
    }
  }, [viewUserId, isAdmin])

  const loadGoogleStatus = async () => {
    try { setGoogleStatus(await getGoogleStatus()) } catch {}
  }

  const loadGoogleEvents = useCallback(async () => {
    try { setGoogleEvents(await getGoogleEvents()) } catch {}
  }, [])

  const handleGoogleConnect = async () => {
    if (!googleStatus?.configured) {
      toast.error('Google Calendar no está configurado. Contacta al administrador del sistema.')
      return
    }
    try {
      const { url } = await getGoogleAuthUrl()
      const popup = window.open(url, 'google-auth', 'width=500,height=650,scrollbars=yes')
      const handler = (e: MessageEvent) => {
        if (e.data?.googleCalendar === 'connected') {
          window.removeEventListener('message', handler)
          popup?.close()
          toast.success('Google Calendar conectado')
          loadGoogleStatus()
          loadGoogleEvents()
        } else if (e.data?.googleCalendar === 'error') {
          window.removeEventListener('message', handler)
          toast.error('Error al conectar Google Calendar')
        }
      }
      window.addEventListener('message', handler)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Google Calendar no configurado aún')
    }
  }

  const handleGoogleDisconnect = async () => {
    const ok = await confirm('Se perderá la sincronización con Google Calendar.', { title: 'Desconectar Google Calendar', confirmLabel: 'Desconectar' })
    if (!ok) return
    try {
      await disconnectGoogle()
      setGoogleStatus(s => s ? { ...s, connected: false, google_email: null } : s)
      setGoogleEvents([])
      toast.success('Google Calendar desconectado')
    } catch { toast.error('Error al desconectar') }
  }

  const handleSyncAll = async () => {
    setSyncing(true)
    try {
      const r = await syncAllToGoogle()
      toast.success(`Sincronizados ${r.synced} eventos${r.failed ? ` (${r.failed} errores)` : ''}`)
    } catch { toast.error('Error al sincronizar') } finally { setSyncing(false) }
  }

  useEffect(() => {
    load(null)
    loadGoogleStatus()
    if (isAdmin) getUsers().then(setUsers)
    if (isAgendadora) getGroupVendors().then(setGroupVendors).catch(() => {})
  }, [])

  useEffect(() => {
    if (googleStatus?.connected) loadGoogleEvents()
    else setGoogleEvents([])
  }, [googleStatus?.connected])

  /* auto-refresh every 30s */
  useEffect(() => {
    const id = setInterval(() => {
      load()
      if (googleStatus?.connected) loadGoogleEvents()
    }, 30_000)
    return () => clearInterval(id)
  }, [load, loadGoogleEvents, googleStatus?.connected])

  useRealtime(['calendar_update', 'lead_update'], () => load())

  const viewingUser  = viewUserId ? users.find(u => u.id === viewUserId) : null

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    const list = q
      ? users.filter(u => u.name.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q))
      : users
    return list.slice(0, 50)
  }, [users, userSearch])

  const selectUser = (u: any) => {
    setViewUserId(u.id)
    setShowPicker(false)
    setUserSearch('')
    load(u.id)
  }

  const backToMine = () => {
    setViewUserId(null)
    load(null)
  }

  /* event sets for FullCalendar */
  const crmFcEvents = events.map(e => ({
    id: e.id.toString(),
    title: e.title,
    start: e.start_time,
    end: e.end_time,
    backgroundColor: e.color,
    borderColor: e.color,
    extendedProps: { event: e },
  }))

  const googleFcEvents = googleEvents.map(e => ({
    id: `g_${e.id}`,
    title: e.title,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    backgroundColor: '#4285f4',
    borderColor: '#1a73e8',
    extendedProps: { googleEvent: e },
    url: e.htmlLink || undefined,
  }))

  const fcEvents = [...crmFcEvents, ...googleFcEvents]

  /* dot indicators for mini calendar */
  const eventDates = useMemo(() => {
    const s = new Set<string>()
    fcEvents.forEach(e => {
      if (e.start) s.add(e.start.slice(0, 10))
    })
    return s
  }, [fcEvents])

  /* navigate FullCalendar to a date from mini calendar */
  const goToDate = (date: Date) => {
    setSelectedDate(format(date, 'yyyy-MM-dd'))
    const api = calRef.current?.getApi()
    if (api) api.changeView('timeGridDay', date)
  }

  /* modal helpers */
  const openCreate = (startStr?: string, endStr?: string) => {
    const start = toDateTimeLocal(startStr)
    const end = endStr ? toDateTimeLocal(endStr) : addMinutesLocal(start, 30)
    setForm({
      title: '',
      start_time: start,
      end_time: end,
      event_type: 'reunion', notes: '', color: '#7c3aed',
      assigned_to: isAgendadora ? (groupVendors[0]?.id?.toString() ?? '') : '',
    })
    setEditEvent(null)
    setShowModal(true)
  }

  const toLocalInput = (utcStr?: string | null): string => {
    if (!utcStr) return ''
    const d = new Date(utcStr)
    if (isNaN(d.getTime())) return utcStr.slice(0, 16)
    return d.toLocaleString('sv', { hour12: false }).slice(0, 16).replace(' ', 'T')
  }

  const openEdit = (event: CalendarEvent) => {
    setEditEvent(event)
    setForm({
      title: event.title,
      start_time: toLocalInput(event.start_time),
      end_time:   toLocalInput(event.end_time),
      event_type: event.event_type,
      notes: event.notes || '',
      color: event.color,
      assigned_to: event.assigned_to?.toString() ?? '',
    })
    setShowModal(true)
  }

  useEffect(() => {
    const eid = searchParams.get('event_id')
    if (eid && events.length > 0) {
      const found = events.find(e => e.id === parseInt(eid))
      if (found) openEdit(found)
    }
  }, [events])

  const toUtcIso = (localStr: string): string => {
    if (!localStr) return localStr
    const d = new Date(localStr)
    return isNaN(d.getTime()) ? localStr : d.toISOString()
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title || !form.start_time || !form.end_time) {
      toast.error('Completa título y fechas')
      return
    }
    setLoading(true)
    try {
      const payload = {
        ...form,
        start_time: toUtcIso(form.start_time),
        end_time: toUtcIso(form.end_time),
        assigned_to: form.assigned_to ? parseInt(form.assigned_to) : null,
      }
      if (editEvent) {
        await updateCalendarEvent(editEvent.id, payload)
        toast.success('Evento actualizado')
      } else {
        await createCalendarEvent(payload)
        toast.success(payload.assigned_to ? 'Reunión agendada — vendedor notificado' : 'Evento creado')
      }
      setShowModal(false)
      load()
    } catch {
      toast.error('Error guardando evento')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!editEvent) return
    const ok = await confirm('¿Eliminar este evento? Esta acción no se puede deshacer.', { title: 'Eliminar evento', confirmLabel: 'Eliminar' })
    if (!ok) return
    try {
      await deleteCalendarEvent(editEvent.id)
      toast.success('Evento eliminado')
      setShowModal(false)
      load()
    } catch {
      toast.error('Error al eliminar')
    }
  }

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const colorOptions = [
    { color: '#7c3aed', label: 'Azul' },
    { color: '#10B981', label: 'Esmeralda' },
    { color: '#F59E0B', label: 'Ámbar' },
    { color: '#EF4444', label: 'Rojo' },
    { color: '#8B5CF6', label: 'Púrpura' },
    { color: '#64748B', label: 'Slate' },
  ]

  /* today's events for sidebar */
  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const todayEvents = fcEvents
    .filter(e => e.start?.slice(0, 10) === todayStr)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 5)

  /* ── render ─────────────────────────────────────────────────────────────── */
  return (
    <div className="flex gap-0 h-full" style={{ minHeight: 0 }}>
      {/* ── Left Sidebar ──────────────────────────────────────────────────── */}
      {!isMobile && (
        <aside className="w-60 flex-shrink-0 flex flex-col gap-4 pr-4 py-1">

          {/* New Event button */}
          <button
            onClick={() => openCreate()}
            className="flex items-center gap-2.5 w-full px-4 py-3 rounded-2xl bg-surface-1 border border-white/10 text-white/85 text-sm font-medium hover:bg-surface-2 transition-colors shadow-sm"
          >
            <span className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
              <Plus size={15} className="text-white" />
            </span>
            Nuevo Evento
          </button>

          {/* Mini calendar */}
          <div className="bg-surface-1 border border-white/[0.07] rounded-2xl p-3">
            <MiniCalendar eventDates={eventDates} selectedDate={selectedDate} onDayClick={goToDate} />
          </div>

          {/* Today's events */}
          <div className="bg-surface-1 border border-white/[0.07] rounded-2xl p-3">
            <p className="text-[10px] font-semibold text-white/40 uppercase tracking-widest mb-2">Hoy</p>
            {todayEvents.length === 0 ? (
              <p className="text-xs text-white/35 italic">Sin eventos</p>
            ) : (
              <ul className="space-y-1.5">
                {todayEvents.map(e => (
                  <li key={e.id} className="flex items-center gap-2 text-xs text-white/70 truncate">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: e.backgroundColor ?? '#4285f4' }}
                    />
                    <span className="truncate">{e.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Viewing user info (admin) */}
          {viewingUser && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-3 text-xs text-blue-300">
              <p className="font-semibold text-white/70 mb-1">Viendo agenda de:</p>
              <p className="font-bold text-white">{viewingUser.name}</p>
              <button
                onClick={backToMine}
                className="mt-2 flex items-center gap-1 text-blue-400 hover:text-blue-200 transition-colors"
              >
                <ChevronLeft size={11} /> Volver a mi calendario
              </button>
            </div>
          )}

          {/* Google Calendar status */}
          <div className="bg-surface-1 border border-white/[0.07] rounded-2xl p-3 space-y-2">
            <p className="text-[10px] font-semibold text-white/40 uppercase tracking-widest">Google Calendar</p>
            {googleStatus?.connected ? (
              <>
                <div className="flex items-center gap-1.5 text-xs text-green-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  {googleStatus.google_email?.split('@')[0]}
                </div>
                <button
                  onClick={handleSyncAll}
                  disabled={syncing}
                  className="w-full flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 rounded-lg border border-white/10 bg-surface-0 text-white/70 hover:bg-surface-2 transition-colors"
                >
                  <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} />
                  {syncing ? 'Sincronizando...' : 'Sincronizar'}
                </button>
                <button
                  onClick={handleGoogleDisconnect}
                  className="w-full flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 rounded-lg border border-white/10 bg-surface-0 text-white/52 hover:text-danger hover:border-danger/30 transition-colors"
                >
                  <Link2Off size={11} /> Desconectar
                </button>
              </>
            ) : (
              <button
                onClick={handleGoogleConnect}
                disabled={!googleStatus?.configured}
                className={`w-full flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 rounded-lg border transition-colors ${
                  googleStatus?.configured
                    ? 'border-white/10 bg-surface-0 text-white/70 hover:bg-surface-2'
                    : 'border-white/[0.07] text-white/30 cursor-not-allowed'
                }`}
              >
                <Link2 size={11} />
                {googleStatus?.configured ? 'Conectar' : 'No configurado'}
              </button>
            )}
          </div>

          {/* User picker (admin only) */}
          {isAdmin && (
            <div className="bg-surface-1 border border-white/[0.07] rounded-2xl p-3" ref={pickerRef}>
              <p className="text-[10px] font-semibold text-white/40 uppercase tracking-widest mb-2">Ver usuario</p>
              <div className="relative mb-2">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                <input
                  value={userSearch}
                  onChange={e => { setUserSearch(e.target.value); setShowPicker(true) }}
                  onFocus={() => setShowPicker(true)}
                  placeholder="Buscar usuario..."
                  className="w-full pl-7 pr-2.5 py-1.5 text-xs bg-surface-0 border border-white/10 rounded-lg focus:outline-none focus:ring-1 focus:ring-white/15 focus:border-white/25 text-white/80 placeholder:text-white/30"
                />
              </div>
              {showPicker && filteredUsers.length > 0 && (
                <div className="max-h-40 overflow-y-auto space-y-0.5">
                  {filteredUsers.map(u => (
                    <button key={u.id} onClick={() => selectUser(u)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-surface-0 transition-colors ${
                        u.id === viewUserId ? 'bg-surface-0' : ''
                      }`}>
                      <div className="w-6 h-6 rounded-full bg-surface-3 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-white/78">
                        {u.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-white/85 truncate">{u.name}</p>
                        <p className="text-[10px] text-white/40 capitalize">{u.role}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </aside>
      )}

      {/* ── Main calendar area ─────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        {/* Mobile-only top bar */}
        {isMobile && (
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h1 className="text-lg font-bold text-white">Calendario</h1>
            <div className="flex items-center gap-2">
              {viewingUser && (
                <button onClick={backToMine}
                  className="flex items-center gap-1 text-xs font-medium text-white/70 border border-white/10 bg-surface-1 px-2.5 py-1.5 rounded-lg transition-colors">
                  <ChevronLeft size={12} /> Mi calendario
                </button>
              )}
              <button onClick={() => openCreate()} className="btn-primary text-sm px-3 py-2">
                <Plus size={14} /> Evento
              </button>
            </div>
          </div>
        )}

        <div className="bg-surface-1 rounded-2xl border border-white/[0.07] shadow-sm overflow-hidden flex-1">
          <FullCalendar
            ref={calRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView={isMobile ? 'dayGridMonth' : 'timeGridWeek'}
            locale="es"
            firstDay={1}
            events={fcEvents}
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
            selectable
            selectMirror
            dayMaxEvents
            allDaySlot={false}
            height={isMobile ? 460 : 700}
            nowIndicator
            scrollTime={new Date().getHours() > 0 ? `${new Date().getHours() - 1}:00:00` : '00:00:00'}
            dayHeaderContent={(arg: any) => {
              const isToday = arg.isToday
              const dayName = arg.date.toLocaleDateString('es', { weekday: 'short' })
                .toUpperCase().slice(0, 3)
              const dayNum = arg.date.getDate()
              return (
                <div className="flex flex-col items-center py-1 gap-0.5">
                  <span style={{ fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.06em',
                    color: isToday ? '#1a73e8' : '#70757a' }}>
                    {dayName}
                  </span>
                  <span style={{
                    width: 28, height: 28, borderRadius: '50%', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: '0.82rem',
                    fontWeight: isToday ? 700 : 400,
                    background: isToday ? '#1a73e8' : 'transparent',
                    color: isToday ? '#fff' : '#3c4043',
                  }}>
                    {dayNum}
                  </span>
                </div>
              )
            }}
            eventContent={(arg: any) => {
              const isGoogle = !!arg.event.extendedProps?.googleEvent
              const isTimeGrid = arg.view.type.includes('timeGrid')
              return (
                <div style={{
                  display: 'flex',
                  flexDirection: isTimeGrid ? 'column' : 'row',
                  alignItems: isTimeGrid ? 'flex-start' : 'center',
                  gap: isTimeGrid ? 1 : 4,
                  overflow: 'hidden',
                  width: '100%',
                  minWidth: 0,
                  padding: isTimeGrid ? '2px 6px' : '2px 5px',
                }}>
                  {isGoogle && (
                    <span style={{ fontSize: 9, fontWeight: 800, color: '#fff',
                      background: '#4285f4', borderRadius: 3, padding: '0 2px',
                      flexShrink: 0, lineHeight: '13px', marginBottom: isTimeGrid ? 1 : 0,
                      alignSelf: isTimeGrid ? 'flex-start' : 'center' }}>G</span>
                  )}
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#fff',
                    overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                    minWidth: 0, lineHeight: 1.25 }}>
                    {arg.event.title}
                  </span>
                  {isTimeGrid && arg.timeText && (
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.82)' }}>{arg.timeText}</span>
                  )}
                </div>
              )
            }}
            select={(info: any) => openCreate(info.startStr, info.endStr)}
            eventClick={(info: any) => {
              if (info.event.extendedProps.googleEvent) {
                const link = info.event.extendedProps.googleEvent.htmlLink
                if (link) window.open(link, '_blank')
                info.jsEvent.preventDefault()
                return
              }
              openEdit(info.event.extendedProps.event as CalendarEvent)
            }}
          />
        </div>
      </div>

      {/* ── Event Modal ────────────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4">
          <div className="bg-surface-1 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.07]">
              <h2 className="text-lg font-bold text-white">
                {editEvent ? 'Editar Evento' : 'Nuevo Evento'}
              </h2>
              <button onClick={() => setShowModal(false)}
                className="p-2 hover:bg-surface-2 rounded-lg text-white/62">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSave} className="px-6 py-5 space-y-4">

              {/* Superadmin/subadmin: info del dueño del evento */}
              {editEvent && isAdmin && (editEvent.creator || editEvent.assigned_to) && (
                <div className="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-surface-0 border border-white/[0.07]">
                  <User size={14} className="text-white/40 mt-0.5 flex-shrink-0" />
                  <div className="text-xs space-y-0.5 min-w-0">
                    {editEvent.creator && (
                      <p className="text-white/55">
                        <span className="text-white/35 mr-1">Creado por</span>
                        <span className="font-semibold text-white/80">{editEvent.creator.name}</span>
                        <span className="text-white/35 ml-1">({editEvent.creator.role})</span>
                      </p>
                    )}
                    {editEvent.assigned_to && (() => {
                      const assignedUser = users.find((u: any) => u.id === editEvent.assigned_to)
                      return assignedUser ? (
                        <p className="text-white/55">
                          <span className="text-white/35 mr-1">Asignado a</span>
                          <span className="font-semibold text-white/80">{assignedUser.name}</span>
                          <span className="text-white/35 ml-1">({assignedUser.role})</span>
                        </p>
                      ) : null
                    })()}
                  </div>
                </div>
              )}

              <div>
                <label className="input-label">Título *</label>
                <input className="input" value={form.title} onChange={e => set('title', e.target.value)}
                  placeholder="Reunión con cliente..." required />
              </div>

              {isAgendadora && groupVendors.length > 0 && (
                <div>
                  <label className="input-label">Agendar para vendedor</label>
                  <select className="input" value={form.assigned_to}
                    onChange={e => set('assigned_to', e.target.value)}>
                    <option value="">Solo en mi agenda</option>
                    {groupVendors.map(v => (
                      <option key={v.id} value={v.id}>{v.name}</option>
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
                <label className="input-label">Tipo</label>
                <select className="input" value={form.event_type} onChange={e => set('event_type', e.target.value)}>
                  <option value="reunion">Reunión</option>
                  <option value="llamada">Llamada</option>
                  <option value="seguimiento">Seguimiento</option>
                  <option value="tarea">Tarea</option>
                </select>
              </div>

              <div>
                <label className="input-label">Color</label>
                <div className="flex gap-2.5 flex-wrap mt-1">
                  {colorOptions.map(opt => (
                    <button key={opt.color} type="button" onClick={() => set('color', opt.color)}
                      title={opt.label}
                      className={`w-8 h-8 rounded-full border-4 transition-transform hover:scale-110 ${
                        form.color === opt.color ? 'border-white/15 scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: opt.color }} />
                  ))}
                </div>
              </div>

              <div>
                <label className="input-label">Notas y Detalles de la reunión</label>
                <textarea className="input" rows={4} value={form.notes}
                  onChange={e => set('notes', e.target.value)}
                  placeholder="Agrega links de Meet, instrucciones o detalles para el vendedor..." />
              </div>
            </form>

            <div className="px-6 py-4 border-t border-white/[0.07] flex gap-3">
              {editEvent && (
                <button type="button" onClick={handleDelete}
                  className="bg-surface-1 border border-white/10 hover:bg-danger/10 hover:border-danger/30 hover:text-danger text-white/62 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors">
                  Eliminar
                </button>
              )}
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1">
                Cancelar
              </button>
              <button onClick={handleSave} disabled={loading} className="btn-primary flex-1">
                {loading ? 'Guardando...' : editEvent ? 'Actualizar' : 'Crear'}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  )
}
