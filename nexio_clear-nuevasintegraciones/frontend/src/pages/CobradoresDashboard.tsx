import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCobradorDashboard } from '../api'
import { useRealtime } from '../contexts/RealtimeContext'
import {
  TrendingUp, Users, DollarSign, AlertCircle, CheckCircle, Handshake,
  Hourglass, Wallet, PhoneCall, ChevronRight, AlertTriangle, RefreshCw,
} from 'lucide-react'

const STAGES: Record<string, { label: string; desc: string; color: string; bg: string; border: string; icon: React.ElementType }> = {
  pendiente_moroso:  { label: 'Pendiente Moroso',  desc: 'Recién sincronizado — aún no inicias el cobro', color: '#8B5CF6', bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.22)', icon: Hourglass },
  lead_moroso:       { label: 'Lead Moroso',       desc: 'En gestión de cobro activa',                    color: '#EF4444', bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.22)',  icon: AlertCircle },
  pago_comprometido: { label: 'Pago Comprometido', desc: 'Acordó una fecha de pago contigo',              color: '#F59E0B', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.22)', icon: Handshake },
  pagado:            { label: 'Pagado',            desc: 'Deuda saldada — cobro completado',              color: '#10B981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.22)', icon: CheckCircle },
}

const TEXT = '#1c1633'
const MUTED = 'rgba(28,22,51,0.45)'
const CARD: React.CSSProperties = { background: '#ffffff', border: '1px solid #e6e1f0', boxShadow: '0 1px 4px rgba(28,22,51,0.05)' }

function fmt(n: number) {
  return `$${Math.round(n).toLocaleString('es-CL')}`
}

function fmtCompact(n: number) {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toLocaleString('es-CL', { maximumFractionDigits: 1 })}M`
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000).toLocaleString('es-CL')}K`
  return fmt(n)
}

