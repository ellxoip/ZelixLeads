// Bus de eventos nativo y desacoplado para abrir el Drawer de Lead desde
// CUALQUIER componente (búsqueda global, notificaciones, etc.) sin acoplarlos
// al estado del Drawer ni recargar la página. Mismo patrón que `leadEvents`.

const EVT = 'open-lead-drawer'

// 'agenda' no es una pestaña visual: abre el Drawer en Resumen con la cascada
// de agendamiento (EventModal) ya desplegada — deriva directo al panel de agenda.
export type LeadDrawerTab = 'resumen' | 'historial' | 'chat' | 'agenda'
interface OpenDetail { leadId: number; initialTab?: LeadDrawerTab }

/** Despacha la apertura del Drawer para `leadId`, opcionalmente en una pestaña. */
export function openLeadDrawer(leadId: number, initialTab?: LeadDrawerTab): void {
  window.dispatchEvent(new CustomEvent<OpenDetail>(EVT, { detail: { leadId, initialTab } }))
}

/** Suscribe la apertura del Drawer. Devuelve la función de limpieza (evita leaks). */
export function onOpenLeadDrawer(cb: (leadId: number, initialTab?: LeadDrawerTab) => void): () => void {
  const handler = (e: Event) => {
    const d = (e as CustomEvent<OpenDetail>).detail
    cb(d.leadId, d.initialTab)
  }
  window.addEventListener(EVT, handler)
  return () => window.removeEventListener(EVT, handler)
}
