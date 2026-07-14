// Bus de eventos de lead en el MISMO tab — complementa el SSE (`lead_update`).
//
// Por qué existe: el SSE repinta todas las superficies cuando el servidor emite,
// pero (a) hay una latencia de ida y vuelta y (b) si el SSE está caído no hay
// red de seguridad. Este bus dispara un refresco instantáneo en el mismo tab.
//
// Nombre de evento mantenido ('lead-stage-changed') para que los emisores ya
// existentes (Pipeline, Layout) sigan funcionando sin cambios.

const EVT = 'lead-stage-changed'

export interface LeadChangedDetail {
  leadId?: number
  stage?: string
}

/** Notifica que un lead cambió (etapa, datos, etc.) en este tab. */
export function emitLeadChanged(detail?: LeadChangedDetail) {
  window.dispatchEvent(new CustomEvent(EVT, { detail }))
}

/** Suscribe a cambios de lead en este tab. Devuelve la función de limpieza. */
export function onLeadChanged(cb: (detail?: LeadChangedDetail) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<LeadChangedDetail>).detail)
  window.addEventListener(EVT, handler)
  return () => window.removeEventListener(EVT, handler)
}
