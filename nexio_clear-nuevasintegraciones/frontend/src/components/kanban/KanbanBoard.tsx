import { createContext, type ReactNode } from 'react'

export type KanbanLayout = 'scroll' | 'fill' | 'vertical'

/**
 * El modo del tablero viaja por contexto y no por prop.
 *
 * Las columnas tienen que enterarse (en vertical ignoran su ancho fijo y dejan
 * de scrollear por dentro), y si cada página tuviera que pasarles el modo a
 * mano, bastaría con que una se olvidara para que ese tablero quedara a medio
 * cambiar. Así el tablero manda y las columnas obedecen.
 */
export const KanbanLayoutCtx = createContext<KanbanLayout>('scroll')

// Contenedor de tablero Kanban compartido. Tres modos:
//  - 'scroll' (default): columnas de ancho fijo con scroll horizontal.
//  - 'fill': columnas que reparten el ancho y llenan la altura.
//  - 'vertical': etapas APILADAS, una debajo de otra, cada una con sus leads en
//    lista. Se recorre bajando —como cualquier otra pantalla— en vez de
//    arrastrar de lado: en el embudo de ventas las últimas etapas quedaban
//    fuera de pantalla y había que descubrirlas deslizando.
export default function KanbanBoard({
  children,
  layout = 'scroll',
  background,
}: {
  children: ReactNode
  layout?: KanbanLayout
  background?: string
}) {
  if (layout === 'fill') {
    return (
      <KanbanLayoutCtx.Provider value="fill">
        <div className="flex-1 flex gap-4 min-h-0 pb-4">
          {children}
        </div>
      </KanbanLayoutCtx.Provider>
    )
  }
  if (layout === 'vertical') {
    return (
      <KanbanLayoutCtx.Provider value="vertical">
        {/* Scroll VERTICAL propio: el tablero es la zona que se recorre, y las
            etapas no llevan scroll interno — dos barras anidadas es justo lo
            que hace que uno no sepa cuál está moviendo. */}
        <div className="flex flex-col gap-4 overflow-y-auto pb-4 flex-1 rounded-xl p-3"
          style={{ background: background ?? '#f1f5f9' }}>
          {children}
        </div>
      </KanbanLayoutCtx.Provider>
    )
  }
  return (
    <KanbanLayoutCtx.Provider value="scroll">
      <div className="flex gap-5 overflow-x-auto pb-4 flex-1 rounded-xl p-3 snap-x snap-proximity md:snap-none"
        style={{ background: background ?? '#f1f5f9' }}>
        {children}
      </div>
    </KanbanLayoutCtx.Provider>
  )
}
