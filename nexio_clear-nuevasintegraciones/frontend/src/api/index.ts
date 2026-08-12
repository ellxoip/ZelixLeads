import api from './client'

// AUTH
export const login = (email: string, password: string) =>
  api.post('/api/auth/login', { email, password }).then(r => r.data)
export const getMe = () => api.get('/api/auth/me').then(r => r.data)

// USERS
export const getUsers = (params?: any) => api.get('/api/users', { params }).then(r => r.data)
export const createUser = (data: any) => api.post('/api/users', data).then(r => r.data)
export const updateUser = (id: number, data: any) => api.put(`/api/users/${id}`, data).then(r => r.data)
export const deleteUser = (id: number) => api.delete(`/api/users/${id}`).then(r => r.data)
export const clearDashboard = () => api.post('/api/users/clear-dashboard').then(r => r.data)

// GROUPS
export const getGroups = () => api.get('/api/groups').then(r => r.data)
export const createGroup = (data: any) => api.post('/api/groups', data).then(r => r.data)
export const updateGroup = (id: number, data: any) => api.put(`/api/groups/${id}`, data).then(r => r.data)
export const deleteGroup = (id: number) => api.delete(`/api/groups/${id}`).then(r => r.data)
export const getGroupAreas = (groupId: number) => api.get(`/api/groups/${groupId}/areas`).then(r => r.data)
export const getAllAreas = () => api.get('/api/groups/all-areas').then(r => r.data)
export const getGroupDefaultAssignment = (groupId: number, areaId?: number) =>
  api.get(`/api/groups/${groupId}/default-assignment`, { params: areaId ? { area_id: areaId } : {} }).then(r => r.data)
export const assignUserToArea  = (areaId: number, userId: number) => api.post(`/api/groups/areas/${areaId}/users/${userId}`).then(r => r.data)
export const removeUserFromArea = (areaId: number, userId: number) => api.delete(`/api/groups/areas/${areaId}/users/${userId}`).then(r => r.data)
export const getGroupMembers = (groupId: number) => api.get(`/api/groups/${groupId}/members`).then(r => r.data)
export const assignUserToGroup = (groupId: number, userId: number) => api.post(`/api/groups/${groupId}/members/${userId}`).then(r => r.data)
export const removeUserFromGroup = (groupId: number, userId: number) => api.delete(`/api/groups/${groupId}/members/${userId}`).then(r => r.data)
export const createArea = (groupId: number, data: any) => api.post(`/api/groups/${groupId}/areas`, data).then(r => r.data)
export const updateArea = (areaId: number, data: any) => api.put(`/api/groups/areas/${areaId}`, data).then(r => r.data)
export const deleteArea = (areaId: number) => api.delete(`/api/groups/areas/${areaId}`).then(r => r.data)
export const getGroupWhatsApp = (groupId: number) => api.get(`/api/groups/${groupId}/whatsapp`).then(r => r.data)
export const createWhatsApp = (groupId: number, data: any) => api.post(`/api/groups/${groupId}/whatsapp`, data).then(r => r.data)
export const updateWhatsApp = (configId: number, data: any) => api.put(`/api/groups/whatsapp/${configId}`, data).then(r => r.data)
export const deleteWhatsApp = (configId: number) => api.delete(`/api/groups/whatsapp/${configId}`).then(r => r.data)
export const getAllWhatsAppConfigs = () => api.get('/api/whatsapp/configs').then(r => r.data)

// CONTACTS
export const getContacts = (params?: any) =>
  api.get('/api/contacts', { params: { page_size: 500, ...params } }).then(r => {
    const d = r.data
    return Array.isArray(d) ? d : (d.items ?? [])
  })
export const getContactsPaged = (params?: any) =>
  api.get('/api/contacts', { params }).then(r => r.data as { items: any[]; total: number; page: number; pages: number; page_size: number })
