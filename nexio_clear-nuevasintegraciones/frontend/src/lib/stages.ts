// ───────────────────────────────────────────────────────────────────────────
// Fuente única de verdad del flujo de etapas del pipeline.
//
// Antes estos mapas vivían duplicados dentro de Pipeline.tsx (y parcialmente en
// otras pantallas). Centralizarlos aquí evita que las vistas se comporten
// distinto entre sí. Las ETIQUETAS de texto siguen en `types/index.ts`
// (STAGE_LABELS) que ya era la fuente compartida; este módulo cubre el flujo
// (siguiente/anterior), la paleta de color y la "acción sugerida".
// ───────────────────────────────────────────────────────────────────────────

export const MAIN_STAGES = [
  'lead', 'reunion', 'altamente_interesado', 'cierre',
  'pago_pendiente', 'pago_comprometido', 'pagado_confirmado',
] as const

export const RECOVERY_STAGES = [
  'recuperacion_lead', 'recuperacion_reunion', 'recuperacion_cierre', 'recuperacion_pago',
] as const

// Siguiente etapa "natural" del embudo — usado por el botón Avanzar.
export const NEXT_STAGE: Record<string, string> = {
  lead:                 'reunion',
  reunion:              'altamente_interesado',
  altamente_interesado: 'cierre',
  cierre:               'pago_pendiente',
  pago_pendiente:       'pagado_confirmado',
  pago_comprometido:    'pagado_confirmado',
  pagado_reunion:       'pagado_confirmado',
  recuperacion_lead:    'reunion',
  recuperacion_reunion: 'altamente_interesado',
  recuperacion_cierre:  'pago_comprometido',
  recuperacion_pago:    'pago_comprometido',
}

export const PREV_STAGE: Record<string, string> = {
  reunion:              'lead',
  altamente_interesado: 'reunion',
  cierre:               'altamente_interesado',
  pago_pendiente:       'cierre',
  pago_comprometido:    'cierre',
  pagado_reunion:       'reunion',
}

// Etapas cuyo avance SIEMPRE requiere datos extra que solo el modal puede
// capturar (p. ej. fecha comprometida de pago). Para estas, el botón Avanzar
// abre el modal directamente en vez de intentar un movimiento que el backend
// rechazaría. El resto se intenta en 1 clic, con fallback al modal si el
// backend pide algo que el modal puede resolver.
export const ADVANCE_NEEDS_MODAL = new Set<string>(['pago_comprometido'])

// Texto de "acción sugerida" que se muestra en la tarjeta para que el usuario
// sepa de un vistazo qué toca hacer ahora.
export const NEXT_ACTION: Record<string, string> = {
  lead:                 'Agendar reunión',
  reunion:              'Registrar resultado de la reunión',
  altamente_interesado: 'Generar OT y pasar a Cierre',
  cierre:               'Confirmar honorarios y enviar a pago',
  pago_pendiente:       'Enviar link de pago / registrar abono',
  pago_comprometido:    'Dar seguimiento al pago comprometido',
  pagado_reunion:       'Validar el pago de la reunión',
  recuperacion_lead:    'Reintentar contacto',
  recuperacion_reunion: 'Reagendar reunión',
  recuperacion_cierre:  'Retomar el cierre',
  recuperacion_pago:    'Recuperar el pago pendiente',
}

// Paleta única por etapa — hex + componentes rgb para construir rgba().
export const STAGE_PALETTE: Record<string, { hex: string; r: number; g: number; b: number }> = {
  lead:                 { hex: '#22c55e', r:  34, g: 197, b:  94 },
  reunion:              { hex: '#f97316', r: 249, g: 115, b:  22 },
  altamente_interesado: { hex: '#3b82f6', r:  59, g: 130, b: 246 },
  cierre:               { hex: '#8b5cf6', r: 139, g:  92, b: 246 },
  pago_pendiente:       { hex: '#f59e0b', r: 245, g: 158, b:  11 },
  pago_comprometido:    { hex: '#ef4444', r: 239, g:  68, b:  68 },
  pagado_reunion:       { hex: '#fb923c', r: 251, g: 146, b:  60 },
  pagado_confirmado:    { hex: '#14b8a6', r:  20, g: 184, b: 166 },
  recuperacion_lead:    { hex: '#ef4444', r: 239, g:  68, b:  68 },
  recuperacion_reunion: { hex: '#ef4444', r: 239, g:  68, b:  68 },
  recuperacion_cierre:  { hex: '#ef4444', r: 239, g:  68, b:  68 },
  recuperacion_pago:    { hex: '#ef4444', r: 239, g:  68, b:  68 },
  papelera:             { hex: '#6b7280', r: 107, g: 114, b: 128 },
}

export function getStagePalette(stage: string) {
  const p = STAGE_PALETTE[stage] ?? STAGE_PALETTE.lead
  const { hex, r, g, b } = p
  return {
    hex,
    bg:         `rgba(${r},${g},${b},0.07)`,
    border:     `rgba(${r},${g},${b},0.30)`,
    accent:     hex,
    countBg:    `rgba(${r},${g},${b},0.18)`,
    countColor: hex,
    honColor:   hex,
  }
}
