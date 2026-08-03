import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { getAgentQueue, dismissAgentLead, getGroups } from '../api'
import { useAuthStore } from '../store/auth'
import { parseDate } from '../utils/dates'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Bot, Search, RefreshCw, ArrowRight, Phone, CheckCheck, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'

export default function AgentIA() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'superadmin' || user?.role === 'subadmin'

  const highlightId: number | null = (location.state as any)?.openLeadId ?? null
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({})

  const [data, setData]       = useState<{ count: number; leads: any[] }>({ count: 0, leads: [] })
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [groups, setGroups]   = useState<any[]>([])
  const [groupId, setGroupId] = useState<number | null>(null)

  useEffect(() => {
    if (isAdmin) {
      getGroups().then((gs: any[]) => {
        const subs = gs.filter((g: any) => g.negocio_id !== null)
        setGroups(subs)
      }).catch(() => {})
    }
  }, [isAdmin])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = groupId ? { group_id: groupId } : undefined
      const res = await getAgentQueue(params)
      setData({
        count: res?.count ?? 0,
        leads: Array.isArray(res?.leads) ? res.leads : [],
      })
    } catch {
      toast.error('Error cargando leads del agente IA')
      setData({ count: 0, leads: [] })
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => { load() }, [load])

  // Scroll to highlighted lead once data loads
  useEffect(() => {
    if (!highlightId || loading) return
    const el = cardRefs.current[highlightId]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlightId, loading])

  const filtered = data.leads.filter(lead => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      lead.contact?.name?.toLowerCase().includes(q) ||
      lead.contact?.phone?.toLowerCase().includes(q) ||
      lead.area?.name?.toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(53,122,14,0.12)', color: 'var(--zx-accent-text)' }}>
              <Bot size={16} />
            </div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>Agente IA</h1>
            {data.count > 0 && (
              <span className="text-xs font-bold px-2.5 py-1 rounded-full"
                style={{ background: 'rgba(53,122,14,0.12)', color: 'var(--zx-accent-text)' }}>
                {data.count} pendiente{data.count !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Clientes que escribieron fuera de horario — pendientes de atención
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 rounded-xl px-3.5 py-2.5"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-2)' }}>
          <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar cliente..."
            className="bg-transparent text-sm focus:outline-none w-48"
            style={{ color: 'var(--text)' }}
          />
        </div>

        {isAdmin && groups.length > 0 && (
          <div className="relative">
            <select
              value={groupId ?? ''}
              onChange={e => setGroupId(e.target.value ? Number(e.target.value) : null)}
              className="appearance-none pl-3 pr-8 py-2.5 rounded-xl text-sm font-medium focus:outline-none cursor-pointer"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-2)', color: 'var(--text-2)' }}>
              <option value="">Todos los grupos</option>
              {groups.map((g: any) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--text-muted)' }} />
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-7 h-7 border-2 rounded-full animate-spin"
            style={{ borderColor: 'var(--border)', borderTopColor: 'var(--zx-accent-text)' }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center rounded-2xl"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: 'rgba(53,122,14,0.08)', color: 'var(--zx-accent-text)' }}>
            <Bot size={28} />
          </div>
          <p className="font-bold text-base" style={{ color: 'var(--text-3)' }}>
            {search ? 'Sin resultados' : 'Sin leads pendientes'}
          </p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            {search ? 'Intenta con otro término' : 'Cuando el agente atienda clientes fuera de horario, aparecerán aquí'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((lead: any) => {
            const createdAt = parseDate(lead.created_at)
            const isToday   = new Date().toDateString() === createdAt.toDateString()
            const isHighlighted = lead.id === highlightId
            return (
              <div key={lead.id}
                ref={el => { cardRefs.current[lead.id] = el }}
                className="rounded-2xl overflow-hidden transition-all"
                style={{
                  background: 'var(--surface-1)',
                  border: isHighlighted ? '2px solid var(--zx-accent-text)' : '1.5px solid rgba(53,122,14,0.18)',
                  boxShadow: isHighlighted ? '0 0 0 4px rgba(53,122,14,0.15), 0 2px 10px rgba(53,122,14,0.12)' : '0 2px 10px rgba(53,122,14,0.06)',
                }}>

                {/* Header */}
                <div className="flex items-center gap-3 px-4 py-3.5"
                  style={{ borderBottom: '1px solid var(--border)' }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-base font-black"
                    style={{ background: 'rgba(53,122,14,0.12)', color: 'var(--zx-accent-text)' }}>
                    {lead.contact?.name?.charAt(0)?.toUpperCase() ?? '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm truncate" style={{ color: 'var(--text)' }}>
                      {lead.contact?.name ?? '—'}
                    </p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Phone size={9} style={{ color: 'var(--text-muted)' }} />
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {lead.contact?.phone}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-[9px] font-bold px-2 py-1 rounded-lg flex items-center gap-1"
                      style={{ background: 'rgba(53,122,14,0.10)', color: 'var(--zx-accent-text)', border: '1px solid rgba(53,122,14,0.16)' }}>
                      <Bot size={8} /> IA
                    </span>
                    {isAdmin && lead.group?.name && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                        {lead.group.name}
                      </span>
                    )}
                  </div>
                </div>

                {/* Meta */}
                <div className="px-4 py-3 flex items-center gap-3 flex-wrap text-[11px]"
                  style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  {lead.area?.name && (
                    <span className="font-semibold px-2 py-0.5 rounded-md"
                      style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
                      {lead.area.name}
                    </span>
                  )}
                  {lead.agendadora?.name && <span>{lead.agendadora.name}</span>}
                  <span className="ml-auto">
                    {isToday
                      ? `Hoy · ${format(createdAt, 'HH:mm')}`
                      : format(createdAt, "d MMM · HH:mm", { locale: es })}
                  </span>
                </div>

                {/* Actions */}
                <div className="px-4 py-3 flex gap-2">
                  <button
                    onClick={async () => {
                      try {
                        await dismissAgentLead(lead.id)
                        window.dispatchEvent(new CustomEvent('lead-stage-changed'))
                        load()
                      } catch {
                        toast.error('Error al marcar como atendido')
                      }
                    }}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
                    style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)' }}>
                    <CheckCheck size={11} /> Atendido
                  </button>
                  <button
                    onClick={() => navigate('/leads', { state: { openLeadId: lead.id } })}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all"
                    style={{ background: 'rgba(53,122,14,0.09)', color: 'var(--zx-accent-text)', border: '1px solid rgba(53,122,14,0.18)' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(53,122,14,0.18)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(53,122,14,0.09)' }}>
                    Abrir lead <ArrowRight size={11} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