export const createContact = (data: any) => api.post('/api/contacts', data).then(r => r.data)
export const updateContact = (id: number, data: any) => api.put(`/api/contacts/${id}`, data).then(r => r.data)
export const deleteContact = (id: number, force = false) =>
  api.delete(`/api/contacts/${id}${force ? '?force=true' : ''}`).then(r => r.data)
export const exportContacts = async (params?: any) => {
  const resp = await api.get('/api/contacts/export/csv', { params, responseType: 'blob' })
  const url  = URL.createObjectURL(new Blob([resp.data], { type: 'text/csv;charset=utf-8;' }))
  const a    = document.createElement('a')
  a.href     = url
  a.download = `contactos_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

// LEADS
export const getLeads = (params?: any) => api.get('/api/leads', { params }).then(r => r.data)
export const getLeadsCount = (params?: any) => api.get('/api/leads/count', { params }).then(r => r.data)
export const getPipelineSummary = (params?: any) =>
  api.get('/api/leads/pipeline-summary', { params }).then(r => r.data as Record<string, { count: number; leads: any[] }>)
export const getInactiveLeads = (params?: { days?: number; group_id?: number }) =>
  api.get('/api/leads/inactive-leads', { params }).then(r => r.data as any[])
export const getAgentQueue = (params?: { group_id?: number }) =>
  api.get('/api/leads/agent-queue', { params }).then(r => r.data as { count: number; leads: any[] })
export const dismissAgentLead = (leadId: number) =>
  api.patch(`/api/leads/${leadId}/dismiss-agent`).then(r => r.data)
export const createLead = (data: any) => api.post('/api/leads', data).then(r => r.data)
export const getLead = (id: number) => api.get(`/api/leads/${id}`).then(r => r.data)
export const updateLead = (id: number, data: any) => api.put(`/api/leads/${id}`, data).then(r => r.data)
export const advanceLead = (id: number, data: { result: string; notes?: string }) =>
  api.post(`/api/leads/${id}/advance`, data).then(r => r.data)
export const moveLeadStage = (id: number, data: { stage: string; notes?: string; payment_commitment_date?: string }) =>
  api.post(`/api/leads/${id}/move-stage`, data).then(r => r.data)
export const getLeadHistory = (id: number) => api.get(`/api/leads/${id}/history`).then(r => r.data)
export const retryPagacuotas = (id: number) => api.post(`/api/leads/${id}/retry-pagacuotas`).then(r => r.data)
export const requestOt = (leadId: number) => api.post(`/api/leads/${leadId}/request-ot`).then(r => r.data)

// ── Nexio Copilot — insights proactivos ──
import type { Insight } from '../components/copilot/types'
export const getInsights = (): Promise<Insight[]> => api.get('/api/insights').then(r => r.data)
export const dismissInsight = (id: string) => api.post(`/api/insights/${encodeURIComponent(id)}/dismiss`).then(r => r.data)
export const deleteLead = (id: number) => api.delete(`/api/leads/${id}`).then(r => r.data)
export const getDashboardStats = (params?: any) => api.get('/api/leads/stats/dashboard', { params }).then(r => r.data)
export const getDashboardDetail = (metric: string, params?: any) => api.get('/api/leads/stats/dashboard-detail', { params: { metric, ...params } }).then(r => r.data)
export const exportLeads = async (params?: any) => {
  const resp = await api.get('/api/leads/export/csv', { params, responseType: 'blob' })
  const url  = URL.createObjectURL(new Blob([resp.data], { type: 'text/csv;charset=utf-8;' }))
  const a    = document.createElement('a')
  a.href     = url
  a.download = `clientes_${new Date().toISOString().slice(0,10)}.csv`
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}
export const searchLeads = (q: string) => api.get('/api/leads', { params: { search: q, limit: 8 } }).then(r => r.data)

// ── Buscador Global 360 ──────────────────────────────────────────────
export type SearchAction =
  | { kind: 'drawer'; leadId: number }
  | { kind: 'navigate'; to: string }
export interface SearchItem {
  id?: number
  title: string
  subtitle?: string
  badge?: { label: string; stage: string }
  action: SearchAction
}
export interface SearchGroup {
  type: string
  label: string
  has_more: boolean
  items: SearchItem[]
}
export interface SearchResponse { q: string; groups: SearchGroup[] }
export const globalSearch = (q: string): Promise<SearchResponse> =>
  api.get('/api/search', { params: { q } }).then(r => r.data)

// COBRADOR
export const getCobradorLeads = (params?: any) => api.get('/api/cobrador/leads', { params }).then(r => r.data)
export const getCobradorLead = (id: number) => api.get(`/api/cobrador/leads/${id}`).then(r => r.data)
export const updateCobradorStage = (id: number, stage: string) =>
  api.patch(`/api/cobrador/leads/${id}/stage`, { stage }).then(r => r.data)
export const updateCobradorNotes = (id: number, notes: string) =>
  api.patch(`/api/cobrador/leads/${id}/notes`, { notes }).then(r => r.data)
export const updateCobradorMontoPagado = (id: number, monto_pagado: number) =>
  api.patch(`/api/cobrador/leads/${id}/monto_pagado`, { monto_pagado }).then(r => r.data)
export const getCobradorDashboard = () => api.get('/api/cobrador/dashboard').then(r => r.data)
export const getCobradorCarteras = () => api.get('/api/users/cobradores/carteras').then(r => r.data)
export const deleteCobradorLead = (id: number) => api.delete(`/api/users/cobradores/leads/${id}`).then(r => r.data)
export const setCobradorArea = (userId: number, area: string | null) => api.patch(`/api/users/${userId}/cobrador-area`, { cobrador_area: area }).then(r => r.data)
export const getCobradorHistorial = (params?: any) => api.get('/api/cobrador/historial', { params }).then(r => r.data)
export const syncCobradorLeads = () => api.post('/api/cobrador/sync').then(r => r.data)
export const getCobradorPortalUrl = (id: number) => api.get(`/api/cobrador/leads/${id}/portal-url`).then(r => r.data)
export const markCobradorLeadSeen = (id: number) => api.patch(`/api/cobrador/leads/${id}/seen`).then(r => r.data)
export const markCobradorContactado = (id: number) => api.patch(`/api/cobrador/leads/${id}/contactado`).then(r => r.data)
export const unmarkCobradorContactado = (id: number) => api.patch(`/api/cobrador/leads/${id}/descontactar`).then(r => r.data)
export const sendCobradorEmail = (id: number, subject: string, body: string, to?: string) =>
  api.post(`/api/cobrador/leads/${id}/email`, { subject, body, to }).then(r => r.data)
export const getGmailStatus = () => api.get('/api/google/gmail/status').then(r => r.data)
export const getGmailAuthUrl = () => api.get('/api/google/gmail/auth-url').then(r => r.data)
export const disconnectGmail = () => api.delete('/api/google/gmail/disconnect').then(r => r.data)

// PAYMENTS
export const getPayments = (params?: any) => api.get('/api/payments', { params }).then(r => r.data)
export const confirmPayment = (id: number, data: any) => api.put(`/api/payments/${id}/confirm`, data).then(r => r.data)
export const revertPayment = (id: number) => api.post(`/api/payments/${id}/revert`).then(r => r.data)
export const uploadPaymentInvoice = (pvId: number, file: File) => {
  const fd = new FormData(); fd.append('file', file)
  return api.post(`/api/payments/${pvId}/invoice`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data as { invoice_url: string })
}
export const exportPayments = async (params?: any) => {
  const resp = await api.get('/api/payments/export', { params, responseType: 'blob' })
  const url  = URL.createObjectURL(new Blob([resp.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a    = document.createElement('a')
  a.href     = url
  a.download = `pagos_${new Date().toISOString().slice(0,10)}.xlsx`
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

// SETTINGS
export const getStageLabels = () => api.get('/api/settings/stage-labels').then(r => r.data)
export const updateStageLabels = (data: Record<string, string>) => api.put('/api/settings/stage-labels', data).then(r => r.data)
export const getCobradorStageLabels = () => api.get('/api/settings/cobrador-stage-labels').then(r => r.data)
export const updateCobradorStageLabels = (data: Record<string, string>) => api.put('/api/settings/cobrador-stage-labels', data).then(r => r.data)
export const getSeguimientoDias = () => api.get('/api/settings/seguimiento-dias').then(r => r.data)
export const updateSeguimientoDias = (dias: number) => api.put('/api/settings/seguimiento-dias', { dias }).then(r => r.data)
export const listOtTemplates = () => api.get('/api/settings/ot-templates').then(r => r.data)
export const getOtTemplate = (type: string) => api.get(`/api/settings/ot-templates/${type}`).then(r => r.data)
export const updateOtTemplate = (type: string, overrides: Record<string, string[]>) => api.put(`/api/settings/ot-templates/${type}`, { overrides }).then(r => r.data)
export const resetOtTemplate = (type: string) => api.delete(`/api/settings/ot-templates/${type}`).then(r => r.data)

// PIPELINE STAGES (non-abogados negocios)
export const getPipelineStages = () => api.get('/api/pipeline-stages').then(r => r.data)
export const createPipelineStage = (data: any) => api.post('/api/pipeline-stages', data).then(r => r.data)
export const updatePipelineStage = (id: number, data: any) => api.put(`/api/pipeline-stages/${id}`, data).then(r => r.data)
export const deletePipelineStage = (id: number) => api.delete(`/api/pipeline-stages/${id}`).then(r => r.data)

// CALENDAR
export const getCalendarEvents = (params?: any) => api.get('/api/calendar', { params }).then(r => r.data)
export const createCalendarEvent = (data: any) => api.post('/api/calendar', data).then(r => r.data)
export const getCalendarSlots = (userId: number, date: string) =>
  api.get('/api/calendar/slots', { params: { user_id: userId, date } }).then(r => r.data)
export const updateCalendarEvent = (id: number, data: any) => api.put(`/api/calendar/${id}`, data).then(r => r.data)
export const deleteCalendarEvent = (id: number) => api.delete(`/api/calendar/${id}`).then(r => r.data)

// NOTIFICATIONS
export const getNotifications = (params?: any) => api.get('/api/notifications', { params }).then(r => r.data)
export const getNotificationCount = () => api.get('/api/notifications/count').then(r => r.data)
export const markNotificationRead = (id: number) => api.post(`/api/notifications/${id}/read`).then(r => r.data)
export const markAllRead = () => api.post('/api/notifications/read-all').then(r => r.data)

// WHATSAPP
export const sendWhatsAppMessage = (data: any) => api.post('/api/whatsapp/send', data).then(r => r.data)
export const sendWhatsAppMedia = (formData: FormData) =>
  api.post('/api/whatsapp/send-media', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
export const getWhatsAppMessages = (params?: any) => api.get('/api/whatsapp/messages', { params }).then(r => r.data)
export const getConversations = () => api.get('/api/whatsapp/conversations').then(r => r.data)
export const markMessagesRead = (contactId: number) => api.post(`/api/whatsapp/messages/${contactId}/read`).then(r => r.data)
export const deleteWhatsAppMessage = (id: number) => api.delete(`/api/whatsapp/messages/${id}`).then(r => r.data)
export const editWhatsAppMessage = (id: number, content: string) => api.patch(`/api/whatsapp/messages/${id}`, { content }).then(r => r.data)
export const retryWhatsAppMessage = (id: number) => api.post(`/api/whatsapp/messages/${id}/retry`).then(r => r.data)

// TECNICO
export const getTecnicoStats = () => api.get('/api/tecnico/stats').then(r => r.data)
export const getTecnicoWhatsApp = () => api.get('/api/tecnico/whatsapp').then(r => r.data)
export const createTecnicoWhatsApp = (data: any) => api.post('/api/tecnico/whatsapp', data).then(r => r.data)
export const updateTecnicoWhatsApp = (id: number, data: any) => api.put(`/api/tecnico/whatsapp/${id}`, data).then(r => r.data)
export const deleteTecnicoWhatsApp = (id: number) => api.delete(`/api/tecnico/whatsapp/${id}`).then(r => r.data)
export const toggleTecnicoWhatsApp = (id: number) => api.patch(`/api/tecnico/whatsapp/${id}/toggle`).then(r => r.data)
export const getGoogleOAuthSettings = () => api.get('/api/tecnico/google-settings').then(r => r.data)
export const updateGoogleOAuthSettings = (data: any) => api.put('/api/tecnico/google-settings', data).then(r => r.data)
export const getTecnicoUsers = () => api.get('/api/tecnico/users').then(r => r.data)

// CALENDAR extra
export const getGroupVendors = () => api.get('/api/calendar/group-vendors').then(r => r.data)
export const getVendorPipeline = (params?: any) => api.get('/api/calendar/vendor-pipeline', { params }).then(r => r.data)
export const getAgendadoraFollowup = () => api.get('/api/calendar/agendadora-followup').then(r => r.data)
export const updateVendorStatus = (eventId: number, vendor_status: string, notes?: string) =>
  api.patch(`/api/calendar/${eventId}/vendor-status`, { vendor_status, ...(notes ? { notes } : {}) }).then(r => r.data)

export const runRecoveryAutomation = () =>
  api.post('/api/leads/run-recovery-automation').then(r => r.data)

// WHATSAPP extra
export const getAvailableWhatsApp = (excludeAreaId?: number) =>
  api.get('/api/whatsapp/available', { params: excludeAreaId ? { exclude_area_id: excludeAreaId } : {} }).then(r => r.data)
export const getUnreadByContact = () => api.get('/api/whatsapp/unread-by-contact').then(r => r.data)

// PUSH NOTIFICATIONS
export const getPushVapidKey = () => api.get('/api/push/vapid-key').then(r => r.data)
export const subscribePush = (data: { endpoint: string; p256dh: string; auth: string }) =>
  api.post('/api/push/subscribe', data).then(r => r.data)
export const unsubscribePush = (endpoint: string) =>
  api.delete('/api/push/unsubscribe', { params: { endpoint } }).then(r => r.data)

// GOOGLE CALENDAR
export const getGoogleStatus = () => api.get('/api/google/status').then(r => r.data)
export const getGoogleAuthUrl = () => api.get('/api/google/auth-url').then(r => r.data)
export const disconnectGoogle = () => api.delete('/api/google/disconnect').then(r => r.data)
export const getGoogleEvents = (params?: any) => api.get('/api/google/events', { params }).then(r => r.data)
export const syncEventToGoogle = (eventId: number) => api.post(`/api/google/sync-event/${eventId}`).then(r => r.data)
export const syncAllToGoogle = () => api.post('/api/google/sync-all').then(r => r.data)

// AT INFORMA INTEGRATION
export const getAtInformaAbogados = () =>
  api.get('/api/at_informa/abogados').then(r => r.data)
export const syncVendedoresFromAtInforma = () =>
  api.post('/api/at_informa/sync_vendedores').then(r => r.data)

// CONTACTS BULK IMPORT
export const bulkImportContacts = (formData: FormData) =>
  api.post('/api/contacts/bulk-import', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)

// PDF
export const downloadLeadPdf = async (leadId: number, contactName?: string) => {
  const resp = await api.get(`/api/pdf/lead/${leadId}`, {
    responseType: 'blob',
    // Don't let axios transform the error — we need to read the blob
    validateStatus: (s) => s < 500,
  })
  if (resp.status !== 200) {
    // Try to read error message from blob
    const text = await (resp.data as Blob).text().catch(() => '')
    let detail = 'Error generando PDF'
    try { detail = JSON.parse(text)?.detail || detail } catch { /* ignore */ }
    throw new Error(detail)
  }
  const url  = URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }))
  const a    = document.createElement('a')
  a.href     = url
  const safeName = (contactName ?? 'CLIENTE').toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '')
  a.download = `FICHA_${safeName}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export const syncWhatsAppChats = (configId: number) => api.post(`/api/whatsapp/sync-chats/${configId}`).then(r => r.data)
export const sendTypingPresence = (config_id: number, contact_id: number, typing: boolean) =>
  api.post('/api/whatsapp/typing', { config_id, contact_id, typing }).then(r => r.data)
export const syncFullHistory = (configId: number) => api.post(`/api/whatsapp/sync-full-history/${configId}`).then(r => r.data)

// NEGOCIOS
export const getNegocios = () => api.get('/api/tecnico/negocios').then(r => r.data)
export const createNegocio = (data: any) => api.post('/api/tecnico/negocios', data).then(r => r.data)
export const patchNegocio = (id: number, data: any) => api.patch(`/api/tecnico/negocios/${id}`, data).then(r => r.data)
export const deleteNegocio = (id: number) => api.delete(`/api/tecnico/negocios/${id}`)
export const patchNegocioAdmin = (id: number, data: any) => api.patch(`/api/tecnico/negocios/${id}/admin`, data).then(r => r.data)
export const patchNegocioPlan = (id: number, data: { plan: string; plan_expires_at?: string | null }) => api.patch(`/api/tecnico/negocios/${id}/plan`, data).then(r => r.data)

// AI AGENTS
export const getAIAgents = () => api.get('/api/ai-agents').then(r => r.data)
export const createAIAgent = (data: any) => api.post('/api/ai-agents', data).then(r => r.data)
export const updateAIAgent = (id: number, data: any) => api.put(`/api/ai-agents/${id}`, data).then(r => r.data)
export const toggleAIAgent = (id: number) => api.patch(`/api/ai-agents/${id}/toggle`).then(r => r.data)
export const updateAIAgentSchedule = (id: number, start: string | null, end: string | null) =>
  api.patch(`/api/ai-agents/${id}/schedule`, { business_hours_start: start, business_hours_end: end }).then(r => r.data)
export const deleteAIAgent = (id: number) => api.delete(`/api/ai-agents/${id}`).then(r => r.data)
export const getAIAgentLogs = (id: number, limit = 50) => api.get(`/api/ai-agents/${id}/logs`, { params: { limit } }).then(r => r.data)
export const assignAgentWhatsApp = (agentId: number, whatsappConfigId: number | null) =>
  api.patch(`/api/ai-agents/${agentId}/assign-whatsapp`, { whatsapp_config_id: whatsappConfigId }).then(r => r.data)
export const addAgentConfig = (agentId: number, whatsapp_config_id: number) =>
  api.post(`/api/ai-agents/${agentId}/configs`, { whatsapp_config_id }).then(r => r.data)
export const removeAgentConfig = (agentId: number, configId: number) =>
  api.delete(`/api/ai-agents/${agentId}/configs/${configId}`).then(r => r.data)
export const getContactAgentState = (contactId: number) => api.get(`/api/ai-agents/contact-state/${contactId}`).then(r => r.data)
export const setContactAgentState = (agentId: number, contactId: number, state: string) =>
  api.post(`/api/ai-agents/${agentId}/contact/${contactId}/state`, { state }).then(r => r.data)

// SECURITY AUDIT LOG (ISO 27001)
export const getAuditLog = (params?: any) => api.get('/api/security/audit-log', { params }).then(r => r.data)
export const getSecurityStats = () => api.get('/api/security/stats').then(r => r.data)
export const getLockedUsers = () => api.get('/api/security/locked-users').then(r => r.data)
export const unlockUser = (userId: number) => api.post(`/api/security/unlock/${userId}`).then(r => r.data)

// WORK ORDERS (OT)
export const getOTTypes = () => api.get('/api/work-orders/types').then(r => r.data)
export const listWorkOrders = (lead_id: number) => api.get('/api/work-orders', { params: { lead_id } }).then(r => r.data)
export const getWorkOrder = (id: number) => api.get(`/api/work-orders/${id}`).then(r => r.data)
export const createWorkOrder = (data: any) => api.post('/api/work-orders', data).then(r => r.data)
export const updateWorkOrder = (id: number, data: any) => api.patch(`/api/work-orders/${id}`, data).then(r => r.data)
export const deleteWorkOrder = (id: number) => api.delete(`/api/work-orders/${id}`).then(r => r.data)
export const aiFillWorkOrder = (id: number) => api.post(`/api/work-orders/${id}/ai-fill`).then(r => r.data)
export const downloadWorkOrderPdf = async (id: number, nombre: string, ot_type: string) => {
  const resp = await api.get(`/api/work-orders/${id}/pdf`, { responseType: 'blob' })
  const url  = URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }))
  const a    = document.createElement('a')
  a.href     = url
  const safe = nombre.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '').toUpperCase()
  a.download = `OT_${ot_type.toUpperCase()}_${safe}.pdf`
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

