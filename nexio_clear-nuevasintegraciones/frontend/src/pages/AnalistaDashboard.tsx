import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from 'recharts'
import { getAnalistaCarteras, getAnalistaCarterasDetalle, getPanelAnalistaStats } from '../api'
import { useRealtime } from '../contexts/RealtimeContext'
import {
  Layers, DollarSign, AlertCircle, CheckSquare, TrendingUp, RefreshCw, Calendar, Medal, X, MousePointerClick,
  Users, UserCheck, CalendarCheck, Target, Award, ThumbsUp, Clock, Search,
} from 'lucide-react'

const PALETTE = ['#7c3aed', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#ef4444', '#84cc16']
const AGING_COLORS = ['#7c3aed', '#10b981', '#f59e0b', '#ef4444']
const AGING_BUCKETS = [
  { rango: '1 a 30 días', lo: 1, hi: 30 },
  { rango: '31 a 60 días', lo: 31, hi: 60 },
  { rango: '61 a 90 días', lo: 61, hi: 90 },
  { rango: '+ de 90 días', lo: 91, hi: 1e9 },
]
const STAGE_LABEL: Record<string, string> = {
  pendiente_moroso: 'Pendiente Moroso', lead_moroso: 'Lead Moroso',
  pago_comprometido: 'Pago Comprometido', pagado: 'Pagado', historial: 'Historial (pagado)',
}

function fmt(n: number) { return `$${Math.round(n ?? 0).toLocaleString('es-CL')}` }
function pct(n: number) { return `${(n ?? 0).toFixed(1).replace('.', ',')}%` }
function fmtK(n: number) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `$${Math.round(n / 1000)}K`
  return `$${Math.round(n)}`
}
function fmtDate(s?: string | null) {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}-${m}-${y}`
}

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthRange(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` }
}

const card: React.CSSProperties = { background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: '0 2px 8px var(--border)' }
const clickable: React.CSSProperties = { cursor: 'pointer' }
const sectionTitle: React.CSSProperties = { fontFamily: '"Public Sans", sans-serif', fontWeight: 800, fontSize: 13, letterSpacing: '0.02em', color: 'var(--text)', textTransform: 'uppercase' }
const helpText: React.CSSProperties = { fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }

type ModalCtx = { tipo: string; titulo: string; cobradorId?: number; dia?: string; bucket?: { rango: string; lo: number; hi: number } }

// ─────────────────────────────────────────────────────────────────────────────

// ─── Tabla con buscador + scroll ─────────────────────────────────────────────
function useTableSearch<T>(rows: T[], keys: (keyof T | string)[]) {
  const [q, setQ] = useState('')
  const filtered = q.trim()
    ? rows.filter(row =>
        keys.some(k => String((row as any)[k] ?? '').toLowerCase().includes(q.toLowerCase()))
      )
    : rows
  return { q, setQ, filtered }
}

function TableSearchBar({ q, setQ, placeholder, count, total }: {
  q: string; setQ: (v: string) => void; placeholder?: string; count: number; total: number
}) {
  return (
    <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-xl" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
      <Search size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={placeholder ?? 'Buscar...'}
        className="flex-1 bg-transparent text-xs focus:outline-none"
        style={{ color: 'var(--text)' }}
      />
      {q && (
        <button onClick={() => setQ('')} style={{ color: 'var(--text-muted)' }}><X size={11} /></button>
      )}
      <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
        {count < total ? `${count} de ${total}` : `${total} filas`}
      </span>
    </div>
  )
}

const STAGE_LABEL_V: Record<string, string> = {
  lead: 'Lead', reunion: 'Reunión', recuperacion_lead: 'Recup. Lead', recuperacion_reunion: 'Recup. Reunión',
  altamente_interesado: 'Alt. Interesado', recuperacion_altamente_interesado: 'Recup. Alt. Int.',
  cierre: 'Cierre', recuperacion_cierre: 'Recup. Cierre',
  pago_pendiente: 'Pago Pendiente', pago_comprometido: 'Pago Comprometido',
  pagado_reunion: 'Validando Pago', pagado_confirmado: 'Confirmado ✓',
}
const STAGE_COLOR_V: Record<string, string> = {
  lead: '#94a3b8', reunion: '#7c3aed', recuperacion_lead: '#8b5cf6', recuperacion_reunion: '#7c3aed',
  altamente_interesado: '#06b6d4', recuperacion_altamente_interesado: '#0891b2',
  cierre: '#f59e0b', recuperacion_cierre: '#d97706',
  pago_pendiente: '#10b981', pago_comprometido: '#059669', pagado_reunion: '#34d399', pagado_confirmado: '#065f46',
}

// ─── Filtro de período — idéntico al de Cartera de Cobranza ─────────────────
function PeriodControls({ period, fromDate, toDate, refreshing, onPeriod, onFrom, onTo, onRefresh }: any) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs" style={card}>
        <Calendar size={13} style={{ color: 'var(--text-muted)' }} />
        <input type="date" value={fromDate} onChange={e => onFrom(e.target.value)}
          className="bg-transparent text-xs focus:outline-none w-28" style={{ color: 'var(--text)' }} />
        <span style={{ color: 'var(--text-muted)' }}>al</span>
        <input type="date" value={toDate} onChange={e => onTo(e.target.value)}
          className="bg-transparent text-xs focus:outline-none w-28" style={{ color: 'var(--text)' }} />
      </div>
      <div className="flex items-center gap-1 px-2 py-2 rounded-xl text-[10px]" style={card}>
        <span style={{ color: 'var(--text-muted)' }}>Mes:</span>
        <input type="month" value={period} onChange={e => onPeriod(e.target.value)}
          className="bg-transparent text-xs focus:outline-none" style={{ color: 'var(--text)' }} />
      </div>
      <button onClick={onRefresh} className="p-2.5 rounded-xl" style={card} title="Actualizar datos">
        <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} style={{ color: 'var(--text-muted)' }} />
      </button>
    </div>
  )
}

function usePanelData() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [period, setPeriod] = useState<string>(currentMonth())
  const [fromDate, setFromDate] = useState<string>(() => monthRange(currentMonth()).from)
  const [toDate, setToDate]   = useState<string>(() => monthRange(currentMonth()).to)

  // Al cambiar mes: actualiza rango from/to automáticamente (igual que cobranza)
  const handlePeriodChange = useCallback((ym: string) => {
    setPeriod(ym)
    const { from, to } = monthRange(ym)
    setFromDate(from)
    setToDate(to)
  }, [])

  const fetch = useCallback((silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true)
    getPanelAnalistaStats({ date_from: fromDate, date_to: toDate })
      .then(setData).catch(() => {}).finally(() => { setLoading(false); setRefreshing(false) })
  }, [fromDate, toDate])

  useEffect(() => { fetch() }, [fetch])

  return { data, loading, refreshing, period, handlePeriodChange, fromDate, setFromDate, toDate, setToDate, fetch }
}


