import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { WifiOff, XCircle, CalendarPlus, RefreshCw, Search } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { getAgendadoraFollowup } from '../api'

type FilterType = 'all' | 'no_show' | 'sin_exito'

export default function Seguimiento() {
  const navigate = useNavigate()
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterType>('all')
  const [search, setSearch] = useState('')

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try { setItems(await getAgendadoraFollowup()) }
    catch { toast.error('Error cargando seguimiento') }
    finally { if (!silent) setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = items.filter(item => {
    if (filter !== 'all' && item.vendor_status !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      if (
        !item.contact_name?.toLowerCase().includes(q) &&
        !item.vendor_name?.toLowerCase().includes(q) &&
        !item.outcome_note?.toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  const countNo   = items.filter(i => i.vendor_status === 'no_show').length
  const countSin  = items.filter(i => i.vendor_status === 'sin_exito').length

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Seguimiento</h1>
          <p className="text-xs text-white/52 mt-0.5">Reuniones sin éxito que requieren ser reagendadas</p>
        </div>
        <button onClick={() => load()} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-surface-1 border border-white/10 rounded-xl font-semibold text-sm hover:bg-surface-0 transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      {/* Filtros + Búsqueda */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 rounded-xl p-1"
          style={{ background: 'var(--surface-3)', border: '1px solid var(--border)' }}>
          {([['all', 'Todos', items.length], ['no_show', 'No se conectó', countNo], ['sin_exito', 'No cerró', countSin]] as [FilterType, string, number][]).map(([val, label, count]) => (
            <button key={val} onClick={() => setFilter(val)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
              style={filter === val
                ? { background: 'var(--surface-1)', color: 'var(--primary)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
                : { color: 'var(--text-3)' }}>
              {label}
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{
                  background: filter === val ? 'var(--primary-dim)' : 'var(--surface-4)',
                  color: filter === val ? 'var(--primary)' : 'var(--text-muted)',
                }}>{count}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-1 min-w-[200px] rounded-xl px-3 py-2"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-2)' }}>
          <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar cliente, vendedor, nota..."
            className="flex-1 bg-transparent text-sm focus:outline-none"
            style={{ color: 'var(--text)' }}
          />
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: 'var(--border-2)', borderTopColor: 'var(--primary)' }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center rounded-2xl"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <CalendarPlus size={32} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--text-3)' }}>
            {search || filter !== 'all' ? 'Sin resultados para este filtro' : 'Sin reuniones pendientes de reagendar'}
          </p>
          {(!search && filter === 'all') && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Las reuniones marcadas como fallidas por los vendedores aparecen aquí</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtered.map((item: any) => {
            const isNoShow    = item.vendor_status === 'no_show'
            const statusClr   = isNoShow ? 'var(--warn)'            : 'var(--danger)'
            const statusDim   = isNoShow ? 'rgba(245,158,11,0.10)'   : 'rgba(225,29,72,0.10)'
            const statusBrd   = isNoShow ? 'rgba(245,158,11,0.22)'   : 'rgba(225,29,72,0.22)'
            const statusLabel = isNoShow ? 'No se conectó'          : 'Se conectó y no cerró'
            const StatusIcon  = isNoShow ? WifiOff : XCircle
            return (
              <div key={item.id} className="rounded-2xl p-4 space-y-3 transition-all"
                style={{ background: 'var(--surface-1)', border: `2px solid ${statusBrd}`, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>

                {/* Top row */}
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

                {/* Details */}
                <div className="space-y-1 text-[11px]" style={{ color: 'var(--text-3)' }}>
                  <div className="flex items-center gap-2">
                    <span className="w-16 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Vendedor</span>
                    <span className="font-semibold" style={{ color: 'var(--text-2)' }}>{item.vendor_name ?? '—'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-16 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Fecha</span>
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

                {/* Outcome note */}
                {item.outcome_note && (
                  <div className="rounded-xl px-3 py-2.5"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Nota del vendedor</p>
                    <p className="text-[12px] leading-relaxed italic" style={{ color: 'var(--text-2)' }}>"{item.outcome_note}"</p>
                  </div>
                )}

                {/* Acción única: abrir chat del lead */}
                <button
                  onClick={() => navigate('/leads', { state: { openLeadId: item.lead_id } })}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-[12px] font-bold transition-all"
                  style={{ background: 'var(--primary-dim)', color: 'var(--primary)', border: '1px solid rgba(124,58,237,0.20)' }}
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