// SEGUIMIENTO ASISTENTE
export const getSeguimientoLeads = () => api.get('/api/seguimiento-asistente/leads').then(r => r.data)
export const getMensajePago = (lead_id: number) => api.get(`/api/seguimiento-asistente/leads/${lead_id}/mensaje-pago`).then(r => r.data)
export const getSeguimientoDashboard = () => api.get('/api/seguimiento-asistente/dashboard').then(r => r.data)
export const updateSeguimientoStatus = (lead_id: number, data: any) => api.patch(`/api/seguimiento-asistente/leads/${lead_id}/status`, data).then(r => r.data)
export const ejecutarAccionSeguimiento = (lead_id: number, accion: string, extra?: { fecha?: string; notes?: string }) =>
  api.post(`/api/seguimiento-asistente/leads/${lead_id}/accion`, { accion, ...extra }).then(r => r.data)

// ANALISTA DASHBOARD
export const getAnalistaDashboard = (_unused?: any, from?: string, to?: string) =>
  api.get('/api/analista/dashboard', { params: { from, to } }).then(r => r.data)
export const getAnalistaCarteras = (from?: string, to?: string) =>
  api.get('/api/analista/carteras', { params: { from_date: from, to_date: to } }).then(r => r.data)
export const getAnalistaCarterasDetalle = (from?: string, to?: string) =>
  api.get('/api/analista/carteras/detalle', { params: { from_date: from, to_date: to } }).then(r => r.data)
