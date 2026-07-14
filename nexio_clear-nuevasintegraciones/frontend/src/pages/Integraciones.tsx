import { useCallback, useEffect, useState } from 'react'
import {
  Plug, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
  ChevronRight, Wrench, Loader2, ArrowRight, Search, ScanSearch,
  Activity, Pause, Play,
} from 'lucide-react'
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid,
  Tooltip as RTooltip, ResponsiveContainer,
} from 'recharts'
import { getIntegrationsPanel, reconcileRut, getIntegrationsHealth } from '../api'

type Status = 'ok' | 'down' | 'degraded'
interface Diagnosis { cause: string; message: string; remediation: string[] }
interface Integration {
  id: string; name: string; phase: number; direction: string
  method: string; endpoint: string; realm: string
  status: Status; latencyMs: number | null; httpStatus: number | null
  diagnosis?: Diagnosis
}

const META: Record<Status, { label: string; color: string; bg: string }> = {
  ok:       { label: 'Operativa', color: '#16a34a', bg: 'rgba(22,163,74,0.10)' },
  degraded: { label: 'Degradada', color: '#d97706', bg: 'rgba(217,119,6,0.10)' },
  down:     { label: 'Caída',     color: '#dc2626', bg: 'rgba(220,38,38,0.10)' },
}

const PHASE_LABELS: Record<number, string> = {
  4: 'Fase 4 · ZelixLeads ↔ Control',
  5: 'Fase 5 · ZelixLeads ↔ Contable',
  6: 'Fase 6 · ZelixLeads ↔ PagaCuota',
}

