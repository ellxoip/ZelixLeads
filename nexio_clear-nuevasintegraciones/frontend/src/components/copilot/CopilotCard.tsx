import { Zap, Calendar, Wrench, Copy, Sparkles, X, ArrowRight } from 'lucide-react'
import { ZelixLeadsLogo } from '../ZelixLeadsLogo'
import type { Insight } from './types'

const TYPE_STYLE: Record<Insight['type'], { accent: string; glow: string; Icon: typeof Zap; tag: string }> = {
  cooling:           { accent: '#f59e0b', glow: 'rgba(245,158,11,0.20)', Icon: Zap,      tag: 'Inactividad' },
  missing_meeting:   { accent: '#0ea5e9', glow: 'rgba(14,165,233,0.20)', Icon: Calendar, tag: 'Sin agenda' },
  close_opportunity: { accent: '#a3e635', glow: 'rgba(163,230,53,0.22)', Icon: Wrench,   tag: 'Oportunidad' },
  duplicate:         { accent: '#ef4444', glow: 'rgba(239,68,68,0.22)',  Icon: Copy,     tag: 'Conflicto' },
  orphan:            { accent: '#f59e0b', glow: 'rgba(245,158,11,0.22)', Icon: Sparkles, tag: 'Extracción IA' },
  duplicate_orphan:  { accent: '#ef4444', glow: 'rgba(239,68,68,0.22)',  Icon: Copy,     tag: 'Conflicto' },
}

export default function CopilotCard({ insight, onAct, onDismiss }: {
  insight: Insight
  onAct: (i: Insight) => void
  onDismiss: (i: Insight) => void
}) {
  const s = TYPE_STYLE[insight.type]
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-4 flex flex-col gap-3 transition-transform hover:-translate-y-0.5"
      style={{
        background: 'var(--surface-1)',
        border: `1px solid ${s.accent}33`,
        boxShadow: `0 10px 28px -14px ${s.glow}`,
      }}
    >
      {/* Halo neón sutil */}
      <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full blur-2xl pointer-events-none"
        style={{ background: s.glow }} />

      <div className="flex items-start gap-3">
        {/* Isotipo Nexio con pulso animado (animate-ping en el halo) */}
        <div className="relative flex-shrink-0 w-9 h-9">
          <span className="absolute inset-0 rounded-xl animate-ping"
            style={{ background: s.glow }} />
          <div className="relative w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--surface-2)', border: `1px solid ${s.accent}40` }}>
            <ZelixLeadsLogo size={20} />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <s.Icon size={13} style={{ color: s.accent }} />
            <h4 className="text-sm font-bold text-white truncate">{insight.title}</h4>
            <span className="ml-auto text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full flex-shrink-0"
              style={{ background: `${s.accent}1f`, color: s.accent }}>{s.tag}</span>
          </div>
          <p className="text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--text-muted)' }}>
            {insight.contact_name && <span className="font-semibold text-white/80">{insight.contact_name}</span>}
            {insight.contact_name ? ' · ' : ''}{insight.reason}
          </p>
          {typeof insight.score_confianza === 'number' && (
            <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md"
              style={{ background: `${s.accent}1f`, color: s.accent }}>
              🤖 {insight.score_confianza}% Confianza
            </span>
          )}
        </div>

        <button onClick={() => onDismiss(insight)} title="Descartar (24 h)"
          className="p-1 -mt-1 -mr-1 rounded-lg text-white/30 hover:text-white/70 transition-colors flex-shrink-0">
          <X size={14} />
        </button>
      </div>

      <button onClick={() => onAct(insight)}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold text-white transition-transform active:scale-[0.98]"
        style={{ background: s.accent }}>
        <Zap size={13} /> {insight.action_label} <ArrowRight size={13} className="opacity-80" />
      </button>
    </div>
  )
}
