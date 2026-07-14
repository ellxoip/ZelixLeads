// Nexio Copilot — contrato de datos de las tarjetas de recomendación.

export type InsightType =
  | 'cooling' | 'missing_meeting' | 'close_opportunity'
  | 'duplicate' | 'orphan' | 'duplicate_orphan'   // 'duplicate_orphan' = legacy

export type InsightAction =
  | { kind: 'drawer'; leadId: number; tab?: 'resumen' | 'historial' | 'chat' }
  | { kind: 'agenda'; leadId: number }
  | { kind: 'work_order'; leadId: number }
  | { kind: 'autofill'; leadId: number; contactId: number; fields: Record<string, string> }

export interface Insight {
  id: string            // estable: `${type}:${lead_id}`
  lead_id: number
  type: InsightType
  priority: number      // 0..100 — orden de las tarjetas
  score_confianza?: number  // 0..100 — confianza de la inferencia (badge 🤖)
  title: string
  reason: string        // justificación perspicaz del porqué se infiere
  action_label: string
  action: InsightAction
  contact_name?: string | null
  created_at: string
}