// ─── Tabla de leads reutilizable para modales ────────────────────────────────
function ModalLeadTable({ rows }: { rows: any[] }) {
  const { q, setQ, filtered } = useTableSearch(rows, ['contact_name','contact_phone','area','stage'])
  return (
    <>
      <TableSearchBar q={q} setQ={setQ} placeholder="Buscar cliente, teléfono, área o etapa..." count={filtered.length} total={rows.length} />
      <div className="overflow-x-auto" style={{ maxHeight: 380, overflowY: 'auto' }}>
        <table className="w-full text-xs">
          <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-1)', zIndex: 1 }}>
            <tr style={{ color: 'var(--text-muted)' }} className="text-left">
              <th className="font-semibold pb-2 pr-3">Cliente</th>
              <th className="font-semibold pb-2 pr-3">Teléfono</th>
              <th className="font-semibold pb-2 pr-3">Área</th>
              <th className="font-semibold pb-2 pr-3">Etapa actual</th>
              <th className="font-semibold pb-2 text-right">Honorarios</th>
              <th className="font-semibold pb-2 pl-3">Última actividad</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l: any) => (
              <tr key={l.lead_id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                <td className="py-1.5 pr-3 font-semibold" style={{ color: 'var(--text)' }}>{l.contact_name}</td>
                <td className="py-1.5 pr-3" style={{ color: 'var(--text-muted)' }}>{l.contact_phone || '—'}</td>
                <td className="py-1.5 pr-3" style={{ color: 'var(--text-muted)' }}>{l.area}</td>
                <td className="py-1.5 pr-3">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{
                    background: `${STAGE_COLOR_V[l.stage] ?? '#94a3b8'}18`,
                    color: STAGE_COLOR_V[l.stage] ?? '#94a3b8',
                  }}>{STAGE_LABEL_V[l.stage] ?? l.stage}</span>
                </td>
                <td className="py-1.5 text-right font-bold" style={{ color: l.honorarios > 0 ? '#f59e0b' : 'var(--text-muted)' }}>
                  {l.honorarios > 0 ? fmt(l.honorarios) : '—'}
                </td>
                <td className="py-1.5 pl-3" style={{ color: 'var(--text-muted)' }}>
                  {l.updated_at ? new Date(l.updated_at).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="py-4 text-center" style={{ color: 'var(--text-muted)' }}>Sin resultados para "{q}".</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ─── Dashboard Vendedores ─────────────────────────────────────────────────────
function DashboardVendedores() {
  const { data, loading, refreshing, period, handlePeriodChange, fromDate, setFromDate, toDate, setToDate, fetch } = usePanelData()
  const [modal, setModal] = useState<{ tipo: string; titulo: string; vendedorId?: number } | null>(null)

  const [qVend, setQVend] = useState('')

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--primary)' }} /></div>
  if (!data) return <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>Sin datos.</div>

  const vendedores: any[] = data.vendedores ?? []
  const res = data.resumen ?? {}
  const totHon   = res.total_honorarios_comprometidos ?? 0
  const totConf  = res.total_honorarios_confirmados ?? 0
  const totConf2 = vendedores.reduce((s,v)=>s+v.confirmados,0)
  const totLeads = res.total_leads_periodo ?? 0
  const PALETTE2 = ['#7c3aed','#10b981','#f59e0b','#ec4899','#8b5cf6','#06b6d4','#ef4444','#84cc16']
  const colorOf  = (i: number) => PALETTE2[i % PALETTE2.length]

  function ModalBodyV({ tipo, vendedorId }: { tipo: string; vendedorId?: number }) {
    const Th = ({ c, r }: any) => <th className={`font-semibold pb-2 ${r?'text-right':'text-left'}`} style={{ color:'var(--text-muted)' }}>{c}</th>
    const Td = ({ c, r, s }: any) => <td className={`py-1.5 ${r?'text-right':''}`} style={{ color:'var(--text)', ...s }}>{c}</td>
    const v = vendedorId ? vendedores.find(x=>x.id===vendedorId) : null

    if (tipo === 'vendedor' && v) {
      const rows: any[] = v.leads_detalle ?? []
      return <>
        <div className="p-3 rounded-xl mb-4 text-xs" style={{ background:'rgba(124,58,237,0.06)', border:'1px solid rgba(124,58,237,0.15)', color:'var(--text)', lineHeight:1.6 }}>
          <strong>{v.name}</strong> · {v.group}<br/>
          • <strong>{v.total_periodo} leads</strong> creados en período · <strong>{v.activos} activos</strong> en proceso actualmente<br/>
          • Pipeline: {v.en_reunion} en reunión · {v.altamente_interesado} alt. interesado · {v.cierre} cierre · {v.en_pago} en pago · <strong style={{color:'#10b981'}}>{v.confirmados} confirmados</strong><br/>
          • Honorarios comprometidos (en pago): <strong style={{color:'#f59e0b'}}>{fmt(v.honorarios_comprometidos)}</strong> · Honorarios confirmados: <strong style={{color:'#10b981'}}>{fmt(v.honorarios_confirmados)}</strong><br/>
          • Reuniones: {v.reuniones_asignadas} asignadas · {v.reuniones_exitosas} exitosas · {v.reuniones_no_show??0} no asistió · {v.reuniones_sin_exito??0} sin éxito<br/>
          • % Efectividad reunión: <strong>{pct(v.pct_efectividad_reunion)}</strong> (exitosas ÷ asignadas) · % Conversión leads: <strong>{pct(v.pct_conversion)}</strong> (confirmados ÷ leads período)
        </div>
        <p className="text-[10px] font-bold uppercase mb-2" style={{color:'var(--text-muted)'}}>Leads activos de {v.name} ({rows.length})</p>
        <ModalLeadTable rows={rows} />
      </>
    }
    if (tipo === 'confirmados') {
      const all = vendedores.flatMap(v => (v.leads_detalle??[]).filter((l:any)=>l.stage==='pagado_confirmado').map((l:any)=>({...l,vendedor:v.name})))
      return <>
        <div className="p-3 rounded-xl mb-4 text-xs" style={{ background:'rgba(16,185,129,0.06)', border:'1px solid rgba(16,185,129,0.15)', color:'var(--text)', lineHeight:1.6 }}>
          <strong>Leads con pago confirmado</strong> — verificados. Total: <strong>{all.length}</strong> · <strong style={{color:'#10b981'}}>{fmt(all.reduce((s,l)=>s+l.honorarios,0))}</strong> en honorarios confirmados.
        </div>
      <ModalLeadTable rows={all.map((l:any)=>({...l, lead_id: l.lead_id ?? String(l.contact_name)+String(l.vendedor)}))} />
      </>
    }
    if (tipo === 'en_pago') {
      const all = vendedores.flatMap(v => (v.leads_detalle??[]).filter((l:any)=>['pago_comprometido','pago_pendiente','pagado_reunion'].includes(l.stage)).map((l:any)=>({...l,vendedor:v.name})))
      return <>
        <div className="p-3 rounded-xl mb-4 text-xs" style={{ background:'rgba(245,158,11,0.06)', border:'1px solid rgba(245,158,11,0.15)', color:'var(--text)', lineHeight:1.6 }}>
          <strong>Leads en proceso de pago</strong> — Comprometido + Pendiente + Validando. Total: <strong>{all.length}</strong> · <strong style={{color:'#f59e0b'}}>{fmt(all.reduce((s,l)=>s+l.honorarios,0))}</strong> en honorarios comprometidos.
        </div>
      <ModalLeadTable rows={all.map((l:any)=>({...l, lead_id: l.lead_id ?? Math.random()}))} />
      </>
    }
    return null
  }

  const KPIS_V = [
    { tipo:'leads', label:'LEADS DEL PERÍODO', value:String(totLeads), sub:`creados ${data.period?.from} – ${data.period?.to}`, icon:Users, color:'#7c3aed', bg:'rgba(124,58,237,0.10)', desc:'Total de leads registrados por vendedores en el rango' },
    { tipo:'en_pago', label:'HONORARIOS COMPROMETIDOS', value:fmt(totHon), sub:`${vendedores.reduce((s,v)=>s+v.en_pago,0)} leads en proceso de pago`, icon:DollarSign, color:'#f59e0b', bg:'rgba(245,158,11,0.10)', desc:'Honorarios de leads en pago (Comprometido+Pendiente+Validando) — click para ver el listado' },
    { tipo:'confirmados', label:'HONORARIOS CONFIRMADOS', value:fmt(totConf), sub:`${totConf2} leads con pago verificado`, icon:CheckSquare, color:'#10b981', bg:'rgba(16,185,129,0.10)', desc:'Honorarios de leads con pago confirmado por el verificador — click para ver el listado' },
    { tipo:'reuniones', label:'REUNIONES DEL PERÍODO', value:String(vendedores.reduce((s,v)=>s+v.reuniones_asignadas,0)), sub:`${vendedores.reduce((s,v)=>s+v.reuniones_exitosas,0)} exitosas · ${vendedores.reduce((s,v)=>s+(v.reuniones_no_show??0),0)} no asistieron`, icon:CalendarCheck, color:'#8b5cf6', bg:'rgba(139,92,246,0.10)', desc:'Reuniones asignadas a vendedores en el período' },
    { tipo:'efectividad', label:'% EFECTIVIDAD GLOBAL', value:(()=>{ const r=vendedores.reduce((s,v)=>s+v.reuniones_asignadas,0); const e=vendedores.reduce((s,v)=>s+v.reuniones_exitosas,0); return pct(r>0?e/r*100:0) })(), sub:'exitosas ÷ reuniones asignadas', icon:TrendingUp, color:'#10b981', bg:'rgba(16,185,129,0.10)', desc:'% de reuniones que terminaron en éxito — mide calidad de cierre' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 style={{ ...sectionTitle, fontSize: 22 }}>Dashboard Vendedores</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{data.period?.from} al {data.period?.to} · solo rol Vendedor · datos reales en tiempo real</p>
          <p className="flex items-center gap-1 mt-1" style={helpText}><MousePointerClick size={12} /> Click en cualquier tarjeta o fila para ver el detalle completo con todos los clientes</p>
        </div>
        <PeriodControls period={period} fromDate={fromDate} toDate={toDate} refreshing={refreshing}
          onPeriod={handlePeriodChange} onFrom={setFromDate} onTo={setToDate} onRefresh={() => fetch(true)} />
      </div>

      {/* KPIs clickeables */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {KPIS_V.map(k => {
          const Icon = k.icon
          const clickable = ['en_pago','confirmados'].includes(k.tipo)
          return (
            <button key={k.label} className="p-4 text-left transition-all hover:-translate-y-0.5" style={{ ...card, cursor: clickable ? 'pointer' : 'default' }}
              onClick={() => clickable ? setModal({ tipo: k.tipo, titulo: k.label }) : undefined} title={k.desc}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: k.bg }}>
                  <Icon size={15} style={{ color: k.color }} />
                </div>
                <span className="text-[10px] font-bold uppercase leading-tight" style={{ color: 'var(--text-muted)' }}>{k.label}</span>
              </div>
              <p className="text-2xl font-black leading-none" style={{ color: 'var(--text)', fontFamily: '"Public Sans",sans-serif' }}>{k.value}</p>
              <p className="text-[11px] mt-1 font-semibold" style={{ color: k.color }}>{k.sub}</p>
              <p className="mt-1.5" style={helpText}>{k.desc}</p>
            </button>
          )
        })}
      </div>

      {/* Tabla comparativa */}
      <div className="p-5" style={card}>
        <h3 style={sectionTitle}>Comparativo por Vendedor</h3>
        <p className="mb-3 mt-1" style={helpText}>
          Activos = leads en proceso · En pago = comprometido+pendiente+validando · % Conv. = confirmados ÷ leads período · % Efect. = exitosas ÷ reuniones asignadas · Click en fila para ver todos los leads de ese vendedor.
        </p>
        {(() => {
          const filt = qVend ? vendedores.filter(v => [v.name,v.group].some(s=>String(s??'').toLowerCase().includes(qVend.toLowerCase()))) : vendedores
          return <>
            <TableSearchBar q={qVend} setQ={setQVend} placeholder="Buscar vendedor o grupo..." count={filt.length} total={vendedores.length} />
            <div className="overflow-x-auto" style={{ maxHeight: 400, overflowY: 'auto' }}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ color: 'var(--text-muted)' }} className="text-left">
                <th className="font-semibold pb-2">Vendedor</th>
                <th className="font-semibold pb-2">Grupo</th>
                <th className="font-semibold pb-2 text-right">Leads período</th>
                <th className="font-semibold pb-2 text-right">Activos</th>
                <th className="font-semibold pb-2 text-right">Reunión</th>
                <th className="font-semibold pb-2 text-right">Alt.Int.</th>
                <th className="font-semibold pb-2 text-right">Cierre</th>
                <th className="font-semibold pb-2 text-right">En pago</th>
                <th className="font-semibold pb-2 text-right">Confirmados</th>
                <th className="font-semibold pb-2 text-right">Hon.Comprometido</th>
                <th className="font-semibold pb-2 text-right">Hon.Confirmado</th>
                <th className="font-semibold pb-2 text-right">Reu.ag.</th>
                <th className="font-semibold pb-2 text-right">Exitosas</th>
                <th className="font-semibold pb-2 text-right">No asistió</th>
                <th className="font-semibold pb-2 text-right">% Efect.</th>
                <th className="font-semibold pb-2 text-right">% Conv.</th>
              </tr>
            </thead>
            <tbody>
              {filt.map((v: any, i: number) => (
                <tr key={v.id} className="border-t transition-colors hover:bg-slate-50" style={{ borderColor: 'var(--border)', color: 'var(--text)', cursor: 'pointer' }}
                  onClick={() => setModal({ tipo: 'vendedor', titulo: `Leads de ${v.name}`, vendedorId: v.id })}>
                  <td className="py-2 font-semibold">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: colorOf(vendedores.indexOf(v)) }} />{v.name}
                    </span>
                  </td>
                  <td className="py-2" style={{ color: 'var(--text-muted)' }}>{v.group}</td>
                  <td className="py-2 text-right">{v.total_periodo}</td>
                  <td className="py-2 text-right">{v.activos}</td>
                  <td className="py-2 text-right" style={{color:'#7c3aed'}}>{v.en_reunion}</td>
                  <td className="py-2 text-right" style={{color:'#8b5cf6'}}>{v.altamente_interesado}</td>
                  <td className="py-2 text-right" style={{color:'#f59e0b'}}>{v.cierre}</td>
                  <td className="py-2 text-right font-bold" style={{color:'#10b981'}}>{v.en_pago}</td>
                  <td className="py-2 text-right font-bold" style={{color:'#059669'}}>{v.confirmados}</td>
                  <td className="py-2 text-right font-bold" style={{color:'#f59e0b'}}>{fmt(v.honorarios_comprometidos)}</td>
                  <td className="py-2 text-right font-bold" style={{color:'#10b981'}}>{fmt(v.honorarios_confirmados)}</td>
                  <td className="py-2 text-right">{v.reuniones_asignadas}</td>
                  <td className="py-2 text-right" style={{color:'#10b981'}}>{v.reuniones_exitosas}</td>
                  <td className="py-2 text-right" style={{color:'#ef4444'}}>{v.reuniones_no_show??0}</td>
                  <td className="py-2 text-right font-bold" style={{color:v.pct_efectividad_reunion>=50?'#10b981':v.pct_efectividad_reunion>=25?'#f59e0b':'#94a3b8'}}>{pct(v.pct_efectividad_reunion)}</td>
                  <td className="py-2 text-right font-bold" style={{color:v.pct_conversion>=20?'#10b981':v.pct_conversion>=10?'#f59e0b':'#94a3b8'}}>{pct(v.pct_conversion)}</td>
                </tr>
              ))}
              {filt.length === 0 && <tr><td colSpan={16} className="py-4 text-center" style={{color:'var(--text-muted)'}}>{qVend ? `Sin resultados para "${qVend}"` : 'Sin vendedores activos.'}</td></tr>}
              {vendedores.length > 1 && (
                <tr className="border-t-2 font-black" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                  <td className="py-2" colSpan={2}>TOTAL GENERAL</td>
                  <td className="py-2 text-right">{vendedores.reduce((s,v)=>s+v.total_periodo,0)}</td>
                  <td className="py-2 text-right">{vendedores.reduce((s,v)=>s+v.activos,0)}</td>
                  <td className="py-2 text-right" style={{color:'#7c3aed'}}>{vendedores.reduce((s,v)=>s+v.en_reunion,0)}</td>
                  <td className="py-2 text-right" style={{color:'#8b5cf6'}}>{vendedores.reduce((s,v)=>s+v.altamente_interesado,0)}</td>
                  <td className="py-2 text-right" style={{color:'#f59e0b'}}>{vendedores.reduce((s,v)=>s+v.cierre,0)}</td>
                  <td className="py-2 text-right" style={{color:'#10b981'}}>{vendedores.reduce((s,v)=>s+v.en_pago,0)}</td>
                  <td className="py-2 text-right" style={{color:'#059669'}}>{vendedores.reduce((s,v)=>s+v.confirmados,0)}</td>
                  <td className="py-2 text-right" style={{color:'#f59e0b'}}>{fmt(vendedores.reduce((s,v)=>s+v.honorarios_comprometidos,0))}</td>
                  <td className="py-2 text-right" style={{color:'#10b981'}}>{fmt(vendedores.reduce((s,v)=>s+v.honorarios_confirmados,0))}</td>
                  <td className="py-2 text-right">{vendedores.reduce((s,v)=>s+v.reuniones_asignadas,0)}</td>
                  <td className="py-2 text-right" style={{color:'#10b981'}}>{vendedores.reduce((s,v)=>s+v.reuniones_exitosas,0)}</td>
                  <td className="py-2 text-right" style={{color:'#ef4444'}}>{vendedores.reduce((s,v)=>s+(v.reuniones_no_show??0),0)}</td>
                  <td className="py-2 text-right" colSpan={2}>—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
          </>
        })()}
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="p-5 lg:col-span-2" style={card}>
          <h3 style={sectionTitle}>Pipeline de Leads por Vendedor</h3>
          <p className="mb-3 mt-1" style={helpText}>Distribución actual de leads activos en cada etapa por vendedor</p>
          <div style={{ width: '100%', height: Math.max(220, vendedores.length * 42) }}>
            <ResponsiveContainer>
              <BarChart data={vendedores} layout="vertical" margin={{ left: 10, right: 20 }}>
                <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--text)' }} width={100} />
                <Tooltip />
                <Bar dataKey="en_reunion" name="Reunión" fill="#7c3aed" stackId="a" />
                <Bar dataKey="altamente_interesado" name="Alt. Interesado" fill="#8b5cf6" stackId="a" />
                <Bar dataKey="cierre" name="Cierre" fill="#f59e0b" stackId="a" />
                <Bar dataKey="en_pago" name="En pago" fill="#10b981" stackId="a" />
                <Bar dataKey="confirmados" name="Confirmados" fill="#059669" stackId="a" radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-3 mt-2">
            {[{label:'Reunión',color:'#7c3aed'},{label:'Alt.Int.',color:'#8b5cf6'},{label:'Cierre',color:'#f59e0b'},{label:'En pago',color:'#10b981'},{label:'Confirmados',color:'#059669'}]
              .map(l=><span key={l.label} className="inline-flex items-center gap-1 text-[10px]" style={{color:'var(--text-muted)'}}><span className="w-2 h-2 rounded-full" style={{background:l.color}}/>{l.label}</span>)}
          </div>
        </div>
        <div className="p-5" style={card}>
          <h3 style={sectionTitle}>Honorarios por Vendedor</h3>
          <p className="mb-2 mt-1" style={helpText}>Comprometido (barras) — click en nombre para ver los leads</p>
          <div style={{ width:'100%', height:180 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={vendedores.map(v=>({name:v.name,value:v.honorarios_comprometidos}))} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={2} label={false} style={{cursor:'pointer'}}
                  onClick={(e:any)=>{ const v=vendedores.find(x=>x.name===e?.name); if(v) setModal({tipo:'vendedor',titulo:`Leads de ${v.name}`,vendedorId:v.id}) }}>
                  {vendedores.map((_:any,i:number)=><Cell key={i} fill={colorOf(i)} />)}
                </Pie>
                <Tooltip formatter={(v:any)=>fmt(Number(v))} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5 mt-2">
            {vendedores.map((v,i)=>(
              <button key={v.id} className="flex items-center gap-1.5 text-xs w-full text-left rounded px-1 py-0.5 hover:bg-slate-50 transition-colors"
                onClick={()=>setModal({tipo:'vendedor',titulo:`Leads de ${v.name}`,vendedorId:v.id})}>
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background:colorOf(i)}} />
                <span className="flex-1 font-semibold truncate" style={{color:'var(--text)'}}>{v.name}</span>
                <span className="font-bold" style={{color:'#f59e0b'}}>{fmt(v.honorarios_comprometidos)}</span>
                <span className="text-[10px]" style={{color:'#10b981'}}>✓{fmt(v.honorarios_confirmados)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" style={{background:'var(--surface-4)',backdropFilter:'blur(2px)'}} onClick={()=>setModal(null)}>
          <div className="w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-2xl p-6" style={{background:'var(--surface-1)'}} onClick={e=>e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 style={{...sectionTitle,fontSize:16}}>{modal.titulo}</h2>
                <p className="text-xs mt-0.5" style={{color:'var(--text-muted)'}}>Período: {data.period?.from} al {data.period?.to}</p>
              </div>
              <button onClick={()=>setModal(null)} className="p-2 rounded-lg hover:bg-slate-100"><X size={16} style={{color:'var(--text-muted)'}}/></button>
            </div>
            <ModalBodyV tipo={modal.tipo} vendedorId={modal.vendedorId} />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Dashboard Agendadoras ────────────────────────────────────────────────────
function DashboardAgendadoras() {
  const { data, loading, refreshing, period, handlePeriodChange, fromDate, setFromDate, toDate, setToDate, fetch } = usePanelData()
  const [modal, setModal] = useState<{ tipo: string; titulo: string; agendadoraId?: number } | null>(null)
  const [qAg, setQAg] = useState('')

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--primary)' }} /></div>
  if (!data) return <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>Sin datos.</div>

  const agendadoras: any[] = data.agendadoras ?? []
  const PALETTE2 = ['#7c3aed','#10b981','#f59e0b','#ec4899','#8b5cf6','#06b6d4','#ef4444','#84cc16']
  const colorOf  = (i: number) => PALETTE2[i % PALETTE2.length]
  const totalReuniones = agendadoras.reduce((s,a)=>s+a.reuniones_agendadas,0)
  const totalExitosas  = agendadoras.reduce((s,a)=>s+a.reuniones_exitosas,0)
  const totalLeads     = agendadoras.reduce((s,a)=>s+a.leads_creados,0)
  const totalNoShow    = agendadoras.reduce((s,a)=>s+a.reuniones_no_show,0)
  const totalConv      = agendadoras.reduce((s,a)=>s+a.leads_convertidos,0)

  function ModalBodyA({ tipo, agendadoraId }: { tipo: string; agendadoraId?: number }) {
    const Th = ({ c, r }: any) => <th className={`font-semibold pb-2 ${r?'text-right':'text-left'}`} style={{color:'var(--text-muted)'}}>{c}</th>
    const Td = ({ c, r, s }: any) => <td className={`py-1.5 ${r?'text-right':''}`} style={{color:'var(--text)',...s}}>{c}</td>
    const a = agendadoraId ? agendadoras.find(x=>x.id===agendadoraId) : null

    if (tipo==='agendadora' && a) {
      const rows: any[] = a.leads_detalle ?? []
      const totalAsignados = a.leads_activos + a.leads_convertidos
      return <>
        <div className="p-3 rounded-xl mb-4 text-xs" style={{background:'rgba(124,58,237,0.06)',border:'1px solid rgba(124,58,237,0.15)',color:'var(--text)',lineHeight:1.6}}>
          <strong>{a.name}</strong> · {a.group}<br/>
          • Leads creados en período: <strong>{a.leads_creados}</strong> · Leads activos: <strong>{a.leads_activos}</strong> · Convertidos a pago: <strong style={{color:'#059669'}}>{a.leads_convertidos}</strong> · Total asignados (activos+pago): <strong>{totalAsignados}</strong><br/>
          • Reuniones agendadas: <strong>{a.reuniones_agendadas}</strong> → Exitosas: <strong style={{color:'#10b981'}}>{a.reuniones_exitosas}</strong> · Sin éxito: <span style={{color:'#f59e0b'}}>{a.reuniones_sin_exito}</span> · No asistió: <span style={{color:'#ef4444'}}>{a.reuniones_no_show}</span> · Pendientes: {a.reuniones_pendientes}<br/>
          • % Efectividad (exitosas ÷ agendadas): <strong style={{color:a.pct_efectividad>=50?'#10b981':a.pct_efectividad>=25?'#f59e0b':'#ef4444'}}>{pct(a.pct_efectividad)}</strong><br/>
          • % Conversión leads (convertidos ÷ total asignados): <strong style={{color:'#8b5cf6'}}>{pct(a.pct_conversion_leads)}</strong>
        </div>
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[{label:'Reu. agendadas',val:a.reuniones_agendadas,color:'#8b5cf6'},{label:'Exitosas',val:a.reuniones_exitosas,color:'#10b981'},{label:'No asistió',val:a.reuniones_no_show,color:'#ef4444'},{label:'Sin éxito',val:a.reuniones_sin_exito,color:'#f59e0b'}]
            .map(m=><div key={m.label} className="p-3 rounded-xl text-center" style={{background:'var(--surface-2)'}}><p className="text-[10px] font-semibold mb-1" style={{color:'var(--text-muted)'}}>{m.label}</p><p className="text-2xl font-black" style={{color:m.color}}>{m.val}</p></div>)}
        </div>
        <p className="text-[10px] font-bold uppercase mb-2" style={{color:'var(--text-muted)'}}>
          Leads asignados a {a.name} — activos y en proceso de pago ({rows.length})
        </p>
        <ModalLeadTable rows={rows} />
      </>
    }
    if (tipo==='global') {
      return <>
        <div className="p-3 rounded-xl mb-4 text-xs" style={{background:'rgba(124,58,237,0.06)',border:'1px solid rgba(124,58,237,0.15)',color:'var(--text)',lineHeight:1.6}}>
          <strong>Resumen global — todos los agendadores</strong><br/>
          • Leads creados en período: <strong>{totalLeads}</strong> · Convertidos a pago: <strong style={{color:'#059669'}}>{totalConv}</strong><br/>
          • Reuniones agendadas: <strong>{totalReuniones}</strong> → Exitosas: <strong style={{color:'#10b981'}}>{totalExitosas}</strong> · No asistió: <strong style={{color:'#ef4444'}}>{totalNoShow}</strong><br/>
          • % Efectividad: <strong>{pct(totalReuniones>0?totalExitosas/totalReuniones*100:0)}</strong><br/>
          Click en una fila para ver el detalle completo de ese agendador/a.
        </div>
        {(() => {
          const filtA = qAg ? agendadoras.filter(a => [a.name,a.group].some((s:any)=>String(s??'').toLowerCase().includes(qAg.toLowerCase()))) : agendadoras
          return <>
            <TableSearchBar q={qAg} setQ={setQAg} placeholder="Buscar agendador/a o grupo..." count={filtA.length} total={agendadoras.length} />
            <div className="overflow-x-auto" style={{ maxHeight: 400, overflowY: 'auto' }}>
              <table className="w-full text-xs">
                <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-1)', zIndex: 1 }}><tr>
                  <Th c="Agendador/a" /><Th c="Grupo" /><Th c="Leads creados" r /><Th c="Activos" r /><Th c="Conv. a pago" r /><Th c="Reu. agendadas" r /><Th c="Exitosas" r /><Th c="No asistió" r /><Th c="Sin éxito" r /><Th c="Pendientes" r /><Th c="% Efectividad" r /><Th c="% Conv. leads" r />
                </tr></thead>
                <tbody>
                  {filtA.map((a: any,i: number)=>(
                <tr key={a.id} className="border-t hover:bg-slate-50 transition-colors" style={{borderColor:'var(--border)',cursor:'pointer'}}
                  onClick={()=>setModal({tipo:'agendadora',titulo:`Detalle de ${a.name}`,agendadoraId:a.id})}>
                  <Td c={<span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{background:colorOf(i)}}/>{a.name}</span>} s={{fontWeight:600}} />
                  <Td c={a.group} s={{color:'var(--text-muted)'}} />
                  <Td c={a.leads_creados} r /><Td c={a.leads_activos} r />
                  <Td c={a.leads_convertidos} r s={{color:'#059669',fontWeight:700}} />
                  <Td c={a.reuniones_agendadas} r s={{fontWeight:700}} />
                  <Td c={a.reuniones_exitosas} r s={{color:'#10b981',fontWeight:700}} />
                  <Td c={a.reuniones_no_show} r s={{color:'#ef4444'}} />
                  <Td c={a.reuniones_sin_exito} r s={{color:'#f59e0b'}} />
                  <Td c={a.reuniones_pendientes} r />
                  <Td c={pct(a.pct_efectividad)} r s={{fontWeight:700,color:a.pct_efectividad>=50?'#10b981':a.pct_efectividad>=25?'#f59e0b':'#ef4444'}} />
                  <Td c={pct(a.pct_conversion_leads)} r s={{fontWeight:700,color:'#8b5cf6'}} />
                </tr>
              ))}
              {filtA.length === 0 && <tr><td colSpan={13} className="py-4 text-center" style={{color:'var(--text-muted)'}}>{qAg ? `Sin resultados para "${qAg}"` : 'Sin agendadores.'}</td></tr>}
              {agendadoras.length > 1 && (
                <tr className="border-t-2 font-black" style={{borderColor:'var(--border)',color:'var(--text)'}}>
                  <td className="py-2" colSpan={2}>TOTAL GENERAL</td>
                  <Td c={agendadoras.reduce((s,a)=>s+a.leads_creados,0)} r />
                  <Td c={agendadoras.reduce((s,a)=>s+a.leads_activos,0)} r />
                  <Td c={agendadoras.reduce((s,a)=>s+a.leads_convertidos,0)} r s={{color:'#059669'}} />
                  <Td c={agendadoras.reduce((s,a)=>s+a.reuniones_agendadas,0)} r />
                  <Td c={agendadoras.reduce((s,a)=>s+a.reuniones_exitosas,0)} r s={{color:'#10b981'}} />
                  <Td c={agendadoras.reduce((s,a)=>s+a.reuniones_no_show,0)} r s={{color:'#ef4444'}} />
                  <Td c={agendadoras.reduce((s,a)=>s+a.reuniones_sin_exito,0)} r s={{color:'#f59e0b'}} />
                  <Td c={agendadoras.reduce((s,a)=>s+a.reuniones_pendientes,0)} r />
                  <td className="py-2 text-right" colSpan={2}>—</td>
                </tr>
              )}
                </tbody>
              </table>
            </div>
          </>
        })()}
      </>
    }
    return null
  }

  const KPIS_A = [
    { tipo:'global', label:'LEADS CREADOS EN PERÍODO', value:String(totalLeads), sub:'por todos los agendadores', icon:Users, color:'#7c3aed', bg:'rgba(124,58,237,0.10)', desc:'Leads nuevos registrados en el sistema por agendadores en el período' },
    { tipo:'global', label:'REUNIONES AGENDADAS', value:String(totalReuniones), sub:`${agendadoras.reduce((s,a)=>s+a.reuniones_pendientes,0)} pendientes de resultado`, icon:CalendarCheck, color:'#8b5cf6', bg:'rgba(139,92,246,0.10)', desc:'Total de reuniones creadas y asignadas por agendadores en el período' },
    { tipo:'global', label:'REUNIONES EXITOSAS', value:String(totalExitosas), sub:`${totalNoShow} no asistió · ${agendadoras.reduce((s,a)=>s+a.reuniones_sin_exito,0)} sin éxito`, icon:ThumbsUp, color:'#10b981', bg:'rgba(16,185,129,0.10)', desc:'Reuniones donde el cliente avanzó (Alt.Interesado o pagó en reunión)' },
    { tipo:'global', label:'% EFECTIVIDAD GLOBAL', value:pct(totalReuniones>0?totalExitosas/totalReuniones*100:0), sub:'exitosas ÷ agendadas', icon:Target, color:'#f59e0b', bg:'rgba(245,158,11,0.10)', desc:'% de reuniones exitosas sobre el total agendadas — mide calidad del agendamiento' },
    { tipo:'global', label:'LEADS CONVERTIDOS A PAGO', value:String(totalConv), sub:'en etapa de pago o confirmados', icon:Award, color:'#059669', bg:'rgba(5,150,105,0.10)', desc:'Leads que alcanzaron alguna etapa de pago — resultado final del trabajo del agendador' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 style={{ ...sectionTitle, fontSize: 22 }}>Dashboard Agendadores</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{data.period?.from} al {data.period?.to} · rendimiento real de agendamiento</p>
          <p className="flex items-center gap-1 mt-1" style={helpText}><MousePointerClick size={12} /> Click en cualquier tarjeta o fila para ver el detalle completo de ese agendador/a</p>
        </div>
        <PeriodControls period={period} fromDate={fromDate} toDate={toDate} refreshing={refreshing}
          onPeriod={handlePeriodChange} onFrom={setFromDate} onTo={setToDate} onRefresh={() => fetch(true)} />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {KPIS_A.map(k => {
          const Icon = k.icon
          return (
            <button key={k.label} className="p-4 text-left transition-all hover:-translate-y-0.5" style={{ ...card, cursor:'pointer' }}
              onClick={() => setModal({ tipo: k.tipo, titulo: k.label })} title={k.desc}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: k.bg }}>
                  <Icon size={15} style={{ color: k.color }} />
                </div>
                <span className="text-[10px] font-bold uppercase leading-tight" style={{ color: 'var(--text-muted)' }}>{k.label}</span>
              </div>
              <p className="text-2xl font-black leading-none" style={{ color: 'var(--text)', fontFamily: '"Public Sans",sans-serif' }}>{k.value}</p>
              <p className="text-[11px] mt-1 font-semibold" style={{ color: k.color }}>{k.sub}</p>
              <p className="mt-1.5" style={helpText}>{k.desc}</p>
            </button>
          )
        })}
      </div>

      {/* Tabla comparativa */}
      <div className="p-5" style={card}>
        <h3 style={sectionTitle}>Comparativo por Agendador/a</h3>
        <p className="mb-3 mt-1" style={helpText}>Efectividad = reuniones exitosas ÷ agendadas · Conv.leads = convertidos a pago ÷ leads activos · Click en fila para ver detalle completo del agendador/a.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ color: 'var(--text-muted)' }} className="text-left">
                <th className="font-semibold pb-2">Agendador/a</th>
                <th className="font-semibold pb-2">Grupo</th>
                <th className="font-semibold pb-2 text-right">Leads creados</th>
                <th className="font-semibold pb-2 text-right">Leads activos</th>
                <th className="font-semibold pb-2 text-right">Conv. a pago</th>
                <th className="font-semibold pb-2 text-right">Reu. agendadas</th>
                <th className="font-semibold pb-2 text-right">Exitosas</th>
                <th className="font-semibold pb-2 text-right">No asistió</th>
                <th className="font-semibold pb-2 text-right">Sin éxito</th>
                <th className="font-semibold pb-2 text-right">Pendientes</th>
                <th className="font-semibold pb-2 text-right">% Asistencia</th>
                <th className="font-semibold pb-2 text-right">% Efectividad</th>
                <th className="font-semibold pb-2 text-right">% Conv. leads</th>
              </tr>
            </thead>
            <tbody>
              {agendadoras.map((a, i) => (
                <tr key={a.id} className="border-t transition-colors hover:bg-slate-50" style={{ borderColor: 'var(--border)', color: 'var(--text)', cursor:'pointer' }}
                  onClick={() => setModal({ tipo: 'agendadora', titulo: `Detalle de ${a.name}`, agendadoraId: a.id })}>
                  <td className="py-2 font-semibold">
                    <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: colorOf(i) }} />{a.name}</span>
                  </td>
                  <td className="py-2" style={{ color: 'var(--text-muted)' }}>{a.group}</td>
                  <td className="py-2 text-right">{a.leads_creados}</td>
                  <td className="py-2 text-right">{a.leads_activos}</td>
                  <td className="py-2 text-right font-bold" style={{color:'#059669'}}>{a.leads_convertidos}</td>
                  <td className="py-2 text-right font-bold">{a.reuniones_agendadas}</td>
                  <td className="py-2 text-right font-bold" style={{color:'#10b981'}}>{a.reuniones_exitosas}</td>
                  <td className="py-2 text-right" style={{color:'#ef4444'}}>{a.reuniones_no_show}</td>
                  <td className="py-2 text-right" style={{color:'#f59e0b'}}>{a.reuniones_sin_exito}</td>
                  <td className="py-2 text-right">{a.reuniones_pendientes}</td>
                  <td className="py-2 text-right font-bold" style={{color:a.pct_efectividad>=50?'#10b981':a.pct_efectividad>=25?'#f59e0b':'#ef4444'}}>{pct(a.pct_efectividad)}</td>
                  <td className="py-2 text-right font-bold" style={{color:'#8b5cf6'}}>{pct(a.pct_conversion_leads)}</td>
                </tr>
              ))}
              {agendadoras.length === 0 && <tr><td colSpan={13} className="py-6 text-center" style={{color:'var(--text-muted)'}}>Sin agendadores activos.</td></tr>}
              {agendadoras.length > 1 && (
                <tr className="border-t-2 font-black" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                  <td className="py-2" colSpan={2}>TOTAL GENERAL</td>
                  <td className="py-2 text-right">{agendadoras.reduce((s,a)=>s+a.leads_creados,0)}</td>
                  <td className="py-2 text-right">{agendadoras.reduce((s,a)=>s+a.leads_activos,0)}</td>
                  <td className="py-2 text-right" style={{color:'#059669'}}>{agendadoras.reduce((s,a)=>s+a.leads_convertidos,0)}</td>
                  <td className="py-2 text-right">{agendadoras.reduce((s,a)=>s+a.reuniones_agendadas,0)}</td>
                  <td className="py-2 text-right" style={{color:'#10b981'}}>{agendadoras.reduce((s,a)=>s+a.reuniones_exitosas,0)}</td>
                  <td className="py-2 text-right" style={{color:'#ef4444'}}>{agendadoras.reduce((s,a)=>s+a.reuniones_no_show,0)}</td>
                  <td className="py-2 text-right" style={{color:'#f59e0b'}}>{agendadoras.reduce((s,a)=>s+a.reuniones_sin_exito,0)}</td>
                  <td className="py-2 text-right">{agendadoras.reduce((s,a)=>s+a.reuniones_pendientes,0)}</td>
                  <td className="py-2 text-right" colSpan={2}>—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="p-5 lg:col-span-2" style={card}>
          <h3 style={sectionTitle}>Resultados de Reuniones por Agendador/a</h3>
          <p className="mb-3 mt-1" style={helpText}>Desglose por resultado de cada reunión agendada en el período — click en barra para detalle</p>
          <div style={{ width: '100%', height: Math.max(220, agendadoras.length * 42) }}>
            <ResponsiveContainer>
              <BarChart data={agendadoras} layout="vertical" margin={{ left: 10, right: 20 }}
                onClick={(e:any) => { const a=agendadoras.find(x=>x.name===e?.activeLabel); if(a) setModal({tipo:'agendadora',titulo:`Detalle de ${a.name}`,agendadoraId:a.id}) }}>
                <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--text)' }} width={100} />
                <Tooltip />
                <Bar dataKey="reuniones_exitosas" name="Exitosas" fill="#10b981" stackId="r" />
                <Bar dataKey="reuniones_sin_exito" name="Sin éxito" fill="#f59e0b" stackId="r" />
                <Bar dataKey="reuniones_no_show" name="No asistió" fill="#ef4444" stackId="r" />
                <Bar dataKey="reuniones_pendientes" name="Pendientes" fill="#8b5cf6" stackId="r" radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-3 mt-2">
            {[{label:'Exitosas',color:'#10b981'},{label:'Sin éxito',color:'#f59e0b'},{label:'No asistió',color:'#ef4444'},{label:'Pendientes',color:'#8b5cf6'}]
              .map(l=><span key={l.label} className="inline-flex items-center gap-1 text-[10px]" style={{color:'var(--text-muted)'}}><span className="w-2 h-2 rounded-full" style={{background:l.color}}/>{l.label}</span>)}
          </div>
        </div>
        <div className="p-5" style={card}>
          <h3 style={sectionTitle}>Ranking de Efectividad</h3>
          <p className="mb-3 mt-1" style={helpText}>Exitosas ÷ agendadas · click para detalle</p>
          <div className="space-y-2.5">
            {[...agendadoras].filter(a=>a.reuniones_agendadas>0).sort((a,b)=>b.pct_efectividad-a.pct_efectividad).map((a,i)=>(
              <button key={a.id} className="flex items-center gap-2.5 w-full text-left rounded-lg px-1.5 py-1 hover:bg-slate-50 transition-colors"
                onClick={()=>setModal({tipo:'agendadora',titulo:`Detalle de ${a.name}`,agendadoraId:a.id})}>
                {i<3?<Medal size={16} style={{color:['#f59e0b','#94a3b8','#b45309'][i],flexShrink:0}}/>:<span className="w-4 text-center text-[11px] font-bold flex-shrink-0" style={{color:'var(--text-muted)'}}>{i+1}</span>}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-semibold truncate" style={{color:'var(--text)'}}>{a.name}</span>
                    <span className="text-xs font-bold ml-2" style={{color:a.pct_efectividad>=50?'#10b981':a.pct_efectividad>=25?'#f59e0b':'#ef4444'}}>{pct(a.pct_efectividad)}</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{background:'var(--surface-2)'}}>
                    <div className="h-full rounded-full" style={{width:`${Math.min(a.pct_efectividad,100)}%`,background:a.pct_efectividad>=50?'#10b981':a.pct_efectividad>=25?'#f59e0b':'#ef4444'}}/>
                  </div>
                  <p className="text-[10px] mt-0.5" style={{color:'var(--text-muted)'}}>{a.reuniones_exitosas} exit. / {a.reuniones_agendadas} ag. · {a.leads_creados} leads</p>
                </div>
              </button>
            ))}
            {agendadoras.filter(a=>a.reuniones_agendadas>0).length===0 && <p className="text-xs py-4" style={{color:'var(--text-muted)'}}>Sin reuniones en el período.</p>}
          </div>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" style={{background:'var(--surface-4)',backdropFilter:'blur(2px)'}} onClick={()=>setModal(null)}>
          <div className="w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-2xl p-6" style={{background:'var(--surface-1)'}} onClick={e=>e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 style={{...sectionTitle,fontSize:16}}>{modal.titulo}</h2>
                <p className="text-xs mt-0.5" style={{color:'var(--text-muted)'}}>Período: {data.period?.from} al {data.period?.to}</p>
              </div>
              <button onClick={()=>setModal(null)} className="p-2 rounded-lg hover:bg-slate-100"><X size={16} style={{color:'var(--text-muted)'}}/></button>
            </div>
            <ModalBodyA tipo={modal.tipo} agendadoraId={modal.agendadoraId} />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main wrapper con tabs ────────────────────────────────────────────────────
export default function AnalistaDashboard() {
  const [activeTab, setActiveTab] = useState<'cobranza' | 'vendedores' | 'agendadores'>('cobranza')

  return (
    <div className="space-y-4">
      {/* Tab navbar */}
      <div className="flex items-center gap-1 p-1 rounded-xl w-fit" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
        {([
          { key: 'cobranza',    label: 'Cartera de Cobranza' },
          { key: 'vendedores',  label: 'Dashboard Vendedores' },
          { key: 'agendadores', label: 'Dashboard Agendadores' },
        ] as const).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{
              background: activeTab === tab.key ? 'var(--primary)' : 'transparent',
              color: activeTab === tab.key ? '#ffffff' : 'var(--text-muted)',
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'cobranza'    && <CobranzaDashboard />}
      {activeTab === 'vendedores'  && <DashboardVendedores />}
      {activeTab === 'agendadores' && <DashboardAgendadoras />}
    </div>
  )
}

// ─── Dashboard cobranza (código original renombrado) ─────────────────────────
function CobranzaDashboard() {
  const [data, setData] = useState<any>(null)
  const [det, setDet] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [period, setPeriod] = useState<string>(currentMonth())
  const [fromDate, setFromDate] = useState<string>(() => monthRange(currentMonth()).from)
  const [toDate, setToDate] = useState<string>(() => monthRange(currentMonth()).to)
  const [modal, setModal] = useState<ModalCtx | null>(null)

  const fetchData = useCallback((from: string, to: string, silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true)
    Promise.all([getAnalistaCarteras(from, to), getAnalistaCarterasDetalle(from, to)])
      .then(([d, dd]) => { setData(d); setDet(dd) })
      .catch(() => {})
      .finally(() => { setLoading(false); setRefreshing(false) })
  }, [])

  useEffect(() => { fetchData(fromDate, toDate) }, [fetchData, fromDate, toDate])
  useRealtime(['cobrador_sync', 'lead_update'], () => fetchData(fromDate, toDate, true))

  const handlePeriodChange = (ym: string) => {
    setPeriod(ym)
    const { from, to } = monthRange(ym)
    setFromDate(from); setToDate(to)
  }

  const colorByName = useMemo(() => {
    const byName: Record<string, string> = {}
    const ranked = [...(data?.comparativo ?? [])].sort((a: any, b: any) => b.cartera - a.cartera)
    ranked.forEach((r: any, i: number) => { byName[r.nombre] = PALETTE[i % PALETTE.length] })
    return byName
  }, [data])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--primary)' }} />
    </div>
  )
  if (!data) return <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>Sin datos de carteras de cobradores.</div>

  const k = data.kpis ?? {}
  const comparativo: any[] = data.comparativo ?? []
  const montoPorEjec: any[] = data.montoPorEjecutivo ?? []
  const ranking: any[] = data.ranking ?? []
  const aging: any[] = data.aging ?? []
  const promesas = data.promesas ?? { total: 0, cumplidas: 0, incumplidas: 0 }
  const series: any[] = data.recaudacionDiariaPorEjecutivo?.series ?? []
  const clientes: any[] = det?.clientes ?? []
  const cuotas: any[] = det?.cuotas ?? []

  const totCartera = comparativo.reduce((s, r) => s + (r.cartera ?? 0), 0)
  const totClientes = comparativo.reduce((s, r) => s + r.clientes, 0)
  const agingTotal = aging.reduce((s: number, a: any) => s + a.monto, 0)
  const rango = `${fmtDate(data.rangeStart)} al ${fmtDate(data.rangeEnd)}`

  const stacked = (data.recaudacionDiariaPorEjecutivo?.dias ?? []).map((dia: number, i: number) => {
    const row: any = { dia }
    for (const s of series) row[s.nombre] = s.data[i] ?? 0
    return row
  })

  // ── Tablas del modal según tipo ────────────────────────────────────────────
  function ModalBody({ ctx }: { ctx: ModalCtx }) {
    const Th = ({ children, right }: any) => <th className={`font-semibold pb-2 ${right ? 'text-right' : 'text-left'}`} style={{ color: 'var(--text-muted)' }}>{children}</th>
    const Td = ({ children, right, style }: any) => <td className={`py-1.5 ${right ? 'text-right' : ''}`} style={{ color: 'var(--text)', ...style }}>{children}</td>

    const TablaCuotas = ({ rows, conPago }: { rows: any[]; conPago?: boolean }) => {
      const { q, setQ, filtered } = useTableSearch(rows, ['cliente','cobrador','estado'])
      return <>
        <TableSearchBar q={q} setQ={setQ} placeholder="Buscar cliente o cobrador..." count={filtered.length} total={rows.length} />
        <div className="overflow-x-auto" style={{ maxHeight: 350, overflowY: 'auto' }}>
          <table className="w-full text-xs">
            <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-1)', zIndex: 1 }}><tr>
              <Th>Cliente</Th><Th>Cobrador</Th><Th right>N° Cuota</Th><Th right>Vencimiento</Th>
              <Th right>Monto</Th><Th>Estado</Th>{conPago && <Th right>Pagado el</Th>}{!conPago && <Th right>Días vencida</Th>}
            </tr></thead>
            <tbody>
              {filtered.map((c: any, i: number) => (
                <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <Td>{c.cliente}</Td><Td>{c.cobrador}</Td><Td right>{c.numeroCuota}</Td><Td right>{fmtDate(c.fechaVencimiento)}</Td>
                  <Td right style={{ fontWeight: 700 }}>{fmt(c.estado === 'PAGADA' ? c.montoPagado : c.montoCuota)}</Td>
                  <Td><span style={{ color: c.estado === 'PAGADA' ? '#10b981' : c.diasVencida > 0 ? '#ef4444' : '#f59e0b', fontWeight: 700 }}>
                    {c.estado === 'PAGADA' ? 'PAGADA' : c.diasVencida > 0 ? 'VENCIDA' : 'PENDIENTE'}</span></Td>
                  {conPago ? <Td right>{fmtDate(c.fechaPago)}</Td> : <Td right>{c.diasVencida > 0 ? `${c.diasVencida}d` : '—'}</Td>}
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={7} className="py-4 text-center" style={{ color: 'var(--text-muted)' }}>{q ? `Sin resultados para "${q}"` : 'Sin registros.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </>
    }

    const TablaClientes = ({ rows }: { rows: any[] }) => {
      const { q, setQ, filtered } = useTableSearch(rows, ['nombre','rut','cobrador','stage'])
      return <>
        <TableSearchBar q={q} setQ={setQ} placeholder="Buscar cliente, RUT o cobrador..." count={filtered.length} total={rows.length} />
        <div className="overflow-x-auto" style={{ maxHeight: 400, overflowY: 'auto' }}>
          <table className="w-full text-xs">
            <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-1)', zIndex: 1 }}><tr>
              <Th>Cliente</Th><Th>RUT</Th><Th>Cobrador</Th><Th>Etapa</Th><Th>Contactado</Th>
              <Th right>Deuda total</Th><Th right>Cobrado</Th><Th right>Pendiente</Th><Th right>Cuotas vencidas</Th>
            </tr></thead>
            <tbody>
              {filtered.map((c: any) => (
                <tr key={c.leadId} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <Td>{c.nombre}</Td><Td>{c.rut ?? '—'}</Td><Td>{c.cobrador}</Td>
                  <Td>{STAGE_LABEL[c.stage] ?? c.stage}</Td>
                  <Td>{c.isContactado ? `Sí (${fmtDate(c.contactadoAt?.slice(0, 10))})` : 'No'}</Td>
                  <Td right>{fmt(c.montoDeuda)}</Td>
                  <Td right style={{ color: '#10b981', fontWeight: 700 }}>{fmt(c.montoPagado)}</Td>
                  <Td right style={{ color: '#ef4444' }}>{fmt(c.pendiente)}</Td>
                  <Td right>{c.cuotasVencidas}</Td>
                </tr>
          ))}
              {filtered.length === 0 && <tr><td colSpan={9} className="py-4 text-center" style={{ color: 'var(--text-muted)' }}>{q ? `Sin resultados para "${q}"` : 'Sin clientes.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </>
    }

    const Formula = ({ children }: any) => (
      <div className="p-3 rounded-xl mb-4 text-xs" style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)', color: 'var(--text)', lineHeight: 1.6 }}>
        {children}
      </div>
    )

    const cuotasPeriodo = cuotas.filter(c => c.enPeriodo)
    const vencidasPeriodo = cuotasPeriodo.filter(c => c.estado === 'PENDIENTE' && c.diasVencida > 0)
    const liquidadasPeriodo = cuotasPeriodo.filter(c => c.estado === 'PAGADA')
    const pagosEnPeriodo = cuotas.filter(c => c.estado === 'PAGADA' && c.fechaPago && c.fechaPago >= data.rangeStart && c.fechaPago <= data.rangeEnd)

    switch (ctx.tipo) {
      case 'cuotas-periodo':
        return <>
          <Formula><strong>Cómo se calcula:</strong> se cuentan todas las cuotas de los contratos de los clientes en cartera cuya <strong>fecha de vencimiento</strong> cae entre el {rango}. Total: <strong>{cuotasPeriodo.length} cuotas</strong> por <strong>{fmt(cuotasPeriodo.reduce((s, c) => s + c.montoCuota, 0))}</strong> (monto esperado del período).</Formula>
          <TablaCuotas rows={cuotasPeriodo} />
        </>
      case 'cartera':
        return <>
          <Formula><strong>Cómo se calcula:</strong> suma de la <strong>deuda total</strong> de los {totClientes} clientes asignados a las carteras de los cobradores (dato sincronizado desde el sistema contable). Cartera total: <strong>{fmt(totCartera)}</strong>. Cobrado a la fecha: <strong>{fmt(comparativo.reduce((s, r) => s + r.cobrado, 0))}</strong>.</Formula>
          <TablaClientes rows={clientes} />
        </>
      case 'vencidas':
        return <>
          <Formula><strong>Cómo se calcula:</strong> cuotas del período ({rango}) que están <strong>PENDIENTES y su fecha de vencimiento ya pasó</strong>. Son {vencidasPeriodo.length} de {cuotasPeriodo.length} cuotas del período = <strong>{pct(k.pctVencidas)}</strong>. Saldo vencido del período: <strong>{fmt(vencidasPeriodo.reduce((s, c) => s + c.montoCuota - c.montoPagado, 0))}</strong>.</Formula>
          <TablaCuotas rows={vencidasPeriodo} />
        </>
      case 'liquidadas':
        return <>
          <Formula><strong>Cómo se calcula:</strong> cuotas del período ({rango}) que figuran <strong>PAGADAS</strong> en el sistema contable. Son {liquidadasPeriodo.length} de {cuotasPeriodo.length} = <strong>{pct(k.pctLiquidadas)}</strong>, por un monto liquidado de <strong>{fmt(liquidadasPeriodo.reduce((s, c) => s + c.montoPagado, 0))}</strong>.</Formula>
          <TablaCuotas rows={liquidadasPeriodo} conPago />
        </>
      case 'recuperacion':
        return <>
          <Formula><strong>Fórmula:</strong> % Recuperación = monto liquidado ÷ monto esperado del período.<br />
            = {fmt(k.totalRecuperado)} ÷ {fmt(k.montoEsperado)} = <strong>{pct(k.pctRecuperacion)}</strong><br />
            El monto esperado es la suma de todas las cuotas con vencimiento entre el {rango}; el liquidado, lo efectivamente pagado de esas cuotas.</Formula>
          <TablaCuotas rows={liquidadasPeriodo} conPago />
        </>
      case 'cobrador': {
        const r = comparativo.find(x => x.cobradorId === ctx.cobradorId)
        const cls = clientes.filter(c => c.cobradorId === ctx.cobradorId)
        if (!r) return null
        return <>
          <Formula>
            <strong>{r.nombre}</strong> — áreas: <span className="capitalize">{(r.areas || '—').toLowerCase()}</span><br />
            • <strong>Cartera {fmt(r.cartera)}</strong> = suma de deuda total de sus {r.clientes} clientes.<br />
            • <strong>Cobrado {fmt(r.cobrado)}</strong> = pagos acumulados de esos clientes → % recuperación de cartera = {pct(r.pctRecuperacion)}.<br />
            • <strong>{r.cuotas} cuotas del período</strong> por {fmt(r.montoEsperado)}; {r.vencidas} vencidas, {r.liquidadas} liquidadas por {fmt(r.montoLiquidado)}.<br />
            • <strong>Contactabilidad {pct(r.contactabilidad)}</strong> = {r.contactados} contactados ÷ {r.clientes} asignados.<br />
            • <strong>Efectividad {pct(r.efectividad)}</strong> = {r.pagados} pagados ÷ {r.clientes} asignados. Comprometidos hoy: {r.comprometidos}. Días con cobro en el período: {r.diasConCobro}.
          </Formula>
          <TablaClientes rows={cls} />
        </>
      }
      case 'dia': {
        const pagosDia = cuotas.filter(c => c.estado === 'PAGADA' && c.fechaPago === ctx.dia)
        return <>
          <Formula><strong>Pagos del {fmtDate(ctx.dia)}:</strong> cuotas con fecha de pago ese día, según el sistema contable. Total del día: <strong>{fmt(pagosDia.reduce((s, c) => s + c.montoPagado, 0))}</strong>.</Formula>
          <TablaCuotas rows={pagosDia} conPago />
        </>
      }
      case 'aging': {
        const b = ctx.bucket!
        const rows = cuotas.filter(c => c.estado === 'PENDIENTE' && c.diasVencida >= b.lo && c.diasVencida <= b.hi)
        return <>
          <Formula><strong>Aging «{b.rango}»:</strong> cuotas PENDIENTES cuya fecha de vencimiento pasó hace entre {b.lo} y {b.hi >= 1e9 ? 'más de 90' : b.hi} días. Saldo del tramo = suma de (monto cuota − pagado parcial) = <strong>{fmt(rows.reduce((s, c) => s + c.montoCuota - c.montoPagado, 0))}</strong>. Incluye toda la cartera, no solo el período seleccionado.</Formula>
          <TablaCuotas rows={rows} />
        </>
      }
      case 'comprometidos': {
        const rows = clientes.filter(c => c.stage === 'pago_comprometido')
        return <>
          <Formula><strong>Comprometidos pendientes:</strong> clientes que el cobrador movió a la etapa <strong>Pago Comprometido</strong> y aún no completan su pago. Son la gestión activa de cobro.</Formula>
          <TablaClientes rows={rows} />
        </>
      }
      case 'pagados': {
        const rows = clientes.filter(c => c.stage === 'pagado' || c.stage === 'historial')
        return <>
          <Formula><strong>Pagados:</strong> clientes cuyo saldo llegó a cero (etapa Pagado o ya archivados en Historial). El pago se confirma automáticamente desde el sistema contable.</Formula>
          <TablaClientes rows={rows} />
        </>
      }
      case 'contactados': {
        const rows = clientes.filter(c => c.isContactado)
        return <>
          <Formula><strong>Contactados:</strong> clientes marcados como contactados por su cobrador (botón «Contactado» del panel cobrador, que además queda registrado en el sistema contable). Contactabilidad = contactados ÷ asignados.</Formula>
          <TablaClientes rows={rows} />
        </>
      }
      case 'recaudacion': {
        return <>
          <Formula><strong>Recaudación del período:</strong> todos los pagos de cuotas con fecha de pago entre el {rango}, día por día y atribuidos al cobrador dueño de la cartera. Total: <strong>{fmt(pagosEnPeriodo.reduce((s, c) => s + c.montoPagado, 0))}</strong>. Haz click en una barra para ver los pagos de ese día.</Formula>
          <TablaCuotas rows={pagosEnPeriodo} conPago />
        </>
      }
      default:
        return null
    }
  }

  const abrir = (ctx: ModalCtx) => setModal(ctx)

  const KPIS = [
    { tipo: 'cuotas-periodo', label: 'TOTAL CUOTAS DEL PERÍODO', value: String(k.totalCuotas ?? 0), sub: `Esperado ${fmt(k.montoEsperado)}`, icon: Layers, color: 'var(--primary-tx)', bg: 'rgba(124,58,237,0.10)', desc: 'Cuotas que vencen en el rango de fechas elegido' },
    { tipo: 'cartera', label: 'CARTERA TOTAL', value: fmt(k.totalCartera), sub: `${totClientes} clientes asignados`, icon: DollarSign, color: '#10b981', bg: 'rgba(16,185,129,0.10)', desc: 'Deuda total de todos los clientes en cartera' },
    { tipo: 'vencidas', label: 'CUOTAS VENCIDAS', value: String(k.cuotasVencidas ?? 0), sub: `${pct(k.pctVencidas)} del período`, subColor: '#ef4444', icon: AlertCircle, color: '#ef4444', bg: 'rgba(239,68,68,0.10)', desc: 'Cuotas del período pendientes y atrasadas' },
    { tipo: 'liquidadas', label: 'CUOTAS LIQUIDADAS', value: String(k.cuotasLiquidadas ?? 0), sub: `${pct(k.pctLiquidadas)} del período`, subColor: '#7c3aed', icon: CheckSquare, color: 'var(--primary-tx)', bg: 'rgba(124,58,237,0.10)', desc: 'Cuotas del período ya pagadas' },
    { tipo: 'recuperacion', label: '% RECUPERACIÓN', value: pct(k.pctRecuperacion), sub: `${fmt(k.totalRecuperado)} recuperado`, subColor: '#10b981', icon: TrendingUp, color: '#10b981', bg: 'rgba(16,185,129,0.10)', desc: 'Monto liquidado ÷ monto esperado del período' },
  ]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 style={{ ...sectionTitle, fontSize: 22 }}>Distribución de Cartera de Cobranza</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {data.periodLabel} · datos reales de las carteras de cobradores y cuotas del sistema contable
          </p>
          <p className="flex items-center gap-1 mt-1" style={helpText}>
            <MousePointerClick size={12} /> Haz click en cualquier tarjeta, fila, barra o gráfico para ver el detalle y cómo se calculó.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs" style={card}>
            <Calendar size={13} style={{ color: 'var(--text-muted)' }} />
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="bg-transparent text-xs focus:outline-none w-28" style={{ color: 'var(--text)' }} />
            <span style={{ color: 'var(--text-muted)' }}>al</span>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="bg-transparent text-xs focus:outline-none w-28" style={{ color: 'var(--text)' }} />
          </div>
          <div className="flex items-center gap-1 px-2 py-2 rounded-xl text-[10px]" style={card}>
            <span style={{ color: 'var(--text-muted)' }}>Mes:</span>
            <input type="month" value={period} onChange={e => handlePeriodChange(e.target.value)}
              className="bg-transparent text-xs focus:outline-none" style={{ color: 'var(--text)' }} />
          </div>
          <button onClick={() => fetchData(fromDate, toDate, true)} className="p-2.5 rounded-xl" style={card} title="Actualizar">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
      </div>

      {/* ── Fila 1: KPIs clickeables ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {KPIS.map(kpi => {
          const Icon = kpi.icon
          return (
            <button key={kpi.label} className="p-4 text-left transition-all hover:-translate-y-0.5" style={{ ...card, ...clickable }}
              onClick={() => abrir({ tipo: kpi.tipo, titulo: kpi.label })}
              title={`${kpi.desc} — click para ver el detalle`}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: kpi.bg }}>
                  <Icon size={15} style={{ color: kpi.color }} />
                </div>
                <span className="text-[10px] font-bold leading-tight" style={{ color: 'var(--text-muted)' }}>{kpi.label}</span>
              </div>
              <p className="text-2xl font-black leading-none" style={{ color: 'var(--text)', fontFamily: '"Public Sans", sans-serif' }}>{kpi.value}</p>
              {kpi.sub && <p className="text-[11px] mt-1 font-semibold" style={{ color: (kpi as any).subColor ?? 'var(--text-muted)' }}>{kpi.sub}</p>}
              <p className="mt-1.5" style={helpText}>{kpi.desc}</p>
            </button>
          )
        })}
      </div>

      {/* ── Fila 2: comparativo + donut ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="p-5 lg:col-span-2" style={card}>
          <h3 style={sectionTitle}>Comparativo por Cartera de Cobrador</h3>
          <p className="mb-3 mt-1" style={helpText}>
            Cartera = deuda total de los clientes asignados · Cobrado = pagos acumulados · Vencidas y Liquidación corresponden a cuotas del período seleccionado.
            Click en una fila para abrir la cartera completa del cobrador con cada cliente y fórmula.
          </p>
          <div className="overflow-x-auto table-scroll table-scroll-light" style={{ maxHeight: 350, overflowY: 'auto' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: 'var(--text-muted)' }} className="text-left">
                  <th className="font-semibold pb-2">Cobrador</th>
                  <th className="font-semibold pb-2">Áreas</th>
                  <th className="font-semibold pb-2 text-right">Clientes</th>
                  <th className="font-semibold pb-2 text-right">Cartera</th>
                  <th className="font-semibold pb-2 text-right">Cobrado</th>
                  <th className="font-semibold pb-2 text-right">Pendiente</th>
                  <th className="font-semibold pb-2 text-right">Vencidas</th>
                  <th className="font-semibold pb-2 text-right">Liquidación</th>
                  <th className="font-semibold pb-2 text-right">% Recup.</th>
                </tr>
              </thead>
              <tbody>
                {comparativo.map(r => (
                  <tr key={r.cobradorId} className="border-t transition-colors hover:bg-slate-50" style={{ borderColor: 'var(--border)', color: 'var(--text)', ...clickable }}
                    onClick={() => abrir({ tipo: 'cobrador', titulo: `Cartera de ${r.nombre}`, cobradorId: r.cobradorId })}
                    title="Click para ver la cartera completa de este cobrador">
                    <td className="py-2 font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: colorByName[r.nombre] }} />
                        {r.nombre}
                      </span>
                    </td>
                    <td className="py-2 capitalize" style={{ color: 'var(--text-muted)' }}>{(r.areas || '—').toLowerCase()}</td>
                    <td className="py-2 text-right">{r.clientes}</td>
                    <td className="py-2 text-right">{fmt(r.cartera)}</td>
                    <td className="py-2 text-right" style={{ color: '#10b981', fontWeight: 700 }}>{fmt(r.cobrado)}</td>
                    <td className="py-2 text-right" style={{ color: '#ef4444' }}>{fmt(r.pendiente)}</td>
                    <td className="py-2 text-right">{r.vencidas}</td>
                    <td className="py-2 text-right">{fmt(r.montoLiquidado)}</td>
                    <td className="py-2 text-right font-bold">{pct(r.pctRecuperacion)}</td>
                  </tr>
                ))}
                <tr className="border-t-2" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                  <td className="py-2 font-black" colSpan={2}>TOTAL GENERAL</td>
                  <td className="py-2 text-right font-black">{totClientes}</td>
                  <td className="py-2 text-right font-black">{fmt(totCartera)}</td>
                  <td className="py-2 text-right font-black" style={{ color: '#10b981' }}>{fmt(comparativo.reduce((s, r) => s + r.cobrado, 0))}</td>
                  <td className="py-2 text-right font-black" style={{ color: '#ef4444' }}>{fmt(comparativo.reduce((s, r) => s + r.pendiente, 0))}</td>
                  <td className="py-2 text-right font-black">{comparativo.reduce((s, r) => s + r.vencidas, 0)}</td>
                  <td className="py-2 text-right font-black">{fmt(comparativo.reduce((s, r) => s + r.montoLiquidado, 0))}</td>
                  <td className="py-2 text-right font-black">{pct(totCartera ? comparativo.reduce((s, r) => s + r.cobrado, 0) / totCartera * 100 : 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="p-5" style={card}>
          <h3 style={sectionTitle}>Distribución de Cartera</h3>
          <p className="mb-2 mt-1" style={helpText}>Qué parte de la deuda total administra cada cobrador. Click en un segmento o nombre para abrir su cartera.</p>
          <div style={{ width: '100%', height: 180, position: 'relative' }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={montoPorEjec} dataKey="monto" nameKey="nombre" cx="50%" cy="50%" innerRadius={52} outerRadius={82} paddingAngle={2}
                  label={false} labelLine={false} style={clickable}
                  onClick={(e: any) => { const r = comparativo.find(x => x.nombre === e?.nombre); if (r) abrir({ tipo: 'cobrador', titulo: `Cartera de ${r.nombre}`, cobradorId: r.cobradorId }) }}>
                  {montoPorEjec.map((e, i) => <Cell key={e.nombre ?? i} fill={colorByName[e.nombre] ?? PALETTE[i % PALETTE.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => fmt(Number(v))} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <span className="text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>CARTERA</span>
              <span className="text-sm font-black" style={{ color: 'var(--text)' }}>{fmtK(totCartera)}</span>
            </div>
          </div>
          <div className="space-y-2 mt-3">
            {montoPorEjec.map((e, i) => {
              const epct = totCartera > 0 ? (e.monto / totCartera) * 100 : 0
              const r = comparativo.find(x => x.nombre === e.nombre)
              return (
                <button key={e.nombre ?? i} className="flex items-start gap-1.5 text-xs w-full text-left rounded-lg px-1.5 py-1 transition-colors hover:bg-slate-50" style={clickable}
                  onClick={() => r && abrir({ tipo: 'cobrador', titulo: `Cartera de ${r.nombre}`, cobradorId: r.cobradorId })}>
                  <span className="w-2.5 h-2.5 rounded-full mt-0.5 flex-shrink-0" style={{ background: colorByName[e.nombre] ?? PALETTE[i % PALETTE.length] }} />
                  <span className="font-semibold flex-1 truncate" style={{ color: 'var(--text)' }}>{e.nombre}</span>
                  <span className="text-right" style={{ color: 'var(--text-muted)' }}>{fmt(e.monto)} ({pct(epct)})</span>
                </button>
              )
            })}
            {montoPorEjec.length === 0 && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Sin carteras con deuda.</p>}
          </div>
        </div>
      </div>

      {/* ── Fila 3: recaudación diaria ── */}
      <div className="p-5" style={card}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 style={{ ...sectionTitle, ...clickable }} onClick={() => abrir({ tipo: 'recaudacion', titulo: `Recaudación del período` })} title="Click para ver todos los pagos del período">
            Recaudación Diaria por Cobrador — {data.periodLabel}
          </h3>
          <div className="flex flex-wrap gap-3">
            {series.map((s: any, i: number) => (
              <span key={s.nombre ?? i} className="inline-flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: colorByName[s.nombre] ?? PALETTE[i % PALETTE.length] }} />{s.nombre}
              </span>
            ))}
          </div>
        </div>
        <p className="mb-3 mt-1" style={helpText}>
          Pagos reales de cuotas registrados en el sistema contable, por día y por cobrador (color). Click en una barra para ver los pagos de ese día; click en el título para ver todos los del período.
        </p>
        <div style={{ width: '100%', height: 250 }}>
          <ResponsiveContainer>
            <BarChart data={stacked} onClick={(e: any) => {
              const dia = e?.activeLabel
              if (dia) {
                const fecha = `${data.rangeStart.slice(0, 8)}${String(dia).padStart(2, '0')}`
                abrir({ tipo: 'dia', titulo: `Pagos del día ${dia}`, dia: fecha })
              }
            }} style={clickable}>
              <XAxis dataKey="dia" tick={{ fontSize: 10, fill: '#94a3b8' }} interval={0} />
              <YAxis tickFormatter={fmtK} tick={{ fontSize: 10, fill: '#94a3b8' }} width={52} />
              <Tooltip formatter={(v: any) => fmt(Number(v))} labelFormatter={(l: any) => `Día ${l} — click para detalle`} />
              {series.map((s: any, i: number) => (
                <Bar key={s.nombre ?? i} dataKey={s.nombre} stackId="r" fill={colorByName[s.nombre] ?? PALETTE[i % PALETTE.length]}
                  radius={i === series.length - 1 ? [3, 3, 0, 0] : undefined} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Fila 4: gestión por cobrador ── */}
      <div className="p-5" style={card}>
        <h3 style={sectionTitle}>Gestión por Cobrador</h3>
        <p className="mb-3 mt-1" style={helpText}>
          Asignados = clientes en su cartera · Contactados = marcados «contactado» (click para ver quiénes) · Contactabilidad = contactados ÷ asignados ·
          Comprometidos = en etapa Pago Comprometido · Pagados = saldo cero · Efectividad = pagados ÷ asignados · Días con cobro = días del período con al menos un pago.
          Click en una fila para el detalle del cobrador.
        </p>
        <div className="overflow-x-auto table-scroll table-scroll-light" style={{ maxHeight: 350, overflowY: 'auto' }}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ color: 'var(--text-muted)' }} className="text-left">
                <th className="font-semibold pb-2">Cobrador</th>
                <th className="font-semibold pb-2 text-right">Asignados</th>
                <th className="font-semibold pb-2 text-right">Contactados</th>
                <th className="font-semibold pb-2 text-right">Contactabilidad</th>
                <th className="font-semibold pb-2 text-right">Comprometidos</th>
                <th className="font-semibold pb-2 text-right">Pagados</th>
                <th className="font-semibold pb-2 text-right">Efectividad</th>
                <th className="font-semibold pb-2 text-right">Días con cobro</th>
              </tr>
            </thead>
            <tbody>
              {comparativo.map(r => (
                <tr key={r.cobradorId} className="border-t transition-colors hover:bg-slate-50" style={{ borderColor: 'var(--border)', color: 'var(--text)', ...clickable }}
                  onClick={() => abrir({ tipo: 'cobrador', titulo: `Cartera de ${r.nombre}`, cobradorId: r.cobradorId })}>
                  <td className="py-2 font-semibold">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: colorByName[r.nombre] }} />
                      {r.nombre}
                    </span>
                  </td>
                  <td className="py-2 text-right">{r.clientes}</td>
                  <td className="py-2 text-right">{r.contactados}</td>
                  <td className="py-2 text-right font-bold">{pct(r.contactabilidad)}</td>
                  <td className="py-2 text-right">{r.comprometidos}</td>
                  <td className="py-2 text-right">{r.pagados}</td>
                  <td className="py-2 text-right font-bold">{pct(r.efectividad)}</td>
                  <td className="py-2 text-right">{r.diasConCobro}</td>
                </tr>
              ))}
              <tr className="border-t-2" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                <td className="py-2 font-black">TOTAL</td>
                <td className="py-2 text-right font-black">{totClientes}</td>
                <td className="py-2 text-right font-black" style={clickable} onClick={() => abrir({ tipo: 'contactados', titulo: 'Clientes contactados' })}>{comparativo.reduce((s, r) => s + r.contactados, 0)}</td>
                <td className="py-2 text-right font-black">{pct(totClientes ? comparativo.reduce((s, r) => s + r.contactados, 0) / totClientes * 100 : 0)}</td>
                <td className="py-2 text-right font-black" style={clickable} onClick={() => abrir({ tipo: 'comprometidos', titulo: 'Compromisos de pago pendientes' })}>{comparativo.reduce((s, r) => s + r.comprometidos, 0)}</td>
                <td className="py-2 text-right font-black" style={clickable} onClick={() => abrir({ tipo: 'pagados', titulo: 'Clientes pagados' })}>{comparativo.reduce((s, r) => s + r.pagados, 0)}</td>
                <td className="py-2 text-right font-black">{pct(totClientes ? comparativo.reduce((s, r) => s + r.pagados, 0) / totClientes * 100 : 0)}</td>
                <td className="py-2 text-right">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Fila 5: ranking + compromisos + aging ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5" style={card}>
          <h3 style={sectionTitle}>Ranking de Recuperación</h3>
          <p className="mb-3 mt-1" style={helpText}>Ordenado por % de recuperación del período (liquidado ÷ esperado de su cartera). Click en un cobrador para su detalle.</p>
          <div className="space-y-2.5">
            {ranking.map((r, i) => (
              <button key={r.cobradorId} className="flex items-center gap-2 w-full text-left rounded-lg px-1.5 py-1 transition-colors hover:bg-slate-50" style={clickable}
                onClick={() => abrir({ tipo: 'cobrador', titulo: `Cartera de ${r.nombre}`, cobradorId: r.cobradorId })}>
                {i < 3
                  ? <Medal size={16} style={{ color: ['#f59e0b', '#94a3b8', '#b45309'][i] }} />
                  : <span className="w-4 text-center text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>{i + 1}</span>}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate" style={{ color: 'var(--text)' }}>{r.nombre}</p>
                  <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{pct(r.pctRecuperacion)} de recuperación · {fmt(r.montoLiquidado)} liquidado</p>
                </div>
              </button>
            ))}
            <div className="border-t pt-2 mt-1" style={{ borderColor: 'var(--border)' }}>
              <p className="text-[10px] font-bold" style={{ color: 'var(--primary)' }}>TOTAL RECUPERADO EN EL PERÍODO</p>
              <p className="text-sm font-black" style={{ color: 'var(--text)' }}>{fmt(data.totalRecuperado)}</p>
            </div>
          </div>
        </div>

        <div className="p-5" style={card}>
          <h3 style={sectionTitle}>Compromisos de Pago</h3>
          <p className="mb-3 mt-1" style={helpText}>Estado de los acuerdos de pago gestionados por los cobradores. Click en cada caja para ver los clientes.</p>
          <div className="space-y-3 mt-2">
            <button className="w-full flex items-center justify-between p-3 rounded-xl transition-all hover:-translate-y-0.5" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', ...clickable }}
              onClick={() => abrir({ tipo: 'pagados', titulo: 'Clientes pagados' })}>
              <span className="text-xs font-semibold" style={{ color: 'var(--success-tx)' }}>Pagados (saldo cero)</span>
              <span className="text-lg font-black" style={{ color: '#10b981' }}>{promesas.cumplidas}</span>
            </button>
            <button className="w-full flex items-center justify-between p-3 rounded-xl transition-all hover:-translate-y-0.5" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', ...clickable }}
              onClick={() => abrir({ tipo: 'comprometidos', titulo: 'Compromisos de pago pendientes' })}>
              <span className="text-xs font-semibold" style={{ color: 'var(--warn-tx)' }}>Comprometidos pendientes</span>
              <span className="text-lg font-black" style={{ color: '#f59e0b' }}>{promesas.incumplidas}</span>
            </button>
            <div className="flex items-center justify-between px-3">
              <span className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>TOTAL COMPROMISOS</span>
              <span className="text-sm font-black" style={{ color: 'var(--text)' }}>{promesas.total}</span>
            </div>
          </div>
        </div>

        <div className="p-5" style={card}>
          <h3 style={sectionTitle}>Aging del Saldo Vencido</h3>
          <p className="mb-1 mt-1" style={helpText}>Antigüedad del saldo vencido de toda la cartera (no solo del período). Click en un tramo para ver las cuotas que lo componen.</p>
          <div style={{ width: '100%', height: 130, position: 'relative' }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={aging} dataKey="monto" nameKey="rango" cx="50%" cy="50%" innerRadius={38} outerRadius={58} paddingAngle={2}
                  label={false} labelLine={false} style={clickable}
                  onClick={(e: any) => { const b = AGING_BUCKETS.find(x => x.rango === e?.rango); if (b) abrir({ tipo: 'aging', titulo: `Saldo vencido — ${b.rango}`, bucket: b }) }}>
                  {aging.map((_: any, i: number) => <Cell key={i} fill={AGING_COLORS[i % AGING_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => fmt(Number(v))} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <span className="text-[9px] font-bold" style={{ color: 'var(--text-muted)' }}>VENCIDO</span>
              <span className="text-[11px] font-black" style={{ color: 'var(--text)' }}>{fmtK(agingTotal)}</span>
            </div>
          </div>
          <div className="space-y-1 mt-2 text-[10px]">
            {aging.map((a: any, i: number) => {
              const apct = agingTotal > 0 ? (a.monto / agingTotal) * 100 : 0
              const b = AGING_BUCKETS[i]
              return (
                <button key={a.rango ?? i} className="flex items-center gap-1.5 w-full rounded px-1 py-0.5 transition-colors hover:bg-slate-50" style={{ color: 'var(--text-muted)', ...clickable }}
                  onClick={() => abrir({ tipo: 'aging', titulo: `Saldo vencido — ${b.rango}`, bucket: b })}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: AGING_COLORS[i % AGING_COLORS.length] }} />
                  <span className="flex-1 truncate text-left">{a.rango}</span>
                  <span className="font-semibold" style={{ color: 'var(--text)' }}>{fmt(a.monto)}</span>
                  <span className="w-10 text-right">{pct(apct)}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-center py-2" style={{ color: 'var(--text-muted)' }}>
        Datos calculados en vivo desde las carteras reales de los cobradores y las cuotas del sistema contable · {data.periodLabel}
      </p>

      {/* ── Modal de detalle ── */}
      {modal && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" style={{ background: 'var(--surface-4)', backdropFilter: 'blur(2px)' }}
          onClick={() => setModal(null)}>
          <div className="w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-2xl p-6" style={{ background: 'var(--surface-1)' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 style={{ ...sectionTitle, fontSize: 16 }}>{modal.titulo}</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Período: {rango}</p>
              </div>
              <button onClick={() => setModal(null)} className="p-2 rounded-lg transition-colors hover:bg-slate-100">
                <X size={16} style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>
            <ModalBody ctx={modal} />
          </div>
        </div>
      )}
    </div>
  )
}