export default function CobradoresDashboard() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchStats = useCallback((silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    getCobradorDashboard()
      .then(setStats)
      .catch(() => {})
      .finally(() => { setLoading(false); setRefreshing(false) })
  }, [])

  useEffect(() => { fetchStats() }, [fetchStats])

  useRealtime(['cobrador_sync', 'lead_update'], () => fetchStats(true))

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--primary)' }} />
    </div>
  )

  const totalDeuda    = stats?.total_deuda   ?? 0
  const totalCobrado  = stats?.total_cobrado ?? 0
  const porStage      = stats?.por_stage     ?? {}
  const stageDetalle  = stats?.por_stage_detalle ?? {}
  const tasa          = stats?.tasa_cobro    ?? 0
  const totalClientes = stats?.total_leads   ?? 0
  const sinGestion    = stats?.sin_gestion   ?? 0
  const contactados   = stats?.contactados   ?? 0
  const cuotasVencidas = stats?.cuotas_vencidas_total ?? 0
  const urgentes: any[] = stats?.urgentes ?? []

  const pendiente = Math.max(totalDeuda - totalCobrado, 0)
  const pct = totalDeuda > 0 ? (totalCobrado / totalDeuda) * 100 : 0

  const kpis = [
    { label: 'Cartera Total', value: fmt(totalDeuda), sub: `Deuda total de los ${totalClientes} cliente${totalClientes !== 1 ? 's' : ''} morosos que tienes asignados`, action: 'Click para ver tu cartera', to: '/cobrador/cartera', icon: Wallet, color: '#7c3aed', bg: 'rgba(124,58,237,0.10)' },
    { label: 'Cobrado', value: fmt(totalCobrado), sub: `Solo clientes con deuda saldada (etapa Pagado) — ${tasa}% de la cartera. Abonos parciales no cuentan`, action: 'Click para ver el historial', to: '/cobrador/historial', icon: TrendingUp, color: '#10B981', bg: 'rgba(16,185,129,0.10)' },
    { label: 'Pendiente por Cobrar', value: fmt(pendiente), sub: cuotasVencidas > 0 ? `Dinero que falta recuperar — incluye ${cuotasVencidas} cuota${cuotasVencidas !== 1 ? 's' : ''} ya vencida${cuotasVencidas !== 1 ? 's' : ''}` : 'Dinero que falta recuperar — sin cuotas vencidas', action: 'Click para ver tu cartera', to: '/cobrador/cartera', icon: DollarSign, color: '#EF4444', bg: 'rgba(239,68,68,0.10)' },
    { label: 'Gestión de Contacto', value: `${contactados}/${totalClientes}`, sub: sinGestion > 0 ? `Clientes que ya contactaste, del total — ${sinGestion} aún sin gestionar` : 'Clientes que ya contactaste, del total — cartera al día', action: 'Click para ver tu cartera', to: '/cobrador/cartera', icon: PhoneCall, color: '#8B5CF6', bg: 'rgba(139,92,246,0.10)' },
  ]

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-black" style={{ color: TEXT, fontFamily: '"Space Grotesk", sans-serif' }}>
            Dashboard Cobranza
          </h1>
          <p className="text-sm mt-0.5" style={{ color: MUTED }}>
            Morosos sincronizados desde el sistema contable · actualización automática
          </p>
        </div>
        <button onClick={() => fetchStats(true)}
          className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-semibold transition-colors"
          style={{ border: '1px solid #e6e1f0', background: '#fff', color: MUTED }}>
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(k => {
          const Icon = k.icon
          return (
            <button key={k.label} onClick={() => navigate(k.to)} className="rounded-2xl p-5 text-left transition-all hover:-translate-y-0.5" style={{ ...CARD, cursor: 'pointer' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = `0 6px 18px ${k.color}22` }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 4px rgba(28,22,51,0.05)' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: k.bg }}>
                  <Icon size={18} style={{ color: k.color }} />
                </div>
              </div>
              <p className="text-2xl font-black leading-tight" style={{ color: TEXT, fontFamily: '"Space Grotesk", sans-serif' }}>
                {k.value}
              </p>
              <p className="text-xs mt-1 font-bold" style={{ color: 'rgba(28,22,51,0.70)' }}>{k.label}</p>
              <p className="text-[11px] mt-0.5 leading-snug" style={{ color: MUTED }}>{k.sub}</p>
              <p className="text-[10px] font-bold mt-1.5 flex items-center gap-1" style={{ color: k.color }}>
                {k.action} <ChevronRight size={10} />
              </p>
            </button>
          )
        })}
      </div>

      {/* ── Embudo por etapa — clickable ── */}
      <div className="rounded-2xl p-5" style={CARD}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-bold text-sm" style={{ color: TEXT }}>Cartera por Etapa</h3>
            <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>En qué punto del proceso de cobro está cada cliente moroso</p>
          </div>
          <span className="text-[11px] flex-shrink-0 mt-0.5" style={{ color: MUTED }}>Click en una etapa para ver sus clientes</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Object.entries(STAGES).map(([key, meta]) => {
            const det = stageDetalle[key] ?? { count: porStage[key] ?? 0, deuda: 0, cobrado: 0 }
            const Icon = meta.icon
            return (
              <button key={key} onClick={() => navigate(`/cobrador/cartera?stage=${key}`)}
                className="text-left p-4 rounded-xl transition-all hover:-translate-y-0.5"
                style={{ background: meta.bg, border: `1px solid ${meta.border}` }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = `0 6px 18px ${meta.color}22` }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'none' }}>
                <div className="flex items-center justify-between mb-2.5">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#ffffff', border: `1px solid ${meta.border}` }}>
                    <Icon size={14} style={{ color: meta.color }} />
                  </div>
                  <span className="text-xl font-black" style={{ color: meta.color, fontFamily: '"Space Grotesk", sans-serif' }}>
                    {det.count}
                  </span>
                </div>
                <p className="text-xs font-bold" style={{ color: TEXT }}>{meta.label}</p>
                <p className="text-[10px] mt-0.5 leading-snug" style={{ color: 'rgba(28,22,51,0.50)' }}>{meta.desc}</p>
                <p className="text-[11px] font-semibold mt-1" style={{ color: meta.color }}>
                  {det.count} cliente{det.count !== 1 ? 's' : ''}{det.deuda > 0 ? ` · ${fmtCompact(det.deuda)} en deuda` : ''}
                </p>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Progreso de cobro ── */}
      <div className="rounded-2xl p-5" style={CARD}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-bold text-sm" style={{ color: TEXT }}>Progreso de Cobro</h3>
            <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>Cuánto de la deuda total de tu cartera ya lograste recuperar</p>
          </div>
          <span className="text-xs font-bold flex-shrink-0 mt-0.5" style={{ color: pct > 0 ? '#10B981' : MUTED }}>{pct.toFixed(1)}% cobrado</span>
        </div>
        <div className="h-3 rounded-full overflow-hidden" style={{ background: 'rgba(28,22,51,0.08)' }}>
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.min(pct, 100)}%`, background: 'linear-gradient(90deg, #10B981 0%, #34d399 100%)' }} />
        </div>
        <div className="flex justify-between mt-2 text-xs" style={{ color: MUTED }}>
          <span>Cobrado: <strong style={{ color: '#10B981' }}>{fmt(totalCobrado)}</strong></span>
          <span>Pendiente: <strong style={{ color: '#EF4444' }}>{fmt(pendiente)}</strong></span>
        </div>
      </div>

      {/* ── Atención requerida + Por área ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Urgentes */}
        <div className="rounded-2xl p-5" style={CARD}>
          <div className="flex items-start gap-2 mb-4">
            <AlertTriangle size={15} style={{ color: '#EF4444', marginTop: 2 }} />
            <div className="flex-1">
              <h3 className="font-bold text-sm" style={{ color: TEXT }}>Atención Requerida</h3>
              <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>Tus morosos prioritarios: sin contacto o con cuotas vencidas — click para abrir su ficha</p>
            </div>
            {sinGestion > 0 && (
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full flex-shrink-0"
                style={{ background: 'rgba(239,68,68,0.10)', color: '#DC2626' }}>
                {sinGestion} sin gestión
              </span>
            )}
          </div>
          {urgentes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <CheckCircle size={26} style={{ color: '#10B981', opacity: 0.5 }} />
              <p className="text-xs" style={{ color: MUTED }}>Sin clientes urgentes — cartera al día</p>
            </div>
          ) : (
            <div className="space-y-2">
              {urgentes.map(u => {
                const s = STAGES[u.stage] ?? STAGES.lead_moroso
                return (
                  <button key={u.id} onClick={() => navigate(`/cobrador/cartera?lead=${u.id}`)}
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-colors hover:bg-slate-50"
                    style={{ border: '1px solid #eef2f7' }}>
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-black text-white"
                      style={{ background: `linear-gradient(135deg, ${s.color} 0%, ${s.color}aa 100%)` }}>
                      {u.nombre?.charAt(0)?.toUpperCase() ?? '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-bold truncate" style={{ color: TEXT }}>{u.nombre}</p>
                        {!u.is_contactado && (
                          <span className="flex-shrink-0 text-[9px] font-black px-1.5 py-px rounded-full"
                            style={{ background: 'rgba(239,68,68,0.10)', color: '#DC2626' }}>
                            SIN CONTACTO
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] truncate mt-0.5" style={{ color: MUTED }}>
                        {u.cuotas_vencidas > 0 ? `${u.cuotas_vencidas} cuota${u.cuotas_vencidas > 1 ? 's' : ''} vencida${u.cuotas_vencidas > 1 ? 's' : ''} · ` : ''}
                        {s.label}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs font-black" style={{ color: '#EF4444' }}>{fmtCompact(u.pendiente)}</p>
                      <p className="text-[9px]" style={{ color: MUTED }}>pendiente</p>
                    </div>
                    <ChevronRight size={14} style={{ color: MUTED, flexShrink: 0 }} />
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Por área */}
        <div className="rounded-2xl p-5" style={CARD}>
          <div className="flex items-start gap-2 mb-4">
            <Users size={15} style={{ color: '#7c3aed', marginTop: 2 }} />
            <div>
              <h3 className="font-bold text-sm" style={{ color: TEXT }}>Cartera por Área</h3>
              <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>Avance de cobro agrupado por área de servicio del cliente</p>
            </div>
          </div>
          {!stats?.por_area?.length ? (
            <p className="text-xs py-8 text-center" style={{ color: MUTED }}>Sin datos por área</p>
          ) : (
            <div className="space-y-4">
              {stats.por_area.map((area: any) => {
                const pctArea = area.total_deuda > 0 ? (area.total_cobrado / area.total_deuda) * 100 : 0
                return (
                  <div key={area.nombre}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold capitalize" style={{ color: TEXT }}>
                        {area.nombre.replace(/_/g, ' ').toLowerCase()}
                      </span>
                      <span className="text-[11px] font-bold" style={{ color: pctArea > 0 ? '#10B981' : 'rgba(28,22,51,0.40)' }}>
                        {pctArea.toFixed(0)}% cobrado
                      </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden mb-1.5" style={{ background: 'rgba(28,22,51,0.07)' }}>
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(pctArea, 100)}%`, background: 'linear-gradient(90deg, #7c3aed 0%, #818cf8 100%)' }} />
                    </div>
                    <div className="flex items-center justify-between text-[10px]" style={{ color: 'rgba(28,22,51,0.50)' }}>
                      <span>{area.total_leads} cliente{area.total_leads !== 1 ? 's' : ''}</span>
                      <span>{fmt(area.total_cobrado)} de {fmt(area.total_deuda)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
