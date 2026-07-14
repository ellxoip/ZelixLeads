import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'

// Encabezado + cuerpo de columna Kanban, presentacional y compartido por todos
// los tableros (Pipeline, Cobranza, etc.). Las TARJETAS son children — cada
// dominio mete las suyas. Esto unifica el "marco" (look & feel) sin tocar la
// lógica de negocio de cada tablero.

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const n = parseInt(full, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export interface KanbanColumnProps {
  title: string
  count: number
  color: string              // hex base — de él se derivan fondo/borde/contador
  subtitle?: string          // ej. total de honorarios/deuda ya formateado
  locked?: boolean
  /** Ancho fijo (px) para layout con scroll. Si se omite, la columna usa flex-1. */
  width?: number
  /** Si true, el cuerpo llena la altura disponible (flex). Si no, usa maxHeight. */
  fill?: boolean
  maxBodyHeight?: string
  emptyLabel?: string
  footer?: ReactNode
  children?: ReactNode
}

export default function KanbanColumn({
  title, count, color, subtitle, locked = false,
  width, fill = false, maxBodyHeight = 'calc(100vh - 270px)',
  emptyLabel = 'Vacío', footer, children,
}: KanbanColumnProps) {
  const { r, g, b } = hexToRgb(color)
  const headerBg = `rgba(${r},${g},${b},0.07)`
  const headerBorder = `rgba(${r},${g},${b},0.30)`
  const countBg = `rgba(${r},${g},${b},0.18)`

  return (
    <div
      className={`flex flex-col flex-shrink-0 snap-start ${width ? '' : 'flex-1 min-w-0'}`}
      style={width ? { minWidth: width, width } : undefined}
    >
      {/* ── Header ── */}
      <div className="rounded-xl mb-2 px-3 py-2.5 flex items-center justify-between"
        style={{
          background: `linear-gradient(135deg, ${headerBg} 0%, #ffffff 70%)`,
          border: `1px solid ${headerBorder}`,
          borderTop: `3px solid ${color}`,
          boxShadow: '0 1px 3px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(255,255,255,0.5)',
        }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex-shrink-0 w-2 h-2 rounded-full"
            style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
          <div className="min-w-0">
            <p className="font-bold text-[11px] leading-tight truncate uppercase"
              style={{ color: '#1c1633', fontFamily: '"Space Grotesk", sans-serif', letterSpacing: '0.02em' }}>
              {title}
              {locked && <Lock size={10} className="inline ml-1 opacity-40" />}
            </p>
            {subtitle && (
              <p className="text-[10px] mt-0.5 font-semibold" style={{ color: 'rgba(28,22,51,0.55)' }}>{subtitle}</p>
            )}
          </div>
        </div>
        <span className="text-[10px] font-bold min-w-[20px] h-5 rounded-md flex items-center justify-center px-1.5"
          style={{ background: countBg, color }}>
          {count}
        </span>
      </div>

      {/* ── Body ── */}
      <div className={`space-y-2 overflow-y-auto ${fill ? 'flex-1 min-h-0' : ''}`}
        style={fill ? { minHeight: 50 } : { maxHeight: maxBodyHeight, minHeight: 50 }}>
        {count === 0 && (
          <div className="text-center py-8 text-xs rounded-xl"
            style={{ color: 'rgba(28,22,51,0.45)', border: '1.5px dashed #cbd5e1', background: 'rgba(255,255,255,0.6)' }}>
            {emptyLabel}
          </div>
        )}
        {children}
        {footer}
      </div>
    </div>
  )
}
