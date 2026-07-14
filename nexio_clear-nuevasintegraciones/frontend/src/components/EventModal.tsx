import { useState, useEffect, useMemo } from 'react'
import { Trash2, X, Calendar, Link2, Clock, User, ThumbsUp, XCircle, CheckCircle2, Video } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, updateVendorStatus, getCalendarSlots, getLead, getAllAreas, createLead, moveLeadStage } from '../api'
import type { CalendarEvent } from '../types'
import { useAuthStore } from '../store/auth'
import { useConfirm } from './ConfirmDialog'

const EVENT_TYPES = [
  { value: 'reunion',      label: 'Reunión',      color: '#3B82F6' },
  { value: 'llamada',      label: 'Llamada',      color: '#10B981' },
  { value: 'seguimiento',  label: 'Seguimiento',  color: '#F59E0B' },
  { value: 'tarea',        label: 'Tarea',        color: '#8B5CF6' },
]

/** Convert a UTC datetime string from the API to local time for <input type="datetime-local"> */
function toLocalInput(utcStr?: string | null): string {
  if (!utcStr) return ''
  const d = new Date(utcStr)
  if (isNaN(d.getTime())) return utcStr.slice(0, 16)
  // 'sv' locale returns ISO-like "YYYY-MM-DD HH:MM:SS" in local time
  return d.toLocaleString('sv', { hour12: false }).slice(0, 16).replace(' ', 'T')
}

