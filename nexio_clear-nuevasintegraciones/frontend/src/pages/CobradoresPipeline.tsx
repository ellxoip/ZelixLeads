import { useState, useEffect } from 'react'
import { X, Phone, Mail, ArrowRight, TrendingUp, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import { getCobradorLeads, updateCobradorStage, updateCobradorNotes, updateCobradorMontoPagado } from '../api'
import { useRealtime } from '../contexts/RealtimeContext'
import KanbanColumn from '../components/kanban/KanbanColumn'
import KanbanBoard from '../components/kanban/KanbanBoard'

interface CobradorLead {
  id: number
  cobrador_id: number
  contact_id: number | null
  nombre: string
  rut?: string | null
  empresa?: string | null
  telefono?: string | null
  email?: string | null
  monto_deuda: number
  monto_pagado: number
  num_cuotas?: number | null
  cuota_inicial?: number | null
  monto_cuota?: number | null
  proxima_cuota_fecha?: string | null
  proxima_cuota_monto?: number | null
  lf_cuotas_vencidas?: number | null
  is_contactado?: boolean
  descripcion?: string | null
  stage: string
  notes?: string | null
  created_at?: string
}

const STAGES = [
  { key: 'pendiente_moroso',  label: 'Pendiente Moroso',  sublabel: 'En ventana de gracia',   color: '#8B5CF6', light: 'rgba(139,92,246,0.07)', border: 'rgba(139,92,246,0.18)', headerGrad: 'linear-gradient(135deg,#8B5CF6,#7C3AED)' },
  { key: 'lead_moroso',       label: 'Lead Moroso',       sublabel: 'Pendiente de contacto', color: '#EF4444', light: 'rgba(239,68,68,0.07)',  border: 'rgba(239,68,68,0.18)',  headerGrad: 'linear-gradient(135deg,#EF4444,#DC2626)' },
  { key: 'pago_comprometido', label: 'Pago Comprometido', sublabel: 'Acuerdo en negociación', color: '#F59E0B', light: 'rgba(245,158,11,0.07)', border: 'rgba(245,158,11,0.18)', headerGrad: 'linear-gradient(135deg,#F59E0B,#D97706)' },
  { key: 'pagado',            label: 'Pagado',             sublabel: 'Deuda saldada',          color: '#10B981', light: 'rgba(16,185,129,0.07)', border: 'rgba(16,185,129,0.18)', headerGrad: 'linear-gradient(135deg,#10B981,#059669)' },
]

const TEXT      = '#1c1633'
const TEXT_MUTED = 'rgba(28,22,51,0.45)'
const CARD_BG   = '#ffffff'
const COL_BG    = 'rgba(28,22,51,0.03)'
const DIVIDER   = 'rgba(28,22,51,0.08)'

function fmt(n: number) { return `$${Math.round(n).toLocaleString('es-CL')}` }
function initials(name: string) { return name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase() }

function proximaCuota(lead: CobradorLead): number {
  if (lead.monto_pagado === 0 && (lead.cuota_inicial ?? 0) > 0) return lead.cuota_inicial!
  return lead.proxima_cuota_monto ?? lead.monto_cuota ?? 0
}

function LeadCard({ lead, onSelect }: { lead: CobradorLead; onSelect: (l: CobradorLead) => void }) {
  const stage = STAGES.find(s => s.key === lead.stage)!
  const pct = lead.monto_deuda > 0 ? Math.min((lead.monto_pagado / lead.monto_deuda) * 100, 100) : 0
  const proxCobro = proximaCuota(lead)

  return (
    <button onClick={() => onSelect(lead)} className="w-full text-left block">
      <div className="rounded-2xl p-4 transition-all duration-150"
        style={{ background: CARD_BG, border: `1px solid ${stage.border}`, boxShadow: '0 1px 4px rgba(28,22,51,0.06)' }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLElement
          el.style.boxShadow = `0 6px 20px ${stage.color}22`
          el.style.borderColor = stage.color
          el.style.transform = 'translateY(-2px)'
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLElement
          el.style.boxShadow = '0 1px 4px rgba(28,22,51,0.06)'
          el.style.borderColor = stage.border
          el.style.transform = 'none'
        }}>

        {/* Top row */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-black text-white"
            style={{ background: stage.headerGrad }}>
            {initials(lead.nombre)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-[13px] leading-snug truncate" style={{ color: TEXT }}>{lead.nombre}</p>
            <p className="text-xs truncate mt-0.5" style={{ color: TEXT_MUTED }}>{lead.empresa || lead.rut || '—'}</p>
          </div>
          {pct > 0 && (
            <span className="flex-shrink-0 text-[11px] font-black px-2 py-0.5 rounded-full"
              style={{ background: stage.light, color: stage.color }}>
              {pct.toFixed(0)}%
            </span>
          )}
        </div>

        {/* Amounts */}
        <div className="rounded-xl p-3 mb-3" style={{ background: stage.light, border: `1px solid ${stage.border}` }}>
          <div className="flex justify-between items-end mb-2.5">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: stage.color }}>Deuda total</p>
              <p className="text-base font-black" style={{ color: TEXT }}>{fmt(lead.monto_deuda)}</p>
            </div>
            <div className="text-right">
              <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: TEXT_MUTED }}>
                {lead.monto_pagado === 0 && (lead.cuota_inicial ?? 0) > 0 ? 'Pago Inicial' : 'Próx. Cuota'}
              </p>
              <p className="text-base font-black" style={{ color: proxCobro > 0 ? '#EF4444' : '#10B981' }}>{fmt(proxCobro)}</p>
            </div>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(28,22,51,0.08)' }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: stage.color }} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 flex-wrap">
          {lead.telefono && (
            <span className="flex items-center gap-1.5 text-xs" style={{ color: TEXT_MUTED }}>
              <Phone size={11} />{lead.telefono}
            </span>
          )}
          {(lead.lf_cuotas_vencidas ?? 0) > 0 && (
            <span className="ml-auto text-[9px] font-black px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(239,68,68,0.10)', color: '#DC2626' }}>
              {lead.lf_cuotas_vencidas} vencida{(lead.lf_cuotas_vencidas ?? 0) > 1 ? 's' : ''}
            </span>
          )}
          {lead.is_contactado && (
            <span className="text-[9px] font-black px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(16,185,129,0.12)', color: '#10B981' }}>
              CONTACTADO
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

function CobradorColumn({ stage, leads, onSelect }: { stage: typeof STAGES[0]; leads: CobradorLead[]; onSelect: (l: CobradorLead) => void }) {
  const totalDeuda = leads.reduce((a, l) => a + l.monto_deuda, 0)
  return (
    <KanbanColumn
      title={stage.label}
      count={leads.length}
      color={stage.color}
      subtitle={totalDeuda > 0 ? fmt(totalDeuda) : undefined}
      fill
      emptyLabel="Sin clientes"
    >
      {leads.map(lead => <LeadCard key={lead.id} lead={lead} onSelect={onSelect} />)}
    </KanbanColumn>
  )
}

function DetailDrawer({ lead, onUpdate, onClose }: { lead: CobradorLead; onUpdate: (l: CobradorLead) => void; onClose: () => void }) {
  const [notes, setNotes] = useState(lead.notes ?? '')
  const [montoPagado, setMontoPagado] = useState(String(lead.monto_pagado + proximaCuota(lead)))
  const [savingNotes, setSavingNotes] = useState(false)
  const [savingMonto, setSavingMonto] = useState(false)
  const [movingTo, setMovingTo] = useState<string | null>(null)

  useEffect(() => {
    setNotes(lead.notes ?? '')
    setMontoPagado(String(lead.monto_pagado + proximaCuota(lead)))
  }, [lead.id])

  const handleMove = async (stageKey: string) => {
    setMovingTo(stageKey)
    try { const u = await updateCobradorStage(lead.id, stageKey); onUpdate(u); toast.success('Etapa actualizada') }
    catch { toast.error('Error al mover') }
    finally { setMovingTo(null) }
  }

  const handleSaveNotes = async () => {
    if (notes === (lead.notes ?? '')) return
    setSavingNotes(true)
    try { const u = await updateCobradorNotes(lead.id, notes); onUpdate(u); toast.success('Notas guardadas') }
    catch { toast.error('Error') }
    finally { setSavingNotes(false) }
  }

  const handleSaveMonto = async () => {
    const val = parseFloat(montoPagado) || 0
    if (val === lead.monto_pagado) return
    setSavingMonto(true)
    try { const u = await updateCobradorMontoPagado(lead.id, val); onUpdate(u); toast.success('Monto actualizado') }
    catch { toast.error('Error') }
    finally { setSavingMonto(false) }
  }

  const stageDef = STAGES.find(s => s.key === lead.stage)!
  const pendiente = Math.max(lead.monto_deuda - lead.monto_pagado, 0)
  const pct = lead.monto_deuda > 0 ? Math.min((lead.monto_pagado / lead.monto_deuda) * 100, 100) : 0

  return (
    <div className="fixed inset-0 z-50 flex" style={{ background: 'rgba(28,22,51,0.45)' }} onClick={onClose}>
      <div className="ml-auto h-full w-full max-w-sm flex flex-col overflow-hidden"
        style={{ background: '#ffffff', boxShadow: '-12px 0 40px rgba(28,22,51,0.15)', borderLeft: `1px solid ${DIVIDER}` }}
        onClick={e => e.stopPropagation()}>

        {/* Colored top band */}
        <div style={{ background: stageDef.headerGrad }} className="flex-shrink-0">
          <div className="px-5 pt-5 pb-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center font-black text-sm text-white flex-shrink-0"
                  style={{ background: 'rgba(255,255,255,0.22)' }}>
                  {initials(lead.nombre)}
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-black text-white leading-tight truncate">{lead.nombre}</h2>
                  {lead.empresa && <p className="text-xs text-white/65 truncate mt-0.5">{lead.empresa}</p>}
                </div>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg flex-shrink-0" style={{ background: 'rgba(255,255,255,0.22)' }}>
                <X size={14} color="white" />
              </button>
            </div>
          </div>
          <div className="px-5 py-3" style={{ background: 'rgba(0,0,0,0.12)' }}>
            <div className="h-1.5 rounded-full overflow-hidden mb-1.5" style={{ background: 'rgba(255,255,255,0.25)' }}>
              <div className="h-full rounded-full bg-white/85" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex justify-between text-[10px] text-white/70">
              <span>{fmt(lead.monto_pagado)} cobrado</span><span>{pct.toFixed(0)}%</span>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 divide-x flex-shrink-0" style={{ borderBottom: `1px solid ${DIVIDER}` }}>
          {[
            { label: 'Total',     value: fmt(lead.monto_deuda),  color: TEXT },
            { label: 'Cobrado',   value: fmt(lead.monto_pagado), color: '#10B981' },
            { label: 'Pendiente', value: fmt(pendiente),          color: pendiente > 0 ? '#EF4444' : '#10B981' },
          ].map(item => (
            <div key={item.label} className="px-3 py-3 text-center">
              <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: TEXT_MUTED }}>{item.label}</p>
              <p className="text-xs font-black" style={{ color: item.color }}>{item.value}</p>
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Stage movers */}
          <div className="px-4 pt-4 pb-3">
            <p className="text-[10px] font-black uppercase tracking-wider mb-3" style={{ color: TEXT_MUTED }}>Mover a etapa</p>
            <div className="space-y-2">
              {STAGES.filter(s => s.key !== lead.stage).map(s => (
                <button key={s.key} onClick={() => handleMove(s.key)} disabled={!!movingTo}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-80"
                  style={{ background: s.light, border: `1.5px solid ${s.border}`, color: s.color }}>
                  {movingTo === s.key
                    ? <div className="w-3.5 h-3.5 rounded-full border-2 animate-spin flex-shrink-0" style={{ borderColor: 'transparent', borderTopColor: s.color }} />
                    : <ArrowRight size={13} className="flex-shrink-0" />}
                  <span>{s.label}</span>
                  <span className="ml-auto text-[10px] opacity-50">{s.sublabel}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ height: 1, background: DIVIDER, margin: '0 16px' }} />

          {/* Monto */}
          <div className="px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: TEXT_MUTED }}>Monto cobrado acumulado ($)</p>
            <p className="text-[10px] mb-2" style={{ color: stageDef.color }}>
              Sugerido: {fmt(lead.monto_pagado + proximaCuota(lead))}
              {lead.monto_pagado === 0 && (lead.cuota_inicial ?? 0) > 0 ? ' (pago inicial)' : ' (+próx. cuota)'}
            </p>
            <div className="flex gap-2">
              <input className="input flex-1 text-sm" type="number" min="0" step="1000"
                value={montoPagado} onChange={e => setMontoPagado(e.target.value)} />
              <button onClick={handleSaveMonto} disabled={savingMonto}
                className="px-4 py-2 rounded-xl text-xs font-bold"
                style={{ background: 'rgba(124,58,237,0.10)', color: '#7c3aed', border: '1.5px solid rgba(124,58,237,0.22)' }}>
                {savingMonto ? '...' : 'OK'}
              </button>
            </div>
            {parseFloat(montoPagado) > 0 && (
              <p className="mt-1.5 text-sm font-black" style={{ color: '#7c3aed' }}>
                {fmt(parseFloat(montoPagado))}
              </p>
            )}
          </div>

          <div style={{ height: 1, background: DIVIDER, margin: '0 16px' }} />

          {/* Contact */}
          {(lead.telefono || lead.email || lead.rut) && (
            <>
              <div className="px-4 py-3 space-y-2">
                {lead.rut     && <div className="flex items-center gap-2 text-xs" style={{ color: TEXT_MUTED }}><TrendingUp size={12}/><span className="font-mono">{lead.rut}</span></div>}
                {lead.telefono && <div className="flex items-center gap-2 text-xs" style={{ color: TEXT_MUTED }}><Phone size={12}/><span>{lead.telefono}</span></div>}
                {lead.email   && <div className="flex items-center gap-2 text-xs" style={{ color: TEXT_MUTED }}><Mail size={12}/><span>{lead.email}</span></div>}
              </div>
              <div style={{ height: 1, background: DIVIDER, margin: '0 16px' }} />
            </>
          )}

          {/* Notes */}
          <div className="px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-wider mb-2" style={{ color: TEXT_MUTED }}>Notas</p>
            <textarea className="input w-full text-sm" rows={4} value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Observaciones, acuerdos de pago..." style={{ resize: 'vertical' }} />
            <button onClick={handleSaveNotes}
              disabled={savingNotes || notes === (lead.notes ?? '')}
              className="mt-2 w-full py-2 rounded-xl text-xs font-bold"
              style={{ background: 'rgba(124,58,237,0.08)', color: '#7c3aed', border: '1.5px solid rgba(124,58,237,0.20)', opacity: notes === (lead.notes ?? '') ? 0.4 : 1 }}>
              {savingNotes ? 'Guardando...' : 'Guardar Notas'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function CobradoresPipeline() {
  const [leads, setLeads] = useState<CobradorLead[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<CobradorLead | null>(null)

  const loadLeads = () => {
    getCobradorLeads()
      .then((data: CobradorLead[]) => {
        setLeads(data)
        setSelected(prev => prev ? (data.find(l => l.id === prev.id) ?? null) : null)
      })
      .catch(() => toast.error('Error cargando pipeline'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    setLoading(true)
    loadLeads()
  }, [])

  useRealtime(['cobrador_sync', 'lead_update'], () => loadLeads())

  const handleUpdate = (updated: CobradorLead) => {
    setLeads(prev => prev.map(l => l.id === updated.id ? updated : l))
    setSelected(updated)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(28,22,51,0.10)', borderTopColor: '#7c3aed' }} />
      </div>
    )
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 72px)' }}>
      {/* Header */}
      <div className="mb-5 flex-shrink-0 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-black" style={{ color: TEXT, fontFamily: '"Space Grotesk", sans-serif' }}>
            Pipeline de Cobranza
          </h1>
          <p className="text-sm mt-0.5" style={{ color: TEXT_MUTED }}>
            {leads.length} cliente{leads.length !== 1 ? 's' : ''} en cartera · pendiente{' '}
            <strong style={{ color: '#EF4444' }}>
              {fmt(leads.reduce((a, l) => a + Math.max(l.monto_deuda - l.monto_pagado, 0), 0))}
            </strong>
          </p>
        </div>
        <div className="flex items-center gap-5">
          {STAGES.map(s => {
            const count = leads.filter(l => l.stage === s.key).length
            return (
              <div key={s.key} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                <span className="text-xs font-semibold" style={{ color: TEXT_MUTED }}>{count} {s.label}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Kanban — full width equal columns */}
      <KanbanBoard layout="fill">
        {STAGES.map(stage => (
          <CobradorColumn key={stage.key} stage={stage}
            leads={leads.filter(l => l.stage === stage.key)}
            onSelect={setSelected} />
        ))}
      </KanbanBoard>

      {selected && (
        <DetailDrawer key={selected.id} lead={selected} onUpdate={handleUpdate} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