export default function Integraciones() {
  const [data, setData] = useState<Integration[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [rut, setRut] = useState('')
  const [rec, setRec] = useState<any>(null)
  const [recLoading, setRecLoading] = useState(false)
  const [recErr, setRecErr] = useState<string | null>(null)

  const reconcile = useCallback(async () => {
    if (!rut.trim()) return
    setRecLoading(true); setRecErr(null)
    try { setRec(await reconcileRut(rut.trim())) }
    catch (e: any) { setRecErr(e?.response?.data?.detail || 'Error al reconciliar'); setRec(null) }
    finally { setRecLoading(false) }
  }, [rut])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const json = await getIntegrationsPanel()
      setData(json.integrations); setCheckedAt(json.timestamp)
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Error al consultar el estado')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const total = data?.length ?? 0
  const okCount = data?.filter(i => i.status === 'ok').length ?? 0
  const allOk = total > 0 && okCount === total
  const phases = [4, 5, 6].filter(ph => data?.some(i => i.phase === ph))

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'rgba(124,58,237,0.10)' }}>
            <Plug size={24} style={{ color: 'var(--primary)' }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text)', fontFamily: '"Space Grotesk", sans-serif' }}>Integraciones</h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Estado en tiempo real de las integraciones de ZelixLeads, por fase.</p>
          </div>
        </div>
        <button onClick={load} disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: 'var(--primary)' }}>
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          Re-verificar todo
        </button>
      </div>

      {data && (
        <div className="mb-6 px-4 py-3 rounded-xl flex items-center gap-3 flex-wrap"
          style={{ background: allOk ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)', border: `1px solid ${allOk ? 'rgba(22,163,74,0.25)' : 'rgba(220,38,38,0.25)'}` }}>
          {allOk ? <CheckCircle2 size={20} style={{ color: '#16a34a' }} /> : <AlertTriangle size={20} style={{ color: '#dc2626' }} />}
          <span className="text-sm font-semibold" style={{ color: allOk ? '#15803d' : '#b91c1c' }}>{okCount}/{total} integraciones operativas</span>
          {checkedAt && <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>Última revisión: {new Date(checkedAt).toLocaleTimeString('es-CL')}</span>}
        </div>
      )}

      {error && <div className="mb-6 px-4 py-3 rounded-xl text-sm" style={{ background: 'rgba(220,38,38,0.08)', color: '#b91c1c' }}>{error}</div>}
      {!data && loading && <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}><Loader2 size={16} className="animate-spin" /> Verificando integraciones…</div>}

      <div className="space-y-6">
        {phases.map(ph => (
          <section key={ph}>
            <h2 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>{PHASE_LABELS[ph]}</h2>
            <div className="space-y-3">
              {data!.filter(i => i.phase === ph).map(i => {
                const meta = META[i.status]
                const isOpen = !!open[i.id]
                const canDiagnose = i.status !== 'ok' && !!i.diagnosis
                return (
                  <div key={i.id} className="rounded-xl border overflow-hidden" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: meta.color, boxShadow: `0 0 8px ${meta.color}` }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold truncate" style={{ color: 'var(--text)' }}>{i.name}</p>
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
                        </div>
                        <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                          {i.direction} · {i.method} {i.endpoint}
                          {i.httpStatus != null && ` · HTTP ${i.httpStatus}`}
                          {i.latencyMs != null && ` · ${i.latencyMs} ms`}
                        </p>
                      </div>
                      {canDiagnose && (
                        <button onClick={() => setOpen(o => ({ ...o, [i.id]: !o[i.id] }))}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg flex-shrink-0"
                          style={{ background: 'rgba(220,38,38,0.08)', color: '#dc2626' }}>
                          <Wrench size={14} /> Diagnosticar
                          <ChevronRight size={14} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                        </button>
                      )}
                    </div>
                    {canDiagnose && isOpen && i.diagnosis && (
                      <div className="px-4 pb-4 pt-1 border-t" style={{ borderColor: 'var(--border)', background: 'rgba(220,38,38,0.02)' }}>
                        <p className="text-xs font-semibold mt-2 mb-1" style={{ color: '#b91c1c' }}>Causa: {i.diagnosis.cause} — {i.diagnosis.message}</p>
                        <p className="text-[11px] font-bold uppercase tracking-wide mt-3 mb-1.5" style={{ color: 'var(--text-muted)' }}>Cómo corregir</p>
                        <ol className="space-y-1.5">
                          {i.diagnosis.remediation.map((step, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-2)' }}>
                              <ArrowRight size={14} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--primary)' }} />
                              <span>{step}</span>
                            </li>
                          ))}
                        </ol>
                        <button onClick={load} disabled={loading}
                          className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-60"
                          style={{ background: '#16a34a' }}>
                          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                          Ya lo corregí — re-verificar
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      {/* ── Reconciliación de datos por RUT ── */}
      <section className="mt-10">
        <div className="rounded-xl border p-4" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <ScanSearch size={18} style={{ color: 'var(--primary)' }} />
            <h2 className="text-base font-bold" style={{ color: 'var(--text)' }}>Reconciliación de datos por RUT</h2>
          </div>
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
            El semáforo mide <strong>conexión</strong>. Esto mide <strong>integridad de datos</strong>: trae los datos reales
            de cada sistema para un RUT y marca dónde divergen (categorías, montos, casos faltantes).
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input value={rut} onChange={e => setRut(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && reconcile()}
                placeholder="RUT del cliente (ej: 10.321.345-7)"
                className="w-full pl-9 pr-3 py-2 rounded-xl text-sm"
                style={{ background: 'var(--surface-0)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            </div>
            <button onClick={reconcile} disabled={recLoading || !rut.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: 'var(--primary)' }}>
              {recLoading ? <Loader2 size={15} className="animate-spin" /> : <ScanSearch size={15} />} Reconciliar
            </button>
          </div>

          {recErr && <div className="mt-3 px-3 py-2 rounded-lg text-sm" style={{ background: 'rgba(220,38,38,0.08)', color: '#b91c1c' }}>{recErr}</div>}

          {rec && (() => {
            const OVR: Record<string, { color: string; bg: string; label: string }> = {
              ok:    { color: '#16a34a', bg: 'rgba(22,163,74,0.08)',  label: 'Consistente' },
              warn:  { color: '#d97706', bg: 'rgba(217,119,6,0.08)',  label: 'Con alertas' },
              error: { color: '#dc2626', bg: 'rgba(220,38,38,0.08)',  label: 'Inconsistente' },
            }
            const ov = OVR[rec.overall] || OVR.ok
            const nx = rec.systems?.nexio?.leads ?? []
            const ct = rec.systems?.contable?.contratos ?? []
            const pc = rec.systems?.pagacuota?.profiles ?? []
            const ctrl = rec.systems?.control?.cases ?? []
            return (
              <div className="mt-4 space-y-4">
                <div className="px-3 py-2 rounded-lg inline-flex items-center gap-2" style={{ background: ov.bg }}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: ov.color }} />
                  <span className="text-sm font-bold" style={{ color: ov.color }}>{ov.label}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>· RUT {rec.rut}</span>
                </div>

                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>Hallazgos</p>
                  <div className="space-y-1.5">
                    {rec.findings?.map((f: any, i: number) => {
                      const c = f.level === 'error' ? '#dc2626' : f.level === 'warn' ? '#d97706' : '#16a34a'
                      const Icon = f.level === 'error' ? XCircle : f.level === 'warn' ? AlertTriangle : CheckCircle2
                      return (
                        <div key={i} className="flex items-start gap-2 text-xs">
                          <Icon size={14} className="flex-shrink-0 mt-0.5" style={{ color: c }} />
                          <span><strong style={{ color: c }}>{f.title}:</strong> <span style={{ color: 'var(--text-2)' }}>{f.detail}</span></span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <SysCol title={`ZelixLeads · ${nx.length} lead(s)`} rows={nx.map((l: any) => `${l.categoria ?? '—'} · $${Math.round(l.monto_cuota).toLocaleString('es-CL')}/cuota · ${l.current_stage}`)} />
                  <SysCol title={`Control · ${ctrl.length} caso(s)`} err={rec.systems?.control?.error} rows={ctrl.map((c: any) => `${c.categoria ?? '—'} · ${c.code} · ${c.stage}`)} />
                  <SysCol title={`Contable · ${ct.length} contrato(s)`} err={rec.systems?.contable?.error} rows={ct.map((c: any) => `${c.tipo_servicio ?? '—'} · cuota2 $${Math.round(Number(c.cuota_2 || 0)).toLocaleString('es-CL')}`)} />
                  <SysCol title={`PagaCuota · ${pc.length} perfil(es)`} err={rec.systems?.pagacuota?.error} rows={pc.map((p: any) => `${p.nombre ?? '—'} · ${p.identifier}`)} />
                </div>
              </div>
            )
          })()}
        </div>
      </section>

      {/* ── Comportamiento en tiempo real ── */}
      <section className="mt-6">
        <LiveLatencyScatter />
      </section>
    </div>
  )
}

// Un color por sistema (paleta categórica CVD-safe; identidad reforzada con leyenda + tooltip)
const HOPS: { key: string; label: string; color: string }[] = [
  { key: 'legal_finance', label: 'Legal Finance', color: '#2a78d6' },
  { key: 'pagacuotas',    label: 'PagaCuota',      color: '#1baf7a' },
  { key: 'at_informa',    label: 'AT-Informa',     color: '#eda100' },
  { key: 'hive_service',  label: 'Control / Hive', color: '#008300' },
]

interface Pt { t: number; latency: number; reachable: boolean; status: number | null }

function LiveLatencyScatter() {
  const [series, setSeries] = useState<Record<string, Pt[]>>(
    () => Object.fromEntries(HOPS.map(h => [h.key, [] as Pt[]])),
  )
  const [live, setLive] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const WINDOW = 40      // muestras por sistema (~2.5 min a 4s)
  const INTERVAL = 4000

  useEffect(() => {
    if (!live) return
    let cancelled = false
    const tick = async () => {
      try {
        const h = await getIntegrationsHealth()
        if (cancelled) return
        const now = Date.now()
        setSeries(prev => {
          const next: Record<string, Pt[]> = { ...prev }
          for (const hop of HOPS) {
            const d = h.hops?.[hop.key]?.live
            if (!d || d.latency_ms == null) continue
            const pt: Pt = { t: now, latency: d.latency_ms, reachable: d.reachable, status: d.status_code }
            next[hop.key] = [...(prev[hop.key] || []), pt].slice(-WINDOW)
          }
          return next
        })
        setErr(null)
      } catch (e: any) {
        if (!cancelled) setErr(e?.response?.data?.detail || e?.message || 'error')
      }
    }
    tick()
    const id = setInterval(tick, INTERVAL)
    return () => { cancelled = true; clearInterval(id) }
  }, [live])

  const allPts = HOPS.flatMap(h => series[h.key] || [])
  const tMin = allPts.length ? Math.min(...allPts.map(p => p.t)) : 0
  const tMax = allPts.length ? Math.max(...allPts.map(p => p.t)) : 1
  const yMax = allPts.length ? Math.max(100, ...allPts.map(p => p.latency)) : 100
  const fmtT = (t: number) => new Date(t).toLocaleTimeString('es-CL', { hour12: false, minute: '2-digit', second: '2-digit' })

  const dot = (color: string) => (props: any) => {
    const { cx, cy, payload } = props
    if (cx == null || cy == null) return null
    if (!payload.reachable) {
      // caído: anillo rojo hueco (estado reservado, con leyenda + icono aparte)
      return <circle cx={cx} cy={cy} r={5} fill="none" stroke="#dc2626" strokeWidth={2} />
    }
    return <circle cx={cx} cy={cy} r={4} fill={color} stroke="var(--surface-1)" strokeWidth={1} />
  }

  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-2 mb-1">
        <Activity size={18} style={{ color: 'var(--primary)' }} />
        <h2 className="text-base font-bold" style={{ color: 'var(--text)' }}>Comportamiento en tiempo real</h2>
        <span className="ml-1 inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: live ? '#16a34a' : 'var(--text-muted)' }}>
          <span className="w-2 h-2 rounded-full" style={{ background: live ? '#16a34a' : 'var(--text-muted)', animation: live ? 'pulse 1.5s ease-in-out infinite' : 'none' }} />
          {live ? 'EN VIVO' : 'PAUSADO'}
        </span>
        <button onClick={() => setLive(v => !v)}
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold"
          style={{ background: 'var(--surface-0)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
          {live ? <><Pause size={13} /> Pausar</> : <><Play size={13} /> Reanudar</>}
        </button>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
        Latencia de respuesta de cada sistema, muestreada cada 4s. Cada punto es un ping;
        un <span style={{ color: '#dc2626', fontWeight: 700 }}>anillo rojo</span> marca un sistema que no respondió.
      </p>

      {/* Leyenda (identidad no depende solo del color) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
        {HOPS.map(h => {
          const last = (series[h.key] || []).at(-1)
          return (
            <span key={h.key} className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-2)' }}>
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: h.color }} />
              {h.label}
              {last && <span style={{ color: last.reachable ? 'var(--text-muted)' : '#dc2626', fontWeight: 600 }}>· {last.reachable ? `${last.latency}ms` : 'sin respuesta'}</span>}
            </span>
          )
        })}
        <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <XCircle size={12} style={{ color: '#dc2626' }} /> caído
        </span>
      </div>

      {err && <div className="mb-2 px-3 py-1.5 rounded-lg text-xs" style={{ background: 'rgba(220,38,38,0.08)', color: '#b91c1c' }}>No se pudo consultar la salud: {err}</div>}

      {allPts.length === 0 ? (
        <div className="h-[260px] flex items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={16} className="animate-spin mr-2" /> Esperando la primera medición…
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeOpacity={0.4} />
            <XAxis type="number" dataKey="t" domain={[tMin, tMax]}
              tickFormatter={fmtT} tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
              stroke="var(--border)" minTickGap={40} />
            <YAxis type="number" dataKey="latency" domain={[0, Math.ceil(yMax / 100) * 100]}
              unit="ms" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={52} stroke="var(--border)" />
            <ZAxis range={[40, 40]} />
            <RTooltip
              cursor={{ strokeDasharray: '3 3', stroke: 'var(--text-muted)' }}
              content={({ active, payload }: any) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload as Pt
                const hop = HOPS.find(h => (series[h.key] || []).includes(p))
                return (
                  <div className="rounded-lg px-2.5 py-1.5 text-xs shadow-lg" style={{ background: 'var(--surface-0)', border: '1px solid var(--border)' }}>
                    <div className="font-bold" style={{ color: hop?.color ?? 'var(--text)' }}>{hop?.label ?? '—'}</div>
                    <div style={{ color: 'var(--text-2)' }}>{p.reachable ? `${p.latency} ms` : 'sin respuesta'}{p.status != null && ` · HTTP ${p.status}`}</div>
                    <div style={{ color: 'var(--text-muted)' }}>{fmtT(p.t)}</div>
                  </div>
                )
              }} />
            {HOPS.map(h => (
              <Scatter key={h.key} name={h.label} data={series[h.key] || []} fill={h.color} shape={dot(h.color)} isAnimationActive={false} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

function SysCol({ title, rows, err }: { title: string; rows: string[]; err?: string | null }) {
  return (
    <div className="rounded-lg border p-2.5" style={{ background: 'var(--surface-0)', borderColor: 'var(--border)' }}>
      <p className="text-[11px] font-bold mb-1.5" style={{ color: 'var(--text)' }}>{title}</p>
      {err && <p className="text-[11px]" style={{ color: '#b91c1c' }}>{err}</p>}
      {rows.length === 0 && !err && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>— sin registros —</p>}
      <div className="space-y-1">
        {rows.map((r, i) => <p key={i} className="text-[11px] leading-snug" style={{ color: 'var(--text-2)' }}>{r}</p>)}
      </div>
    </div>
  )
}
