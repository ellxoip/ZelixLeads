import type { ReactNode } from 'react'

// Contenedor de tablero Kanban compartido. Dos modos:
//  - 'scroll' (default): columnas de ancho fijo con scroll horizontal (Pipeline).
//  - 'fill': columnas que reparten el ancho y llenan la altura (Cobranza).
export default function KanbanBoard({
  children,
  layout = 'scroll',
  background,
}: {
  children: ReactNode
  layout?: 'scroll' | 'fill'
  background?: string
}) {
  if (layout === 'fill') {
    return (
      <div className="flex-1 flex gap-4 min-h-0 pb-4">
        {children}
      </div>
    )
  }
  return (
    <div className="flex gap-5 overflow-x-auto pb-4 flex-1 rounded-xl p-3 snap-x snap-proximity md:snap-none"
      style={{ background: background ?? '#f1f5f9' }}>
      {children}
    </div>
  )
}