// Barra de disponibilidad en vivo del vendedor. Jornada 08:00–20:00 en bloques
// de 30 min: verde neón = libre, gris = ocupado. Interacción (Fase 2):
//  · clic simple en un bloque libre → reunión de 30 min (onPick).
//  · arrastrar sobre bloques libres → selecciona un rango (onRange), clampado
//    para no cruzar bloques ocupados.
function AvailabilityBar({ userId, date, onPick, onRange, selStart, selEnd, onDeselect }: {
  userId?: number
  date?: string
  onPick: (hhmm: string) => void
  onRange: (startHHMM: string, endHHMM: string) => void
  // Rango ya reservado (HH:MM) — se pinta con ✕ y clic encima lo deselecciona.
  selStart?: string
  selEnd?: string
  onDeselect?: () => void
}) {
  const [busy, setBusy] = useState<{ start: string; end: string; title: string }[] | null>(null)
  const [dragStart, setDragStart] = useState<number | null>(null)
  const [dragEnd, setDragEnd] = useState<number | null>(null)

  useEffect(() => {
    if (!userId || !date) { setBusy(null); return }
    let cancel = false
    getCalendarSlots(userId, date)
      .then((d: any) => { if (!cancel) setBusy(d.busy ?? []) })
      .catch(() => { if (!cancel) setBusy([]) })
    return () => { cancel = true }
  }, [userId, date])

  const toMin = (h: string) => parseInt(h.slice(0, 2), 10) * 60 + parseInt(h.slice(3, 5), 10)
  const DAY_START = 8 * 60, DAY_END = 20 * 60, STEP = 30
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${m % 60 ? '30' : '00'}`

  const blocks = useMemo(() => Array.from({ length: (DAY_END - DAY_START) / STEP }, (_, i) => {
    const from = DAY_START + i * STEP, to = from + STEP
    const occupied = (busy ?? []).some(b => toMin(b.start) < to && toMin(b.end) > from)
    return { from, occupied, label: fmt(from) }
  }), [busy])

  // Confirma la selección al soltar (mouse/touch) — a nivel window por robustez.
  useEffect(() => {
    if (dragStart === null) return
    const finalize = () => {
      const s = dragStart, e = dragEnd ?? dragStart
      const lo = Math.min(s, e), hi = Math.max(s, e)
      if (lo === hi) onPick(blocks[lo].label)
      else onRange(blocks[lo].label, fmt(blocks[hi].from + STEP))
      setDragStart(null); setDragEnd(null)
    }
    window.addEventListener('mouseup', finalize)
    window.addEventListener('touchend', finalize)
    return () => { window.removeEventListener('mouseup', finalize); window.removeEventListener('touchend', finalize) }
  }, [dragStart, dragEnd, blocks]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!userId || !date || busy === null) return null

  // Bloques dentro de la reserva ya confirmada (marcados con ✕, deseleccionables)
  const marked = (i: number) => {
    if (!selStart || !selEnd) return false
    const from = blocks[i].from
    return from >= toMin(selStart) && from < toMin(selEnd)
  }

  const begin = (i: number) => {
    if (marked(i)) { onDeselect?.(); return }  // toggle: clic sobre la reserva la quita
    if (!blocks[i].occupied) { setDragStart(i); setDragEnd(i) }
  }
  const extend = (j: number) => {
    if (dragStart === null) return
    const lo = Math.min(dragStart, j), hi = Math.max(dragStart, j)
    for (let k = lo; k <= hi; k++) if (blocks[k].occupied) return // no cruzar ocupados
    setDragEnd(j)
  }
  const inSel = (i: number) =>
    dragStart !== null && i >= Math.min(dragStart, dragEnd ?? dragStart) && i <= Math.max(dragStart, dragEnd ?? dragStart)

  return (
    <div>
      <label className="input-label">Disponibilidad del vendedor</label>
      <div className="flex gap-[2px] rounded-lg overflow-hidden mt-1 select-none">
        {blocks.map((b, i) => {
          const sel = inSel(i)
          const mk = marked(i)
          return (
            <div key={b.from}
              onMouseDown={() => begin(i)}
              onMouseEnter={() => extend(i)}
              onTouchStart={() => begin(i)}
              title={mk ? `${b.label} · Reservado — clic para deseleccionar` : `${b.label} · ${b.occupied ? 'Ocupado' : 'Libre'}`}
              className="flex-1 h-6 transition-all flex items-center justify-center"
              style={{
                background: b.occupied ? 'rgba(239,68,68,0.55)' : mk ? 'rgba(21,128,61,0.95)' : sel ? 'rgba(34,197,94,0.9)' : 'rgba(34,197,94,0.55)',
                boxShadow: b.occupied
                  ? 'inset 0 0 6px rgba(239,68,68,0.5)'
                  : `inset 0 0 ${sel || mk ? 10 : 6}px rgba(34,197,94,${sel || mk ? 0.7 : 0.45})`,
                cursor: b.occupied ? 'not-allowed' : 'pointer',
              }}>
              {mk && <span className="text-white text-[9px] font-bold leading-none select-none">✕</span>}
            </div>
          )
        })}
      </div>
      {/* Eje de tiempos — marcas troncales alineadas bajo la barra */}
      <div className="flex justify-between mt-0.5 text-[10px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
        {['08:00', '11:00', '14:00', '17:00', '20:00'].map(t => <span key={t}>{t}</span>)}
      </div>
      <div className="flex items-center gap-3 mt-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
        <span className="flex items-center gap-1">
          <i className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(34,197,94,0.55)' }} /> Libre
        </span>
        <span className="flex items-center gap-1">
          <i className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(239,68,68,0.55)' }} /> Ocupado
        </span>
        <span className="flex items-center gap-1">
          <i className="w-2 h-2 rounded-sm inline-block flex items-center justify-center" style={{ background: 'rgba(21,128,61,0.95)' }} /> Tu reserva
        </span>
        <span className="ml-auto">Clic = 30 min · arrastra = rango · ✕ = deseleccionar</span>
      </div>
    </div>
  )
}

export function EventModal({
  event, vendors, onClose, onSaved, onDeleted, defaultDate,
  leadId, defaultTitle, lockedLeadName, defaultAssignedTo,
}: {
  event: CalendarEvent | null
  vendors: any[]
  onClose: () => void
  // `info.handled` = el modal ya creó un caso nuevo en otra categoría y lo movió
  // a 'reunion'; el opener NO debe volver a mover el lead original.
  onSaved: (info?: { handled?: boolean; leadId?: number }) => void
  onDeleted?: () => void
  defaultDate?: string
  leadId?: number              // vincula el evento a un lead (cascada desde el Drawer)
  defaultTitle?: string        // título sugerido en cascada
  lockedLeadName?: string      // si viene, el evento queda anclado a este lead (no desvinculable)
  defaultAssignedTo?: number   // pre-asignación inteligente del vendedor del lead
}) {
  const { user: me } = useAuthStore()
  const { confirm, dialog: confirmDialog } = useConfirm()
  const [form, setForm] = useState({
    title: event?.title ?? defaultTitle ?? '',
    start_time: event ? toLocalInput(event.start_time) : (defaultDate ? `${defaultDate}T09:00` : ''),
    end_time:   event ? toLocalInput(event.end_time)   : (defaultDate ? `${defaultDate}T09:30` : ''),
    event_type: event?.event_type ?? 'reunion',
    notes: event?.notes ?? '',
    color: event?.color ?? '#3B82F6',
    assigned_to: event?.assigned_to?.toString() ?? defaultAssignedTo?.toString() ?? (vendors[0]?.id?.toString() ?? ''),
  })
  const [saving, setSaving] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)

  // ── Categoría del cliente ──────────────────────────────────────────────
  // Al agendar una reunión vinculada a un lead, el agendador puede asignar una
  // categoría (área). Si elige una distinta a la actual, se crea un CASO NUEVO
  // para el mismo cliente en esa categoría (el caso actual se mantiene).
  const [leadCtx, setLeadCtx] = useState<any>(null)
  const [areas, setAreas] = useState<any[]>([])
  const [areaId, setAreaId] = useState<string>('')

  useEffect(() => {
    if (!leadId || event) return
    let cancel = false
    Promise.all([getLead(leadId), getAllAreas()])
      .then(([l, a]: [any, any]) => {
        if (cancel) return
        setLeadCtx(l)
        setAreas(Array.isArray(a) ? a : [])
        setAreaId(l?.area_id ? String(l.area_id) : '')
      })
      .catch(() => {})
    return () => { cancel = true }
  }, [leadId, event])

  const categoriaChanged = !!(leadCtx && areaId && String(leadCtx.area_id) !== areaId)
  // Toggle de la reserva en la barra: al deseleccionar (✕) se ocultan las marcas
  // y el ticket; volver a hacer clic/arrastrar en la barra la reactiva.
  const [barCleared, setBarCleared] = useState(false)
  const set = (k: string, v: string) => setForm(f => {
    const updated = { ...f, [k]: v }
    if (k === 'start_time' && v) {
      const [datePart, timePart] = v.split('T')
      if (datePart && timePart) {
        const [h, m] = timePart.split(':').map(Number)
        const pad = (n: number) => n.toString().padStart(2, '0')
        const total = h * 60 + m + 30
        const endH = Math.floor(total / 60) % 24
        const endM = total % 60
        const endDate = total >= 1440
          ? (() => { const d = new Date(`${datePart}T12:00:00`); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10) })()
          : datePart
        updated.end_time = `${endDate}T${pad(endH)}:${pad(endM)}`
      }
    }
    return updated
  })

  const isVendedor = me?.role === 'vendedor'

  const handleVendorStatus = async (status: string) => {
    if (!event) return
    setUpdatingStatus(true)
    try {
      await updateVendorStatus(event.id, status)
      toast.success(status === 'altamente_interesado' ? 'Marcado como exitoso' : 'Estado actualizado')
      onSaved()
    } catch { toast.error('Error actualizando estado') }
    finally { setUpdatingStatus(false) }
  }

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
    if (new Date(form.end_time) <= new Date(form.start_time)) {
      toast.error('La hora de fin debe ser después del inicio'); return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        start_time: toUtcIso(form.start_time),
        end_time: toUtcIso(form.end_time),
        assigned_to: form.assigned_to ? parseInt(form.assigned_to) : null,
      }
      if (event) {
        await updateCalendarEvent(event.id, payload)
        toast.success('Reunión actualizada')
        onSaved()
      } else if (leadId && categoriaChanged) {
        // ── Caso nuevo en otra categoría para el mismo cliente ──
        const vendorId = payload.assigned_to ?? leadCtx?.vendedor_id ?? null
        if (!vendorId) {
          toast.error('Selecciona un vendedor para el caso nuevo')
          setSaving(false); return
        }
        const area = areas.find(a => String(a.id) === areaId)
        const newLead = await createLead({
          contact_id: leadCtx.contact_id,
          area_id: Number(areaId),
          group_id: area?.group_id ?? leadCtx.group_id,
          agendadora_id: leadCtx.agendadora_id ?? me?.id,
          vendedor_id: vendorId,
          honorarios: 0,
        })
        await createCalendarEvent({ ...payload, lead_id: newLead.id })
        try {
          await moveLeadStage(newLead.id, { stage: 'reunion', notes: `Caso nuevo — categoría ${area?.name ?? ''}`.trim() })
        } catch { /* el evento ya quedó; la etapa se puede ajustar manualmente */ }
        toast.success(`Caso nuevo en ${area?.name ?? 'la categoría'} — reunión agendada`)
        onSaved({ handled: true, leadId: newLead.id })
      } else {
        await createCalendarEvent({ ...payload, lead_id: leadId ?? null })
        toast.success(payload.assigned_to ? 'Reunión agendada — vendedor notificado' : 'Reunión agendada')
        onSaved()
      }
    } catch (err: any) { toast.error(err?.response?.data?.detail || 'Error al guardar') }
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
      onClose()
    } catch { toast.error('Error al eliminar') }
  }

  return (
    <>
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-[100] p-0 sm:p-4">
      <div className="bg-surface-1 w-full sm:rounded-2xl sm:max-w-lg shadow-2xl max-h-[95vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 sticky top-0 bg-surface-1 z-10" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full`} style={{ backgroundColor: form.color }} />
            <h2 className="text-base font-bold" style={{ color: 'var(--text)' }}>
              {event ? 'Editar Reunión' : 'Nueva Reunión'}
            </h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface-2 rounded-xl" style={{ color: 'var(--text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        {lockedLeadName && (
          <div className="px-5 pt-4">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-neon/10 border border-neon/25">
              <Link2 size={13} className="text-neon flex-shrink-0" />
              <span className="text-[11px] font-bold uppercase tracking-wide text-neon">Lead:</span>
              <span className="text-xs font-semibold truncate" style={{ color: 'var(--text)' }}>{lockedLeadName}</span>
              <span className="ml-auto text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Anclado · no desvinculable</span>
            </div>
          </div>
        )}

        <form onSubmit={handleSave} className="p-5 space-y-4">
          {/* Google Meet: botón de unirse, estilo evento nativo de Google */}
          {event?.meet_link && (
            <div className="flex items-center gap-3 px-3 py-3 rounded-xl bg-surface-0" style={{ border: '1px solid var(--border)' }}>
              <a href={event.meet_link} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors flex-shrink-0">
                <Video size={16} />
                Unirse con Google Meet
              </a>
              <span className="text-[11px] truncate min-w-0" style={{ color: 'var(--text-muted)' }}>{event.meet_link.replace('https://', '')}</span>
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
              <select className="input" value={form.assigned_to}
                onChange={e => set('assigned_to', e.target.value)}>
                <option value="">Solo en mi agenda</option>
                {vendors.map(v => (
                  <option key={v.id} value={v.id}>{v.name} ({v.role})</option>
                ))}
              </select>
            </div>
          )}

          {/* Categoría del cliente — solo al agendar un lead nuevo (no en edición).
              Elegir otra categoría crea un caso nuevo para el mismo cliente. */}
          {leadId && !event && areas.length > 0 && (
            <div>
              <label className="input-label">Categoría del cliente</label>
              <select className="input" value={areaId}
                onChange={e => setAreaId(e.target.value)}>
                {areas.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              {categoriaChanged && (
                <p className="text-[11px] mt-1.5 flex items-start gap-1.5"
                   style={{ color: '#a16207' }}>
                  <span>ℹ️</span>
                  <span>Se creará un <strong>caso nuevo</strong> en esta categoría para el
                    mismo cliente; el caso actual se mantiene.</span>
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

          {/* Disponibilidad en vivo del vendedor seleccionado (se repinta al
              cambiar vendedor o día). Clic en bloque libre → autocompleta inicio. */}
          <AvailabilityBar
            userId={form.assigned_to ? parseInt(form.assigned_to, 10) : undefined}
            date={form.start_time ? form.start_time.slice(0, 10) : undefined}
            onPick={hhmm => {
              const day = (form.start_time || '').slice(0, 10)
              if (day) { set('start_time', `${day}T${hhmm}`); setBarCleared(false) }
            }}
            onRange={(startHHMM, endHHMM) => {
              const day = (form.start_time || '').slice(0, 10)
              if (day) { setForm(f => ({ ...f, start_time: `${day}T${startHHMM}`, end_time: `${day}T${endHHMM}` })); setBarCleared(false) }
            }}
            selStart={!barCleared && form.start_time && form.end_time && form.start_time.slice(0, 10) === form.end_time.slice(0, 10) ? form.start_time.slice(11, 16) : undefined}
            selEnd={!barCleared && form.start_time && form.end_time && form.start_time.slice(0, 10) === form.end_time.slice(0, 10) ? form.end_time.slice(11, 16) : undefined}
            onDeselect={() => setBarCleared(true)}
          />

          {/* Ticket de confirmación — checklist de la reserva seleccionada.
              Se oculta si el usuario deseleccionó la reserva con la ✕. */}
          {!barCleared && form.start_time && form.end_time && (() => {
            const start = new Date(form.start_time)
            const end = new Date(form.end_time)
            if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return null
            const durMin = Math.round((end.getTime() - start.getTime()) / 60000)
            const durTxt = durMin >= 60
              ? `${Math.floor(durMin / 60)} h${durMin % 60 ? ` ${durMin % 60} min` : ''}`
              : `${durMin} min`
            const vendorName = form.assigned_to
              ? (vendors.find(v => v.id?.toString() === form.assigned_to)?.name ?? 'Vendedor')
              : 'Mi agenda'
            const rows: [typeof User, string, string][] = [
              [User,     'Agendado para', vendorName],
              [Calendar, 'Fecha',         format(start, "EEEE d 'de' MMMM", { locale: es })],
              [Clock,    'Horario',       `${format(start, 'HH:mm')} — ${format(end, 'HH:mm')} · ${durTxt}`],
            ]
            return (
              <div className="rounded-xl overflow-hidden"
                style={{ border: '1.5px dashed rgba(34,197,94,0.5)', background: 'rgba(34,197,94,0.06)' }}>
                <div className="flex items-center gap-2 px-3.5 py-2"
                  style={{ borderBottom: '1px dashed rgba(34,197,94,0.35)' }}>
                  <CheckCircle2 size={14} style={{ color: '#16a34a' }} />
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#16a34a' }}>
                    Reserva seleccionada
                  </span>
                </div>
                <div className="px-3.5 py-2.5 space-y-1.5">
                  {rows.map(([Icon, label, value]) => (
                    <div key={label} className="flex items-center gap-2 text-xs">
                      <CheckCircle2 size={13} className="flex-shrink-0" style={{ color: '#22c55e' }} />
                      <Icon size={12} className="flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                      <span className="font-medium" style={{ color: 'var(--text-muted)' }}>{label}:</span>
                      <span className="font-semibold capitalize" style={{ color: 'var(--text)' }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          <div>
            <label className="input-label">Tipo de reunión</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {EVENT_TYPES.map(t => {
                const active = form.event_type === t.value
                return (
                  <button key={t.value} type="button"
                    onClick={() => set('event_type', t.value)}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
                    style={{
                      border: `1px solid ${active ? t.color : 'var(--border)'}`,
                      background: active ? `${t.color}14` : 'transparent',
                      color: active ? 'var(--text)' : 'var(--text-2)',
                      boxShadow: active ? `0 1px 6px ${t.color}30` : 'none',
                    }}>
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                    {t.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="input-label">Notas y Detalles de la reunión</label>
            <div className="space-y-2">
              <textarea className="input" rows={5} value={form.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="Observaciones, links de Meet, dirección, etc..." />
              
              {form.notes && (
                <div className="p-3 bg-surface-0 rounded-xl" style={{ border: '1px solid var(--border)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Previsualización de Links</p>
                  <div className="text-xs break-words" style={{ color: 'var(--text-2)' }}>
                    {form.notes.split(/(\s+)/).map((part, i) => {
                      if (part.match(/^https?:\/\/[^\s]+$/)) {
                        return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-neon underline hover:text-neon/70 break-all">{part}</a>
                      }
                      return part
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>


          <div className="flex gap-3 pt-4 sticky bottom-0 bg-surface-1" style={{ borderTop: '1px solid var(--border)' }}>
            {event && (
              <button type="button" onClick={handleDelete}
                className="inline-flex items-center gap-2 px-4 py-3 bg-danger/10 text-danger rounded-xl hover:bg-danger/20 transition-colors font-medium text-sm">
                <Trash2 size={16} /> Eliminar
              </button>
            )}
            <button type="submit" disabled={saving}
              className="flex-1 text-white font-bold py-3 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 hover:opacity-90"
              style={{ background: 'var(--primary)' }}>
              {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {event ? 'Guardar Cambios' : 'Agendar Reunión'}
            </button>
          </div>
        </form>
      </div>
    </div>
    {confirmDialog}
    </>
  )
}
