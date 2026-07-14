import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  getUsers, createUser, updateUser, deleteUser,
  getGroups, createGroup, updateGroup, deleteGroup,
  getGroupAreas, createArea, updateArea, deleteArea,
  getAvailableWhatsApp,
  getStageLabels, updateStageLabels,
  getCobradorStageLabels, updateCobradorStageLabels,
  getSeguimientoDias, updateSeguimientoDias,
  listOtTemplates, getOtTemplate, updateOtTemplate, resetOtTemplate,
  getPipelineStages, createPipelineStage, updatePipelineStage, deletePipelineStage,
  adminListWASessions, adminDeleteWASession,
  getAIAgents, createAIAgent, updateAIAgent, toggleAIAgent, deleteAIAgent, getAIAgentLogs,
  getAllWhatsAppConfigs, assignAgentWhatsApp, addAgentConfig, removeAgentConfig,
  getAuditLog, getSecurityStats, getLockedUsers, unlockUser,
  updateAIAgentSchedule,
  assignUserToArea, removeUserFromArea,
  getGroupMembers, assignUserToGroup, removeUserFromGroup,
  getCobradorCarteras, deleteCobradorLead, setCobradorArea, getAllAreas,
} from '../api'
import type { User, Group, Area, WhatsAppConfig } from '../types'
import { STAGE_LABELS as DEFAULT_STAGE_LABELS } from '../types'
import { Users, Building, Plus, Edit2, Trash2, X, Shield, GitBranch, Phone, ChevronRight, Layers, Smartphone, Wifi, WifiOff, RefreshCw, UserCheck, UserMinus, Bot, Zap, ChevronDown, ChevronUp, Eye, Clock, MessageSquare, ToggleLeft, ToggleRight, GripVertical, Loader2, Settings, FileText, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/auth'
import { useConfirm } from '../components/ConfirmDialog'

type Tab = 'users' | 'groups' | 'pipeline' | 'whatsapp_sessions' | 'ai_agents' | 'security' | 'cobrador_carteras' | 'configuracion'

// Encabezado profesional por sección — título, qué hace y cómo usarla (estilo HubSpot/Salesforce)
const TAB_META: Record<Tab, { icon: any; title: string; desc: string }> = {
  users:             { icon: Users,     title: 'Usuarios',            desc: 'Crea y administra las cuentas del equipo: define su rol, a qué grupos pertenecen y si pueden ingresar al sistema.' },
  groups:            { icon: Building,  title: 'Grupos & Áreas',      desc: 'Organiza tu operación en grupos de trabajo y define las áreas de servicio de cada uno. Cada lead y usuario pertenece a un grupo.' },
  pipeline:          { icon: Layers,    title: 'Etapas del Pipeline', desc: 'Configura las etapas del embudo de ventas, su orden y cómo se nombran para tu equipo. Aplica a todos los grupos.' },
  whatsapp_sessions: { icon: Smartphone,title: 'Sesiones de WhatsApp',desc: 'Conecta números de WhatsApp por código QR y revisa cuáles están activos. Cada sesión permite que el equipo chatee con clientes.' },
  ai_agents:         { icon: Bot,       title: 'Agentes IA',          desc: 'Crea asistentes de IA que responden a los leads automáticamente fuera de horario y derivan los casos que necesitan a una persona.' },
  cobrador_carteras: { icon: Users,     title: 'Carteras por Cobrador',desc: 'Asigna a cada cobrador las áreas de servicio cuyos clientes morosos recibirá de forma automática en su cartera.' },
  configuracion:     { icon: Settings,  title: 'Configuración',       desc: 'Plantillas de Órdenes de Trabajo, etiquetas de las etapas y reglas de seguimiento de pagos del sistema.' },
  security:          { icon: Shield,    title: 'Seguridad & Auditoría',desc: 'Registro de eventos del sistema, intentos de acceso y cuentas bloqueadas. Trazabilidad para cumplimiento ISO 27001.' },
}

export default function Admin() {
  const { user: me } = useAuthStore()
  const { confirm, dialog: confirmDialog } = useConfirm()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab: Tab = (searchParams.get('tab') as Tab) || 'users'
  const setActiveTab = (id: Tab) => setSearchParams({ tab: id })
  const [users, setUsers] = useState<User[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null)
  const [areas, setAreas] = useState<Area[]>([])
  const [availableWA, setAvailableWA] = useState<{ id: number; phone_number: string; api_provider: string; name?: string; group_name?: string | null }[]>([])
  const [showUserModal, setShowUserModal] = useState(false)
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [showAreaModal, setShowAreaModal] = useState(false)
  const [showAreasModal, setShowAreasModal] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  const [editGroup, setEditGroup] = useState<Group | null>(null)
  const [editArea, setEditArea] = useState<Area | null>(null)

  const [userForm, setUserForm] = useState({ name: '', email: '', password: '', role: 'agendadora', group_id: '', whatsapp_number: '' })
  const [groupForm, setGroupForm] = useState({ name: '', description: '' })
  const [areaForm, setAreaForm] = useState({ name: '', whatsapp_config_ids: [] as number[] })
  const [saving, setSaving] = useState(false)
  const [stageLabels, setStageLabels] = useState<Record<string, string>>(DEFAULT_STAGE_LABELS)
  const [labelsSaving, setLabelsSaving] = useState(false)
  const [pipelineStages, setPipelineStages] = useState<any[]>([])
  const [stagesLoading, setStagesLoading] = useState(false)
  const [stageForm, setStageForm] = useState({ key: '', name: '', color: '#7c3aed', order: 0 })
  const [editingStage, setEditingStage] = useState<any | null>(null)
  const [showStageModal, setShowStageModal] = useState(false)

  // Members modal
  const [showMembersModal, setShowMembersModal] = useState(false)
  const [membersGroupId, setMembersGroupId]     = useState<number|null>(null)
  const [groupMembers, setGroupMembers]         = useState<User[]>([])
  const [unassigned, setUnassigned]             = useState<User[]>([])
  const [membersLoading, setMembersLoading]     = useState(false)
  const [cobCarteras, setCobCarteras]           = useState<any[]>([])
  const [cobCarterasLoading, setCobCarterasLoading] = useState(false)

  // ── Configuración tab ────────────────────────────────────────────────────
  const DEFAULT_COBRADOR_LABELS: Record<string, string> = {
    pendiente_moroso: 'Pendiente Moroso', lead_moroso: 'Lead Moroso',
    pago_comprometido: 'Pago Comprometido', pagado: 'Pagado',
  }
  const [cobradorLabels, setCobradorLabels] = useState<Record<string, string>>(DEFAULT_COBRADOR_LABELS)
  const [cobradorLabelsSaving, setCobradorLabelsSaving] = useState(false)
  const [seguimientoDias, setSeguimientoDias] = useState(5)
  const [seguimientoDiasSaving, setSeguimientoDiasSaving] = useState(false)
  const [otTypeList, setOtTypeList] = useState<any[]>([])
  const [expandedOt, setExpandedOt] = useState<string | null>(null)
  const [otTemplateData, setOtTemplateData] = useState<Record<string, any>>({})
  const [otEdits, setOtEdits] = useState<Record<string, Record<string, string>>>({})
  const [otSaving, setOtSaving] = useState<string | null>(null)

  const loadConfiguracion = useCallback(async () => {
    try {
      const [cob, seg, ots, vend] = await Promise.all([
        getCobradorStageLabels(),
        getSeguimientoDias(),
        listOtTemplates(),
        getStageLabels(),
      ])
      setCobradorLabels(cob)
      setSeguimientoDias(seg.dias)
      setOtTypeList(ots)
      setStageLabels(vend)
    } catch { toast.error('Error cargando configuración') }
  }, [])

  useEffect(() => { if (activeTab === 'configuracion') loadConfiguracion() }, [activeTab, loadConfiguracion])

  const handleSaveStageLabels = async () => {
    setLabelsSaving(true)
    try {
      const updated = await updateStageLabels(stageLabels)
      setStageLabels(updated)
      toast.success('Etapas vendedor actualizadas')
    } catch { toast.error('Error al guardar') }
    finally { setLabelsSaving(false) }
  }

  const handleSaveCobradorLabels = async () => {
    setCobradorLabelsSaving(true)
    try {
      const updated = await updateCobradorStageLabels(cobradorLabels)
      setCobradorLabels(updated)
      toast.success('Etapas cobrador actualizadas')
    } catch { toast.error('Error al guardar') }
    finally { setCobradorLabelsSaving(false) }
  }

  const handleSaveSeguimientoDias = async () => {
    setSeguimientoDiasSaving(true)
    try {
      const res = await updateSeguimientoDias(seguimientoDias)
      setSeguimientoDias(res.dias)
      toast.success(`Umbral actualizado: ${res.dias} días`)
    } catch { toast.error('Error al guardar') }
    finally { setSeguimientoDiasSaving(false) }
  }

  const loadOtTemplate = async (otType: string) => {
    if (otTemplateData[otType]) return
    try {
      const data = await getOtTemplate(otType)
      setOtTemplateData(prev => ({ ...prev, [otType]: data }))
      const initialEdits: Record<string, string> = {}
      for (const sec of data.sections) {
        for (const blk of sec.body_blocks) {
          initialEdits[`sec_${sec.sec_idx}_blk_${blk.blk_idx}`] = blk.paragraphs.join('\n\n')
        }
      }
      setOtEdits(prev => ({ ...prev, [otType]: initialEdits }))
    } catch { toast.error('Error cargando plantilla') }
  }

  const handleExpandOt = async (otType: string) => {
    if (expandedOt === otType) { setExpandedOt(null); return }
    setExpandedOt(otType)
    await loadOtTemplate(otType)
  }

  const handleSaveOtTemplate = async (otType: string) => {
    setOtSaving(otType)
    try {
      const edits = otEdits[otType] || {}
      const overrides: Record<string, string[]> = {}
      for (const [key, text] of Object.entries(edits)) {
        overrides[key] = text.split('\n\n').map(p => p.trim()).filter(Boolean)
      }
      await updateOtTemplate(otType, overrides)
      setOtTypeList(prev => prev.map(t => t.key === otType ? { ...t, is_customized: true } : t))
      toast.success('Plantilla guardada')
    } catch { toast.error('Error al guardar plantilla') }
    finally { setOtSaving(null) }
  }

  const handleResetOtTemplate = async (otType: string) => {
    try {
      await resetOtTemplate(otType)
      setOtTemplateData(prev => { const n = { ...prev }; delete n[otType]; return n })
      setOtEdits(prev => { const n = { ...prev }; delete n[otType]; return n })
      setExpandedOt(null)
      setOtTypeList(prev => prev.map(t => t.key === otType ? { ...t, is_customized: false } : t))
      toast.success('Plantilla restaurada al original')
    } catch { toast.error('Error al restaurar') }
  }
  const [cobExpandedId, setCobExpandedId]       = useState<number|null>(null)
  const [clientesModal, setClientesModal]       = useState<any|null>(null)
  const [editingCobradorArea, setEditingCobradorArea] = useState<{id:number;areas:string[]}>({ id:0, areas:[] })
  const [allAreas, setAllAreas]                 = useState<any[]>([])

  const loadCobradorCarteras = async () => {
    setCobCarterasLoading(true)
    try { setCobCarteras(await getCobradorCarteras()) }
    catch { toast.error('Error cargando carteras') }
    finally { setCobCarterasLoading(false) }
  }

  const loadUsers  = () => getUsers().then(setUsers)
  const loadGroups = () => getGroups().then(setGroups)
  const loadGroupData = async (gid: number) => {
    try {
      const areasData = await getGroupAreas(gid)
      setAreas(areasData)
    } catch {
      toast.error('Error cargando datos del grupo')
    }
  }

  const openGroupAreas = async (gid: number) => {
    setSelectedGroup(gid)
    setAreaUserDropOpen({})
    setAreaUserSearch({})
    setShowAreasModal(true)
  }

  const openGroupMembers = async (gid: number) => {
    setMembersGroupId(gid)
    setShowMembersModal(true)
    setMembersLoading(true)
    try {
      const [members, all] = await Promise.all([
        getGroupMembers(gid),
        getUsers(),
      ])
      const activeMembers = members.filter((u: User) => u.is_active && ['vendedor', 'agendadora'].includes(u.role))
      setGroupMembers(activeMembers)
      setUnassigned(
        all.filter((u: User) =>
          u.is_active &&
          ['vendedor', 'agendadora'].includes(u.role) &&
          !activeMembers.some((m: User) => m.id === u.id) &&
          (!u.group_id || u.group_id === gid)
        )
      )
    } catch { toast.error('Error cargando miembros') }
    finally { setMembersLoading(false) }
  }

  const handleAssignMember = async (userId: number) => {
    try {
      await assignUserToGroup(membersGroupId!, userId)
      await updateUser(userId, { group_id: membersGroupId })
      await openGroupMembers(membersGroupId!)
      loadUsers()
    } catch { toast.error('Error al asignar') }
  }

  const handleRemoveMember = async (userId: number) => {
    try {
      await removeUserFromGroup(membersGroupId!, userId)
      const u = users.find(x => x.id === userId)
      if (u && u.group_id === membersGroupId) {
        await updateUser(userId, { group_id: null })
      }
      await openGroupMembers(membersGroupId!)
      loadUsers()
    } catch { toast.error('Error al quitar del grupo') }
  }

  const loadPipelineStages = useCallback(async () => {
    setStagesLoading(true)
    try { setPipelineStages(await getPipelineStages()) }
    catch { /* non-abogados only */ }
    finally { setStagesLoading(false) }
  }, [])

  useEffect(() => {
    loadUsers(); loadGroups(); getStageLabels().then(setStageLabels)
    loadPipelineStages()
  }, [loadPipelineStages])
  useEffect(() => { if (selectedGroup) loadGroupData(selectedGroup) }, [selectedGroup])  // eslint-disable-line

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const data: any = { ...userForm }
      if (!data.password) delete data.password
      data.group_id = data.group_id ? parseInt(data.group_id) : null
      if (editUser) {
        await updateUser(editUser.id, data)
        toast.success('Usuario actualizado')
      } else {
        await createUser(data)
        toast.success('Usuario creado')
      }
      setShowUserModal(false)
      loadUsers()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Error al guardar usuario')
    } finally {
      setSaving(false)
    }
  }

  const openEditUser = (u: User) => {
    setEditUser(u)
    setUserForm({ name: u.name, email: u.email, password: '', role: u.role, group_id: u.group_id?.toString() || '', whatsapp_number: u.whatsapp_number || '' })
    setShowUserModal(true)
  }

  const openCreateUser = () => {
    setEditUser(null)
    setUserForm({ name: '', email: '', password: '', role: 'agendadora', group_id: '', whatsapp_number: '' })
    setShowUserModal(true)
  }

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (editGroup) {
        await updateGroup(editGroup.id, groupForm)
        toast.success('Grupo actualizado')
      } else {
        await createGroup(groupForm)
        toast.success('Grupo creado')
      }
      setShowGroupModal(false)
      setEditGroup(null)
      loadGroups()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Error')
    } finally {
      setSaving(false)
    }
  }

  const openEditGroup = (g: Group) => {
    setEditGroup(g)
    setGroupForm({ name: g.name, description: (g as any).description ?? '' })
    setShowGroupModal(true)
  }

  const openCreateGroup = () => {
    setEditGroup(null)
    setGroupForm({ name: '', description: '' })
    setShowGroupModal(true)
  }

  const handleDeleteGroup = async (id: number, name: string) => {
    const ok = await confirm(`Se eliminarán todas las áreas y leads de "${name}" permanentemente.`, { title: `Eliminar grupo ${name}`, confirmLabel: 'Eliminar' })
    if (!ok) return
    try {
      await deleteGroup(id)
      toast.success('Grupo eliminado')
      if (selectedGroup === id) setSelectedGroup(null)
      loadGroups()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Error al eliminar grupo')
    }
  }

  const handleSaveArea = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedGroup) return
    setSaving(true)
    try {
      const payload = {
        name: areaForm.name,
        whatsapp_config_ids: areaForm.whatsapp_config_ids,
        whatsapp_config_id: areaForm.whatsapp_config_ids[0] ?? null,
      }
      if (editArea) {
        await updateArea(editArea.id, payload)
        toast.success('Área actualizada')
      } else {
        await createArea(selectedGroup, { ...payload, kpi_leads: 50, group_id: selectedGroup })
        toast.success('Área creada')
      }
      setShowAreaModal(false)
      setEditArea(null)
      await loadGroupData(selectedGroup)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Error')
    } finally {
      setSaving(false)
    }
  }

  const openEditArea = async (a: Area) => {
    setEditArea(a)
    const currentIds = (a.phone_configs ?? []).map((c: any) => c.id)
    setAreaForm({ name: a.name, whatsapp_config_ids: currentIds })
    const available = await getAvailableWhatsApp().catch(() => [])
    setAvailableWA(available)
    setShowAreaModal(true)
  }

  const openCreateArea = async () => {
    setEditArea(null)
    setAreaForm({ name: '', whatsapp_config_ids: [] })
    const available = await getAvailableWhatsApp().catch(() => [])
    setAvailableWA(available)
    setShowAreaModal(true)
  }

  const toggleWASelection = (id: number) => {
    setAreaForm(f => ({
      ...f,
      whatsapp_config_ids: f.whatsapp_config_ids.includes(id)
        ? f.whatsapp_config_ids.filter(x => x !== id)
        : [...f.whatsapp_config_ids, id],
    }))
  }

  const [deletingAreaId, setDeletingAreaId] = useState<number | null>(null)
  const [areaUserDropOpen, setAreaUserDropOpen] = useState<Record<number, boolean>>({})
  const [areaUserSearch, setAreaUserSearch] = useState<Record<number, string>>({})

  const handleAssignUserToArea = async (areaId: number, userId: number) => {
    try {
      await assignUserToArea(areaId, userId)
      // Refresh areas
      if (selectedGroup) loadGroupData(selectedGroup)
      toast.success('Usuario asignado al área')
    } catch (e: any) { toast.error(e?.response?.data?.detail || 'Error asignando usuario') }
    setAreaUserDropOpen(p => ({ ...p, [areaId]: false }))
  }

  const handleRemoveUserFromArea = async (areaId: number, userId: number) => {
    try {
      await removeUserFromArea(areaId, userId)
      if (selectedGroup) loadGroupData(selectedGroup)
      toast.success('Usuario removido del área')
    } catch { toast.error('Error removiendo usuario') }
  }

  const handleDeleteArea = async (id: number) => {
    if (deletingAreaId === id) {
      try {
        await deleteArea(id)
        toast.success('Área eliminada')
        setDeletingAreaId(null)
        if (selectedGroup) await loadGroupData(selectedGroup)
      } catch (err: any) {
        toast.error(err?.response?.data?.detail || 'Error al eliminar')
        setDeletingAreaId(null)
      }
    } else {
      setDeletingAreaId(id)
      setTimeout(() => setDeletingAreaId(prev => prev === id ? null : prev), 3000)
    }
  }

  const handleDeleteUser = async (id: number) => {
    const ok = await confirm('El usuario quedará inactivo y no podrá iniciar sesión.', { title: 'Desactivar usuario', confirmLabel: 'Desactivar' })
    if (!ok) return
    try {
      await deleteUser(id)
      toast.success('Usuario desactivado')
      loadUsers()
    } catch {
      toast.error('Error')
    }
  }

  const roleLabel: Record<string, string> = {
    superadmin: 'Super Admin', subadmin: 'Sub Admin', agendadora: 'Agendador/a',
    vendedor: 'Vendedor', verificador: 'Verificador Pagos', dante: 'Verificador Pagos', cobrador: 'Cobrador',
    analista: 'Analista', asistente_seguimiento: 'Asistente Seguimiento', tecnico: 'Técnico',
  }
  const roleBadge: Record<string, string> = {
    superadmin:  'bg-surface-1 text-white border-lime',
    subadmin:    'bg-surface-2 text-white/85 border-white/10',
    agendadora:  'bg-surface-2 text-white/85 border-white/10',
    vendedor:    'bg-surface-2 text-white/85 border-white/10',
    verificador: 'bg-surface-2 text-white/85 border-white/10',
    dante:       'bg-surface-2 text-white/85 border-white/10',
    cobrador:    'bg-surface-2 text-white/85 border-white/10',
    analista:    'bg-surface-2 text-white/85 border-white/10',
    asistente_seguimiento: 'bg-surface-2 text-white/85 border-white/10',
    tecnico:     'bg-surface-2 text-white/85 border-white/10',
  }

  const handleSaveStage = async () => {
    setSaving(true)
    try {
      if (editingStage) {
        const updated = await updatePipelineStage(editingStage.id, stageForm)
        setPipelineStages(ps => ps.map(s => s.id === updated.id ? updated : s))
        toast.success('Etapa actualizada')
      } else {
        const created = await createPipelineStage({ ...stageForm, order: pipelineStages.length })
        setPipelineStages(ps => [...ps, created])
        toast.success('Etapa creada')
      }
      setShowStageModal(false)
      setEditingStage(null)
      setStageForm({ key: '', name: '', color: '#7c3aed', order: 0 })
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Error al guardar etapa')
    } finally { setSaving(false) }
  }

  const handleDeleteStage = async (id: number) => {
    const ok = await confirm('Se eliminará esta etapa del pipeline.', { title: 'Eliminar etapa', confirmLabel: 'Eliminar' })
    if (!ok) return
    try {
      await deletePipelineStage(id)
      setPipelineStages(ps => ps.filter(s => s.id !== id))
      toast.success('Etapa eliminada')
    } catch { toast.error('Error al eliminar') }
  }

  const handleSaveLabels = async () => {
    setLabelsSaving(true)
    try {
      const updated = await updateStageLabels(stageLabels)
      setStageLabels(updated)
      toast.success('Nombres del pipeline actualizados')
    } catch {
      toast.error('Error al guardar')
    } finally {
      setLabelsSaving(false)
    }
  }

  const [userSearch, setUserSearch] = useState('')

  // Filter out tecnico users from the display list
  const visibleUsers = users.filter(u => {
    if (u.role === 'tecnico') return false
    if (!userSearch.trim()) return true
    const q = userSearch.toLowerCase()
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q)
  })
  const isTecnico = me?.role === 'tecnico'
  const myGroup = groups.find(g => g.id === me?.group_id)
  const negocioTipo: string = (myGroup as any)?.tipo ?? 'abogados'

  // ── Schedule modal (superadmin) ──────────────────────────────
  const [scheduleAgent, setScheduleAgent] = useState<any | null>(null)
  const [scheduleForm, setScheduleForm] = useState({ start: '', end: '' })
  const [scheduleSaving, setScheduleSaving] = useState(false)

  const openScheduleModal = (agent: any) => {
    setScheduleAgent(agent)
    setScheduleForm({
      start: agent.business_hours_start ?? '',
      end:   agent.business_hours_end   ?? '',
    })
  }

  const handleSaveSchedule = async () => {
    if (!scheduleAgent) return
    const start = scheduleForm.start.trim() || null
    const end   = scheduleForm.end.trim()   || null
    if (Boolean(start) !== Boolean(end)) {
      toast.error('Ingresa tanto la hora de inicio como la de fin, o deja ambas vacías para activar 24/7.')
      return
    }
    setScheduleSaving(true)
    try {
      const res = await updateAIAgentSchedule(scheduleAgent.id, start, end)
      setAgents(prev => prev.map(a => a.id === scheduleAgent.id
        ? { ...a, business_hours_start: res.business_hours_start, business_hours_end: res.business_hours_end }
        : a
      ))
      toast.success(start ? `Horario guardado: ${start} – ${end}` : 'Agente configurado como 24/7')
      setScheduleAgent(null)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Error guardando horario')
    } finally {
      setScheduleSaving(false)
    }
  }

  // ── WhatsApp sessions state ──────────────────────────────────
  const [waSessions, setWASessions] = useState<any[]>([])
  const [waLoading, setWALoading] = useState(false)

  const loadWASessions = useCallback(async () => {
    setWALoading(true)
    try { setWASessions(await adminListWASessions()) }
    catch { toast.error('Error cargando sesiones') }
    finally { setWALoading(false) }
  }, [])

  useEffect(() => { if (activeTab === 'whatsapp_sessions') loadWASessions() }, [activeTab])

  // ── AI Agents state ──────────────────────────────────────
  const [agents, setAgents]               = useState<any[]>([])
  const [agentsLoading, setAgentsLoading] = useState(false)
  const [showAgentModal, setShowAgentModal] = useState(false)
  const [editAgent, setEditAgent]         = useState<any | null>(null)
  const [agentLogs, setAgentLogs]         = useState<Record<number, any[]>>({})
  const [agentLogsOpen, setAgentLogsOpen] = useState<Record<number, boolean>>({})
  const [allWAConfigs, setAllWAConfigs]   = useState<any[]>([])
  const [assignWAOpen, setAssignWAOpen]   = useState<Record<number, boolean>>({})
  const [assigningWA, setAssigningWA]     = useState<Record<number, boolean>>({})

  const MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo']

  const defaultAgentForm = {
    name: '', description: '', whatsapp_config_id: '',
    is_active: true,
    openai_api_key: '', openai_model: 'gpt-4o-mini',
    temperature: 0.7, max_tokens: 500, max_history_messages: 20,
    system_prompt: `Eres el asistente virtual de Abogados Tributarios. Atiendes mensajes recibidos fuera del horario de oficina.

Tu única misión es recopilar el nombre del cliente y el motivo de su consulta, y dejar el caso registrado para que el equipo lo atienda a primera hora del día siguiente.

Flujo:
1. Saluda cordialmente e indica que la oficina está cerrada en este momento.
2. Pide el nombre del cliente.
3. Pregunta brevemente el motivo de su consulta (ej: deuda SII, TGR, factura falsa, planificación tributaria).
4. Cuando tengas nombre y motivo, llama a registrar_caso.
5. Dile al cliente que su caso quedó registrado y que un asesor lo contactará a primera hora del día siguiente.

Reglas:
- Mensajes cortos y amables. Máximo 2-3 oraciones por respuesta.
- No des asesoría legal ni tributaria.
- No intentes resolver el problema del cliente, solo registrar su caso.
- Si el cliente insiste en hablar con alguien ahora, dile "ESCALAR".`,
    response_delay_seconds: 2,
    escalation_keywords: [] as string[],
    escalation_kw_input: '',
    business_hours_start: '', business_hours_end: '',
  }

  const [agentForm, setAgentForm] = useState(defaultAgentForm)
  const [agentSaving, setAgentSaving] = useState(false)

  const loadAgents = useCallback(async () => {
    setAgentsLoading(true)
    try {
      const [ag, cfgs] = await Promise.all([getAIAgents(), getAllWhatsAppConfigs()])
      setAgents(ag)
      setAllWAConfigs(cfgs)
    } catch { toast.error('Error cargando agentes') }
    finally { setAgentsLoading(false) }
  }, [])

  useEffect(() => { if (activeTab === 'ai_agents') loadAgents() }, [activeTab])

  // ── Security audit log state ─────────────────────────────
  const [auditLog, setAuditLog] = useState<any[]>([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditPage, setAuditPage] = useState(1)
  const [auditLoading, setAuditLoading] = useState(false)
  const [secStats, setSecStats] = useState<any>(null)
  const [lockedUsers, setLockedUsers] = useState<any[]>([])
  const [auditAction, setAuditAction] = useState('')
  const [auditSeverity, setAuditSeverity] = useState('')

  const loadAuditLog = useCallback(async (page = 1) => {
    setAuditLoading(true)
    try {
      const params: any = { page, page_size: 50 }
      if (auditAction) params.action = auditAction
      if (auditSeverity) params.severity = auditSeverity
      const [logData, stats, locked] = await Promise.all([
        getAuditLog(params), getSecurityStats(), getLockedUsers()
      ])
      setAuditLog(logData.items)
      setAuditTotal(logData.total)
      setAuditPage(page)
      setSecStats(stats)
      setLockedUsers(locked)
    } catch { toast.error('Error cargando auditoría') }
    finally { setAuditLoading(false) }
  }, [auditAction, auditSeverity])

  useEffect(() => { if (activeTab === 'security') loadAuditLog(1) }, [activeTab, auditAction, auditSeverity])
  useEffect(() => {
    if (activeTab === 'cobrador_carteras') {
      loadCobradorCarteras()
      getAllAreas().then(setAllAreas).catch(() => {})
    }
  }, [activeTab])

  const handleUnlock = async (userId: number, email: string) => {
    try {
      await unlockUser(userId)
      toast.success(`Cuenta desbloqueada: ${email}`)
      loadAuditLog(auditPage)
    } catch { toast.error('Error desbloqueando cuenta') }
  }

  const openAgentModal = (agent?: any) => {
    if (agent) {
      setEditAgent(agent)
      setAgentForm({
        name: agent.name, description: agent.description ?? '',
        whatsapp_config_id: String(agent.whatsapp_config_id),
        is_active: agent.is_active,
        openai_api_key: '',
        openai_model: agent.openai_model,
        temperature: agent.temperature, max_tokens: agent.max_tokens,
        max_history_messages: agent.max_history_messages,
        system_prompt: agent.system_prompt,
        response_delay_seconds: agent.response_delay_seconds,
        escalation_keywords: agent.escalation_keywords ?? [],
        escalation_kw_input: '',
        business_hours_start: agent.business_hours_start ?? '',
        business_hours_end: agent.business_hours_end ?? '',
      })
    } else {
      setEditAgent(null)
      setAgentForm(defaultAgentForm)
    }
    setShowAgentModal(true)
  }

  const handleSaveAgent = async () => {
    if (!agentForm.name.trim()) { toast.error('El nombre es obligatorio'); return }
    if (!agentForm.whatsapp_config_id) { toast.error('Selecciona un número de WhatsApp'); return }
    if (!agentForm.system_prompt.trim()) { toast.error('El prompt del sistema es obligatorio'); return }
    if (!editAgent && !agentForm.openai_api_key.trim()) { toast.error('La API Key de OpenAI es obligatoria'); return }

    setAgentSaving(true)
    try {
      const payload: any = {
        name: agentForm.name.trim(),
        description: agentForm.description || null,
        whatsapp_config_id: parseInt(agentForm.whatsapp_config_id),
        is_active: agentForm.is_active,
        openai_model: agentForm.openai_model,
        temperature: agentForm.temperature,
        max_tokens: agentForm.max_tokens,
        max_history_messages: agentForm.max_history_messages,
        system_prompt: agentForm.system_prompt.trim(),
        response_delay_seconds: agentForm.response_delay_seconds,
        escalation_keywords: agentForm.escalation_keywords,
        business_hours_start: agentForm.business_hours_start || null,
        business_hours_end: agentForm.business_hours_end || null,
      }
      if (agentForm.openai_api_key.trim()) payload.openai_api_key = agentForm.openai_api_key.trim()

      if (editAgent) {
        await updateAIAgent(editAgent.id, payload)
        toast.success('Agente actualizado')
      } else {
        payload.openai_api_key = agentForm.openai_api_key.trim()
        await createAIAgent(payload)
        toast.success('Agente creado')
      }
      setShowAgentModal(false)
      loadAgents()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Error guardando agente')
    } finally { setAgentSaving(false) }
  }

  const handleToggleAgent = async (id: number, currentActive: boolean) => {
    try {
      await toggleAIAgent(id)
      setAgents(prev => prev.map(a => a.id === id ? { ...a, is_active: !currentActive } : a))
      toast.success(currentActive ? 'Agente desactivado' : 'Agente activado')
    } catch { toast.error('Error actualizando agente') }
  }

  const handleDeleteAgent = async (id: number) => {
    const ok = await confirm('Se perderán todos sus logs permanentemente.', { title: 'Eliminar agente IA', confirmLabel: 'Eliminar' })
    if (!ok) return
    try { await deleteAIAgent(id); toast.success('Agente eliminado'); loadAgents() }
    catch { toast.error('Error al eliminar') }
  }

  const handleAssignWA = async (agentId: number, configId: number | null) => {
    setAssigningWA(p => ({ ...p, [agentId]: true }))
    try {
      await assignAgentWhatsApp(agentId, configId)
      toast.success(configId ? 'Número asignado' : 'Número desasignado')
      setAssignWAOpen(p => ({ ...p, [agentId]: false }))
      loadAgents()
    } catch { toast.error('Error al asignar número') }
    finally { setAssigningWA(p => ({ ...p, [agentId]: false })) }
  }

  const handleAddConfig = async (agentId: number, configId: number) => {
    try {
      const updated = await addAgentConfig(agentId, configId)
      setAgents((prev: any[]) => prev.map((a: any) => a.id === agentId ? updated : a))
      toast.success('Número agregado')
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Error al agregar número')
    }
  }

  const handleRemoveConfig = async (agentId: number, configId: number) => {
    try {
      const updated = await removeAgentConfig(agentId, configId)
      setAgents((prev: any[]) => prev.map((a: any) => a.id === agentId ? updated : a))
      toast.success('Número quitado')
    } catch { toast.error('Error al quitar número') }
  }

  const toggleAgentLogs = async (agentId: number) => {
    const isOpen = agentLogsOpen[agentId]
    setAgentLogsOpen(prev => ({ ...prev, [agentId]: !isOpen }))
    if (!isOpen && !agentLogs[agentId]) {
      try {
        const logs = await getAIAgentLogs(agentId, 30)
        setAgentLogs(prev => ({ ...prev, [agentId]: logs }))
      } catch { toast.error('Error cargando logs') }
    }
  }

  return (
    <div className="space-y-5">

      {(() => {
        const meta = TAB_META[activeTab] ?? { icon: Shield, title: 'Administración', desc: 'Gestión del sistema CRM' }
        const HeaderIcon = meta.icon
        return (
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(124,58,237,0.14)' }}>
              <HeaderIcon size={21} style={{ color: '#6366f1' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-semibold mb-0.5" style={{ color: 'var(--text-muted)' }}>
                <span>Administración</span>
                <ChevronRight size={11} />
                <span style={{ color: 'var(--text-3)' }}>{meta.title}</span>
              </div>
              <h1 className="text-2xl font-bold text-white leading-tight">{meta.title}</h1>
              <p className="text-white/62 text-sm mt-1 max-w-3xl leading-snug">{meta.desc}</p>
            </div>
          </div>
        )
      })()}


      {/* Users tab */}
      {activeTab === 'users' && (
       <div className="space-y-4">
        {/* Leyenda de roles — qué puede hacer cada uno */}
        <div className="bg-surface-1 rounded-xl border border-white/[0.07] p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/45 mb-2.5">Qué puede hacer cada rol</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-1.5">
            {[
              ['Super Admin', 'Control total: usuarios, grupos, configuración y todos los datos'],
              ['Sub Admin', 'Administra su grupo: leads, pipeline, contactos y equipo'],
              ['Agendador/a', 'Agenda reuniones, atiende WhatsApp y gestiona leads'],
              ['Vendedor', 'Atiende sus reuniones y mueve sus leads en el pipeline'],
              ['Verificador Pagos', 'Revisa y confirma los comprobantes de pago'],
              ['Cobrador', 'Gestiona la cartera de clientes morosos asignada'],
              ['Asistente Seguimiento', 'Hace seguimiento a los compromisos de pago pendientes'],
              ['Analista', 'Consulta reportes y métricas de cobranza'],
            ].map(([role, desc]) => (
              <div key={role} className="flex items-baseline gap-2 min-w-0">
                <span className="text-[11px] font-bold text-white/80 whitespace-nowrap">{role}</span>
                <span className="text-[11px] text-white/45 truncate">— {desc}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-surface-1 rounded-xl border border-white/[0.07] shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
            <h2 className="font-semibold text-white/90">Usuarios <span className="text-white/52 font-normal">({visibleUsers.length})</span></h2>
            <div className="flex items-center gap-2">
              <div className="relative">
                <input
                  type="text"
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  placeholder="Buscar..."
                  className="input pl-8 pr-7 text-sm w-48"
                />
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/35 pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                {userSearch && (
                  <button onClick={() => setUserSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/35 hover:text-white/70">
                    <X size={12} />
                  </button>
                )}
              </div>
              <button onClick={openCreateUser} className="btn-primary text-sm">
                <Plus size={15} /> Nuevo Usuario
              </button>
            </div>
          </div>

          <div className="overflow-x-auto table-scroll">
            <table className="w-full text-sm">
              <thead className="bg-surface-0 border-b border-white/[0.07]">
                <tr>
                  <th className="table-header">Nombre</th>
                  <th className="table-header">Email</th>
                  <th className="table-header">Rol</th>
                  <th className="table-header">Grupo</th>
                  <th className="table-header">Estado</th>
                  <th className="table-header" />
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map(u => (
                  <tr key={u.id} className="table-row">
                    <td className="table-cell">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-surface-2 border border-white/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-white/90 font-bold text-xs">{u.name.charAt(0)}</span>
                        </div>
                        <span className="font-semibold text-white/90">{u.name}</span>
                      </div>
                    </td>
                    <td className="table-cell text-white/62 text-xs">{u.email}</td>
                    <td className="table-cell">
                      <span className={`badge border text-[11px] ${roleBadge[u.role] ?? 'bg-surface-2 text-white/78'}`}>
                        {roleLabel[u.role] ?? u.role}
                      </span>
                    </td>
                    <td className="table-cell text-xs text-white/62">
                      {(u.group_ids?.length
                        ? u.group_ids.map(gid => groups.find(g => g.id === gid)?.name).filter(Boolean).join(', ')
                        : groups.find(g => g.id === u.group_id)?.name) ?? '—'}
                    </td>
                    <td className="table-cell">
                      <span className={`badge border text-[11px] ${u.is_active ? 'text-lime border border-lime/30 bg-lime/10' : 'text-danger border border-danger/30 bg-danger/10'}`}>
                        {u.is_active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="table-cell">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => openEditUser(u)}
                          className="p-1.5 hover:bg-surface-2 rounded-lg text-white/52 hover:text-white/90 transition-colors">
                          <Edit2 size={14} />
                        </button>
                        {me?.role === 'superadmin' && u.id !== me.id && (
                          <button onClick={() => handleDeleteUser(u.id)}
                            className="p-1.5 hover:bg-danger/10 rounded-lg text-white/38 hover:text-danger transition-colors">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
       </div>
      )}

      {/* Groups tab */}
      {activeTab === 'groups' && (
        <div className="bg-surface-1 rounded-xl border border-white/[0.07] shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
            <h2 className="font-semibold text-white/90">
              Grupos <span className="text-white/52 font-normal">({groups.length})</span>
            </h2>
            {me?.role === 'superadmin' && (
              <button onClick={openCreateGroup} className="btn-primary text-sm">
                <Plus size={15} /> Nuevo Grupo
              </button>
            )}
          </div>
          <div className="divide-y divide-white/5">
            {groups.length === 0 ? (
              <p className="text-sm text-white/52 text-center py-10">Sin grupos creados</p>
            ) : groups.map(g => (
              <div key={g.id} className="flex items-center justify-between px-6 py-4 hover:bg-surface-0 transition-colors group">
                <button
                  className="flex items-center gap-3 flex-1 text-left"
                  onClick={() => openGroupAreas(g.id)}>
                  <div className="w-9 h-9 rounded-xl bg-surface-2 flex items-center justify-center flex-shrink-0 group-hover:bg-surface-3 transition-colors">
                    <Layers size={15} className="text-white/78" />
                  </div>
                  <div>
                    <p className="font-semibold text-white/90 text-sm">{g.name}</p>
                    <p className="text-xs text-white/52 mt-0.5">Click para ver áreas legales</p>
                  </div>
                </button>
                <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                  <button
                    onClick={() => openGroupMembers(g.id)}
                    className="flex items-center gap-1.5 text-xs font-medium text-white/62 hover:text-white bg-surface-2 hover:bg-surface-3 px-3 py-1.5 rounded-lg transition-colors">
                    <UserCheck size={12} /> Usuarios
                  </button>
                  <button
                    onClick={() => openGroupAreas(g.id)}
                    className="flex items-center gap-1.5 text-xs font-medium text-white/62 hover:text-white bg-surface-2 hover:bg-surface-3 px-3 py-1.5 rounded-lg transition-colors">
                    Ver áreas <ChevronRight size={12} />
                  </button>
                  {me?.role === 'superadmin' && (
                    <>
                      <button
                        onClick={() => openEditGroup(g)}
                        className="p-1.5 hover:bg-surface-2 rounded-lg text-white/38 hover:text-white/90 transition-colors"
                        title="Editar grupo">
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteGroup(g.id, g.name)}
                        className="p-1.5 hover:bg-danger/10 rounded-lg text-white/38 hover:text-danger transition-colors"
                        title="Eliminar grupo">
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Areas Modal — centrado */}
      {showAreasModal && selectedGroup && (
        <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4">
          <div className="bg-surface-1 rounded-2xl shadow-modal w-full max-w-xl max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.07] flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-surface-2 rounded-xl flex items-center justify-center">
                  <Layers size={16} className="text-white/85" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">
                    Áreas — {groups.find(g => g.id === selectedGroup)?.name}
                  </h2>
                  <p className="text-xs text-white/52 mt-0.5">{areas.length} área{areas.length !== 1 ? 's' : ''} configurada{areas.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <button
                onClick={() => { setShowAreasModal(false); setSelectedGroup(null); setAreaUserDropOpen({}); setAreaUserSearch({}) }}
                className="p-2 hover:bg-surface-2 rounded-xl text-white/52 hover:text-white/85 transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-2">
              {areas.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-12 h-12 bg-surface-2 rounded-2xl flex items-center justify-center mx-auto mb-3">
                    <Layers size={20} className="text-white/52" />
                  </div>
                  <p className="text-sm text-white/52 font-medium">Sin áreas configuradas</p>
                  <p className="text-xs text-white/38 mt-1">Agrega la primera área con el botón de abajo</p>
                </div>
              ) : areas.map((a: any) => {
                const phones: any[] = a.phone_configs ?? []
                const areaAssigned: any[] = a.users ?? []
                const allEligible = users.filter(u =>
                  u.is_active &&
                  ['agendadora','vendedor','subadmin','verificador'].includes(u.role)
                )
                const unassigned = allEligible.filter(u => !areaAssigned.some((au: any) => au.id === u.id))
                const searchQ = (areaUserSearch[a.id] ?? '').toLowerCase()
                const filteredUnassigned = searchQ
                  ? unassigned.filter(u => u.name.toLowerCase().includes(searchQ) || u.role.includes(searchQ))
                  : unassigned
                const isOpen = !!areaUserDropOpen[a.id]

                return (
                  <div key={a.id} className="rounded-xl overflow-hidden"
                    style={{ background: '#ffffff', border: '1px solid #e6e1f0', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>

                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3"
                      style={{ background: '#faf9fd', borderBottom: '1px solid #e6e1f0' }}>
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                          <Layers size={14} style={{ color: '#16a34a' }} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-sm" style={{ color: '#130d26' }}>{a.name}</p>
                          {phones.length > 0 ? (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {phones.map((wp: any) => (
                                <span key={wp.id} className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                                  style={{ background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' }}>
                                  <Phone size={8} /> {wp.phone_number}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[10px]" style={{ color: '#94a3b8' }}>Sin número</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => openEditArea(a)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
                          style={{ color: '#94a3b8' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#334155'; (e.currentTarget as HTMLElement).style.background = '#f1f5f9' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#94a3b8'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                          <Edit2 size={13} />
                        </button>
                        {deletingAreaId === a.id ? (
                          <button onClick={() => handleDeleteArea(a.id)}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold"
                            style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                            <Trash2 size={10} /> Confirmar
                          </button>
                        ) : (
                          <button onClick={() => handleDeleteArea(a.id)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
                            style={{ color: '#94a3b8' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#dc2626'; (e.currentTarget as HTMLElement).style.background = '#fef2f2' }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#94a3b8'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Body */}
                    <div className="px-4 py-3" style={{ background: '#ffffff' }}>
                      {/* Assigned users */}
                      {areaAssigned.length > 0 && (
                        <div className="space-y-1.5 mb-3">
                          {areaAssigned.map((u: any) => (
                            <div key={u.id} className="flex items-center gap-3 px-3 py-2 rounded-lg group"
                              style={{ background: '#faf9fd', border: '1px solid #e6e1f0' }}>
                              <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                                style={{
                                  background: u.role === 'agendadora' ? '#ede9fe' : '#dcfce7',
                                  color: u.role === 'agendadora' ? '#7c3aed' : '#16a34a',
                                }}>
                                {u.name.charAt(0).toUpperCase()}
                              </div>
                              <p className="text-sm font-medium flex-1 truncate" style={{ color: '#1e293b' }}>{u.name}</p>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                                style={{
                                  background: u.role === 'agendadora' ? '#ede9fe' : '#dcfce7',
                                  color: u.role === 'agendadora' ? '#7c3aed' : '#16a34a',
                                }}>
                                {u.role === 'agendadora' ? 'Agend.' : u.role === 'vendedor' ? 'Vend.' : u.role.slice(0,5)}
                              </span>
                              <button onClick={() => handleRemoveUserFromArea(a.id, u.id)}
                                className="w-6 h-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                                style={{ color: '#94a3b8' }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#dc2626'; (e.currentTarget as HTMLElement).style.background = '#fef2f2' }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#94a3b8'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                                <X size={11} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Inline user picker */}
                      {unassigned.length > 0 && (
                        isOpen ? (
                          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #cbd5e1' }}>
                            <div className="flex items-center gap-2 px-3 py-2" style={{ background: '#f1f5f9', borderBottom: '1px solid #e6e1f0' }}>
                              <input
                                autoFocus
                                value={areaUserSearch[a.id] ?? ''}
                                onChange={e => setAreaUserSearch(p => ({ ...p, [a.id]: e.target.value }))}
                                placeholder="Buscar persona..."
                                className="flex-1 text-xs outline-none bg-transparent font-medium"
                                style={{ color: '#1e293b' }}
                              />
                              <button onClick={() => setAreaUserDropOpen(p => ({ ...p, [a.id]: false }))}
                                style={{ color: '#94a3b8' }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#475569' }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#94a3b8' }}>
                                <X size={13} />
                              </button>
                            </div>
                            <div style={{ background: '#ffffff', maxHeight: '180px', overflowY: 'auto' }}>
                              {filteredUnassigned.length === 0 ? (
                                <p className="text-xs text-center py-4" style={{ color: '#94a3b8' }}>Sin resultados</p>
                              ) : filteredUnassigned.map((u: any) => (
                                <button key={u.id}
                                  onClick={() => handleAssignUserToArea(a.id, u.id)}
                                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
                                  style={{ borderBottom: '1px solid #f1f5f9' }}
                                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#faf9fd' }}
                                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#ffffff' }}>
                                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                                    style={{
                                      background: u.role === 'agendadora' ? '#ede9fe' : '#dcfce7',
                                      color: u.role === 'agendadora' ? '#7c3aed' : '#16a34a',
                                    }}>
                                    {u.name.charAt(0).toUpperCase()}
                                  </div>
                                  <p className="text-sm font-semibold flex-1 truncate" style={{ color: '#1e293b' }}>{u.name}</p>
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                                    style={{
                                      background: u.role === 'agendadora' ? '#ede9fe' : '#dcfce7',
                                      color: u.role === 'agendadora' ? '#7c3aed' : '#16a34a',
                                    }}>
                                    {u.role === 'agendadora' ? 'Agendador/a' : u.role === 'vendedor' ? 'Vendedor/a' : u.role}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setAreaUserDropOpen(p => ({ ...p, [a.id]: true })); setAreaUserSearch(p => ({ ...p, [a.id]: '' })) }}
                            className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg w-full justify-center transition-colors"
                            style={{ background: '#f0f9ff', border: '1px dashed #7dd3fc', color: '#0284c7' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#e0f2fe' }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#f0f9ff' }}>
                            <Plus size={12} /> Añadir persona al área
                          </button>
                        )
                      )}

                      {areaAssigned.length === 0 && !isOpen && (
                        <p className="text-xs italic text-center py-1" style={{ color: '#94a3b8' }}>Sin personas asignadas</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-white/[0.07] flex-shrink-0">
              <button onClick={openCreateArea} className="btn-primary w-full justify-center">
                <Plus size={15} /> Nueva Área Legal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pipeline tab */}
      {activeTab === 'pipeline' && (
        negocioTipo === 'abogados' ? (
          /* ── Abogados: only rename stages ── */
          <div className="card space-y-5">
            <div>
              <h2 className="font-semibold text-white/90">Nombres de Etapas del Pipeline</h2>
              <p className="text-sm text-white/62 mt-0.5">Personaliza cómo se llaman las columnas del pipeline.</p>
            </div>
            <div className="space-y-3">
              {Object.entries(DEFAULT_STAGE_LABELS).map(([key, defaultLabel]) => (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-xs text-white/52 w-44 truncate font-mono">{key}</span>
                  <input
                    className="input flex-1"
                    value={stageLabels[key] ?? defaultLabel}
                    onChange={e => setStageLabels(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder={defaultLabel}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-2 border-t border-white/[0.07]">
              <button onClick={handleSaveLabels} disabled={labelsSaving} className="btn-primary">
                {labelsSaving ? 'Guardando...' : 'Guardar nombres'}
              </button>
            </div>
          </div>
        ) : (
          /* ── Non-abogados: full CRUD pipeline stages ── */
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-white/90">Etapas del Pipeline</h2>
                <p className="text-sm text-white/52 mt-0.5">Define las columnas del pipeline de tu negocio.</p>
              </div>
              <button
                onClick={() => { setEditingStage(null); setStageForm({ key: '', name: '', color: '#7c3aed', order: pipelineStages.length }); setShowStageModal(true) }}
                className="btn-primary flex items-center gap-2"
              >
                <Plus size={15} /> Nueva etapa
              </button>
            </div>

            {stagesLoading ? (
              <div className="flex justify-center py-10">
                <div className="w-6 h-6 border-2 border-lime border-t-transparent rounded-full animate-spin" />
              </div>
            ) : pipelineStages.length === 0 ? (
              <div className="flex flex-col items-center py-14 rounded-xl border border-dashed border-white/10 space-y-3">
                <GitBranch size={28} className="text-white/25" />
                <p className="text-sm text-white/42">Sin etapas configuradas</p>
                <button onClick={() => { setEditingStage(null); setStageForm({ key: '', name: '', color: '#7c3aed', order: 0 }); setShowStageModal(true) }} className="btn-primary text-xs">
                  Crear primera etapa
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {pipelineStages.map((s: any, idx: number) => (
                  <div key={s.id} className="flex items-center gap-3 px-4 py-3 bg-surface-1 border border-white/[0.08] rounded-xl">
                    <GripVertical size={14} className="text-white/25 flex-shrink-0" />
                    <span className="w-6 h-6 rounded-full flex-shrink-0 border border-white/20" style={{ backgroundColor: s.color ?? '#7c3aed' }} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-white">{s.name}</p>
                      <p className="text-xs text-white/42 font-mono">{s.key}</p>
                    </div>
                    <span className="text-xs text-white/30">#{idx + 1}</span>
                    <button onClick={() => { setEditingStage(s); setStageForm({ key: s.key, name: s.name, color: s.color ?? '#7c3aed', order: s.order }); setShowStageModal(true) }}
                      className="w-8 h-8 flex items-center justify-center text-white/42 hover:text-white hover:bg-white/5 rounded-lg transition-colors">
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => handleDeleteStage(s.id)}
                      className="w-8 h-8 flex items-center justify-center text-white/42 hover:text-danger hover:bg-danger/5 rounded-lg transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Stage modal */}
            {showStageModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowStageModal(false)}>
                <div className="bg-surface-0 border border-white/10 rounded-2xl p-6 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-white">{editingStage ? 'Editar etapa' : 'Nueva etapa'}</h3>
                    <button onClick={() => setShowStageModal(false)} className="text-white/42 hover:text-white"><X size={16} /></button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="input-label">Nombre visible *</label>
                      <input className="input w-full" placeholder="Ej: Contactado, En proceso..." value={stageForm.name}
                        onChange={e => setStageForm(f => ({ ...f, name: e.target.value }))} />
                    </div>
                    <div>
                      <label className="input-label">Clave interna *</label>
                      <input className="input w-full font-mono" placeholder="Ej: contactado, en_proceso..." value={stageForm.key}
                        onChange={e => setStageForm(f => ({ ...f, key: e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') }))} />
                      <p className="text-xs text-white/35 mt-1">Solo letras minúsculas, números y guion bajo.</p>
                    </div>
                    <div>
                      <label className="input-label">Color</label>
                      <div className="flex items-center gap-3">
                        <input type="color" className="w-10 h-10 rounded-lg border border-white/10 bg-transparent cursor-pointer" value={stageForm.color}
                          onChange={e => setStageForm(f => ({ ...f, color: e.target.value }))} />
                        <span className="text-xs text-white/52 font-mono">{stageForm.color}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3 pt-1">
                    <button onClick={() => setShowStageModal(false)} className="btn-secondary flex-1">Cancelar</button>
                    <button onClick={handleSaveStage} disabled={saving || !stageForm.name.trim() || !stageForm.key.trim()} className="btn-primary flex-1">
                      {saving ? 'Guardando...' : editingStage ? 'Guardar' : 'Crear'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      )}

      {/* ── WhatsApp Sessions tab ── */}
      {activeTab === 'whatsapp_sessions' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-white/90">Sesiones WhatsApp QR</h2>
              <p className="text-sm text-white/52 mt-0.5">Números vinculados por agendadores/as vía QR</p>
            </div>
            <button onClick={loadWASessions} className="w-9 h-9 flex items-center justify-center border border-white/10 rounded-xl bg-surface-1 text-white/45 hover:text-white/78 transition-colors">
              <RefreshCw size={14} className={waLoading ? 'animate-spin' : ''} />
            </button>
          </div>

          {waLoading ? (
            <div className="flex justify-center py-10">
              <div className="w-6 h-6 border-2 border-lime border-t-transparent rounded-full animate-spin" />
            </div>
          ) : waSessions.length === 0 ? (
            <div className="flex flex-col items-center py-12 rounded-xl border border-white/[0.07] space-y-3">
              <Smartphone size={28} className="text-white/25" />
              <p className="text-sm text-white/45">Ninguna agendadora ha vinculado WhatsApp aún</p>
            </div>
          ) : (
            <div className="bg-surface-1 rounded-xl border border-white/[0.07] overflow-hidden table-scroll">
              <table className="w-full text-sm">
                <thead className="bg-surface-0 border-b border-white/[0.07]">
                  <tr>
                    <th className="table-header">Agendador/a</th>
                    <th className="table-header">Número</th>
                    <th className="table-header">Nombre sesión</th>
                    <th className="table-header">Estado</th>
                    <th className="table-header">Grupo</th>
                    <th className="table-header">Áreas</th>
                    <th className="table-header" />
                  </tr>
                </thead>
                <tbody>
                  {waSessions.map((s: any) => {
                    const connected = s.live_status === 'connected'
                    return (
                      <tr key={s.id} className="table-row">
                        <td className="table-cell">
                          <p className="font-semibold text-white/90">{s.owner_name ?? '—'}</p>
                          <p className="text-xs text-white/45">{s.owner_role ?? ''}</p>
                        </td>
                        <td className="table-cell text-white/78 font-mono text-xs">
                          {s.phone_number === 'pending' ? <span className="text-white/38 italic">Pendiente</span> : s.phone_number}
                        </td>
                        <td className="table-cell text-white/78">{s.name}</td>
                        <td className="table-cell">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
                            connected ? 'bg-lime/10 text-lime' : 'bg-white/[0.06] text-white/45'
                          }`}>
                            {connected ? <Wifi size={10} /> : <WifiOff size={10} />}
                            {connected ? 'Conectado' : (s.live_status ?? 'Desconocido')}
                          </span>
                        </td>
                        <td className="table-cell text-white/62 text-xs">{s.group_name ?? '—'}</td>
                        <td className="table-cell">
                          {s.areas?.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {s.areas.map((a: any) => (
                                <span key={a.id} className="text-[10px] px-1.5 py-0.5 rounded border" style={{ background: 'rgba(124,58,237,0.14)', color: 'rgba(147,168,255,0.85)', borderColor: 'rgba(124,58,237,0.22)' }}>{a.name}</span>
                              ))}
                            </div>
                          ) : <span className="text-white/25 text-xs">Sin área</span>}
                        </td>
                        <td className="table-cell">
                          <button
                            onClick={async () => {
                              const ok = await confirm(`Se desconectará el número "${s.name}".`, { title: 'Eliminar sesión WhatsApp', confirmLabel: 'Eliminar' })
                              if (!ok) return
                              try {
                                await adminDeleteWASession(s.id)
                                toast.success('Sesión eliminada')
                                loadWASessions()
                              } catch { toast.error('Error al eliminar') }
                            }}
                            className="p-1.5 hover:bg-danger/10 rounded-lg text-white/25 hover:text-danger transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="rounded-xl p-3 flex items-start gap-2.5"
            style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.18)' }}>
            <Smartphone size={13} className="flex-shrink-0 mt-0.5" style={{ color: 'rgba(124,58,237,0.85)' }} />
            <p className="text-xs" style={{ color: 'rgba(147,168,255,0.80)' }}>
              Los agendadores/as gestionan sus propios números desde <strong>Mis WhatsApp</strong> en el menú lateral.
              Cada una puede vincular hasta 3 números. Desde aquí puedes monitorear todas las conexiones y eliminar sesiones problemáticas.
            </p>
          </div>
        </div>
      )}

      {/* ──────────── MODALS ──────────── */}

      {/* Members modal */}
      {showMembersModal && membersGroupId && (() => {
        const grpName = groups.find(g => g.id === membersGroupId)?.name ?? ''
        const memberRoleColor = (role: string) => role === 'agendadora'
          ? { bg: '#ede9fe', border: '#c4b5fd', text: '#6d28d9' }
          : { bg: '#dcfce7', border: '#86efac', text: '#15803d' }
        return (
        <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4">
          <div className="rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden"
            style={{ background: '#ffffff', border: '1px solid #e6e1f0' }}>

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 flex-shrink-0"
              style={{ borderBottom: '1px solid #f1f5f9', background: '#faf9fd' }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: '#ede9fe', border: '1px solid #c4b5fd' }}>
                  <UserCheck size={16} style={{ color: '#6d28d9' }} />
                </div>
                <div>
                  <h2 className="text-sm font-bold" style={{ color: '#1e293b' }}>{grpName}</h2>
                  <p className="text-[11px] mt-0.5" style={{ color: '#64748b' }}>
                    {groupMembers.length} persona{groupMembers.length !== 1 ? 's' : ''} en el grupo
                  </p>
                </div>
              </div>
              <button onClick={() => { setShowMembersModal(false); setMembersGroupId(null) }}
                className="w-8 h-8 flex items-center justify-center rounded-xl transition-colors"
                style={{ color: '#64748b' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f1f5f9' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto" style={{ background: '#ffffff' }}>
              {membersLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <>
                  {/* Current members */}
                  <div className="px-5 pt-5 pb-3">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#94a3b8' }}>
                        Equipo actual
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                        style={{ background: '#ede9fe', color: '#6d28d9' }}>
                        {groupMembers.length}
                      </span>
                    </div>
                    {groupMembers.length === 0 ? (
                      <div className="flex flex-col items-center py-8 rounded-xl"
                        style={{ background: '#faf9fd', border: '1px dashed #e6e1f0' }}>
                        <UserCheck size={22} style={{ color: '#cbd5e1' }} />
                        <p className="text-xs mt-2" style={{ color: '#94a3b8' }}>Sin personas asignadas aún</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {groupMembers.map(u => {
                          const rc = memberRoleColor(u.role)
                          return (
                            <div key={u.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl group transition-colors"
                              style={{ background: '#faf9fd', border: '1px solid #e6e1f0' }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#c7d2fe' }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#e6e1f0' }}>
                              <div className="w-8 h-8 rounded-xl font-bold flex items-center justify-center text-sm flex-shrink-0"
                                style={{ background: rc.bg, color: rc.text, border: `1px solid ${rc.border}` }}>
                                {u.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold truncate" style={{ color: '#1e293b' }}>{u.name}</p>
                                <p className="text-[11px] truncate" style={{ color: '#64748b' }}>{u.email}</p>
                              </div>
                              <span className="text-[10px] font-semibold px-2 py-1 rounded-lg flex-shrink-0"
                                style={{ background: rc.bg, color: rc.text, border: `1px solid ${rc.border}` }}>
                                {roleLabel[u.role] ?? u.role}
                              </span>
                              <button
                                onClick={() => handleRemoveMember(u.id)}
                                title="Quitar del grupo"
                                className="w-7 h-7 flex items-center justify-center rounded-lg transition-all flex-shrink-0"
                                style={{ color: '#64748b', background: '#f1f5f9', border: '1px solid #e6e1f0' }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ef4444'; (e.currentTarget as HTMLElement).style.background = '#fee2e2'; (e.currentTarget as HTMLElement).style.borderColor = '#fca5a5' }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#64748b'; (e.currentTarget as HTMLElement).style.background = '#f1f5f9'; (e.currentTarget as HTMLElement).style.borderColor = '#e6e1f0' }}>
                                <UserMinus size={13} />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* Divider */}
                  {unassigned.length > 0 && (
                    <div className="mx-5 my-1" style={{ height: '1px', background: '#f1f5f9' }} />
                  )}

                  {/* Available to add */}
                  {unassigned.length > 0 && (
                    <div className="px-5 pt-3 pb-5">
                      <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: '#94a3b8' }}>
                        Disponibles para agregar
                      </p>
                      <div className="space-y-1.5">
                        {unassigned.map(u => {
                          const rc = memberRoleColor(u.role)
                          return (
                            <div key={u.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all"
                              style={{ background: '#faf9fd', border: '1px solid #e6e1f0' }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f1f5f9'; (e.currentTarget as HTMLElement).style.borderColor = '#cbd5e1' }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#faf9fd'; (e.currentTarget as HTMLElement).style.borderColor = '#e6e1f0' }}>
                              <div className="w-8 h-8 rounded-xl font-bold flex items-center justify-center text-sm flex-shrink-0"
                                style={{ background: rc.bg, color: rc.text, border: `1px solid ${rc.border}` }}>
                                {u.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold truncate" style={{ color: '#1e293b' }}>{u.name}</p>
                                <p className="text-[11px] truncate" style={{ color: '#64748b' }}>{u.email}</p>
                              </div>
                              <span className="text-[10px] font-semibold px-2 py-1 rounded-lg flex-shrink-0"
                                style={{ background: rc.bg, color: rc.text, border: `1px solid ${rc.border}` }}>
                                {roleLabel[u.role] ?? u.role}
                              </span>
                              <button
                                onClick={() => handleAssignMember(u.id)}
                                className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg flex-shrink-0 transition-all"
                                style={{ background: '#ede9fe', color: '#6d28d9', border: '1px solid #c4b5fd' }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#ddd6fe' }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#ede9fe' }}>
                                <Plus size={11} /> Agregar
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        )
      })()}

      {/* User modal */}
      {showUserModal && (() => {
        const maxUsers = me?.negocio_plan_limits?.max_users ?? -1
        const activeUsers = users.filter(u => u.is_active && u.role !== 'tecnico').length
        const atUserLimit = !editUser && maxUsers !== -1 && activeUsers >= maxUsers
        return (
        <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4">
          <div className="bg-surface-1 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.07]">
              <h2 className="text-lg font-bold text-white">{editUser ? 'Editar Usuario' : 'Nuevo Usuario'}</h2>
              <button onClick={() => setShowUserModal(false)} className="p-2 hover:bg-surface-2 rounded-lg text-white/62">
                <X size={18} />
              </button>
            </div>
            {atUserLimit && (
              <div className="mx-6 mt-4 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium"
                style={{ background: 'rgba(225,29,72,0.08)', border: '1px solid rgba(225,29,72,0.20)', color: '#e11d48' }}>
                <span>⚠ Límite de {maxUsers} usuarios del plan alcanzado. Actualiza el plan para agregar más.</span>
              </div>
            )}
            <form onSubmit={handleSaveUser} className="px-6 py-5 space-y-4">
              <div>
                <label className="input-label">Nombre *</label>
                <input className="input" value={userForm.name} required
                  onChange={e => setUserForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="input-label">Email *</label>
                <input type="email" className="input" value={userForm.email} required
                  onChange={e => setUserForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div>
                <label className="input-label">
                  Contraseña {editUser ? '(vacío = no cambiar)' : '*'}
                </label>
                <input type="password" className="input" value={userForm.password}
                  required={!editUser}
                  onChange={e => setUserForm(f => ({ ...f, password: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="input-label">Rol *</label>
                  <select className="input" value={userForm.role}
                    onChange={e => setUserForm(f => ({ ...f, role: e.target.value }))}>
                    {me?.role === 'superadmin' && <option value="superadmin">Super Admin</option>}
                    <option value="subadmin">Sub Admin</option>
                    <option value="agendadora">Agendador/a</option>
                    <option value="vendedor">Vendedor</option>
                    <option value="verificador">Verificador Pagos</option>
                    <option value="cobrador">Cobrador</option>
                    <option value="analista">Analista</option>
                    <option value="asistente_seguimiento">Asistente Seguimiento</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">Grupo</label>
                  <select className="input" value={userForm.group_id}
                    onChange={e => setUserForm(f => ({ ...f, group_id: e.target.value }))}>
                    <option value="">Sin grupo</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="input-label">WhatsApp personal</label>
                <input className="input" value={userForm.whatsapp_number} placeholder="+56 9..."
                  onChange={e => setUserForm(f => ({ ...f, whatsapp_number: e.target.value }))} />
              </div>
            </form>
            <div className="px-6 py-4 border-t border-white/[0.07] flex gap-3">
              <button type="button" onClick={() => setShowUserModal(false)} className="btn-secondary flex-1">Cancelar</button>
              <button onClick={handleSaveUser} disabled={saving || atUserLimit} className="btn-primary flex-1">
                {saving ? 'Guardando...' : editUser ? 'Actualizar' : 'Crear'}
              </button>
            </div>
          </div>
        </div>
        )
      })()}

      {/* Group modal */}
      {showGroupModal && (
        <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4">
          <div className="bg-surface-1 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.07]">
              <h2 className="text-lg font-bold text-white">{editGroup ? 'Editar Grupo' : 'Nuevo Grupo'}</h2>
              <button onClick={() => { setShowGroupModal(false); setEditGroup(null) }} className="p-2 hover:bg-surface-2 rounded-lg text-white/62">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSaveGroup} className="px-6 py-5 space-y-4">
              <div>
                <label className="input-label">Nombre *</label>
                <input className="input" value={groupForm.name} required
                  onChange={e => setGroupForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="input-label">Descripción</label>
                <input className="input" value={groupForm.description}
                  onChange={e => setGroupForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </form>
            <div className="px-6 py-4 border-t border-white/[0.07] flex gap-3">
              <button type="button" onClick={() => { setShowGroupModal(false); setEditGroup(null) }} className="btn-secondary flex-1">Cancelar</button>
              <button onClick={handleSaveGroup} disabled={saving} className="btn-primary flex-1">
                {saving ? 'Guardando...' : editGroup ? 'Actualizar' : 'Crear Grupo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Area modal */}
      {showAreaModal && (
        <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4">
          <div className="bg-surface-1 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.07]">
              <div>
                <h2 className="text-lg font-bold text-white">{editArea ? 'Editar Área' : 'Nueva Área Legal'}</h2>
                <p className="text-xs text-white/52 mt-0.5">Un número puede asignarse a múltiples áreas</p>
              </div>
              <button onClick={() => { setShowAreaModal(false); setEditArea(null) }} className="p-2 hover:bg-surface-2 rounded-lg text-white/62">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSaveArea} className="px-6 py-5 space-y-4">
              <div>
                <label className="input-label">Nombre del área *</label>
                <input className="input" value={areaForm.name} required
                  placeholder="Ej: Deuda Ejecutiva"
                  onChange={e => setAreaForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="input-label">Números WhatsApp asociados</label>
                {availableWA.length === 0 ? (
                  <p className="text-xs text-warn mt-1 flex items-center gap-1">
                    <Phone size={11} /> Sin números disponibles — el técnico debe agregar números primero.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto border border-white/10 rounded-xl p-2">
                    {availableWA.map(wa => (
                      <label key={wa.id} className="flex items-center gap-3 p-2 hover:bg-surface-0 rounded-lg cursor-pointer">
                        <input
                          type="checkbox"
                          checked={areaForm.whatsapp_config_ids.includes(wa.id)}
                          onChange={() => toggleWASelection(wa.id)}
                          className="rounded border-white/15 text-white"
                        />
                        <div className="flex items-center gap-2 min-w-0">
                          <Phone size={13} className="text-lime flex-shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-white/90">{wa.phone_number}</p>
                            <p className="text-xs text-white/52">{[wa.name, wa.group_name].filter(Boolean).join(' · ')}</p>
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
                {areaForm.whatsapp_config_ids.length > 0 && (
                  <p className="text-xs text-lime mt-1.5 font-medium">
                    {areaForm.whatsapp_config_ids.length} número{areaForm.whatsapp_config_ids.length > 1 ? 's' : ''} seleccionado{areaForm.whatsapp_config_ids.length > 1 ? 's' : ''}
                  </p>
                )}
              </div>
            </form>
            <div className="px-6 py-4 border-t border-white/[0.07] flex gap-3">
              <button type="button" onClick={() => { setShowAreaModal(false); setEditArea(null) }} className="btn-secondary flex-1">Cancelar</button>
              <button onClick={handleSaveArea} disabled={saving} className="btn-primary flex-1">
                {saving ? 'Guardando...' : editArea ? 'Actualizar' : 'Crear Área'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── AI Agents tab ─────────────────────────────────────────── */}
      {activeTab === 'ai_agents' && (
        <div className="space-y-4">
          <div className="bg-surface-1 rounded-xl border border-white/[0.07] shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
              <div>
                <h2 className="font-semibold text-white/90 flex items-center gap-2">
                  <Bot size={16} className="text-lime" />
                  {isTecnico ? 'Agentes IA' : 'Mis Agentes'}
                  <span className="text-white/52 font-normal">({agents.length})</span>
                </h2>
                <p className="text-xs text-white/42 mt-0.5">
                  {isTecnico
                    ? 'Gestión global de agentes IA por número WhatsApp'
                    : 'Agentes configurados para tu negocio'}
                </p>
              </div>
              {/* Only tecnico can create agents */}
              {isTecnico && (
                <button onClick={() => openAgentModal()}
                  className="flex items-center gap-1.5 btn-primary text-sm px-4 py-2">
                  <Plus size={14} /> Nuevo Agente
                </button>
              )}
            </div>

            {agentsLoading ? (
              <div className="px-6 py-10 text-center text-white/42 text-sm">Cargando agentes...</div>
            ) : agents.length === 0 ? (
              <div className="px-6 py-12 text-center space-y-3">
                <Bot size={36} className="mx-auto text-white/20" />
                <p className="text-white/52 text-sm">{isTecnico ? 'No hay agentes configurados.' : 'No tienes agentes asignados.'}</p>
                <p className="text-white/32 text-xs">{isTecnico ? 'Crea el primer agente para automatizar respuestas de WhatsApp.' : 'Contacta al técnico para configurar un agente.'}</p>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {agents.map(agent => (
                  <div key={agent.id} className="px-6 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ background: agent.is_active ? 'rgba(22,163,74,0.12)' : 'rgba(100,116,139,0.10)' }}>
                          <Bot size={16} style={{ color: agent.is_active ? '#16a34a' : '#64748b' }} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm" style={{ color: '#130d26' }}>{agent.name}</span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                              style={agent.is_active
                                ? { background: 'rgba(22,163,74,0.12)', color: '#15803d', border: '1px solid rgba(22,163,74,0.35)' }
                                : { background: 'rgba(100,116,139,0.12)', color: '#475569', border: '1px solid rgba(100,116,139,0.35)' }}>
                              {agent.is_active ? 'ACTIVO' : 'INACTIVO'}
                            </span>
                            {isTecnico && agent.group_name && (
                              <span className="text-[10px] text-white/40 border border-white/10 px-1.5 py-0.5 rounded">
                                {agent.group_name}
                              </span>
                            )}
                          </div>
                          {agent.description && <p className="text-xs mt-0.5 truncate" style={{ color: '#475569' }}>{agent.description}</p>}
                          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                            {/* Multi-number chips */}
                            {(agent.configs ?? []).map((c: any) => (
                              <span key={c.id} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg"
                                style={{ background: '#2d2b55', border: '1.5px solid #6c63ff' }}>
                                <MessageSquare size={9} style={{ color: '#a5b4fc', flexShrink: 0 }} />
                                <span className="flex flex-col leading-none">
                                  <span className="font-bold" style={{ color: '#ffffff' }}>{c.phone_number}</span>
                                  {c.group_name && (
                                    <span className="text-[9px] mt-0.5" style={{ color: '#c4b5fd' }}>{c.group_name}</span>
                                  )}
                                </span>
                                <button
                                  onClick={() => handleRemoveConfig(agent.id, c.id)}
                                  className="ml-0.5 transition-colors flex-shrink-0"
                                  style={{ color: '#a5b4fc' }}
                                  onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                                  onMouseLeave={e => (e.currentTarget.style.color = '#a5b4fc')}
                                  title="Quitar número">
                                  <X size={9} />
                                </button>
                              </span>
                            ))}
                            {/* Add number button */}
                            {(agent.configs ?? []).length < 10 && (
                              <button
                                onClick={() => setAssignWAOpen(p => ({ ...p, [agent.id]: !p[agent.id] }))}
                                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold transition-colors"
                                style={{ color: '#ffffff', border: '1px solid #d97706', background: '#b45309' }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#92400e' }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#b45309' }}>
                                <MessageSquare size={9} /> + Número
                              </button>
                            )}
                            {isTecnico && (
                              <span className="flex items-center gap-1 text-xs" style={{ color: '#64748b' }}>
                                <Zap size={10} /> {agent.openai_model}
                              </span>
                            )}
                            <span className="text-xs font-medium" style={{ color: '#64748b' }}>{agent.total_messages_sent ?? 0} enviados</span>
                            {agent.business_hours_start && (
                              <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md"
                                style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.4)' }}>
                                <Clock size={10} /> {agent.business_hours_start}–{agent.business_hours_end}
                              </span>
                            )}
                          </div>

                          {/* Add-number dropdown */}
                          {assignWAOpen[agent.id] && (
                            <div className="mt-2 flex items-center gap-2">
                              <select
                                className="input text-xs py-1.5 flex-1"
                                defaultValue=""
                                onChange={e => {
                                  const v = e.target.value
                                  if (v) { handleAddConfig(agent.id, parseInt(v)); setAssignWAOpen(p => ({ ...p, [agent.id]: false })) }
                                }}>
                                <option value="">— Seleccionar número —</option>
                                {allWAConfigs
                                  .filter((c: any) => !(agent.configs ?? []).some((x: any) => x.id === c.id))
                                  .map((c: any) => (
                                    <option key={c.id} value={c.id}>
                                      {c.phone_number}{c.name ? ` — ${c.name}` : ''}{c.group_name ? ` · ${c.group_name}` : ''}
                                    </option>
                                  ))}
                              </select>
                              <button
                                onClick={() => setAssignWAOpen(p => ({ ...p, [agent.id]: false }))}
                                className="text-white/42 hover:text-white/90 p-1">
                                <X size={13} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {/* Logs toggle — both tecnico and business admin */}
                        <button onClick={() => toggleAgentLogs(agent.id)}
                          className="flex items-center gap-1 text-xs text-white/52 hover:text-white/90 border border-white/10 px-2.5 py-1.5 rounded-lg transition-colors">
                          <Eye size={11} />
                          {agentLogsOpen[agent.id] ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        </button>

                        {/* Toggle active — both tecnico and business admin */}
                        <button
                          onClick={() => handleToggleAgent(agent.id, agent.is_active)}
                          title={agent.is_active ? 'Desactivar agente' : 'Activar agente'}
                          className={`p-2 rounded-lg transition-colors ${agent.is_active ? 'text-lime hover:bg-lime/10' : 'text-white/30 hover:bg-white/[0.06]'}`}>
                          {agent.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                        </button>

                        {/* Schedule — superadmin/subadmin can configure business hours */}
                        {!isTecnico && (
                          <button
                            onClick={() => openScheduleModal(agent)}
                            title="Configurar horario de activación"
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors"
                            style={{ background: '#1c1c2e', color: '#f5f5ff', border: '1px solid #3a3a5c' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#2a2a42' }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#1c1c2e' }}>
                            <Clock size={12} /> Horario
                          </button>
                        )}

                        {/* Edit / Delete — tecnico only */}
                        {isTecnico && (
                          <>
                            <button onClick={() => openAgentModal(agent)}
                              className="p-2 text-white/52 hover:text-white/90 hover:bg-white/[0.06] rounded-lg transition-colors">
                              <Edit2 size={14} />
                            </button>
                            <button onClick={() => handleDeleteAgent(agent.id)}
                              className="p-2 text-white/52 hover:text-danger hover:bg-danger/10 rounded-lg transition-colors">
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Logs panel */}
                    {agentLogsOpen[agent.id] && (
                      <div className="mt-4 bg-surface-2 rounded-xl border border-white/[0.07] overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.07]">
                          <span className="text-xs font-semibold text-white/62">Últimas interacciones</span>
                          <button onClick={() => getAIAgentLogs(agent.id, 30).then(l => setAgentLogs(prev => ({ ...prev, [agent.id]: l })))}
                            className="text-xs text-white/42 hover:text-white/90 flex items-center gap-1">
                            <RefreshCw size={10} /> Actualizar
                          </button>
                        </div>
                        {(!agentLogs[agent.id] || agentLogs[agent.id].length === 0) ? (
                          <p className="text-xs text-white/42 px-4 py-4 text-center">Sin interacciones registradas aún.</p>
                        ) : (
                          <div className="divide-y divide-white/[0.05] max-h-72 overflow-y-auto">
                            {agentLogs[agent.id].map(log => (
                              <div key={log.id} className="px-4 py-3 text-xs">
                                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${log.error ? 'bg-danger' : 'bg-lime'}`} />
                                  <span className="text-white/42">{log.created_at ? new Date(log.created_at).toLocaleString('es-CL') : ''}</span>
                                  <span className="text-white/20">·</span>
                                  <span className="text-white/42">{log.model_used}</span>
                                  <span className="text-white/20">·</span>
                                  <span className="text-white/42">{log.tokens_used} tokens · {log.latency_ms}ms</span>
                                </div>
                                {log.error ? (
                                  <p className="text-danger/80">Error: {log.error}</p>
                                ) : (
                                  <div className="space-y-1">
                                    <p className="text-white/42 truncate"><span className="text-white/25">Cliente:</span> {log.input_message}</p>
                                    <p className="text-white/75 truncate"><span className="text-lime/60">Agente:</span> {log.output_message}</p>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Security audit log tab (ISO 27001) ───────────────────────── */}
      {activeTab === 'security' && (() => {
        const severityBadge: Record<string, string> = {
          info: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
          warning: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
          critical: 'bg-danger/10 text-danger border-danger/20',
        }
        const actionLabel: Record<string, string> = {
          login_success: 'Inicio de sesión',
          login_failed: 'Intento fallido',
          login_blocked: 'Acceso bloqueado',
          login_locked: 'Cuenta bloqueada',
          account_unlocked: 'Cuenta desbloqueada',
          user_created: 'Usuario creado',
          user_updated: 'Usuario actualizado',
          user_deactivated: 'Usuario desactivado',
        }
        const roleLabel: Record<string, string> = {
          superadmin: 'Super Admin', subadmin: 'Sub Admin',
          agendadora: 'Agendador/a', vendedor: 'Vendedor',
          verificador: 'Verificador', tecnico: 'Técnico',
        }
        const totalPages = Math.max(1, Math.ceil(auditTotal / 50))
        return (
          <div className="space-y-4">
            {/* Stats */}
            {secStats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Intentos fallidos (24h)', value: secStats.failed_logins_24h, color: 'text-amber-400', bg: secStats.failed_logins_24h > 0 ? 'border-amber-500/20' : '' },
                  { label: 'Cuentas bloqueadas', value: secStats.blocked_accounts, color: secStats.blocked_accounts > 0 ? 'text-danger' : 'text-white/70', bg: secStats.blocked_accounts > 0 ? 'border-danger/20' : '' },
                  { label: 'Eventos críticos (24h)', value: secStats.critical_events_24h, color: secStats.critical_events_24h > 0 ? 'text-red-400' : 'text-white/70', bg: secStats.critical_events_24h > 0 ? 'border-red-500/20' : '' },
                  { label: 'Total eventos registrados', value: secStats.total_events, color: 'text-white/70', bg: '' },
                ].map(s => (
                  <div key={s.label} className={`bg-surface-1 rounded-xl border px-4 py-3 ${s.bg || 'border-white/[0.07]'}`}>
                    <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-white/42 mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Cuentas bloqueadas */}
            <div className="bg-danger/5 border border-danger/20 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-danger/15">
                  <span className="w-2 h-2 rounded-full bg-danger animate-pulse" />
                  <span className="text-sm font-semibold text-danger">
                    {lockedUsers.length} cuenta{lockedUsers.length > 1 ? 's' : ''} bloqueada{lockedUsers.length > 1 ? 's' : ''}
                  </span>
                  <span className="text-xs text-danger/60 ml-1">— tras {5} intentos fallidos consecutivos</span>
                </div>
                <div className="divide-y divide-danger/10">
                  {lockedUsers.length === 0 && (
                    <div className="px-5 py-4 text-sm text-white/45">
                      No hay cuentas bloqueadas actualmente.
                    </div>
                  )}
                  {lockedUsers.map((u: any) => {
                    const until = new Date(u.locked_until)
                    const remaining = Math.max(0, Math.ceil((until.getTime() - Date.now()) / 60000))
                    return (
                      <div key={u.id} className="flex items-center gap-4 px-5 py-3">
                        <div className="w-8 h-8 rounded-full bg-danger/15 flex items-center justify-center flex-shrink-0">
                          <span className="text-danger font-bold text-xs">{u.name.charAt(0)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white/90">{u.name}</p>
                          <p className="text-xs text-white/42">{u.email} · {roleLabel[u.role] ?? u.role}{u.negocio_name ? ` · ${u.negocio_name}` : ''}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs text-danger/80">{remaining} min restantes</p>
                          <p className="text-[10px] text-white/30">{u.failed_attempts} intentos</p>
                        </div>
                        <button
                          onClick={() => handleUnlock(u.id, u.email)}
                          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-danger/15 hover:bg-danger/25 text-danger border border-danger/20 transition-colors flex-shrink-0"
                        >
                          Desbloquear
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>

            {/* Filters + table */}
            <div className="bg-surface-1 rounded-xl border border-white/[0.07] overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 gap-3 flex-wrap">
                <h2 className="font-semibold text-white/90 flex items-center gap-2">
                  <Shield size={16} className="text-white/60" />
                  Registro de Auditoría
                  <span className="text-white/40 font-normal text-sm">({auditTotal} eventos de tu negocio)</span>
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={auditAction}
                    onChange={e => setAuditAction(e.target.value)}
                    className="input text-xs py-1.5 px-2 h-auto"
                  >
                    <option value="">Todas las acciones</option>
                    {Object.entries(actionLabel).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                  <select
                    value={auditSeverity}
                    onChange={e => setAuditSeverity(e.target.value)}
                    className="input text-xs py-1.5 px-2 h-auto"
                  >
                    <option value="">Todos los niveles</option>
                    <option value="info">Info</option>
                    <option value="warning">Warning</option>
                    <option value="critical">Critical</option>
                  </select>
                  <button
                    onClick={() => loadAuditLog(1)}
                    disabled={auditLoading}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-white/10 bg-surface-2 text-white/70 hover:bg-surface-3 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={auditLoading ? 'animate-spin' : ''} />
                    Actualizar
                  </button>
                </div>
              </div>

              {auditLoading ? (
                <div className="py-12 text-center text-white/42 text-sm">Cargando registros...</div>
              ) : auditLog.length === 0 ? (
                <div className="py-12 text-center space-y-2">
                  <Shield size={32} className="mx-auto text-white/15" />
                  <p className="text-white/42 text-sm">Sin eventos de auditoría</p>
                </div>
              ) : (
                <div className="overflow-x-auto table-scroll">
                  <table className="w-full text-xs">
                    <thead className="bg-surface-0 border-b border-white/[0.07]">
                      <tr>
                        <th className="table-header">Fecha/Hora</th>
                        <th className="table-header">Acción</th>
                        <th className="table-header">Usuario</th>
                        <th className="table-header">IP</th>
                        <th className="table-header">Nivel</th>
                        <th className="table-header">Detalle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLog.map((e: any) => (
                        <tr key={e.id} className={`table-row ${e.severity === 'critical' ? 'bg-danger/[0.03]' : e.severity === 'warning' ? 'bg-amber-500/[0.02]' : ''}`}>
                          <td className="table-cell text-white/42 whitespace-nowrap">
                            {new Date(e.created_at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}
                          </td>
                          <td className="table-cell font-medium text-white/80">
                            {actionLabel[e.action] ?? e.action}
                          </td>
                          <td className="table-cell text-white/60">{e.actor_email ?? '—'}</td>
                          <td className="table-cell text-white/42 font-mono">{e.ip_address ?? '—'}</td>
                          <td className="table-cell">
                            <span className={`badge border text-[10px] font-semibold ${severityBadge[e.severity] ?? 'bg-surface-2 text-white/50'}`}>
                              {e.severity}
                            </span>
                          </td>
                          <td className="table-cell text-white/42 max-w-xs truncate" title={e.details ?? ''}>{e.details ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {totalPages > 1 && (
                <div className="flex items-center justify-between px-6 py-3 border-t border-white/[0.05] text-xs text-white/42">
                  <span>Página {auditPage} de {totalPages} · {auditTotal} registros</span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => loadAuditLog(auditPage - 1)}
                      disabled={auditPage <= 1 || auditLoading}
                      className="px-3 py-1 rounded-lg border border-white/10 hover:bg-surface-2 disabled:opacity-30 transition-colors"
                    >
                      Anterior
                    </button>
                    <button
                      onClick={() => loadAuditLog(auditPage + 1)}
                      disabled={auditPage >= totalPages || auditLoading}
                      className="px-3 py-1 rounded-lg border border-white/10 hover:bg-surface-2 disabled:opacity-30 transition-colors"
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* ── Schedule modal — superadmin/subadmin ─────────────────── */}
      {scheduleAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="rounded-2xl shadow-2xl w-full max-w-sm flex flex-col"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-2)' }}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: '1px solid var(--border)' }}>
              <h3 className="font-bold text-base flex items-center gap-2" style={{ color: 'var(--text)' }}>
                <Clock size={16} style={{ color: '#d97706' }} />
                Horario de activación
              </h3>
              <button onClick={() => setScheduleAgent(null)}
                className="p-1.5 rounded-lg transition-colors hover:bg-black/[0.05]"
                style={{ color: 'var(--text-muted)' }}>
                <X size={15} />
              </button>
            </div>

            <div className="px-5 py-5 space-y-4">
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
                Define en qué rango el agente responde automáticamente.
              </p>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
                Ej: <span style={{ color: '#d97706', fontWeight: 600 }}>17:30 – 09:00</span> activa desde las 17:30 hasta las 9:00 AM del día siguiente.
                Deja ambos vacíos para <span style={{ color: '#16a34a', fontWeight: 600 }}>24/7</span>.
                Hora de Chile (Santiago).
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-2)' }}>Hora inicio</label>
                  <input
                    type="time"
                    value={scheduleForm.start}
                    onChange={e => setScheduleForm(f => ({ ...f, start: e.target.value }))}
                    className="w-full rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none"
                    style={{
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border-2)',
                      color: 'var(--text)',
                    }}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-2)' }}>Hora fin</label>
                  <input
                    type="time"
                    value={scheduleForm.end}
                    onChange={e => setScheduleForm(f => ({ ...f, end: e.target.value }))}
                    className="w-full rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none"
                    style={{
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border-2)',
                      color: 'var(--text)',
                    }}
                  />
                </div>
              </div>

              {(scheduleForm.start || scheduleForm.end) ? (
                <div className="rounded-lg px-3 py-2.5 text-sm font-semibold flex items-center gap-2"
                  style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.30)', color: '#b45309' }}>
                  <Clock size={13} />
                  {scheduleForm.start || '??:??'} → {scheduleForm.end || '??:??'}
                  {scheduleForm.start && scheduleForm.end && scheduleForm.start > scheduleForm.end
                    ? <span style={{ color: '#d97706', fontSize: 11 }}> (cruza medianoche)</span> : null}
                </div>
              ) : (
                <div className="rounded-lg px-3 py-2.5 text-sm font-semibold flex items-center gap-2"
                  style={{ background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', color: '#16a34a' }}>
                  <Clock size={13} /> Activo 24/7
                </div>
              )}
            </div>

            <div className="flex gap-3 px-5 pb-5">
              <button
                onClick={() => setScheduleAgent(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors hover:bg-black/[0.04]"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border-2)', color: 'var(--text-2)' }}>
                Cancelar
              </button>
              <button
                onClick={handleSaveSchedule}
                disabled={scheduleSaving}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
                style={{ background: '#d97706', border: '1px solid #f59e0b', color: '#fff' }}
                onMouseEnter={e => { if (!scheduleSaving) (e.currentTarget as HTMLElement).style.background = '#b45309' }}
                onMouseLeave={e => { if (!scheduleSaving) (e.currentTarget as HTMLElement).style.background = '#d97706' }}>
                {scheduleSaving ? <RefreshCw size={13} className="animate-spin" /> : <Clock size={13} />}
                {scheduleSaving ? 'Guardando…' : 'Guardar horario'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Agent modal — tecnico only ─────────────────────────────── */}
      {showAgentModal && isTecnico && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface-1 rounded-2xl border border-white/[0.07] shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07]">
              <h3 className="font-semibold text-white/90 flex items-center gap-2">
                <Bot size={16} className="text-lime" />
                {editAgent ? 'Editar Agente IA' : 'Nuevo Agente IA'}
              </h3>
              <button onClick={() => setShowAgentModal(false)} className="text-white/42 hover:text-white/90 p-1 rounded-lg"><X size={16} /></button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
              {/* Básico */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-white/42 uppercase tracking-wider">Información básica</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs text-white/52 block mb-1">Nombre del agente *</label>
                    <input className="input w-full" placeholder="Ej: Asistente Ventas"
                      value={agentForm.name} onChange={e => setAgentForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-white/52 block mb-1">Descripción (opcional)</label>
                    <input className="input w-full" placeholder="Ej: Agente de ventas para canal Instagram"
                      value={agentForm.description} onChange={e => setAgentForm(f => ({ ...f, description: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs text-white/52 block mb-1">Número WhatsApp *</label>
                    <select className="input w-full" value={agentForm.whatsapp_config_id}
                      onChange={e => setAgentForm(f => ({ ...f, whatsapp_config_id: e.target.value }))}>
                      <option value="">— Seleccionar —</option>
                      {allWAConfigs.map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {c.phone_number}{c.name ? ` — ${c.name}` : ''}{c.group_name ? ` · ${c.group_name}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <button type="button" onClick={() => setAgentForm(f => ({ ...f, is_active: !f.is_active }))}
                        className={`w-10 h-5 rounded-full transition-colors ${agentForm.is_active ? 'bg-lime' : 'bg-white/20'} relative`}>
                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${agentForm.is_active ? 'left-5' : 'left-0.5'}`} />
                      </button>
                      <span className="text-sm text-white/78">{agentForm.is_active ? 'Activo' : 'Inactivo'}</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Prompt */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-white/42 uppercase tracking-wider">Personalidad & Conocimiento</h4>
                <div>
                  <label className="text-xs text-white/52 block mb-1">Prompt del sistema *</label>
                  <textarea className="input w-full resize-none font-mono text-xs" rows={8}
                    placeholder="Describe la personalidad, servicios, precios y comportamiento del agente..."
                    value={agentForm.system_prompt}
                    onChange={e => setAgentForm(f => ({ ...f, system_prompt: e.target.value }))} />
                  <p className="text-[10px] text-white/32 mt-1">Incluye nombre del negocio, servicios, precios, horarios y tono de voz.</p>
                </div>
              </div>

              {/* OpenAI */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-white/42 uppercase tracking-wider">OpenAI</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs text-white/52 block mb-1">
                      API Key {editAgent ? '(dejar vacío para mantener la actual)' : '*'}
                    </label>
                    <input className="input w-full font-mono text-xs" type="password"
                      placeholder={editAgent ? '••••••••••••••••••••' : 'sk-proj-...'}
                      value={agentForm.openai_api_key}
                      onChange={e => setAgentForm(f => ({ ...f, openai_api_key: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs text-white/52 block mb-1">Modelo</label>
                    <select className="input w-full" value={agentForm.openai_model}
                      onChange={e => setAgentForm(f => ({ ...f, openai_model: e.target.value }))}>
                      {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-white/52 block mb-1">Temperatura ({agentForm.temperature})</label>
                    <input type="range" min="0" max="2" step="0.1" className="w-full accent-lime"
                      value={agentForm.temperature}
                      onChange={e => setAgentForm(f => ({ ...f, temperature: parseFloat(e.target.value) }))} />
                    <div className="flex justify-between text-[10px] text-white/30 mt-0.5">
                      <span>Preciso</span><span>Creativo</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-white/52 block mb-1">Máx. tokens respuesta</label>
                    <input type="number" className="input w-full" min={50} max={4000}
                      value={agentForm.max_tokens}
                      onChange={e => setAgentForm(f => ({ ...f, max_tokens: parseInt(e.target.value) || 500 }))} />
                  </div>
                  <div>
                    <label className="text-xs text-white/52 block mb-1">Mensajes de historial</label>
                    <input type="number" className="input w-full" min={5} max={100}
                      value={agentForm.max_history_messages}
                      onChange={e => setAgentForm(f => ({ ...f, max_history_messages: parseInt(e.target.value) || 20 }))} />
                  </div>
                </div>
              </div>

              {/* Comportamiento */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-white/42 uppercase tracking-wider">Comportamiento</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-white/52 block mb-1">Demora de respuesta (seg)</label>
                    <input type="number" className="input w-full" min={0} max={30}
                      value={agentForm.response_delay_seconds}
                      onChange={e => setAgentForm(f => ({ ...f, response_delay_seconds: parseInt(e.target.value) || 0 }))} />
                  </div>
                  <div>
                    <label className="text-xs text-white/52 block mb-1">Horario inicio</label>
                    <input type="time" className="input w-full"
                      value={agentForm.business_hours_start}
                      onChange={e => setAgentForm(f => ({ ...f, business_hours_start: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs text-white/52 block mb-1">Horario fin</label>
                    <input type="time" className="input w-full"
                      value={agentForm.business_hours_end}
                      onChange={e => setAgentForm(f => ({ ...f, business_hours_end: e.target.value }))} />
                  </div>
                </div>
                <p className="text-[10px] text-white/32">Sin horario = activo 24/7. Con horario = solo responde dentro del rango.</p>
              </div>

              {/* Escalación */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-white/42 uppercase tracking-wider">Escalación a humano</h4>
                <p className="text-[10px] text-white/42">Palabras en la respuesta del bot que disparan la derivación automática a un agente humano.</p>
                <div className="flex gap-2">
                  <input className="input flex-1" placeholder="Ej: asesor humano, persona real..."
                    value={agentForm.escalation_kw_input}
                    onChange={e => setAgentForm(f => ({ ...f, escalation_kw_input: e.target.value }))}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault()
                        const kw = agentForm.escalation_kw_input.trim()
                        if (kw && !agentForm.escalation_keywords.includes(kw)) {
                          setAgentForm(f => ({ ...f, escalation_keywords: [...f.escalation_keywords, kw], escalation_kw_input: '' }))
                        }
                      }
                    }} />
                  <button type="button"
                    onClick={() => {
                      const kw = agentForm.escalation_kw_input.trim()
                      if (kw && !agentForm.escalation_keywords.includes(kw)) {
                        setAgentForm(f => ({ ...f, escalation_keywords: [...f.escalation_keywords, kw], escalation_kw_input: '' }))
                      }
                    }}
                    className="btn-secondary px-3 text-sm">Agregar</button>
                </div>
                {agentForm.escalation_keywords.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {agentForm.escalation_keywords.map(kw => (
                      <span key={kw} className="flex items-center gap-1 text-xs bg-amber-500/15 text-amber-400 border border-amber-500/25 px-2.5 py-1 rounded-full">
                        {kw}
                        <button onClick={() => setAgentForm(f => ({ ...f, escalation_keywords: f.escalation_keywords.filter(k => k !== kw) }))}>
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-white/[0.07] flex gap-3">
              <button onClick={() => setShowAgentModal(false)} className="btn-secondary flex-1">Cancelar</button>
              <button onClick={handleSaveAgent} disabled={agentSaving} className="btn-primary flex-1">
                {agentSaving ? 'Guardando...' : editAgent ? 'Actualizar Agente' : 'Crear Agente'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog}

      {/* ── Cobrador Carteras tab ── */}
      {activeTab === 'cobrador_carteras' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-white text-base">{cobCarteras.length} cobrador{cobCarteras.length !== 1 ? 'es' : ''} activo{cobCarteras.length !== 1 ? 's' : ''}</h2>
              <p className="text-xs text-white/40 mt-0.5">Toca <span className="font-semibold text-white/60">el chip de áreas</span> de cada cobrador para elegir qué áreas atiende · <span className="font-semibold text-white/60">% Cobrado</span> = clientes con deuda saldada (no cuenta abonos parciales)</p>
            </div>
            <button onClick={loadCobradorCarteras} disabled={cobCarterasLoading}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl bg-surface-1 text-white/70 hover:bg-surface-2 border border-white/10 transition-colors">
              <RefreshCw size={13} className={cobCarterasLoading ? 'animate-spin' : ''} /> Actualizar
            </button>
          </div>

          {cobCarterasLoading ? (
            <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" /></div>
          ) : cobCarteras.length === 0 ? (
            <div className="bg-surface-1 rounded-2xl border border-white/[0.07] p-12 text-center">
              <p className="text-sm text-white/40">Sin cobradores activos</p>
            </div>
          ) : (
            <div className="space-y-3">
              {cobCarteras.map((c: any) => {
                const pct = c.total_deuda > 0 ? (c.total_cobrado / c.total_deuda * 100) : 0
                const expanded = cobExpandedId === c.id
                const isEditingArea = editingCobradorArea.id === c.id
                return (
                  <div key={c.id} className="bg-surface-1 rounded-2xl border border-white/[0.07]">

                    {/* ── Cobrador header row ── */}
                    <div className="grid gap-4 p-5" style={{ gridTemplateColumns: '1fr auto' }}>
                      <div className="flex items-center gap-4 min-w-0">
                        {/* Avatar */}
                        <div className="w-11 h-11 rounded-xl flex items-center justify-center font-black text-lg flex-shrink-0"
                          style={{ background: 'rgba(124,58,237,0.18)', color: '#818cf8' }}>
                          {c.name.charAt(0).toUpperCase()}
                        </div>
                        {/* Name + email + area */}
                        <div className="min-w-0">
                          <p className="font-bold text-white/90">{c.name}</p>
                          <p className="text-xs text-white/40 truncate mb-2">{c.email}</p>
                          {/* Area assignment */}
                          <div className="flex items-center gap-2 relative">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">Áreas:</span>
                            <button onClick={e => {
                              e.stopPropagation()
                              if (isEditingArea) { setEditingCobradorArea({ id: 0, areas: [] }); return }
                              const current = c.cobrador_area ? c.cobrador_area.split(',').map((s: string) => s.trim()).filter(Boolean) : []
                              setEditingCobradorArea({ id: c.id, areas: current })
                            }}
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all hover:opacity-80"
                              style={c.cobrador_area
                                ? { background: 'rgba(124,58,237,0.15)', color: '#818cf8', border: '1px solid rgba(124,58,237,0.35)' }
                                : { background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.40)', fontWeight: 700 }}>
                              <Edit2 size={10} />
                              {c.cobrador_area
                                ? c.cobrador_area.split(',').map((s: string) => s.trim()).filter(Boolean).join(' · ')
                                : 'Sin área asignada'}
                            </button>
                            {isEditingArea && (
                              <>
                                <div className="fixed inset-0 z-30" onClick={() => setEditingCobradorArea({ id: 0, areas: [] })} />
                                <div className="absolute left-0 top-full mt-1 z-40 rounded-xl shadow-2xl overflow-hidden border border-gray-200"
                                  style={{ background: '#ffffff', minWidth: 220 }}>
                                  <div className="max-h-52 overflow-y-auto">
                                    {Array.from(new Map(allAreas.map((a: any) => [a.name, a])).values()).map((a: any) => {
                                      const checked = editingCobradorArea.areas.includes(a.name)
                                      return (
                                        <label key={a.name} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-indigo-50 transition-colors border-b border-gray-100 last:border-0">
                                          <input type="checkbox" checked={checked}
                                            onChange={() => setEditingCobradorArea(prev => ({
                                              ...prev,
                                              areas: checked ? prev.areas.filter(x => x !== a.name) : [...prev.areas, a.name]
                                            }))}
                                            className="w-3.5 h-3.5 accent-indigo-500" />
                                          <span className="text-xs font-medium text-gray-800">{a.name}</span>
                                        </label>
                                      )
                                    })}
                                  </div>
                                  <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-100">
                                    <button onClick={async () => {
                                      const val = editingCobradorArea.areas.join(',') || null
                                      try {
                                        const res: any = await setCobradorArea(c.id, val)
                                        const traidos = (res?.leads_reasignados ?? 0) + (res?.created ?? 0)
                                        toast.success(traidos > 0 ? `Áreas guardadas — ${traidos} cliente${traidos !== 1 ? 's' : ''} en cartera` : 'Áreas guardadas')
                                        setEditingCobradorArea({ id: 0, areas: [] })
                                        loadCobradorCarteras()
                                      } catch { toast.error('Error') }
                                    }} className="flex-1 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors"
                                      style={{ background: '#7c3aed' }}>
                                      Guardar
                                    </button>
                                    <button onClick={() => setEditingCobradorArea({ id: 0, areas: [] })}
                                      className="px-2 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-600">✕</button>
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Stats + expand */}
                      <div className="flex items-center gap-5">
                        <div className="text-center">
                          <p className="text-2xl font-black text-white/90">{c.total_leads}</p>
                          <p className="text-[10px] uppercase tracking-widest text-white/35">Clientes</p>
                        </div>
                        <div className="w-px h-10 bg-white/[0.07]" />
                        <div className="text-center">
                          <p className="text-lg font-black" style={{ color: pct > 0 ? '#16a34a' : 'var(--text-muted)' }}>{pct.toFixed(0)}%</p>
                          <p className="text-[10px] uppercase tracking-widest text-white/35">Cobrado</p>
                        </div>
                        <button onClick={() => setClientesModal(c)}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all hover:scale-105"
                          style={{ background: 'rgba(124,58,237,0.12)', color: '#818cf8', border: '1px solid rgba(124,58,237,0.30)' }}>
                          Ver clientes
                          <ChevronDown size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="px-5 pb-4">
                      <div className="flex justify-between text-[10px] text-white/35 mb-1.5">
                        <span>Cobrado: ${Math.round(c.total_cobrado).toLocaleString('es-CL')}</span>
                        <span>Total: ${Math.round(c.total_deuda).toLocaleString('es-CL')}</span>
                      </div>
                      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: 'linear-gradient(90deg, #7c3aed, #06b6d4)' }} />
                      </div>
                    </div>

                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Clientes modal ── */}
      {clientesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={e => { if (e.target === e.currentTarget) setClientesModal(null) }}>
          <div className="rounded-2xl overflow-hidden flex flex-col"
            style={{ background: '#ffffff', border: '1px solid #e6e1f0', width: '100%', maxWidth: 860, maxHeight: '85vh' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 flex-shrink-0"
              style={{ background: '#faf9fd', borderBottom: '1px solid #e6e1f0' }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-base flex-shrink-0"
                  style={{ background: 'rgba(124,58,237,0.12)', color: '#7c3aed' }}>
                  {clientesModal.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-bold text-gray-900">{clientesModal.name}</p>
                  <p className="text-xs text-gray-500">{clientesModal.total_leads} clientes · {clientesModal.email}</p>
                </div>
              </div>
              <button onClick={() => setClientesModal(null)}
                className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                <X size={18} />
              </button>
            </div>
            {/* Cards grid */}
            <div className="overflow-y-auto p-5" style={{ background: '#f1f5f9' }}>
              {clientesModal.leads.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-12">Sin clientes en cartera</p>
              ) : (
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
                  {clientesModal.leads.map((l: any) => {
                    const stageCfg: Record<string, {label:string;color:string;dot:string;text:string}> = {
                      pendiente_moroso:  { label: 'Pendiente Moroso',  color: '#ede9fe', dot: '#7c3aed', text: '#5b21b6' },
                      lead_moroso:       { label: 'Lead Moroso',       color: '#fee2e2', dot: '#dc2626', text: '#991b1b' },
                      pago_comprometido: { label: 'Pago Comprometido', color: '#fef3c7', dot: '#d97706', text: '#92400e' },
                      pagado:            { label: 'Pagado',             color: '#d1fae5', dot: '#059669', text: '#065f46' },
                    }
                    const s = stageCfg[l.stage] ?? { label: l.stage, color: '#f3f4f6', dot: '#6b7280', text: '#374151' }
                    const pctL = l.monto_deuda > 0 ? Math.min((l.monto_pagado / l.monto_deuda) * 100, 100) : 0
                    return (
                      <div key={l.id} className="rounded-xl p-4 flex flex-col gap-3 group"
                        style={{ background: '#ffffff', border: '1px solid #e6e1f0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                        {/* Top row */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-gray-900 truncate">{l.nombre}</p>
                            {l.empresa && <p className="text-[11px] text-gray-500 truncate mt-0.5">{l.empresa}</p>}
                          </div>
                          <button onClick={async () => {
                            if (!window.confirm(`¿Quitar a ${l.nombre} de la cartera?`)) return
                            try {
                              await deleteCobradorLead(l.id)
                              toast.success('Eliminado')
                              await loadCobradorCarteras()
                              setClientesModal((prev: any) => prev ? { ...prev, leads: prev.leads.filter((x: any) => x.id !== l.id) } : null)
                            } catch { toast.error('Error') }
                          }} className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg transition-all flex-shrink-0"
                            style={{ color: '#dc2626', background: '#fee2e2' }}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                        {/* Stage badge */}
                        <span className="self-start inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
                          style={{ background: s.color, color: s.text }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }} />
                          {s.label}
                        </span>
                        {/* Montos */}
                        <div className="flex justify-between text-[10px] text-gray-500 font-medium">
                          <span>Deuda: ${Math.round(l.monto_deuda).toLocaleString('es-CL')}</span>
                          <span>Pagado: ${Math.round(l.monto_pagado).toLocaleString('es-CL')}</span>
                        </div>
                        {/* Progress bar */}
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#e6e1f0' }}>
                          <div className="h-full rounded-full transition-all"
                            style={{ width: `${pctL}%`, background: pctL >= 100 ? '#059669' : 'linear-gradient(90deg,#7c3aed,#06b6d4)' }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Configuración tab ── */}
      {activeTab === 'configuracion' && (
        <div className="space-y-6">

          {/* Pipeline Vendedores */}
          <div className="card space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-surface-2 rounded-xl flex items-center justify-center flex-shrink-0">
                <GitBranch size={16} className="text-white/70" />
              </div>
              <div>
                <h2 className="font-semibold text-white/90">Nombres del Pipeline de Vendedores</h2>
                <p className="text-xs text-white/52 mt-0.5">Personaliza las etapas del pipeline principal de ventas.</p>
              </div>
            </div>
            <div className="space-y-3">
              {([
                ['espera_cliente',       'En proceso de reunión'],
                ['altamente_interesado', 'Altamente Interesado'],
                ['sin_exito',            'Sin Éxito / No Conectó'],
                ['pagado_reunion',       'Pagado en Reunión'],
                ['cierre',               'Cierre'],
                ['pago_comprometido',    'Pago Comprometido'],
              ] as [string, string][]).map(([key, defaultLabel]) => (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-xs text-white/42 w-44 truncate font-mono">{key}</span>
                  <input
                    className="input flex-1"
                    value={stageLabels[key] ?? defaultLabel}
                    onChange={e => setStageLabels(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder={defaultLabel}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-2 border-t border-white/[0.07]">
              <button onClick={handleSaveStageLabels} disabled={labelsSaving} className="btn-primary">
                {labelsSaving ? 'Guardando...' : 'Guardar nombres'}
              </button>
            </div>
          </div>

          {/* Pipeline Cobradores */}
          <div className="card space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-surface-2 rounded-xl flex items-center justify-center flex-shrink-0">
                <GitBranch size={16} className="text-white/70" />
              </div>
              <div>
                <h2 className="font-semibold text-white/90">Nombres del Pipeline de Cobradores</h2>
                <p className="text-xs text-white/52 mt-0.5">Personaliza las columnas del pipeline de cobros.</p>
              </div>
            </div>
            <div className="space-y-3">
              {Object.entries(DEFAULT_COBRADOR_LABELS).map(([key, defaultLabel]) => (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-xs text-white/42 w-40 truncate font-mono">{key}</span>
                  <input
                    className="input flex-1"
                    value={cobradorLabels[key] ?? defaultLabel}
                    onChange={e => setCobradorLabels(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder={defaultLabel}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-2 border-t border-white/[0.07]">
              <button onClick={handleSaveCobradorLabels} disabled={cobradorLabelsSaving} className="btn-primary">
                {cobradorLabelsSaving ? 'Guardando...' : 'Guardar nombres'}
              </button>
            </div>
          </div>

          {/* Asistente de Seguimiento */}
          <div className="card space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-surface-2 rounded-xl flex items-center justify-center flex-shrink-0">
                <Clock size={16} className="text-white/70" />
              </div>
              <div>
                <h2 className="font-semibold text-white/90">Asistente de Seguimiento — Umbral de días</h2>
                <p className="text-xs text-white/52 mt-0.5">Días desde la fecha de compromiso de pago para que un lead entre al panel de seguimiento.</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <input
                type="number"
                min={1}
                max={365}
                className="input w-32 text-center text-lg font-bold"
                value={seguimientoDias}
                onChange={e => setSeguimientoDias(Math.max(1, Math.min(365, parseInt(e.target.value) || 1)))}
              />
              <span className="text-white/52 text-sm">días después de la fecha de compromiso de pago</span>
            </div>
            <div className="flex justify-end pt-2 border-t border-white/[0.07]">
              <button onClick={handleSaveSeguimientoDias} disabled={seguimientoDiasSaving} className="btn-primary">
                {seguimientoDiasSaving ? 'Guardando...' : 'Guardar umbral'}
              </button>
            </div>
          </div>

          {/* Plantillas OT */}
          <div className="card space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-surface-2 rounded-xl flex items-center justify-center flex-shrink-0">
                <FileText size={16} className="text-white/70" />
              </div>
              <div>
                <h2 className="font-semibold text-white/90">Plantillas de Órdenes de Trabajo</h2>
                <p className="text-xs text-white/52 mt-0.5">Edita el texto de cada sección de las OT. Los cambios se reflejan en los PDFs generados.</p>
              </div>
            </div>
            <div className="space-y-2">
              {otTypeList.map(ot => (
                <div key={ot.key} className="border border-white/[0.08] rounded-xl overflow-hidden">
                  <button
                    onClick={() => handleExpandOt(ot.key)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.03] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <FileText size={14} className="text-white/42 flex-shrink-0" />
                      <span className="text-sm font-semibold text-white/90">{ot.label}</span>
                      {ot.is_customized && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-neon/15 text-neon border border-neon/25">Modificada</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {ot.is_customized && (
                        <button
                          onClick={e => { e.stopPropagation(); handleResetOtTemplate(ot.key) }}
                          className="flex items-center gap-1 text-[11px] text-white/42 hover:text-danger px-2 py-1 rounded-lg hover:bg-danger/5 transition-colors"
                          title="Restaurar original"
                        >
                          <RotateCcw size={11} /> Restaurar
                        </button>
                      )}
                      {expandedOt === ot.key ? <ChevronUp size={14} className="text-white/42" /> : <ChevronDown size={14} className="text-white/42" />}
                    </div>
                  </button>

                  {expandedOt === ot.key && (
                    <div className="border-t border-white/[0.07] p-4 space-y-4 bg-surface-0/50">
                      {!otTemplateData[ot.key] ? (
                        <div className="flex justify-center py-6">
                          <Loader2 size={20} className="animate-spin text-white/42" />
                        </div>
                      ) : otTemplateData[ot.key].sections.length === 0 ? (
                        <p className="text-xs text-white/42 text-center py-4">Esta plantilla no tiene secciones editables.</p>
                      ) : (
                        <>
                          {otTemplateData[ot.key].sections.map((sec: any) => (
                            <div key={sec.sec_idx} className="space-y-2">
                              <p className="text-xs font-bold text-white/60 uppercase tracking-wide">{sec.title}</p>
                              {sec.body_blocks.map((blk: any) => {
                                const editKey = `sec_${sec.sec_idx}_blk_${blk.blk_idx}`
                                const currentText = otEdits[ot.key]?.[editKey] ?? blk.paragraphs.join('\n\n')
                                return (
                                  <div key={blk.blk_idx}>
                                    {blk.is_overridden && (
                                      <p className="text-[10px] text-neon mb-1">✓ Modificado</p>
                                    )}
                                    <textarea
                                      rows={4}
                                      className="input w-full text-xs font-mono resize-y"
                                      value={currentText}
                                      onChange={e => setOtEdits(prev => ({
                                        ...prev,
                                        [ot.key]: { ...(prev[ot.key] || {}), [editKey]: e.target.value }
                                      }))}
                                    />
                                    <p className="text-[10px] text-white/30 mt-0.5">Separa párrafos con una línea en blanco.</p>
                                  </div>
                                )
                              })}
                            </div>
                          ))}
                          <div className="flex justify-end pt-2 border-t border-white/[0.07]">
                            <button
                              onClick={() => handleSaveOtTemplate(ot.key)}
                              disabled={otSaving === ot.key}
                              className="btn-primary"
                            >
                              {otSaving === ot.key ? 'Guardando...' : 'Guardar plantilla'}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

    </div>
  )
}