export const getPanelAnalistaStats = (params: { date_from?: string; date_to?: string; period?: string }) =>
  api.get('/api/leads/stats/panel-analista', { params }).then(r => r.data)

// NEXIN (asistente conversacional)
export const nexinChat = (messages: { role: string; content: string }[]) =>
  api.post('/api/nexin/chat', { messages }).then(r => r.data as { reply: string; model?: string })

// INTEGRACIONES (panel de salud del superadmin)
export const getIntegrationsPanel = () =>
  api.get('/api/integrations/panel').then(r => r.data as { ok: boolean; integrations: any[]; timestamp: string })
export const reconcileRut = (rut: string) =>
  api.get('/api/integrations/reconcile', { params: { rut } }).then(r => r.data as any)
export const getIntegrationsHealth = () =>
  api.get('/api/integrations/health').then(r => r.data as {
    ok: boolean
    hops: Record<string, { url: string | null; ok: boolean; live: { reachable: boolean; status_code: number | null; latency_ms: number | null; error: string | null } }>
  })


// ── Mis números de WhatsApp (API oficial de Meta) ──────────────────────────
// Reemplazan a las sesiones por QR, retiradas con Baileys. El servidor le
// pregunta a Meta si el token manda sobre el número antes de guardarlo.
export const getMisNumeros = () => api.get('/api/whatsapp/mis-numeros').then(r => r.data)
export const vincularMiNumero = (d: { name?: string; phone_number_id: string; api_token: string }) =>
  api.post('/api/whatsapp/mis-numeros', d).then(r => r.data)
export const desvincularMiNumero = (id: number) =>
  api.delete(`/api/whatsapp/mis-numeros/${id}`).then(r => r.data)
