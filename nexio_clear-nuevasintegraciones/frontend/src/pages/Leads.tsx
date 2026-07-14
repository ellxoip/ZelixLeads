import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  getLeads, getLeadsCount, getGroups, deleteLead,
  getAllWhatsAppConfigs, exportLeads, getAllAreas, getUsers,
} from '../api'
import { useRealtime } from '../contexts/RealtimeContext'
import { playMessageSound, playNewLeadSound } from '../hooks/useNotificationSound'
import type { Lead } from '../types'
import { STAGE_LABELS } from '../types'
import {
  Plus, Search, Trash2, RefreshCw, Download, Info,
  ChevronLeft, ChevronRight, AlertTriangle, LayoutGrid, List,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/auth'
import LeadModal from '../components/LeadModal'
import { openLeadDrawer } from '../lib/leadDrawerBus'
import { useConfirm } from '../components/ConfirmDialog'
import { useLocation, useSearchParams } from 'react-router-dom'

const ALL_STAGES = [
  'lead', 'reunion', 'altamente_interesado', 'cierre',
  'pago_comprometido', 'pagado_confirmado',
  'recuperacion_lead', 'recuperacion_reunion', 'recuperacion_cierre', 'recuperacion_pago',
]
function ExportButton() {
  const [loading, setLoading] = React.useState(false)
  const { user } = useAuthStore()
  const planAllows = user?.negocio_plan_limits?.export_csv ?? false
  const handleExport = async () => {
    if (!planAllows) { toast.error('Exportar CSV requiere plan Pro o superior'); return }
    setLoading(true)
    try { await exportLeads() }
    catch { toast.error('Error al exportar') }
    finally { setLoading(false) }
  }
  return (
    <button onClick={handleExport} disabled={loading}
      className="flex items-center gap-1.5 border border-white/10 bg-surface-1 hover:bg-surface-0 text-white/78 text-sm font-semibold px-3 py-2 sm:py-2.5 rounded-xl transition-colors shadow-sm disabled:opacity-50"
      title={!planAllows ? 'Plan Pro requerido' : 'Exportar CSV'}
      style={!planAllows ? { opacity: 0.45, cursor: 'not-allowed' } : {}}>
      <Download size={14} className={loading ? 'animate-spin' : ''} />
      <span className="hidden sm:inline">Exportar</span>
    </button>
  )
}

const PAGE_SIZE = 80

// ── Main ──────────────────────────────────────────────────
export default function Leads() {
  const { user } = useAuthStore()
  const { confirm, dialog: confirmDialog } = useConfirm()
  const [leads, setLeads] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [stageFilter, setStage] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [areaFilter, setAreaFilter]   = useState('')
  const [userFilter, setUserFilter]   = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [activePreset, setActivePreset] = useState('')
  const [areas, setAreas]             = useState<any[]>([])
  const [leadUsers, setLeadUsers]     = useState<any[]>([])
  const [showModal, setModal] = useState(false)
  const [configs, setConfigs] = useState<any[]>([])
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leadsPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const loadRef = useRef<(p?: number) => Promise<void>>(async () => { })
  const location = useLocation()
  const [searchParams] = useSearchParams()

  const [viewMode, setViewMode] = useState<'cards' | 'list'>(() => (localStorage.getItem('leads_view_mode') as any) ?? 'cards')
  const toggleView = (mode: 'cards' | 'list') => { setViewMode(mode); localStorage.setItem('leads_view_mode', mode) }

  const canAdmin = !!(user?.role && ['superadmin', 'subadmin'].includes(user.role))
  const isAdmin = canAdmin
  const [groups, setGroups] = useState<any[]>([])

  const buildParams = (p = page) => ({
    ...(stageFilter ? { stage: stageFilter } : {}),
    ...(search ? { search } : {}),
    ...(groupFilter ? { group_id: parseInt(groupFilter) } : {}),
    ...(areaFilter  ? { area_name: areaFilter }  : {}),
    ...(userFilter  ? { agendadora_id: parseInt(userFilter) } : {}),
    ...(dateFrom ? { created_from: dateFrom } : {}),
    ...(dateTo   ? { created_to: dateTo }     : {}),
    limit: PAGE_SIZE,
    offset: (p - 1) * PAGE_SIZE,
  })

  const load = useCallback(async (p = 1) => {
    setLoading(true)
    try {
      const params = buildParams(p)
      const [ld, cnt, cfg] = await Promise.all([
        getLeads(params),
        getLeadsCount(params),
        configs.length ? Promise.resolve(configs) : getAllWhatsAppConfigs(),
      ])
      setLeads(ld)
      setTotal(cnt.total)
      setPage(p)
      setPages(Math.max(1, Math.ceil(cnt.total / PAGE_SIZE)))
      if (!configs.length) setConfigs(cfg as any[])
    } catch { toast.error('Error cargando leads') }
    finally { setLoading(false) }
  }, [stageFilter, search, groupFilter, areaFilter, userFilter, dateFrom, dateTo])

  useEffect(() => { load(1) }, [stageFilter, search, groupFilter, areaFilter, userFilter, dateFrom, dateTo])

  useEffect(() => {
    if (isAdmin) {
      getGroups().then(setGroups)
      getAllAreas().catch(() => []).then(setAreas)
      getUsers().catch(() => []).then((us: any[]) =>
        setLeadUsers(us.filter(u => ['agendadora', 'vendedor', 'subadmin'].includes(u.role) && u.is_active))
      )
    } else if (user?.role === 'agendadora') {
      getAllAreas().catch(() => []).then(setAreas)
    }
  }, [])

  // Keep refs in sync so the SSE closure always sees the latest values
  useEffect(() => { loadRef.current = load }, [load])

  // SSE: real-time lead list updates
  useRealtime(['new_message', 'refresh', 'lead_update', 'cobrador_sync'], (evt) => {
    if (evt.type === 'refresh' || evt.type === 'lead_update' || evt.type === 'cobrador_sync') {
      loadRef.current(1)
      return
    }
    if (evt.type === 'new_message') {
      const cid = evt.message?.contact_id as number
      if (!cid) return
      let isNew = false
      let isActive = false
      setLeads(prev => {
        const exists = prev.some(l => l.contact_id === cid)
        if (!exists) { isNew = true; return prev }
        return prev.map(l =>
          l.contact_id === cid ? { ...l, unread_count: (l.unread_count ?? 0) + 1 } : l
        )
      })
      setTimeout(() => {
        if (isNew) { playNewLeadSound(); setTimeout(() => loadRef.current(1), 1200) }
        else if (!isActive) { playMessageSound() }
      }, 10)
    }
  })

  useEffect(() => {
    // Fallback safety poll every 30s
    leadsPollRef.current = setInterval(() => loadRef.current(1), 30000)
    return () => { if (leadsPollRef.current) clearInterval(leadsPollRef.current) }
  }, [])

  // Auto-open lead en el Drawer COMPARTIDO al navegar desde WhatsApp "Ver Lead".
  useEffect(() => {
    const openId = (location.state as any)?.openLeadId
    if (openId) openLeadDrawer(openId, 'chat')
  }, [location.state])

  // Auto-open chat en el Drawer compartido desde push notification (?chat=leadId).
  useEffect(() => {
    const chatId = searchParams.get('chat')
    if (!chatId) return
    const id = parseInt(chatId)
    if (!isNaN(id)) openLeadDrawer(id, 'chat')
  }, [searchParams])

  // Debounce search input → server search
  const handleSearchChange = (val: string) => {
    setSearchInput(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setSearch(val), 400)
  }

  // Group leads by contact — one row per client in the list
  const contactGroups = useMemo(() => {
    const map = new Map<number, Lead[]>()
    for (const lead of leads) {
      if (!map.has(lead.contact_id)) map.set(lead.contact_id, [])
      map.get(lead.contact_id)!.push(lead)
    }
    const groups = Array.from(map.values())
    const toMs = (d: string) => new Date(d.endsWith('Z') || d.includes('+') ? d : d + 'Z').getTime()
    const getLastUpdate = (g: Lead[]) => { const d = g[0].updated_at ?? g[0].created_at; return d ? toMs(d) : 0 }
    const isNew = (g: Lead[]) => { const d = g[0].created_at; return d ? (Date.now() - toMs(d)) < 86400000 : false }
    return groups.sort((a, b) => {
      const aUnread = a.some(l => (l.unread_count ?? 0) > 0)
      const bUnread = b.some(l => (l.unread_count ?? 0) > 0)
      if (aUnread !== bUnread) return aUnread ? -1 : 1

      // New leads (< 24h) before cold ones
      const aNew = isNew(a), bNew = isNew(b)
      if (aNew !== bNew) return aNew ? -1 : 1

      const aDays = Math.floor((Date.now() - getLastUpdate(a)) / 86400000)
      const bDays = Math.floor((Date.now() - getLastUpdate(b)) / 86400000)
      const aCold = aDays >= 3, bCold = bDays >= 3
      if (aCold !== bCold) return aCold ? -1 : 1
      if (aCold && bCold) return bDays - aDays

      // Among recent leads, most recently updated first
      return getLastUpdate(b) - getLastUpdate(a)
    })
  }, [leads])

  const handleDeleteGroup = async (group: Lead[], e: React.MouseEvent) => {
    e.stopPropagation()
    const count = group.length
    const msg = count === 1
      ? '¿Eliminar este lead? Esta acción no se puede deshacer.'
      : `Se eliminarán el contacto y sus ${count} expedientes permanentemente.`
    const ok = await confirm(msg, { title: count === 1 ? 'Eliminar lead' : `Eliminar ${count} expedientes`, confirmLabel: 'Eliminar' })
    if (!ok) return
    try {
      await Promise.all(group.map(l => deleteLead(l.id)))
      toast.success(count === 1 ? 'Lead eliminado' : `${count} leads eliminados`)
      load(page)
    } catch { toast.error('Error al eliminar') }
  }

  // Nudo 2 — la tabla ahora delega en el Drawer COMPARTIDO (bus A.2), no en el
  // panel lateral legacy. Una sola experiencia de detalle en todo Nexio.
  const handleSelect = (lead: Lead) => { openLeadDrawer(lead.id) }

  return (
    <div className="flex flex-col h-full">

      {/* ══ PAGE HEADER ═══════════════════════════════════ */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-white">Leads</h1>
            {isAdmin && (
              <span className={`text-sm font-bold px-3 py-1 rounded-xl border-2 ${groupFilter
                  ? 'bg-white/10 text-white border-white/20'
                  : 'bg-warn/10 text-warn border-warn/30'
                }`}>
                {groupFilter
                  ? groups.find((g: any) => String(g.id) === groupFilter)?.name ?? 'Grupo'
                  : '⚠ Todos los grupos'}
              </span>
            )}
          </div>
          <p className="text-xs text-white/45 mt-0.5">Base completa de leads: busca, filtra por etapa o vendedor y abre cada expediente para ver su historial · <span className="text-white/60 font-semibold">{contactGroups.length} clientes · {total} expedientes</span></p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Vista toggle */}
          <div className="flex items-center rounded-xl border border-white/10 overflow-hidden" style={{ background: 'var(--surface-1)' }}>
            <button onClick={() => toggleView('cards')} title="Vista cartas"
              className={`flex items-center justify-center w-8 h-8 transition-colors ${viewMode === 'cards' ? 'bg-neon/20 text-neon' : 'text-white/40 hover:text-white/70'}`}>
              <LayoutGrid size={14} />
            </button>
            <button onClick={() => toggleView('list')} title="Vista lista"
              className={`flex items-center justify-center w-8 h-8 transition-colors ${viewMode === 'list' ? 'bg-neon/20 text-neon' : 'text-white/40 hover:text-white/70'}`}>
              <List size={14} />
            </button>
          </div>
          <ExportButton />
          <button onClick={() => setModal(true)}
            className="flex items-center gap-1.5 btn-primary text-sm px-3 sm:px-4 py-2 sm:py-2.5">
            <Plus size={15} /> <span className="hidden sm:inline">Nuevo Lead</span><span className="sm:hidden">Nuevo</span>
          </button>
        </div>
      </div>

      {/* ══ DESCRIPCIÓN ═══════════════════════════════════ */}
      <div className="hidden sm:flex items-start gap-3 rounded-xl px-4 py-3 mb-4 text-xs" style={{ background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.16)', color: 'rgba(52,81,199,0.90)' }}>
        <Info size={15} className="flex-shrink-0 mt-0.5" style={{ color: 'rgba(124,58,237,0.9)' }} />
        <p>Aquí están todos sus clientes. Haga clic en cualquier carta para abrir el expediente completo, donde podrá enviar mensajes, agregar notas, agendar reuniones y avanzar el caso.</p>
      </div>

      {/* ══ SEARCH & FILTERS ══════════════════════════════ */}
      <div className="flex flex-wrap sm:flex-nowrap gap-2 mb-4">
        <div className="relative w-full sm:w-auto sm:flex-1 min-w-0">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/38 pointer-events-none" />
          <input
            className="w-full pl-10 pr-4 py-2.5 text-sm border border-white/10 rounded-xl bg-surface-1 text-white/90 focus:outline-none focus:ring-2 focus:ring-white/15 focus:border-white/25 placeholder:text-white/30 transition-all"
            placeholder="Buscar por nombre, teléfono o RUT..."
            value={searchInput} onChange={e => handleSearchChange(e.target.value)} />
        </div>
        {/* Group filter — admins only */}
        {isAdmin && groups.length > 0 && (
          <select
            className="text-sm border border-white/10 rounded-xl px-3 py-2.5 bg-surface-1 text-white/78 focus:outline-none focus:ring-2 focus:ring-white/15 cursor-pointer min-w-[140px]"
            value={groupFilter} onChange={e => setGroupFilter(e.target.value)}>
            <option value="">Todos los grupos</option>
            {groups.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
        {/* Area filter — admins + agendadoras */}
        {(isAdmin || user?.role === 'agendadora') && areas.length > 0 && (
          <select
            className="text-sm border border-white/10 rounded-xl px-3 py-2.5 bg-surface-1 text-white/78 focus:outline-none focus:ring-2 focus:ring-white/15 cursor-pointer min-w-[140px]"
            value={areaFilter} onChange={e => setAreaFilter(e.target.value)}>
            <option value="">Todas las áreas</option>
            {Array.from(new Map(areas.map((a: any) => [a.name, a])).values()).map((a: any) =>
              <option key={a.name} value={a.name}>{a.name}</option>
            )}
          </select>
        )}
        {/* User filter — admins only */}
        {isAdmin && leadUsers.length > 0 && (
          <select
            className="text-sm border border-white/10 rounded-xl px-3 py-2.5 bg-surface-1 text-white/78 focus:outline-none focus:ring-2 focus:ring-white/15 cursor-pointer min-w-[150px]"
            value={userFilter} onChange={e => setUserFilter(e.target.value)}>
            <option value="">Todos los usuarios</option>
            {leadUsers.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        <select
          className="hidden sm:block text-sm border border-white/10 rounded-xl px-3 py-2.5 bg-surface-1 text-white/78 focus:outline-none focus:ring-2 focus:ring-white/15 cursor-pointer min-w-[150px]"
          value={stageFilter} onChange={e => setStage(e.target.value)}>
          <option value="">Todas las etapas</option>
          {ALL_STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>
        {/* Mobile: compact stage filter */}
        <select
          className="sm:hidden text-xs border border-white/10 rounded-xl px-2 py-2.5 bg-surface-1 text-white/78 focus:outline-none cursor-pointer max-w-[110px]"
          value={stageFilter} onChange={e => setStage(e.target.value)}>
          <option value="">Todas</option>
          {ALL_STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>
        <button onClick={() => load(page)}
          className="w-10 h-10 flex items-center justify-center border border-white/10 rounded-xl bg-surface-1 text-white/38 hover:text-white/78 hover:bg-surface-0 transition-colors flex-shrink-0">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Date range filter */}
      {(() => {
        const ld = (d: Date) => { const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}` }
        const today = new Date()
        const todayStr = ld(today)
        const weekStart = new Date(today); weekStart.setDate(today.getDate() - ((today.getDay()+6)%7))
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
        const prevMonthStart = new Date(today.getFullYear(), today.getMonth()-1, 1)
        const prevMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0)
        const presets = [
          { label: 'Hoy',          from: todayStr,              to: todayStr },
          { label: 'Esta semana',  from: ld(weekStart),         to: todayStr },
          { label: 'Este mes',     from: ld(monthStart),        to: todayStr },
          { label: 'Mes anterior', from: ld(prevMonthStart),    to: ld(prevMonthEnd) },
        ]
        return (
          <div className="flex flex-nowrap sm:flex-wrap gap-2 mb-3 items-center overflow-x-auto sm:overflow-x-visible scrollbar-none">
            <span className="text-[11px] text-white/40 font-medium flex-shrink-0">Fecha:</span>
            {presets.map(preset => {
              const active = activePreset === preset.label
              return (
                <button key={preset.label}
                  onClick={() => {
                    if (active) { setDateFrom(''); setDateTo(''); setActivePreset('') }
                    else { setDateFrom(preset.from); setDateTo(preset.to); setActivePreset(preset.label) }
                  }}
                  className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors whitespace-nowrap flex-shrink-0 ${active ? 'bg-neon/20 border-neon/40 text-neon' : 'border-white/10 bg-surface-1 text-white/50 hover:text-white/80'}`}>
                  {preset.label}
                </button>
              )
            })}
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setActivePreset('') }}
              className="text-[11px] px-2 py-1 rounded-lg border border-white/10 bg-surface-1 text-white/70 focus:outline-none focus:ring-1 focus:ring-neon/40 flex-shrink-0" />
            <span className="text-white/30 text-xs flex-shrink-0">→</span>
            <input type="date" value={dateTo} min={dateFrom} onChange={e => { setDateTo(e.target.value); setActivePreset('') }}
              className="text-[11px] px-2 py-1 rounded-lg border border-white/10 bg-surface-1 text-white/70 focus:outline-none focus:ring-1 focus:ring-neon/40 flex-shrink-0" />
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(''); setDateTo(''); setActivePreset('') }}
                className="text-[11px] px-2 py-1 rounded-lg border border-white/10 bg-surface-1 text-danger/70 hover:text-danger transition-colors">
                ✕ Limpiar
              </button>
            )}
          </div>
        )
      })()}

      {/* ══ GRID VIEW ═════════════════════════════════ */}
      <div className="flex-1 overflow-y-auto pb-4">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-white/30 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-white/20 bg-surface-1 rounded-2xl border border-white/[0.07]">
            <Search size={32} className="mb-3" />
            <p className="text-sm font-medium text-white/38">Sin resultados</p>
            <p className="text-xs mt-1">Prueba con otro filtro o búsqueda</p>
          </div>
        ) : viewMode === 'list' ? (
          <div className="rounded-2xl overflow-x-auto" style={{ background: '#ffffff', border: '1.5px solid rgba(28,22,51,0.09)', boxShadow: '0 1px 8px rgba(28,22,51,0.06)' }}>
            {/* List header */}
            <div className="grid items-center px-5 py-2.5 border-b" style={{ gridTemplateColumns: '3fr 1.4fr 1.6fr 1.3fr', borderColor: 'rgba(28,22,51,0.07)', background: '#faf9fd', minWidth: 620 }}>
              <span className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: '#94a3b8' }}>Contacto</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: '#94a3b8' }}>Etapa</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: '#94a3b8' }}>Área</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: '#94a3b8' }}>Última actividad</span>
            </div>
            {contactGroups.map(group => {
              const lead = group[0]
              const active = false
              const STAGE_ACCENT: Record<string, { dot: string; badge: string; badgeText: string; border: string }> = {
                lead:                 { dot: '#94a3b8', badge: '#f1f5f9', badgeText: '#64748b', border: '#94a3b8' },
                reunion:              { dot: '#f59e0b', badge: '#fffbeb', badgeText: '#d97706', border: '#f59e0b' },
                altamente_interesado: { dot: '#f59e0b', badge: '#fffbeb', badgeText: '#d97706', border: '#f59e0b' },
                cierre:               { dot: '#7c3aed', badge: '#eef2ff', badgeText: '#7c3aed', border: '#7c3aed' },
                pago_comprometido:    { dot: '#22c55e', badge: '#f0fdf4', badgeText: '#16a34a', border: '#22c55e' },
                pagado_confirmado:    { dot: '#22c55e', badge: '#f0fdf4', badgeText: '#16a34a', border: '#22c55e' },
                recuperacion_lead:    { dot: '#ef4444', badge: '#fff1f2', badgeText: '#dc2626', border: '#ef4444' },
                recuperacion_reunion: { dot: '#ef4444', badge: '#fff1f2', badgeText: '#dc2626', border: '#ef4444' },
                recuperacion_cierre:  { dot: '#ef4444', badge: '#fff1f2', badgeText: '#dc2626', border: '#ef4444' },
              }
              const sa = STAGE_ACCENT[lead.current_stage] ?? { dot: '#94a3b8', badge: '#f1f5f9', badgeText: '#475569', border: '#94a3b8' }
              const lastUpdate = lead.updated_at ?? lead.created_at
              const lastUpdateMs = lastUpdate ? Date.now() - new Date(lastUpdate + (lastUpdate.endsWith('Z') || lastUpdate.includes('+') ? '' : 'Z')).getTime() : Infinity
              const daysSince = Math.floor(lastUpdateMs / 86400000)
              const isCold = daysSince >= 3
              const isNewLead = lead.created_at ? (Date.now() - new Date(lead.created_at + (lead.created_at.endsWith('Z') || lead.created_at.includes('+') ? '' : 'Z')).getTime()) < 86400000 : false
              const recMins = Math.floor(lastUpdateMs / 60000)
              const isVeryRecent = lastUpdateMs < 3600000 * 3
              const recLabel = recMins < 1 ? 'ahora' : recMins < 60 ? `hace ${recMins} min` : recMins < 120 ? 'hace 1 hora' : recMins < 1440 ? `hace ${Math.floor(recMins/60)} horas` : recMins < 2880 ? 'hace 1 día' : recMins < 10080 ? `hace ${Math.floor(recMins/1440)} días` : recMins < 20160 ? 'hace 1 semana' : `hace ${Math.floor(recMins/10080)} semanas`
              const AVATAR_COLORS = [
                { bg: 'rgba(124,58,237,0.12)',  fg: '#7c3aed' },
                { bg: 'rgba(124,58,237,0.12)', fg: '#7c3aed' },
                { bg: 'rgba(8,145,178,0.12)',  fg: '#0891b2' },
                { bg: 'rgba(5,150,105,0.12)',  fg: '#059669' },
                { bg: 'rgba(217,119,6,0.12)',  fg: '#d97706' },
                { bg: 'rgba(220,38,38,0.12)',  fg: '#dc2626' },
              ]
              const avatarColor = AVATAR_COLORS[(lead.contact?.name?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length]
              const Initial = lead.contact?.name?.trim()?.charAt(0)?.toUpperCase() ?? '?'
              const allAreas = [...new Set(group.map(l => l.area?.name).filter(Boolean))].join(', ') || '—'
              const totalUnread = group.reduce((s, l) => s + (l.unread_count ?? 0), 0)
              const timeColor = daysSince >= 5 ? '#dc2626' : isCold ? '#b45309' : isVeryRecent ? '#16a34a' : '#94a3b8'
              return (
                <div key={lead.id} role="button" tabIndex={0}
                  onClick={() => handleSelect(lead)}
                  onKeyDown={e => e.key === 'Enter' && handleSelect(lead)}
                  className="grid items-center cursor-pointer transition-colors border-b last:border-b-0"
                  style={{
                    gridTemplateColumns: '3fr 1.4fr 1.6fr 1.3fr',
                    borderColor: 'rgba(28,22,51,0.06)',
                    background: active ? `color-mix(in srgb, ${sa.dot} 7%, #ffffff)` : '#ffffff',
                    borderLeft: `3px solid ${active ? sa.dot : 'transparent'}`,
                    minWidth: 620,
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = '#faf9fd' }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = '#ffffff' }}>
                  {/* Contacto */}
                  <div className="flex items-center gap-3 min-w-0 py-3 pl-4 pr-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                      style={{ background: avatarColor.bg, color: avatarColor.fg }}>
                      {Initial}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="text-[13px] font-semibold truncate leading-tight" style={{ color: '#1c1633' }}>{lead.contact?.name ?? '—'}</p>
                        {isNewLead && (
                          <span className="flex-shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded-full animate-pulse" style={{ background: '#dcfce7', color: '#15803d', border: '1px solid #86efac' }}>NUEVO</span>
                        )}
                        {!isNewLead && isVeryRecent && !isCold && (
                          <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#dcfce7', color: '#15803d', border: '1px solid #86efac' }}>hace {recMins}m</span>
                        )}
                      </div>
                      <p className="text-[11px] truncate mt-0.5" style={{ color: '#94a3b8' }}>{lead.contact?.phone ?? '—'}</p>
                    </div>
                    {totalUnread > 0 && (
                      <span className="min-w-[18px] h-[18px] rounded-full text-[9px] font-bold text-white px-1.5 flex items-center justify-center flex-shrink-0" style={{ background: '#ef4444' }}>{totalUnread}</span>
                    )}
                  </div>
                  {/* Etapa */}
                  <div className="flex items-center py-3 pr-3">
                    <span className="text-[11px] font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap"
                      style={{ background: sa.badge, color: sa.badgeText, border: `1px solid ${sa.dot}25` }}>
                      {STAGE_LABELS[lead.current_stage] ?? lead.current_stage}
                    </span>
                  </div>
                  {/* Área */}
                  <div className="flex items-center py-3 pr-3 min-w-0">
                    <span className="text-[12px] font-medium truncate" style={{ color: '#475569' }}>{allAreas}</span>
                  </div>
                  {/* Última actividad */}
                  <div className="flex items-center py-3 pr-5">
                    <span className="text-[12px] font-medium" style={{ color: timeColor }}>{recLabel}</span>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 px-1">
            {contactGroups.map(group => {
              const lead = group[0]
              const active = false

              const STAGE_ACCENT: Record<string, { dot: string; badge: string; badgeText: string; border: string }> = {
                lead: { dot: '#94a3b8', badge: '#f1f5f9', badgeText: '#64748b', border: '#94a3b8' },
                reunion: { dot: '#f59e0b', badge: '#fffbeb', badgeText: '#d97706', border: '#f59e0b' },
                altamente_interesado: { dot: '#f59e0b', badge: '#fffbeb', badgeText: '#d97706', border: '#f59e0b' },
                cierre: { dot: '#7c3aed', badge: '#eef2ff', badgeText: '#7c3aed', border: '#7c3aed' },
                pago_comprometido: { dot: '#22c55e', badge: '#f0fdf4', badgeText: '#16a34a', border: '#22c55e' },
                pagado_confirmado: { dot: '#22c55e', badge: '#f0fdf4', badgeText: '#16a34a', border: '#22c55e' },
                recuperacion_lead: { dot: '#ef4444', badge: '#fff1f2', badgeText: '#dc2626', border: '#ef4444' },
                recuperacion_reunion: { dot: '#ef4444', badge: '#fff1f2', badgeText: '#dc2626', border: '#ef4444' },
                recuperacion_cierre: { dot: '#ef4444', badge: '#fff1f2', badgeText: '#dc2626', border: '#ef4444' },
              }
              const sa = STAGE_ACCENT[lead.current_stage] ?? { dot: '#94a3b8', badge: '#f1f5f9', badgeText: '#475569', border: '#94a3b8' }
              const hasUnread = group.some(l => (l.unread_count ?? 0) > 0)

              const Initial = lead.contact?.name?.trim()?.charAt(0)?.toUpperCase() ?? '?'
              const lastUpdate = lead.updated_at ?? lead.created_at
              const lastUpdateMs = lastUpdate ? Date.now() - new Date(lastUpdate + (lastUpdate.endsWith('Z') || lastUpdate.includes('+') ? '' : 'Z')).getTime() : Infinity
              const daysSince = Math.floor(lastUpdateMs / 86400000)
              const isCold = daysSince >= 3
              const isNewLead = lead.created_at ? (Date.now() - new Date(lead.created_at + (lead.created_at.endsWith('Z') || lead.created_at.includes('+') ? '' : 'Z')).getTime()) < 86400000 : false
              const recMins = Math.floor(lastUpdateMs / 60000)
              const isVeryRecent = lastUpdateMs < 3600000 * 3
              const isRecentToday = !isVeryRecent && lastUpdateMs < 86400000
              const recLabel = recMins < 60 ? `${recMins}m` : recMins < 1440 ? `${Math.floor(recMins/60)}h` : ''

              const AVATAR_COLORS = [
                { bg: 'rgba(124,58,237,0.12)',  fg: '#7c3aed' },
                { bg: 'rgba(124,58,237,0.12)', fg: '#7c3aed' },
                { bg: 'rgba(8,145,178,0.12)',  fg: '#0891b2' },
                { bg: 'rgba(5,150,105,0.12)',  fg: '#059669' },
                { bg: 'rgba(217,119,6,0.12)',  fg: '#d97706' },
                { bg: 'rgba(220,38,38,0.12)',  fg: '#dc2626' },
              ]
              const avatarColor = AVATAR_COLORS[(lead.contact?.name?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length]

              return (
                <div key={lead.id} role="button" tabIndex={0}
                  onClick={() => handleSelect(lead)}
                  onKeyDown={e => e.key === 'Enter' && handleSelect(lead)}
                  className={`relative flex flex-col text-left rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 group${hasUnread ? ' lead-vibrate' : ''}`}
                  style={{
                    animationDelay: hasUnread ? `${(lead.id % 7) * 0.5}s` : undefined,
                    background: '#ffffff',
                    border: active ? '1.5px solid #7c3aed' : '1px solid rgba(28,22,51,0.08)',
                    boxShadow: active
                      ? '0 0 0 3px rgba(124,58,237,0.10), 0 4px 12px rgba(124,58,237,0.10)'
                      : '0 1px 3px rgba(28,22,51,0.05)',
                  }}
                  onMouseEnter={e => {
                    if (!active) (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(28,22,51,0.08)'
                  }}
                  onMouseLeave={e => {
                    if (!active) (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(28,22,51,0.05)'
                  }}
                >
                  {/* Delete button — admin/subadmin only, visible on hover */}
                  {isAdmin && (
                    <button
                      onClick={e => handleDeleteGroup(group, e)}
                      title="Eliminar lead"
                      className="absolute top-2.5 right-2.5 z-10 w-6 h-6 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: 'rgba(225,29,72,0.10)', color: '#e11d48' }}>
                      <Trash2 size={11} />
                    </button>
                  )}

                  {/* Stage accent bar */}
                  <div className="h-1 w-full flex-shrink-0"
                    style={{ background: active ? '#7c3aed' : isCold ? (daysSince >= 5 ? '#ef4444' : '#f59e0b') : sa.dot }} />

                  <div className="p-4 flex flex-col gap-3 flex-1">

                    {/* Header: avatar + name + alert badge */}
                    <div className="flex items-start gap-3">
                      {lead.contact?.avatar_url ? (
                        <img
                          src={lead.contact.avatar_url}
                          alt={lead.contact.name}
                          className="w-10 h-10 rounded-xl object-cover flex-shrink-0"
                          style={{ boxShadow: '0 3px 10px rgba(0,0,0,0.18)' }}
                          onError={e => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                            (e.currentTarget.nextElementSibling as HTMLElement).style.display = 'flex'
                          }}
                        />
                      ) : null}
                      <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-base flex-shrink-0"
                        style={{
                          background: active ? '#7c3aed' : avatarColor.bg,
                          color: active ? '#ffffff' : avatarColor.fg,
                          display: lead.contact?.avatar_url ? 'none' : 'flex',
                        }}>
                        {Initial}
                      </div>
                      <div className="min-w-0 flex-1 pt-0.5">
                        <div className="flex items-center gap-1.5">
                          <p className="text-[13px] font-bold truncate leading-tight" style={{ color: '#1c1633' }}>
                            {lead.contact?.name ?? '—'}
                          </p>
                          {!active && isVeryRecent && !isCold && (
                            <span className="flex-shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded-full animate-pulse"
                              style={{ background: '#dcfce7', color: '#15803d', border: '1px solid #86efac' }}>
                              {isNewLead ? 'NUEVO' : `hace ${recLabel}`}
                            </span>
                          )}
                          {!active && isRecentToday && !isCold && recLabel && (
                            <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                              style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe' }}>
                              {recLabel}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] truncate mt-0.5 font-medium" style={{ color: 'rgba(28,22,51,0.50)' }}>
                          {lead.contact?.phone ?? '—'}
                        </p>
                      </div>
                    </div>

                    {/* Cold lead banner */}
                    {!active && isCold && (
                      <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold w-full"
                        style={daysSince >= 5
                          ? { background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5' }
                          : { background: '#fef3c7', color: '#b45309', border: '1px solid #fcd34d' }}>
                        <AlertTriangle size={12} className="flex-shrink-0" />
                        Sin interacción hace {daysSince} {daysSince === 1 ? 'día' : 'días'}
                      </div>
                    )}

                    {/* Group badge */}
                    {isAdmin && lead.group?.name && (
                      <div>
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: '#eef2ff', color: '#7c3aed', border: '1px solid #c7d2fe' }}>
                          {lead.group.name}
                        </span>
                      </div>
                    )}

                    {/* Expedientes */}
                    <div className="space-y-1.5">
                      <p className="text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: 'rgba(28,22,51,0.38)' }}>
                        {group.length === 1 ? '1 Expediente' : `${group.length} Expedientes`}
                      </p>
                      {group.map((l) => {
                        const lsa = STAGE_ACCENT[l.current_stage] ?? STAGE_ACCENT.lead
                        const hasPago = l.current_stage === 'pago_comprometido' && (l as any).payment_commitment_date
                        const pagoEl = hasPago ? (() => {
                          const d = new Date((l as any).payment_commitment_date + 'T00:00:00')
                          const today = new Date(); today.setHours(0,0,0,0)
                          const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
                          const isToday   = diff === 0
                          const isOverdue = diff < 0
                          const isSoon    = diff > 0 && diff <= 2
                          const bg     = isOverdue ? '#fef2f2' : isToday ? '#fff7ed' : isSoon ? '#fffbeb' : '#f0fdf4'
                          const border = isOverdue ? '#fca5a5' : isToday ? '#fdba74' : isSoon ? '#fde68a' : '#86efac'
                          const color  = isOverdue ? '#dc2626' : isToday ? '#c2410c' : isSoon ? '#b45309' : '#15803d'
                          const label  = isOverdue ? `VENCIDO ${Math.abs(diff)}d` : isToday ? '¡PAGA HOY!' : `En ${diff}d — ${d.toLocaleDateString('es-CL',{day:'2-digit',month:'short'})}`
                          return (
                            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg mt-1.5" style={{ background: bg, border: `1.5px solid ${border}` }}>
                              <span className="text-[10px] font-black" style={{ color }}>{label}</span>
                            </div>
                          )
                        })() : null
                        return (
                          <div key={l.id}>
                            <div className="flex items-center gap-2.5 rounded-lg py-2 pr-2.5"
                              style={{
                                background: '#faf9fd',
                                border: '1px solid rgba(28,22,51,0.07)',
                                paddingLeft: 0,
                                overflow: 'hidden',
                              }}>
                              <div className="w-1 self-stretch flex-shrink-0 rounded-l-lg" style={{ background: lsa.dot, minWidth: 3 }} />
                              <p className="text-[11px] font-bold flex-1 truncate pl-1" style={{ color: '#1c1633' }}>
                                {l.area?.name ?? 'Sin Área'}
                              </p>
                              {(l.unread_count ?? 0) > 0 && (
                                <span className="min-w-[16px] h-4 rounded-full text-[9px] font-bold text-white px-1 flex items-center justify-center flex-shrink-0"
                                  style={{ background: '#ef4444' }}>
                                  {l.unread_count}
                                </span>
                              )}
                              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                                style={{ background: lsa.badge, color: lsa.badgeText, border: `1px solid ${lsa.dot}30` }}>
                                {STAGE_LABELS[l.current_stage] ?? l.current_stage}
                              </span>
                            </div>
                            {pagoEl}
                          </div>
                        )
                      })}
                    </div>

                    {/* CTA */}
                    <div className="mt-auto pt-0.5">
                      <div className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all"
                        style={active ? {
                          background: '#7c3aed',
                          color: '#ffffff',
                          border: '1px solid #7c3aed',
                          boxShadow: '0 2px 8px rgba(124,58,237,0.28)',
                        } : {
                          background: 'rgba(124,58,237,0.09)',
                          color: '#7c3aed',
                          border: '1px solid rgba(124,58,237,0.22)',
                        }}>
                        {active ? 'Lead abierto' : 'Abrir lead'}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Load more */}
        {/* Paginator */}
        {pages > 1 && !loading && (
          <div className="flex items-center justify-between gap-4 pt-4 pb-2">
            <p className="text-xs text-white/45">
              Página {page} de {pages} · {total} expedientes
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => load(Math.max(1, page - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg border border-white/10 text-white/52 hover:text-white hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={15} />
              </button>

              {Array.from({ length: pages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === pages || Math.abs(p - page) <= 2)
                .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                  if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push('...')
                  acc.push(p)
                  return acc
                }, [])
                .map((p, i) =>
                  p === '...' ? (
                    <span key={`e${i}`} className="px-1 text-white/38 text-xs">…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => load(p as number)}
                      className={`min-w-[30px] h-[30px] rounded-lg text-xs font-semibold transition-colors ${p === page ? 'bg-lime text-black' : 'border border-white/10 text-white/52 hover:text-white hover:bg-surface-2'
                        }`}
                    >{p}</button>
                  )
                )}

              <button
                onClick={() => load(Math.min(pages, page + 1))}
                disabled={page === pages}
                className="p-1.5 rounded-lg border border-white/10 text-white/52 hover:text-white hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        )}
      </div>


      {showModal && (
        <LeadModal onClose={() => setModal(false)} onSuccess={() => { setModal(false); load() }} />
      )}

      {confirmDialog}
    </div>
  )
}
