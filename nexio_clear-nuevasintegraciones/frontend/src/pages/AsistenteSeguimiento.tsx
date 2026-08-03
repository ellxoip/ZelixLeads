import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  RefreshCw, Search, CalendarClock, AlertTriangle, Clock,
  DollarSign, Users, TrendingUp, ChevronLeft, ChevronRight,
  ExternalLink, CheckCircle, XCircle, MessageCircle, X, ChevronDown,
  ThumbsUp, CreditCard, CalendarDays, Copy, Check,
} from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { getSeguimientoLeads, getSeguimientoDashboard, updateSeguimientoStatus, ejecutarAccionSeguimiento, getMensajePago } from '../api'
import { useRealtime } from '../contexts/RealtimeContext'

const PAGE_SIZE = 12

const STATUS_OPTIONS = [
  { value: 'en_seguimiento', label: 'En seguimiento', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  { value: 'contactado',     label: 'Contactado',     color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' },
  { value: 'repactado',      label: 'Repactado',      color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)' },
  { value: 'pagado',         label: 'Pagó',           color: '#10B981', bg: 'rgba(16,185,129,0.12)' },
  { value: 'perdido',        label: 'Perdido',        color: '#EF4444', bg: 'rgba(239,68,68,0.12)' },
]

const FILTER_ALL = '__todos__'

function fmtDate(s?: string | null) {
  if (!s) return '—'
  const d = new Date(`${s}T12:00:00`)
  return isNaN(d.getTime()) ? s : format(d, "d MMM yyyy", { locale: es })
}

function fmtMoney(n?: number | null) {
  if (!n) return '$0'
  return `$${Math.round(n).toLocaleString('es-CL')}`
}

function waLink(phone?: string | null) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  return `https://wa.me/${digits}`
}

export default function AsistenteSeguimiento() {
  const [leads, setLeads] = useState<{ en_seguimiento: any[]; proximos: any[] }>({ en_seguimiento: [], proximos: [] })
  const [dash, setDash] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [bucket, setBucket] = useState<'en_seguimiento' | 'proximos'>('en_seguimiento')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(FILTER_ALL)
  const [page, setPage] = useState(1)
  const [updatingId, setUpdatingId] = useState<number | null>(null)
  const [modal, setModal] = useState<null | 'vencidos' | 'proximos' | 'monto' | 'gestionados'>(null)
  const [accionModal, setAccionModal] = useState<{ lead: any } | null>(null)
  const [compromisoModal, setCompromisoModal] = useState<{ lead: any } | null>(null)
  const [compromisoFecha, setCompromisoFecha] = useState('')
  const [compromisoNota, setCompromisoNota] = useState('')
  const [openDropdown, setOpenDropdown] = useState<number | null>(null)
  const [loadingMsgId, setLoadingMsgId] = useState<number | null>(null)
  const [msgModal, setMsgModal] = useState<{ lead: any; message: string; source: string; paymentLink?: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const generarMensajePago = async (item: any) => {
    setLoadingMsgId(item.lead_id)
    try {
      const res = await getMensajePago(item.lead_id)
      setCopied(false)
      setMsgModal({ lead: item, message: res.message, source: res.source, paymentLink: res.payment_link })
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? 'No se pudo generar el mensaje de pago')
    } finally {
      setLoadingMsgId(null)
    }
  }

  const copiarMensaje = async () => {
    if (!msgModal) return
    try {
      await navigator.clipboard.writeText(msgModal.message)
      setCopied(true)
      toast.success('Mensaje copiado — pégalo en el chat del cliente')
      setTimeout(() => setCopied(false), 2500)
    } catch {
      toast.error('No se pudo copiar — selecciona el texto manualmente')
    }
  }

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [l, d] = await Promise.all([getSeguimientoLeads(), getSeguimientoDashboard()])
      setLeads(l)
      setDash(d)
    } catch { toast.error('Error cargando seguimiento') }
    finally { if (!silent) setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useRealtime(['lead_update', 'calendar_update'], () => load(true))

  const setStatus = async (leadId: number, status: string) => {
    setUpdatingId(leadId)
    try {
      await updateSeguimientoStatus(leadId, status)
      toast.success('Estado actualizado')
      load(true)
    } catch { toast.error('No se pudo actualizar') }
    finally { setUpdatingId(null) }
  }

  const ejecutarAccion = async (leadId: number, accion: string, extra?: { fecha?: string; notes?: string }) => {
    setUpdatingId(leadId)
    try {
      await ejecutarAccionSeguimiento(leadId, accion, extra as any)
      toast.success(accion === 'pago_pendiente' ? 'Lead enviado a Pago Pendiente' : accion === 'altamente_interesado' ? 'Lead devuelto a Altamente Interesado' : 'Fecha repactada — el lead vuelve a Pago Comprometido con su cuenta regresiva')
      load(true)
    } catch (e: any) { toast.error(e?.response?.data?.detail ?? 'No se pudo ejecutar la acción') }
    finally { setUpdatingId(null) }
  }

  const confirmarCompromiso = async () => {
    if (!compromisoModal || !compromisoFecha) return toast.error('Debes ingresar la fecha')
    await ejecutarAccion(compromisoModal.lead.lead_id, 'compromiso', { fecha: compromisoFecha, notes: compromisoNota })
    setCompromisoModal(null)
    setCompromisoFecha('')
    setCompromisoNota('')
  }

  const allItems = leads[bucket] ?? []

  const filtered = useMemo(() => {
    return allItems.filter((i: any) => {
      if (statusFilter !== FILTER_ALL && (i.seguimiento_status ?? 'en_seguimiento') !== statusFilter) return false
      if (!search) return true
      const q = search.toLowerCase()
      return (
        i.contact_name?.toLowerCase().includes(q) ||
        i.vendor_name?.toLowerCase().includes(q) ||
        i.agendadora_name?.toLowerCase().includes(q) ||
        i.contact_phone?.includes(q)
      )
    })
  }, [allItems, search, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Reset page on filter change
  useEffect(() => { setPage(1) }, [search, statusFilter, bucket])

  // KPIs
  const montoRiesgo = allItems.reduce((s: number, i: any) => s + (i.honorarios ?? 0), 0)
  const contactados = allItems.filter((i: any) => ['contactado', 'repactado', 'pagado'].includes(i.seguimiento_status ?? '')).length

  const kpis: { label: string; value: string; sub: string; color: string; bg: string; icon: any; key: typeof modal }[] = [
    { label: 'Vencidos', value: String(leads.en_seguimiento.length), sub: 'La fecha comprometida de pago ya pasó y el cliente no ha pagado', color: '#EF4444', bg: 'rgba(239,68,68,0.10)', icon: AlertTriangle, key: 'vencidos' },
    { label: 'Próximos', value: String(leads.proximos.length), sub: 'La fecha de pago se acerca — vence en los próximos días', color: '#F59E0B', bg: 'rgba(245,158,11,0.10)', icon: Clock, key: 'proximos' },
    { label: 'Monto en riesgo', value: fmtMoney(dash?.monto_en_riesgo ?? montoRiesgo), sub: 'Suma de honorarios de todos los compromisos aún sin pagar', color: 'var(--zx-accent-text)', bg: 'rgba(53,122,14,0.10)', icon: DollarSign, key: 'monto' },
    { label: 'Gestionados', value: `${contactados}/${allItems.length}`, sub: 'Clientes que ya contactaste, repactaste o pagaron, del total', color: '#10B981', bg: 'rgba(16,185,129,0.10)', icon: TrendingUp, key: 'gestionados' },
  ]

  // Datos para cada modal
  const gestionadosItems = [...leads.en_seguimiento, ...leads.proximos].filter((i: any) =>
    ['contactado', 'repactado', 'pagado'].includes(i.seguimiento_status ?? '')
  )
  const montoItems = [...leads.en_seguimiento].sort((a: any, b: any) => (b.honorarios ?? 0) - (a.honorarios ?? 0))

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-black" style={{ color: 'var(--text)', fontFamily: '"Space Grotesk", sans-serif' }}>
            Asistente de Seguimiento
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Clientes que se comprometieron a pagar en una fecha — contáctalos, repacta la fecha o registra su pago
          </p>
        </div>
        <button onClick={() => load()} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm"
          style={{ background: '#fff', border: '1px solid rgba(28,22,51,0.10)', color: 'var(--text)' }}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      {/* KPI Cards — clickeables */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map(k => {
          const Icon = k.icon
          return (
            <button key={k.label} onClick={() => setModal(k.key)} className="p-4 rounded-2xl text-left w-full transition-all"
              style={{ background: '#fff', border: '1px solid rgba(28,22,51,0.08)', boxShadow: '0 1px 6px rgba(28,22,51,0.05)', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = `0 4px 16px ${k.color}22`)}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 6px rgba(28,22,51,0.05)')}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: k.bg }}>
                  <Icon size={15} style={{ color: k.color }} />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{k.label}</span>
              </div>
              <p className="text-2xl font-black" style={{ color: 'var(--text)', fontFamily: '"Space Grotesk", sans-serif' }}>{k.value}</p>
              <p className="text-[10px] mt-0.5 leading-snug" style={{ color: 'var(--text-muted)' }}>{k.sub}</p>
              <p className="text-[9px] font-bold mt-1.5 flex items-center gap-1" style={{ color: k.color }}>
                Click para ver el detalle <ChevronRight size={9} />
              </p>
            </button>
          )
        })}
      </div>

      {/* Modal KPI */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={() => setModal(null)}>
          <div className="rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden"
            style={{ background: '#fff', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}
            onClick={e => e.stopPropagation()}>
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(28,22,51,0.08)' }}>
              <div>
                <p className="font-black text-base" style={{ color: 'var(--text)', fontFamily: '"Space Grotesk", sans-serif' }}>
                  {modal === 'vencidos' && `Compromisos vencidos (${leads.en_seguimiento.length})`}
                  {modal === 'proximos' && `Próximos a vencer (${leads.proximos.length})`}
                  {modal === 'monto' && `Monto en riesgo — ${fmtMoney(dash?.monto_en_riesgo ?? montoRiesgo)}`}
                  {modal === 'gestionados' && `Gestionados (${contactados})`}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {modal === 'vencidos' && 'Más de 5 días sin pago desde la fecha de compromiso'}
                  {modal === 'proximos' && 'Compromiso vence en menos de 5 días'}
                  {modal === 'monto' && 'Ordenado por monto mayor a menor'}
                  {modal === 'gestionados' && 'Clientes contactados, repactados o que pagaron'}
                </p>
              </div>
              <button onClick={() => setModal(null)} className="p-2 rounded-xl" style={{ color: 'var(--text-muted)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(28,22,51,0.06)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <X size={16} />
              </button>
            </div>

            {/* Modal body — contenido diferente por KPI */}
            <div className="overflow-y-auto flex-1 px-5 py-3">

              {/* VENCIDOS: ordenado por días vencidos, badge rojo prominente */}
              {modal === 'vencidos' && (
                <div className="space-y-2">
                  {[...leads.en_seguimiento].sort((a: any, b: any) => b.dias_vencido - a.dias_vencido).map((item: any) => {
                    const wa = waLink(item.contact_phone)
                    return (
                      <div key={item.lead_id} className="flex items-center gap-3 p-3 rounded-xl"
                        style={{ border: '1px solid rgba(239,68,68,0.15)', background: 'rgba(239,68,68,0.03)' }}>
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-black text-sm"
                          style={{ background: 'rgba(239,68,68,0.12)', color: '#DC2626' }}>
                          {item.dias_vencido}d
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm truncate" style={{ color: 'var(--text)' }}>{item.contact_name ?? '—'}</p>
                          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                            Compromiso: {fmtDate(item.payment_commitment_date)} · {item.vendor_name ?? '—'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {item.honorarios > 0 && <span className="text-xs font-bold" style={{ color: '#DC2626' }}>{fmtMoney(item.honorarios)}</span>}
                          {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#25D366', color: '#fff' }}><ExternalLink size={11} /></a>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* PROXIMOS: semáforo por días restantes */}
              {modal === 'proximos' && (
                <div className="space-y-2">
                  {[...leads.proximos].sort((a: any, b: any) => a.dias_vencido - b.dias_vencido).map((item: any) => {
                    const diasRestantes = (item.dias_gracia ?? 5) - item.dias_vencido
                    const urgent = diasRestantes <= 1
                    const wa = waLink(item.contact_phone)
                    return (
                      <div key={item.lead_id} className="flex items-center gap-3 p-3 rounded-xl"
                        style={{ border: `1px solid ${urgent ? 'rgba(239,68,68,0.20)' : 'rgba(245,158,11,0.20)'}`, background: urgent ? 'rgba(239,68,68,0.03)' : 'rgba(245,158,11,0.03)' }}>
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-black text-xs text-center leading-tight"
                          style={{ background: urgent ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)', color: urgent ? '#DC2626' : '#D97706' }}>
                          {diasRestantes}d
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm truncate" style={{ color: 'var(--text)' }}>{item.contact_name ?? '—'}</p>
                          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                            Vence: {fmtDate(item.payment_commitment_date)} · {item.vendor_name ?? '—'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ background: urgent ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)', color: urgent ? '#DC2626' : '#D97706' }}>
                            {urgent ? '¡Urgente!' : `${diasRestantes}d restantes`}
                          </span>
                          {item.honorarios > 0 && <span className="text-xs font-bold" style={{ color: 'var(--zx-accent-text)' }}>{fmtMoney(item.honorarios)}</span>}
                          {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#25D366', color: '#fff' }}><ExternalLink size={11} /></a>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* MONTO EN RIESGO: ranking con barras de porcentaje */}
              {modal === 'monto' && (() => {
                const total = montoItems.reduce((s: number, i: any) => s + (i.honorarios ?? 0), 0)
                return (
                  <div className="space-y-3">
                    <div className="p-3 rounded-xl text-center mb-4" style={{ background: 'rgba(53,122,14,0.08)', border: '1px solid rgba(53,122,14,0.15)' }}>
                      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--zx-accent-text)' }}>Total en riesgo</p>
                      <p className="text-2xl font-black" style={{ color: 'var(--zx-accent-text)', fontFamily: '"Space Grotesk", sans-serif' }}>{fmtMoney(total)}</p>
                    </div>
                    {montoItems.map((item: any, idx: number) => {
                      const pct = total > 0 ? (item.honorarios / total) * 100 : 0
                      const wa = waLink(item.contact_phone)
                      return (
                        <div key={item.lead_id} className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black w-5 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>#{idx + 1}</span>
                            <span className="text-sm font-semibold flex-1 truncate" style={{ color: 'var(--text)' }}>{item.contact_name ?? '—'}</span>
                            <span className="text-sm font-black" style={{ color: 'var(--zx-accent-text)' }}>{fmtMoney(item.honorarios)}</span>
                            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{pct.toFixed(1)}%</span>
                            {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: '#25D366', color: '#fff' }}><ExternalLink size={10} /></a>}
                          </div>
                          <div className="h-1.5 rounded-full" style={{ background: 'rgba(28,22,51,0.08)' }}>
                            <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: idx === 0 ? 'var(--zx-accent-text)' : idx === 1 ? '#8B5CF6' : idx === 2 ? '#10B981' : '#94A3B8' }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}

              {/* GESTIONADOS: resumen por estado + lista */}
              {modal === 'gestionados' && (() => {
                const byStatus = STATUS_OPTIONS.filter(s => ['contactado','repactado','pagado'].includes(s.value)).map(s => ({
                  ...s,
                  items: [...leads.en_seguimiento, ...leads.proximos].filter((i: any) => (i.seguimiento_status ?? '') === s.value),
                }))
                return (
                  <div className="space-y-4">
                    {/* Resumen */}
                    <div className="grid grid-cols-3 gap-2">
                      {byStatus.map(s => (
                        <div key={s.value} className="p-3 rounded-xl text-center" style={{ background: s.bg, border: `1px solid ${s.color}33` }}>
                          <p className="text-xl font-black" style={{ color: s.color, fontFamily: '"Space Grotesk", sans-serif' }}>{s.items.length}</p>
                          <p className="text-[10px] font-bold" style={{ color: s.color }}>{s.label}</p>
                        </div>
                      ))}
                    </div>
                    {/* Lista */}
                    <div className="space-y-2">
                      {gestionadosItems.length === 0
                        ? <p className="text-center py-6 text-sm" style={{ color: 'var(--text-muted)' }}>Sin clientes gestionados aún</p>
                        : gestionadosItems.map((item: any) => {
                          const stInfo = STATUS_OPTIONS.find(s => s.value === (item.seguimiento_status ?? ''))
                          const wa = waLink(item.contact_phone)
                          return (
                            <div key={item.lead_id} className="flex items-center gap-3 p-3 rounded-xl"
                              style={{ border: '1px solid rgba(28,22,51,0.08)', background: 'rgba(28,22,51,0.01)' }}>
                              <div className="flex-1 min-w-0">
                                <p className="font-bold text-sm truncate" style={{ color: 'var(--text)' }}>{item.contact_name ?? '—'}</p>
                                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{item.contact_phone ?? '—'} · {item.vendor_name ?? '—'}</p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {item.honorarios > 0 && <span className="text-xs font-bold" style={{ color: 'var(--zx-accent-text)' }}>{fmtMoney(item.honorarios)}</span>}
                                {stInfo && <span className="text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ background: stInfo.bg, color: stInfo.color }}>{stInfo.label}</span>}
                                {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#25D366', color: '#fff' }}><ExternalLink size={11} /></a>}
                              </div>
                            </div>
                          )
                        })
                      }
                    </div>
                  </div>
                )
              })()}
            </div>

            {/* Modal footer */}
            <div className="px-5 py-3" style={{ borderTop: '1px solid rgba(28,22,51,0.08)' }}>
              <button onClick={() => setModal(null)} className="w-full py-2 rounded-xl text-sm font-semibold"
                style={{ background: 'rgba(28,22,51,0.05)', color: 'var(--text)' }}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Bucket tabs */}
        <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'rgba(28,22,51,0.05)', border: '1px solid rgba(28,22,51,0.08)' }}>
          {([
            ['en_seguimiento', `Vencidos (${leads.en_seguimiento.length})`],
            ['proximos', `Próximos (${leads.proximos.length})`],
          ] as [string, string][]).map(([val, label]) => (
            <button key={val} onClick={() => setBucket(val as any)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              style={bucket === val
                ? { background: '#fff', color: 'var(--primary)', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }
                : { color: 'var(--text-muted)' }}>
              {label}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="h-9 pl-3 pr-8 rounded-xl text-xs font-semibold focus:outline-none appearance-none"
          style={{ background: '#fff', border: '1px solid rgba(28,22,51,0.12)', color: 'var(--text)' }}>
          <option value={FILTER_ALL}>Todos los estados</option>
          {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        {/* Search */}
        <div className="flex items-center gap-2 flex-1 min-w-[180px] px-3 py-2 rounded-xl"
          style={{ background: '#fff', border: '1px solid rgba(28,22,51,0.12)' }}>
          <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar cliente, vendedor, teléfono..."
            className="flex-1 bg-transparent text-sm focus:outline-none" style={{ color: 'var(--text)' }} />
        </div>

        <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Qué muestra la pestaña activa */}
      <p className="text-xs -mt-2" style={{ color: 'var(--text-muted)' }}>
        {bucket === 'en_seguimiento'
          ? 'Viendo Vencidos: clientes cuya fecha comprometida de pago ya pasó sin que paguen — son la prioridad.'
          : 'Viendo Próximos: clientes cuya fecha de pago aún no llega — contáctalos antes de que venza.'}
      </p>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-7 h-7 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--primary)' }} />
        </div>
      ) : pageItems.length === 0 ? (
        <div className="py-16 text-center rounded-2xl" style={{ background: '#fff', border: '1px solid rgba(28,22,51,0.08)' }}>
          <CalendarClock size={36} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="font-semibold text-sm" style={{ color: 'var(--text)' }}>
            {search || statusFilter !== FILTER_ALL ? 'Sin resultados para este filtro' : bucket === 'en_seguimiento' ? 'Sin compromisos vencidos' : 'Sin compromisos próximos a vencer'}
          </p>
          <p className="text-xs mt-1.5 max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
            {search || statusFilter !== FILTER_ALL
              ? 'Prueba limpiando la búsqueda o cambiando el filtro de estado.'
              : bucket === 'en_seguimiento'
                ? 'Cuando un cliente pase su fecha comprometida de pago sin pagar, aparecerá aquí automáticamente para que lo contactes.'
                : 'Cuando un cliente tenga una fecha de pago comprometida por vencer, aparecerá aquí para que lo contactes antes.'}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden"
          style={{ background: '#fff', border: '1px solid rgba(28,22,51,0.08)', boxShadow: '0 2px 10px rgba(28,22,51,0.05)' }}>
          <div className="overflow-x-auto table-scroll table-scroll-light">
            <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: 980 }}>
              <thead>
                <tr style={{ background: '#faf9fd', borderBottom: '1px solid rgba(28,22,51,0.08)' }}>
                  {['Cliente', 'Etapa', 'Compromiso', 'Monto', 'Equipo', 'Estado gestión', 'Acciones'].map((h, i) => (
                    <th key={h} className={`px-4 py-3 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap ${i >= 5 ? 'text-center' : 'text-left'}`}
                      style={{ color: 'rgba(28,22,51,0.45)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageItems.map((item: any) => {
                  const overdue = item.en_seguimiento
                  const currentStatus = item.seguimiento_status ?? 'en_seguimiento'
                  const statusInfo = STATUS_OPTIONS.find(s => s.value === currentStatus) ?? STATUS_OPTIONS[0]
                  const wa = waLink(item.contact_phone)
                  const updating = updatingId === item.lead_id
                  const diasRestantes = (item.dias_gracia ?? 5) - item.dias_vencido

                  return (
                    <tr key={item.lead_id} className="transition-colors"
                      style={{ borderBottom: '1px solid rgba(28,22,51,0.06)', borderLeft: `3px solid ${overdue ? '#EF4444' : '#F59E0B'}` }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(28,22,51,0.018)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>

                      {/* Cliente */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold"
                            style={{ background: overdue ? 'rgba(239,68,68,0.10)' : 'rgba(245,158,11,0.10)', color: overdue ? '#DC2626' : '#D97706' }}>
                            {(item.contact_name ?? '?').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-[13px] truncate max-w-[180px]" style={{ color: 'var(--text)' }}>{item.contact_name ?? '—'}</p>
                            <div className="flex items-center gap-1.5">
                              {item.contact_phone && <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{item.contact_phone}</span>}
                              {item.service_description && <span className="text-[10px] truncate max-w-[110px]" style={{ color: 'rgba(28,22,51,0.35)' }}>· {item.service_description}</span>}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Etapa */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-[10px] font-bold px-2 py-1 rounded-md"
                          style={item.current_stage === 'pago_pendiente'
                            ? { background: 'rgba(14,165,233,0.10)', color: '#0369a1' }
                            : item.current_stage === 'pago_comprometido'
                              ? { background: 'rgba(16,185,129,0.10)', color: '#059669' }
                              : { background: 'rgba(139,92,246,0.10)', color: 'var(--zx-accent-text)' }}>
                          {item.current_stage === 'pago_pendiente' ? 'Pago Pendiente'
                            : item.current_stage === 'pago_comprometido' ? 'Pago Comprometido'
                            : 'Altamente Interesado'}
                        </span>
                      </td>

                      {/* Compromiso */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>{fmtDate(item.payment_commitment_date)}</p>
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold mt-0.5 px-1.5 py-0.5 rounded"
                          style={{ background: overdue ? 'rgba(239,68,68,0.10)' : 'rgba(245,158,11,0.10)', color: overdue ? '#DC2626' : '#D97706' }}>
                          {overdue ? <AlertTriangle size={9} /> : <Clock size={9} />}
                          {overdue ? `${item.dias_vencido}d vencido` : `Vence en ${diasRestantes}d`}
                        </span>
                      </td>

                      {/* Monto */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p className="text-[13px] font-black" style={{ color: item.honorarios > 0 ? 'var(--text)' : 'var(--text-muted)', fontFamily: '"Space Grotesk", sans-serif' }}>
                          {item.honorarios > 0 ? fmtMoney(item.honorarios) : '—'}
                        </p>
                        <span className="text-[9px] font-bold uppercase tracking-wide"
                          style={{ color: item.pagacuotas_status === 'failed' ? '#DC2626' : item.pagacuotas_status === 'created' ? '#059669' : 'var(--text-muted)' }}>
                          {item.pagacuotas_status === 'created' ? '● PagaCuotas OK' : item.pagacuotas_status === 'failed' ? '● PagaCuotas error' : '○ Sin registrar'}
                        </span>
                      </td>

                      {/* Equipo */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p className="text-[11px] font-semibold truncate max-w-[130px]" style={{ color: 'var(--text)' }}>{item.vendor_name ?? '—'}</p>
                        {item.agendadora_name && (
                          <p className="text-[10px] truncate max-w-[130px]" style={{ color: 'var(--text-muted)' }}>{item.agendadora_name}</p>
                        )}
                      </td>

                      {/* Estado gestión */}
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <select value={currentStatus} disabled={updating}
                          onChange={e => setStatus(item.lead_id, e.target.value)}
                          className="text-[11px] font-bold px-2 py-1.5 rounded-lg focus:outline-none appearance-none cursor-pointer text-center"
                          style={{ background: statusInfo.bg, color: statusInfo.color, border: `1px solid ${statusInfo.color}33`, opacity: updating ? 0.5 : 1 }}>
                          {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      </td>

                      {/* Acciones */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1.5">
                          {wa && (
                            <a href={wa} target="_blank" rel="noopener noreferrer" title="Abrir WhatsApp"
                              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
                              style={{ background: 'rgba(37,211,102,0.12)', color: '#1da851', border: '1px solid rgba(37,211,102,0.25)' }}
                              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(37,211,102,0.22)')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(37,211,102,0.12)')}>
                              <MessageCircle size={13} />
                            </a>
                          )}
                          <button onClick={() => generarMensajePago(item)} disabled={loadingMsgId === item.lead_id} title="Generar mensaje de pago"
                            className="h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-[10px] font-bold flex-shrink-0 transition-colors disabled:opacity-50"
                            style={{ background: 'rgba(16,185,129,0.10)', color: '#059669', border: '1px solid rgba(16,185,129,0.25)' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(16,185,129,0.20)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(16,185,129,0.10)')}>
                            <CreditCard size={12} className={loadingMsgId === item.lead_id ? 'animate-pulse' : ''} />
                            {loadingMsgId === item.lead_id ? '...' : 'Mensaje pago'}
                          </button>
                          <button onClick={() => { setCompromisoFecha(''); setCompromisoNota(''); setCompromisoModal({ lead: item }) }} title="Cliente pagará otro día — repactar fecha"
                            className="h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-[10px] font-bold flex-shrink-0 transition-colors"
                            style={{ background: 'rgba(53,122,14,0.08)', color: 'var(--zx-accent-text)', border: '1px solid rgba(53,122,14,0.22)' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(53,122,14,0.16)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(53,122,14,0.08)')}>
                            <CalendarDays size={12} /> Nueva fecha
                          </button>
                          <div className="relative">
                            <button onClick={() => setOpenDropdown(openDropdown === item.lead_id ? null : item.lead_id)} title="Más acciones"
                              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
                              style={{ background: 'rgba(28,22,51,0.05)', color: 'var(--text-muted)', border: '1px solid rgba(28,22,51,0.10)' }}>
                              <ChevronDown size={13} style={{ transform: openDropdown === item.lead_id ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                            </button>
                            {openDropdown === item.lead_id && (
                              <div className="absolute right-0 z-30 rounded-xl overflow-hidden mt-1 w-56"
                                style={{ background: '#fff', border: '1px solid rgba(28,22,51,0.12)', boxShadow: '0 8px 24px rgba(0,0,0,0.14)' }}>
                                <button onClick={() => { setOpenDropdown(null); ejecutarAccion(item.lead_id, 'pago_pendiente') }}
                                  className="flex items-center gap-2.5 w-full px-4 py-2.5 text-xs font-semibold text-left transition-colors"
                                  style={{ color: '#10B981', borderBottom: '1px solid rgba(28,22,51,0.06)' }}
                                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(16,185,129,0.06)')}
                                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                  <CreditCard size={13} /> Pagará hoy → Pago Pendiente
                                </button>
                                <button onClick={() => { setOpenDropdown(null); ejecutarAccion(item.lead_id, 'altamente_interesado') }}
                                  className="flex items-center gap-2.5 w-full px-4 py-2.5 text-xs font-semibold text-left transition-colors"
                                  style={{ color: '#8B5CF6', borderBottom: '1px solid rgba(28,22,51,0.06)' }}
                                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(139,92,246,0.06)')}
                                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                  <ThumbsUp size={13} /> Volver a Altamente Interesado
                                </button>
                                {item.pagacuotas_link && (
                                  <a href={item.pagacuotas_link} target="_blank" rel="noopener noreferrer"
                                    onClick={() => setOpenDropdown(null)}
                                    className="flex items-center gap-2.5 w-full px-4 py-2.5 text-xs font-semibold text-left no-underline transition-colors"
                                    style={{ color: '#059669' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(16,185,129,0.06)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                    <ExternalLink size={13} /> Ver portal PagaCuotas
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {/* Leyenda de estados de gestión */}
          <div className="px-4 py-3 flex items-center gap-x-4 gap-y-1 flex-wrap"
            style={{ borderTop: '1px solid rgba(28,22,51,0.08)', background: '#faf9fd' }}>
            <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'rgba(28,22,51,0.45)' }}>Qué significa cada estado de gestión:</p>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}><span className="font-bold" style={{ color: '#F59E0B' }}>En seguimiento</span> = aún sin contactar</span>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}><span className="font-bold" style={{ color: '#3B82F6' }}>Contactado</span> = ya le escribiste</span>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}><span className="font-bold" style={{ color: '#8B5CF6' }}>Repactado</span> = acordó nueva fecha</span>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}><span className="font-bold" style={{ color: '#10B981' }}>Pagó</span> = pago realizado</span>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}><span className="font-bold" style={{ color: '#EF4444' }}>Perdido</span> = no responde o no pagará</span>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Mostrando {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} de {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
              style={{ background: '#fff', border: '1px solid rgba(28,22,51,0.10)', color: page === 1 ? 'var(--text-muted)' : 'var(--text)', opacity: page === 1 ? 0.5 : 1 }}>
              <ChevronLeft size={15} />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
              .reduce<(number | string)[]>((acc, p, idx, arr) => {
                if (idx > 0 && typeof arr[idx - 1] === 'number' && (p as number) - (arr[idx - 1] as number) > 1) acc.push('…')
                acc.push(p)
                return acc
              }, [])
              .map((p, i) => p === '…' ? (
                <span key={`e${i}`} className="w-8 h-8 flex items-center justify-center text-xs" style={{ color: 'var(--text-muted)' }}>…</span>
              ) : (
                <button key={p} onClick={() => setPage(p as number)}
                  className="w-8 h-8 rounded-lg text-xs font-semibold transition-colors"
                  style={page === p
                    ? { background: 'var(--primary)', color: '#fff', border: 'none' }
                    : { background: '#fff', border: '1px solid rgba(28,22,51,0.10)', color: 'var(--text)' }}>
                  {p}
                </button>
              ))
            }
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
              style={{ background: '#fff', border: '1px solid rgba(28,22,51,0.10)', color: page === totalPages ? 'var(--text-muted)' : 'var(--text)', opacity: page === totalPages ? 0.5 : 1 }}>
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Modal mensaje de pago — copiar y pegar en WhatsApp Web */}
      {msgModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(15,20,35,0.55)', backdropFilter: 'blur(4px)' }}
          onClick={() => setMsgModal(null)}>
          <div className="rounded-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[85vh]"
            style={{ background: '#fff', boxShadow: '0 20px 60px rgba(28,22,51,0.25)' }}
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={{ borderBottom: '1px solid rgba(28,22,51,0.08)' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(16,185,129,0.10)' }}>
                <CreditCard size={16} style={{ color: '#059669' }} />
              </div>
              <div className="min-w-0">
                <p className="font-black text-sm" style={{ color: 'var(--text)', fontFamily: '"Space Grotesk", sans-serif' }}>Mensaje de pago</p>
                <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                  {msgModal.lead.contact_name}
                  {msgModal.source === 'original' ? ' · credenciales originales' : ' · generado con link de pago'}
                </p>
              </div>
              <button onClick={() => setMsgModal(null)} className="ml-auto p-1.5 rounded-lg flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                <X size={14} />
              </button>
            </div>

            {/* Preview del mensaje */}
            <div className="px-5 py-4 flex-1 overflow-y-auto">
              <div className="rounded-xl px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap break-words"
                style={{ background: '#e7f8ee', border: '1px solid rgba(16,185,129,0.25)', color: '#1c1633' }}>
                {msgModal.message}
              </div>
              <p className="text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>
                Copia este mensaje y pégalo directamente en el chat del cliente desde tu WhatsApp Web.
              </p>
            </div>

            {/* Footer */}
            <div className="px-5 pb-4 flex gap-2 flex-shrink-0">
              {waLink(msgModal.lead.contact_phone) && (
                <a href={waLink(msgModal.lead.contact_phone)!} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold no-underline flex-shrink-0"
                  style={{ background: 'rgba(37,211,102,0.12)', color: '#1da851', border: '1px solid rgba(37,211,102,0.30)' }}>
                  <ExternalLink size={13} /> Abrir chat
                </a>
              )}
              <button onClick={copiarMensaje}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white transition-colors"
                style={{ background: copied ? '#059669' : 'var(--primary)' }}>
                {copied ? <><Check size={14} /> Copiado</> : <><Copy size={14} /> Copiar mensaje</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal compromiso de pago */}
      {compromisoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={() => setCompromisoModal(null)}>
          <div className="rounded-2xl w-full max-w-sm overflow-hidden"
            style={{ background: '#fff', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid rgba(28,22,51,0.08)' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(53,122,14,0.10)' }}>
                <CalendarDays size={16} style={{ color: 'var(--zx-accent-text)' }} />
              </div>
              <div>
                <p className="font-black text-sm" style={{ color: 'var(--text)', fontFamily: '"Space Grotesk", sans-serif' }}>Repactar fecha de pago</p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{compromisoModal.lead.contact_name}</p>
              </div>
              <button onClick={() => setCompromisoModal(null)} className="ml-auto p-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }}>
                <X size={14} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Fecha de compromiso de pago *
                </label>
                <input type="date" value={compromisoFecha} onChange={e => setCompromisoFecha(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none"
                  style={{ border: '1.5px solid rgba(28,22,51,0.15)', color: 'var(--text)', background: '#fff' }} />
                <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                  El lead vuelve a Pago Comprometido con esta fecha y su cuenta regresiva.
                  Si vence sin pago, cae de nuevo a este panel.
                </p>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Notas del resultado
                </label>
                <textarea value={compromisoNota} onChange={e => setCompromisoNota(e.target.value)}
                  rows={3} placeholder="Ej: El cliente pidió más tiempo para decidir..."
                  className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none resize-none"
                  style={{ border: '1.5px solid rgba(28,22,51,0.15)', color: 'var(--text)', background: '#fff' }} />
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 pb-4 flex gap-2">
              <button onClick={() => setCompromisoModal(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ border: '1px solid rgba(28,22,51,0.12)', color: 'var(--text-muted)', background: 'transparent' }}>
                Cancelar
              </button>
              <button onClick={confirmarCompromiso} disabled={!compromisoFecha || updatingId !== null}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold"
                style={{ background: compromisoFecha ? 'var(--zx-accent-text)' : 'rgba(53,122,14,0.3)', color: '#fff', opacity: !compromisoFecha ? 0.6 : 1 }}>
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
