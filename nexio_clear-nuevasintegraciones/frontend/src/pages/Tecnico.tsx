import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  getTecnicoStats, getTecnicoWhatsApp, createTecnicoWhatsApp, updateTecnicoWhatsApp,
  deleteTecnicoWhatsApp, toggleTecnicoWhatsApp, getGoogleOAuthSettings,
  updateGoogleOAuthSettings, getTecnicoUsers, getGroups,
  getAIAgents, createAIAgent, updateAIAgent, toggleAIAgent, deleteAIAgent, getAIAgentLogs,
  getAllWhatsAppConfigs, getNegocios, createNegocio, patchNegocio, deleteNegocio, patchNegocioAdmin, patchNegocioPlan,
  getAuditLog, getSecurityStats, getLockedUsers, unlockUser,
} from '../api'
import { PLAN_COLORS, PLAN_LIGHT, PLAN_DARK, PLAN_LIMITS, type PlanKey } from '../utils/plans'
import toast from 'react-hot-toast'
import {
  Users, MessageSquare, Wrench, CheckCircle, XCircle, Plus,
  Edit2, Trash2, ToggleLeft, ToggleRight, Save, Eye, EyeOff,
  RefreshCw, Calendar, Info, Smartphone, Wifi, WifiOff, QrCode,
  Link, Unlink, Loader2, Bot, Zap, Clock, ChevronDown, ChevronUp, X,
  Building2, ShieldCheck, KeyRound, Shield,
} from 'lucide-react'
import { useConfirm } from '../components/ConfirmDialog'

type Tab = 'negocios' | 'overview' | 'whatsapp' | 'google' | 'users' | 'ai_agents' | 'security'

interface QRConfig {
  id: number
  name: string
  phone_number: string
  api_provider: string
  is_active: boolean
  group_id: number | null
  group_name: string | null
}

type QRStatus = 'not_started' | 'connecting' | 'qr_ready' | 'connected' | 'disconnected' | 'logged_out' | 'service_unavailable'

interface WAConfig {
  id: number
  name: string
  phone_number: string
  api_provider: string
  phone_number_id: string | null
  has_token: boolean
  group_id: number | null
  group_name: string | null
  is_active: boolean
}

interface WAForm {
  name: string
  phone_number: string
  api_provider: string
  api_token: string
  phone_number_id: string
}

const emptyWAForm: WAForm = {
  name: '', phone_number: '', api_provider: 'meta',
  api_token: '', phone_number_id: '',
}

export default function Tecnico() {
  const { confirm, dialog: confirmDialog } = useConfirm()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: Tab = (searchParams.get('tab') as Tab) || 'negocios'
  const setTab = (id: Tab) => setSearchParams({ tab: id })
  const [stats, setStats] = useState<any>(null)
  const [waConfigs, setWAConfigs] = useState<WAConfig[]>([])
  const [groups, setGroups] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [selectedNegocioId, setSelectedNegocioId] = useState<number | null>(null)

  // Google settings state
  const [googleSettings, setGoogleSettings] = useState({
    client_id: '', client_secret_masked: '', redirect_uri: '', configured: false,
  })
  const [googleForm, setGoogleForm] = useState({ client_id: '', client_secret: '', redirect_uri: '' })
  const [showSecret, setShowSecret] = useState(false)
  const [savingGoogle, setSavingGoogle] = useState(false)

  // WA modal state
  const [showWAModal, setShowWAModal] = useState(false)
  const [editingWA, setEditingWA] = useState<WAConfig | null>(null)
  const [waForm, setWAForm] = useState<WAForm>(emptyWAForm)
  const [showToken, setShowToken] = useState(false)
  const [savingWA, setSavingWA] = useState(false)


  useEffect(() => {
    loadAll()
  }, [])

  const loadAll = async () => {
    try {
      const [s, g, neg] = await Promise.all([getTecnicoStats(), getGroups(), getNegocios()])
      setStats(s)
      setGroups(g)
      setNegocios(neg)
    } catch { toast.error('Error cargando datos') }
  }

  const getNegocioGroupIds = (negocioId: number): Set<number> => {
    const neg = negocios.find((n: any) => n.id === negocioId)
    if (!neg) return new Set([negocioId])
    // all_group_ids viene del backend e incluye el root + todos los subgrupos
    const ids: number[] = neg.all_group_ids ?? [neg.id]
    return new Set(ids)
  }

  const inSelectedNegocio = (groupId: number | null): boolean => {
    if (!selectedNegocioId) return true
    if (!groupId) return false
    return getNegocioGroupIds(selectedNegocioId).has(groupId)
  }

  useEffect(() => {
    if (tab === 'whatsapp') loadWA()
    if (tab === 'google') loadGoogle()
    if (tab === 'users') loadUsers()
  }, [tab])

  const loadWA = async () => {
    try { setWAConfigs(await getTecnicoWhatsApp()) } catch { toast.error('Error cargando configs') }
  }

  const loadGoogle = async () => {
    try {
      const s = await getGoogleOAuthSettings()
      setGoogleSettings(s)
      setGoogleForm({ client_id: s.client_id, client_secret: '', redirect_uri: s.redirect_uri })
    } catch { toast.error('Error cargando configuración Google') }
  }

  const loadUsers = async () => {
    try { setUsers(await getTecnicoUsers()) } catch { toast.error('Error cargando usuarios') }
  }

  // ── Negocios state ──────────────────────────────────────────
  const [negocios, setNegocios]                   = useState<any[]>([])
  const [negociosLoading, setNegociosLoading]     = useState(false)
  const [showNegocioModal, setShowNegocioModal]   = useState(false)
  const [negocioSaving, setNegocioSaving]         = useState(false)
  const defaultNegocioForm = { business_name: '', description: '', tipo: 'abogados', plan: 'basico', admin_name: '', admin_email: '', admin_password: '' }
  const [negocioForm, setNegocioForm]             = useState(defaultNegocioForm)
  const [showAdminPass, setShowAdminPass]         = useState(false)
  const [editingNegocio, setEditingNegocio]       = useState<any>(null)
  const [editNegocioForm, setEditNegocioForm]     = useState({ name: '', description: '', plan: 'basico' })
  const [editNegocioSaving, setEditNegocioSaving] = useState(false)
  const [editPlanSaving, setEditPlanSaving]       = useState(false)
  const [deletingNegocioId, setDeletingNegocioId] = useState<number | null>(null)
  const [editingAdmin, setEditingAdmin]           = useState<any>(null)  // negocio object
  const [editAdminForm, setEditAdminForm]         = useState({ name: '', email: '', password: '', is_active: true })
  const [editAdminSaving, setEditAdminSaving]     = useState(false)
  const [showAdminPassEdit, setShowAdminPassEdit] = useState(false)
  const [planSaving, setPlanSaving]               = useState<number | null>(null)

  const loadNegocios = useCallback(async () => {
    setNegociosLoading(true)
    try { setNegocios(await getNegocios()) }
    catch { toast.error('Error cargando negocios') }
    finally { setNegociosLoading(false) }
  }, [])

  useEffect(() => { if (tab === 'negocios') loadNegocios() }, [tab])

  const handleCreateNegocio = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!negocioForm.business_name.trim()) { toast.error('Nombre del negocio requerido'); return }
    if (!negocioForm.admin_name.trim()) { toast.error('Nombre del administrador requerido'); return }
    if (!negocioForm.admin_email.trim()) { toast.error('Email del administrador requerido'); return }
    if (!negocioForm.admin_password.trim()) { toast.error('Contraseña requerida'); return }
    if (negocioForm.admin_password.length < 8) { toast.error('La contraseña debe tener al menos 8 caracteres'); return }
    setNegocioSaving(true)
    try {
      const created = await createNegocio({
        business_name: negocioForm.business_name.trim(),
        description: negocioForm.description.trim() || null,
        tipo: negocioForm.tipo,
        plan: negocioForm.plan,
        admin_name: negocioForm.admin_name.trim(),
        admin_email: negocioForm.admin_email.trim(),
        admin_password: negocioForm.admin_password,
      })
      if (negocioForm.plan !== 'basico') {
        await patchNegocioPlan(created.id, { plan: negocioForm.plan as any })
      }
      toast.success(`Negocio "${negocioForm.business_name.trim()}" creado`)
      setShowNegocioModal(false)
      setNegocioForm(defaultNegocioForm)
      loadNegocios()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Error al crear negocio')
    } finally { setNegocioSaving(false) }
  }

  const handleEditNegocio = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editNegocioForm.name.trim()) { toast.error('El nombre es requerido'); return }
    setEditNegocioSaving(true)
    try {
      await patchNegocio(editingNegocio.id, { name: editNegocioForm.name.trim(), description: editNegocioForm.description.trim() || null })
      if (editNegocioForm.plan !== (editingNegocio.plan ?? 'basico')) {
        await patchNegocioPlan(editingNegocio.id, { plan: editNegocioForm.plan as any })
      }
      setNegocios(prev => prev.map((x: any) => x.id === editingNegocio.id ? {
        ...x,
        name: editNegocioForm.name.trim(),
        description: editNegocioForm.description.trim() || null,
        plan: editNegocioForm.plan,
        plan_limits: PLAN_LIMITS[editNegocioForm.plan as PlanKey],
      } : x))
      toast.success('Negocio actualizado')
      setEditingNegocio(null)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Error al actualizar')
    } finally { setEditNegocioSaving(false) }
  }

  const handleDeleteNegocio = async (id: number) => {
    try {
      await deleteNegocio(id)
      setNegocios(prev => prev.filter((x: any) => x.id !== id))
      toast.success('Negocio eliminado')
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Error al eliminar')
    } finally { setDeletingNegocioId(null) }
  }

  const handleEditAdmin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editAdminForm.name.trim()) { toast.error('El nombre es requerido'); return }
    if (!editAdminForm.email.trim()) { toast.error('El email es requerido'); return }
    setEditAdminSaving(true)
    try {
      const payload: any = {
        name: editAdminForm.name.trim(),
        email: editAdminForm.email.trim(),
        is_active: editAdminForm.is_active,
      }
      if (editAdminForm.password) payload.password = editAdminForm.password
      const updated = await patchNegocioAdmin(editingAdmin.id, payload)
      setNegocios(prev => prev.map((x: any) => x.id === editingAdmin.id ? { ...x, admin: updated } : x))
      toast.success('Administrador actualizado')
      setEditingAdmin(null)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Error al actualizar')
    } finally { setEditAdminSaving(false) }
  }

  // ── WA CRUD ─────────────────────────────────────────────────

  const openCreateWA = () => {
    setEditingWA(null)
    setWAForm(emptyWAForm)
    setShowToken(false)
    setShowWAModal(true)
  }

  const openEditWA = (cfg: WAConfig) => {
    setEditingWA(cfg)
    setWAForm({
      name: cfg.name || '',
      phone_number: cfg.phone_number,
      api_provider: cfg.api_provider,
      api_token: '',
      phone_number_id: cfg.phone_number_id || '',
    })
    setShowToken(false)
    setShowWAModal(true)
  }

  const handleSaveWA = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingWA(true)
    try {
      const payload: any = {
        name: waForm.name,
        phone_number: waForm.phone_number,
        api_provider: waForm.api_provider,
        phone_number_id: waForm.phone_number_id || null,
      }
      if (waForm.api_token) payload.api_token = waForm.api_token
      if (editingWA) {
        await updateTecnicoWhatsApp(editingWA.id, payload)
        toast.success('Config actualizada')
      } else {
        await createTecnicoWhatsApp(payload)
        toast.success('Config creada')
      }
      setShowWAModal(false)
      loadWA()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Error al guardar')
    } finally {
      setSavingWA(false)
    }
  }

  const handleDeleteWA = async (cfg: WAConfig) => {
    const ok = await confirm(`Eliminar la configuración "${cfg.name}" es irreversible.`, { title: 'Eliminar config WhatsApp', confirmLabel: 'Eliminar' })
    if (!ok) return
    try {
      await deleteTecnicoWhatsApp(cfg.id)
      toast.success('Configuración eliminada')
      loadWA()
    } catch { toast.error('Error al eliminar') }
  }

  const handleToggleWA = async (cfg: WAConfig) => {
    try {
      await toggleTecnicoWhatsApp(cfg.id)
      setWAConfigs(prev => prev.map(c => c.id === cfg.id ? { ...c, is_active: !c.is_active } : c))
    } catch { toast.error('Error al cambiar estado') }
  }

  // ── Google settings ──────────────────────────────────────────

  const handleSaveGoogle = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!googleForm.client_id || !googleForm.redirect_uri) {
      toast.error('Client ID y Redirect URI son requeridos'); return
    }
    if (!googleSettings.configured && !googleForm.client_secret) {
      toast.error('Client Secret es requerido la primera vez'); return
    }
    setSavingGoogle(true)
    try {
      const payload: any = { client_id: googleForm.client_id, redirect_uri: googleForm.redirect_uri }
      if (googleForm.client_secret) payload.client_secret = googleForm.client_secret
      else payload.client_secret = '__keep__'
      await updateGoogleOAuthSettings(payload)
      toast.success('Configuración Google guardada')
      loadGoogle()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Error al guardar')
    } finally {
      setSavingGoogle(false)
    }
  }

  const setWA = (k: keyof WAForm, v: string) => setWAForm(f => ({ ...f, [k]: v }))
  const setG = (k: string, v: string) => setGoogleForm(f => ({ ...f, [k]: v }))

  // ── AI Agents state ─────────────────────────────────────────
  const [agents, setAgents]               = useState<any[]>([])
  const [agentsLoading, setAgentsLoading] = useState(false)
  const [showAgentModal, setShowAgentModal] = useState(false)
  const [editAgent, setEditAgent]         = useState<any | null>(null)
  const [agentLogs, setAgentLogs]         = useState<Record<number, any[]>>({})
  const [agentLogsOpen, setAgentLogsOpen] = useState<Record<number, boolean>>({})
  const [allWAConfigs, setAllWAConfigs]   = useState<any[]>([])

  const MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo']

  const defaultAgentForm = {
    name: '', description: '', group_id: '', selected_admin_id: '',
    is_active: true,
    openai_api_key: '', openai_model: 'gpt-4o-mini',
    temperature: 0.7, max_tokens: 500, max_history_messages: 20,
    system_prompt: `Eres un asistente virtual amigable y profesional. Responde de forma clara y concisa.

Tu objetivo es ayudar a los clientes, responder sus preguntas y agendar citas cuando sea necesario.

Si el cliente tiene una consulta compleja o quiere hablar con una persona, dile amablemente que lo conectarás con un asesor humano.`,
    response_delay_seconds: 2,
    escalation_keywords: [] as string[],
    escalation_kw_input: '',
    business_hours_start: '', business_hours_end: '',
  }
  const [agentForm, setAgentForm] = useState(defaultAgentForm)
  const [agentSaving, setAgentSaving] = useState(false)

  // business admins (superadmin/subadmin) — each represents one negocio
  const [bizAdmins, setBizAdmins] = useState<any[]>([])

  const loadAgents = useCallback(async () => {
    setAgentsLoading(true)
    try {
      const [ag, cfgs, allUsers] = await Promise.all([
        getAIAgents(),
        getAllWhatsAppConfigs(),
        getTecnicoUsers(),
      ])
      setAgents(ag)
      setAllWAConfigs(cfgs)
      // Only superadmin users — one per negocio, created by técnico
      setBizAdmins(allUsers.filter((u: any) => u.role === 'superadmin'))
    } catch { toast.error('Error cargando agentes') }
    finally { setAgentsLoading(false) }
  }, [])

  useEffect(() => { if (tab === 'ai_agents') loadAgents() }, [tab])

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

  useEffect(() => { if (tab === 'security') loadAuditLog(1) }, [tab, auditAction, auditSeverity])

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
      const matchAdmin = bizAdmins.find((u: any) => u.group_id === agent.group_id)
      setAgentForm({
        name: agent.name, description: agent.description ?? '',
        group_id: agent.group_id ? String(agent.group_id) : '',
        selected_admin_id: matchAdmin ? String(matchAdmin.id) : '',
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
    if (!agentForm.system_prompt.trim()) { toast.error('El prompt del sistema es obligatorio'); return }
    if (!editAgent && !agentForm.openai_api_key.trim()) { toast.error('La API Key de OpenAI es obligatoria'); return }

    // Preventive plan check for new agents
    if (!editAgent && agentForm.group_id) {
      const targetGroupId = parseInt(agentForm.group_id)
      const negocio = negocios.find((n: any) =>
        n.id === targetGroupId || (n.sub_groups ?? []).some((sg: any) => sg.id === targetGroupId)
      )
      if (negocio) {
        const limits = PLAN_LIMITS[negocio.plan as PlanKey]
        const existingCount = agents.filter((a: any) => {
          const agGroupId = a.group_id
          return agGroupId === negocio.id || negocios.some((n: any) =>
            n.id === negocio.id && (n.sub_groups ?? []).some((sg: any) => sg.id === agGroupId)
          )
        }).length
        if (limits.max_ai_agents !== -1 && existingCount >= limits.max_ai_agents) {
          toast.error(`Plan ${limits.label}: límite de ${limits.max_ai_agents} agentes IA alcanzado. Actualiza el plan para continuar.`)
          return
        }
      }
    }

    setAgentSaving(true)
    try {
      const payload: any = {
        name: agentForm.name.trim(),
        description: agentForm.description || null,
        group_id: agentForm.group_id ? parseInt(agentForm.group_id) : null,
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
      if (!editAgent) payload.openai_api_key = agentForm.openai_api_key.trim()

      if (editAgent) {
        await updateAIAgent(editAgent.id, payload)
        toast.success('Agente actualizado')
      } else {
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
    <div className="space-y-6">

      {/* ── SELECTOR DE NEGOCIO (visible en todos los tabs excepto negocios y security) ── */}
      {tab !== 'negocios' && tab !== 'security' && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-white/[0.07]"
          style={{ background: 'rgba(255,255,255,0.03)' }}>
          <Building2 size={14} className="text-neon flex-shrink-0" />
          <span className="text-xs text-white/52 font-medium flex-shrink-0">Negocio:</span>
          <select
            value={selectedNegocioId ?? ''}
            onChange={e => setSelectedNegocioId(e.target.value ? parseInt(e.target.value) : null)}
            className="flex-1 bg-transparent text-sm text-white/90 outline-none cursor-pointer min-w-0"
          >
            <option value="">Todos los negocios</option>
            {negocios.map((n: any) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </select>
          {selectedNegocioId && (
            <button onClick={() => setSelectedNegocioId(null)}
              className="flex-shrink-0 text-white/38 hover:text-white/80 transition-colors">
              <X size={13} />
            </button>
          )}
        </div>
      )}

      {/* ── NEGOCIOS ── */}
      {tab === 'negocios' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-sm text-white/62">
                Cada negocio tiene su propio panel, administrador y configuración. Crea uno para incorporar un nuevo cliente.
              </p>
            </div>
            <button onClick={() => { setNegocioForm(defaultNegocioForm); setShowNegocioModal(true) }} className="btn-primary flex-shrink-0">
              <Plus size={16} /> Crear Negocio
            </button>
          </div>

          {negociosLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin text-white/52" />
            </div>
          ) : negocios.length === 0 ? (
            <div className="bg-surface-1 rounded-xl border border-white/[0.07] text-center py-20 text-white/52">
              <Building2 size={36} className="mx-auto mb-3 opacity-25" />
              <p className="font-medium">Sin negocios registrados</p>
              <p className="text-sm mt-1">Crea el primer negocio para comenzar</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {negocios.map(n => (
                <div key={n.id} className="bg-surface-1 rounded-xl border border-white/[0.07] p-5 space-y-4 hover:border-white/15 transition-colors">
                  {/* Header */}
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-11 rounded-xl bg-neon/10 flex items-center justify-center flex-shrink-0">
                      <Building2 size={20} className="text-neon" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <h3 className="font-semibold text-white/90 truncate">{n.name}</h3>
                        {(() => {
                          const p = (n.plan ?? 'basico') as PlanKey
                          const c = PLAN_COLORS[p]
                          return (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                              style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
                              {PLAN_LIMITS[p].label}
                            </span>
                          )
                        })()}
                      </div>
                      {n.description && (
                        <p className="text-xs text-white/42 mt-0.5 truncate">{n.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => { setEditingNegocio(n); setEditNegocioForm({ name: n.name, description: n.description ?? '', plan: n.plan ?? 'basico' }) }}
                        className="p-1.5 rounded-lg text-white/42 hover:text-white hover:bg-white/[0.07] transition-colors"
                        title="Editar negocio"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => setDeletingNegocioId(n.id)}
                        className="p-1.5 rounded-lg text-white/42 hover:text-danger hover:bg-danger/10 transition-colors"
                        title="Eliminar negocio"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Tipo + Plan row */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-white/35 w-8">Tipo</span>
                      <select
                        className="flex-1 text-xs font-semibold rounded-lg px-2 py-1.5 border border-white/10 bg-surface-0 text-white focus:outline-none focus:border-lime/40"
                        value={n.tipo ?? 'abogados'}
                        onChange={async (e) => {
                          const newTipo = e.target.value
                          try {
                            await patchNegocio(n.id, { tipo: newTipo })
                            setNegocios(prev => prev.map((x: any) => x.id === n.id ? { ...x, tipo: newTipo } : x))
                            toast.success('Tipo actualizado')
                          } catch { toast.error('Error al actualizar') }
                        }}
                      >
                        <option value="abogados">Abogados / Tributario</option>
                        <option value="inmobiliaria">Inmobiliaria</option>
                        <option value="clinica">Clínica / Salud</option>
                        <option value="restaurant">Restaurant / Gastronomía</option>
                        <option value="otro">Otro</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-white/35 w-8">Plan</span>
                      <div className="flex gap-1.5 flex-1">
                        {(['basico', 'pro', 'enterprise'] as PlanKey[]).map(p => {
                          const colors = PLAN_LIGHT[p]
                          const active = (n.plan ?? 'basico') === p
                          return (
                            <button
                              key={p}
                              disabled={planSaving === n.id}
                              onClick={async () => {
                                if (active) return
                                setPlanSaving(n.id)
                                try {
                                  await patchNegocioPlan(n.id, { plan: p })
                                  setNegocios(prev => prev.map((x: any) => x.id === n.id ? { ...x, plan: p, plan_limits: PLAN_LIMITS[p] } : x))
                                  toast.success(`Plan cambiado a ${PLAN_LIMITS[p].label}`)
                                } catch { toast.error('Error al cambiar plan') }
                                finally { setPlanSaving(null) }
                              }}
                              className="flex-1 text-[10px] font-bold py-1.5 rounded-lg border transition-all"
                              style={{
                                background: active ? colors.bg : 'var(--surface-0)',
                                color: active ? colors.text : 'var(--text-muted)',
                                border: active ? `1.5px solid ${colors.border}` : '1px solid var(--border-2)',
                                boxShadow: active ? `0 2px 8px ${colors.bg}66` : 'none',
                                cursor: active ? 'default' : 'pointer',
                              }}
                            >
                              {PLAN_LIMITS[p].label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Admin info */}
                  {n.admin ? (
                    <button
                      onClick={() => { setEditingAdmin(n); setEditAdminForm({ name: n.admin.name, email: n.admin.email, password: '', is_active: n.admin.is_active }); setShowAdminPassEdit(false) }}
                      className="w-full flex items-center gap-2.5 bg-surface-0 rounded-lg px-3 py-2.5 hover:bg-surface-2 transition-colors group text-left"
                    >
                      <ShieldCheck size={14} className="text-warn flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-white/85 truncate">{n.admin.name}</p>
                        <p className="text-xs text-white/42 truncate">{n.admin.email}</p>
                      </div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                        n.admin.is_active ? 'bg-lime/15 text-lime' : 'bg-danger/15 text-danger'
                      }`}>
                        {n.admin.is_active ? 'Activo' : 'Inactivo'}
                      </span>
                      <Edit2 size={12} className="text-white/25 group-hover:text-white/60 flex-shrink-0 transition-colors" />
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-amber-400/70 bg-amber-500/5 border border-amber-500/15 rounded-lg px-3 py-2">
                      <Info size={12} /> Sin superadministrador asignado
                    </div>
                  )}

                  {/* Stats */}
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {[
                      { label: 'Usuarios', value: n.member_count, color: 'text-neon' },
                      { label: 'Equipos', value: n.sub_group_count ?? 0, color: 'text-white/62' },
                      { label: 'WhatsApp', value: n.wa_count, color: 'text-lime' },
                      { label: 'Agentes IA', value: n.ai_agent_count, color: 'text-warn' },
                    ].map(s => (
                      <div key={s.label} className="bg-surface-0 rounded-lg py-2">
                        <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                        <p className="text-[10px] text-white/42 mt-0.5">{s.label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Botón rápido crear agente — solo planes pro/enterprise */}
                  {PLAN_LIMITS[(n.plan ?? 'basico') as PlanKey].max_ai_agents !== 0 && (
                    <button
                      onClick={async () => {
                        if (agents.length === 0 && !agentsLoading) await loadAgents()
                        setEditAgent(null)
                        setAgentForm(f => ({
                          ...defaultAgentForm,
                          selected_admin_id: n.admin ? String(n.admin.id) : '',
                          group_id: n.id ? String(n.id) : '',
                        }))
                        setShowAgentModal(true)
                        setTab('ai_agents')
                      }}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all"
                      style={{
                        background: '#2d3a6e',
                        color: '#ffffff',
                        border: '1px solid #3d4f9e',
                        boxShadow: '0 2px 10px rgba(45,58,110,0.60)',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.background = '#3d4f9e'
                        ;(e.currentTarget as HTMLElement).style.borderColor = '#5a6fc2'
                        ;(e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(53,122,14,0.45)'
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.background = '#2d3a6e'
                        ;(e.currentTarget as HTMLElement).style.borderColor = '#3d4f9e'
                        ;(e.currentTarget as HTMLElement).style.boxShadow = '0 2px 10px rgba(45,58,110,0.60)'
                      }}
                    >
                      <Bot size={13} />
                      Crear Agente IA
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── MODAL EDITAR NEGOCIO ── */}
      {editingNegocio && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="rounded-2xl shadow-2xl w-full max-w-md" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-2)' }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <p className="font-bold text-base" style={{ color: 'var(--text)' }}>Editar negocio</p>
              <button onClick={() => setEditingNegocio(null)} className="p-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            <form onSubmit={handleEditNegocio} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
              <div>
                <label className="input-label">Nombre del negocio *</label>
                <input className="input-field" value={editNegocioForm.name} onChange={e => setEditNegocioForm(f => ({ ...f, name: e.target.value }))} placeholder="Ej: Abogados Tributarios" />
              </div>
              <div>
                <label className="input-label">Descripción</label>
                <input className="input-field" value={editNegocioForm.description} onChange={e => setEditNegocioForm(f => ({ ...f, description: e.target.value }))} placeholder="Descripción opcional" />
              </div>

              {/* Plan selector */}
              <div>
                <label className="input-label">Plan de suscripción</label>
                <div className="flex gap-1.5 mt-1">
                  {(['basico', 'pro', 'enterprise'] as PlanKey[]).map(p => {
                    const active = editNegocioForm.plan === p
                    const c = PLAN_LIGHT[p]
                    return (
                      <button key={p} type="button"
                        onClick={() => setEditNegocioForm(f => ({ ...f, plan: p }))}
                        className="flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all"
                        style={{
                          background: active ? c.bg : 'var(--surface-0)',
                          color: active ? c.text : 'var(--text-muted)',
                          border: active ? `2px solid ${c.border}` : '1px solid var(--border-2)',
                          boxShadow: active ? `0 4px 14px ${c.bg}55` : 'none',
                        }}>
                        {PLAN_LIMITS[p].label}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                  {editNegocioForm.plan === 'basico' && 'Hasta 5 usuarios · 1 número WhatsApp · sin Agente IA'}
                  {editNegocioForm.plan === 'pro' && 'Hasta 15 usuarios · 3 números WA · 2 Agentes IA · exportar CSV'}
                  {editNegocioForm.plan === 'enterprise' && 'Usuarios y WA ilimitados · Agentes IA ilimitados · todas las funciones'}
                </p>
              </div>

              {/* Feature panel */}
              {(() => {
                const lim = PLAN_LIMITS[editNegocioForm.plan as PlanKey]
                const features = [
                  { label: 'Chat WhatsApp',          on: lim.whatsapp_chat,        detail: '' },
                  { label: 'PDF / Orden de trabajo',  on: lim.pdf_ot,              detail: '' },
                  { label: 'Agente IA',               on: lim.max_ai_agents !== 0, detail: lim.max_ai_agents === -1 ? 'ilimitados' : lim.max_ai_agents > 0 ? `hasta ${lim.max_ai_agents}` : '' },
                  { label: 'Seguimiento de leads',    on: lim.seguimiento,         detail: '' },
                  { label: 'Google Calendar',         on: lim.google_calendar,     detail: '' },
                  { label: 'Exportar CSV',            on: lim.export_csv,          detail: '' },
                  { label: 'Analytics avanzados',     on: lim.analytics_avanzados, detail: '' },
                ]
                const limits = [
                  { label: 'Usuarios',         val: lim.max_users === -1 ? 'Ilimitados' : `Hasta ${lim.max_users}` },
                  { label: 'Números WhatsApp', val: lim.max_wa_numbers === -1 ? 'Ilimitados' : `Hasta ${lim.max_wa_numbers}` },
                  { label: 'Leads activos',    val: lim.max_leads === -1 ? 'Ilimitados' : `Hasta ${lim.max_leads}` },
                ]
                return (
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-2)' }}>
                    <div className="px-3 py-2" style={{ background: 'var(--surface-3)', borderBottom: '1px solid var(--border)' }}>
                      <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Funciones incluidas</p>
                    </div>
                    <div style={{ background: 'var(--surface-1)' }}>
                      {features.map((f, i) => (
                        <div key={f.label} className="flex items-center justify-between px-3 py-2"
                          style={{ borderBottom: i < features.length - 1 ? '1px solid var(--border)' : 'none' }}>
                          <span className="text-xs font-medium" style={{ color: f.on ? 'var(--text)' : 'var(--text-muted)' }}>{f.label}</span>
                          <div className="flex items-center gap-1.5">
                            {f.detail && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{f.detail}</span>}
                            {f.on
                              ? <CheckCircle size={13} style={{ color: '#16a34a' }} />
                              : <XCircle size={13} style={{ color: 'rgba(28,22,51,0.2)' }} />
                            }
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="px-3 py-2.5" style={{ background: 'var(--surface-3)', borderTop: '1px solid var(--border)' }}>
                      <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Límites</p>
                      <div className="flex gap-3">
                        {limits.map(l => (
                          <div key={l.label} className="flex-1 text-center">
                            <p className="text-xs font-bold" style={{ color: 'var(--text)' }}>{l.val}</p>
                            <p className="text-[9px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{l.label}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              })()}

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setEditingNegocio(null)} className="btn-ghost flex-1">Cancelar</button>
                <button type="submit" disabled={editNegocioSaving} className="btn-primary flex-1">
                  {editNegocioSaving ? <><Loader2 size={14} className="animate-spin" /> Guardando...</> : <><Save size={14} /> Guardar</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL EDITAR ADMIN NEGOCIO ── */}
      {editingAdmin && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="rounded-2xl shadow-2xl w-full max-w-md" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-2)' }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <div>
                <p className="font-bold text-base" style={{ color: 'var(--text)' }}>Editar administrador</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{editingAdmin.name}</p>
              </div>
              <button onClick={() => setEditingAdmin(null)} className="p-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            <form onSubmit={handleEditAdmin} className="p-5 space-y-4">
              <div>
                <label className="input-label">Nombre *</label>
                <input className="input-field" value={editAdminForm.name} onChange={e => setEditAdminForm(f => ({ ...f, name: e.target.value }))} placeholder="Nombre completo" />
              </div>
              <div>
                <label className="input-label">Email *</label>
                <input className="input-field" type="email" value={editAdminForm.email} onChange={e => setEditAdminForm(f => ({ ...f, email: e.target.value }))} placeholder="correo@ejemplo.com" />
              </div>
              <div>
                <label className="input-label">Nueva contraseña <span className="text-white/30 font-normal">(dejar vacío para no cambiar)</span></label>
                <div className="relative">
                  <input
                    className="input-field pr-10"
                    type={showAdminPassEdit ? 'text' : 'password'}
                    value={editAdminForm.password}
                    onChange={e => setEditAdminForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="Mínimo 8 caracteres"
                  />
                  <button type="button" onClick={() => setShowAdminPassEdit(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/42 hover:text-white/85">
                    {showAdminPassEdit ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-white/62">Estado</span>
                <button type="button"
                  onClick={() => setEditAdminForm(f => ({ ...f, is_active: !f.is_active }))}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    editAdminForm.is_active
                      ? 'bg-lime/15 text-lime border-lime/25 hover:bg-lime/25'
                      : 'bg-danger/15 text-danger border-danger/25 hover:bg-danger/25'
                  }`}>
                  {editAdminForm.is_active ? <><CheckCircle size={13} /> Activo</> : <><XCircle size={13} /> Inactivo</>}
                </button>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setEditingAdmin(null)} className="btn-ghost flex-1">Cancelar</button>
                <button type="submit" disabled={editAdminSaving} className="btn-primary flex-1">
                  {editAdminSaving ? <><Loader2 size={14} className="animate-spin" /> Guardando...</> : <><Save size={14} /> Guardar</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL CONFIRMAR ELIMINAR NEGOCIO ── */}
      {deletingNegocioId !== null && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-2)' }}>
            <div className="w-12 h-12 rounded-2xl bg-danger/15 flex items-center justify-center mx-auto">
              <Trash2 size={22} className="text-danger" />
            </div>
            <div className="text-center">
              <p className="font-bold text-white">¿Eliminar negocio?</p>
              <p className="text-xs text-white/52 mt-1">Esta acción no se puede deshacer. Se eliminarán todos los datos asociados.</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDeletingNegocioId(null)} className="btn-ghost flex-1">Cancelar</button>
              <button onClick={() => handleDeleteNegocio(deletingNegocioId)} className="flex-1 px-4 py-2 rounded-xl font-semibold text-sm bg-danger/20 text-danger border border-danger/30 hover:bg-danger/30 transition-colors">
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── OVERVIEW ── */}
      {tab === 'overview' && stats && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Usuarios Totales',        value: stats.total_users,          icon: Users,          color: 'bg-neon/15 text-neon' },
              { label: 'Grupos Activos',           value: stats.total_groups,         icon: Wrench,         color: 'bg-warn/15 text-warn' },
              { label: 'Configs WhatsApp',         value: stats.total_wa_configs,     icon: MessageSquare,  color: 'bg-lime/15 text-lime' },
              { label: 'Google Calendar Conectado', value: stats.google_connected_users, icon: Calendar,    color: 'bg-warn/15 text-warn' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-surface-1 rounded-xl border border-white/[0.07] p-5">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color} mb-3`}>
                  <Icon size={18} />
                </div>
                <p className="text-2xl font-bold text-white">{value}</p>
                <p className="text-sm text-white/62 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          <div>
            <h2 className="text-base font-semibold text-white/90 mb-3">Resumen por Grupo</h2>
            <div className="bg-surface-1 rounded-xl border border-white/[0.07] overflow-hidden table-scroll">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.07] text-left">
                    <th className="px-4 py-3 text-white/62 font-medium">Grupo</th>
                    <th className="px-4 py-3 text-white/62 font-medium text-center">Miembros</th>
                    <th className="px-4 py-3 text-white/62 font-medium text-center">Áreas</th>
                    <th className="px-4 py-3 text-white/62 font-medium text-center">WA Total</th>
                    <th className="px-4 py-3 text-white/62 font-medium text-center">WA Meta</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.groups.map((g: any) => (
                    <tr key={g.id} className="border-b border-white/5 hover:bg-surface-0/50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-white/90">{g.name}</p>
                        {g.description && <p className="text-xs text-white/52">{g.description}</p>}
                      </td>
                      <td className="px-4 py-3 text-center text-white/78">{g.member_count}</td>
                      <td className="px-4 py-3 text-center text-white/78">{g.area_count}</td>
                      <td className="px-4 py-3 text-center text-white/78">{g.wa_count}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                          g.wa_meta_count > 0 ? 'text-lime bg-lime/10' : 'bg-surface-2 text-white/62'
                        }`}>
                          {g.wa_meta_count > 0 ? <CheckCircle size={10} /> : <XCircle size={10} />}
                          {g.wa_meta_count}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── WHATSAPP META ── */}
      {tab === 'whatsapp' && (() => {
        const visibleWA = waConfigs.filter(c => inSelectedNegocio(c.group_id))
        return (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-sm text-white/62">
                Configura los números aquí. El administrador los asignará a grupos y les dará nombre.
                {selectedNegocioId && <span className="ml-2 text-neon font-medium">({visibleWA.length} de {waConfigs.length})</span>}
              </p>
            </div>
            <button onClick={openCreateWA} className="btn-primary flex-shrink-0">
              <Plus size={16} /> Agregar Número
            </button>
          </div>

          <div className="bg-surface-1 rounded-xl border border-white/[0.07] overflow-hidden">
            {visibleWA.length === 0 ? (
              <div className="text-center py-16 text-white/52">
                <MessageSquare size={32} className="mx-auto mb-3 opacity-30" />
                <p className="font-medium">Sin configuraciones</p>
                <p className="text-sm mt-1">Crea la primera configuración WhatsApp Meta</p>
              </div>
            ) : (
              <div className="overflow-x-auto table-scroll">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.07] text-left">
                      <th className="px-4 py-3 text-white/62 font-medium">Número</th>
                      <th className="px-4 py-3 text-white/62 font-medium">Proveedor</th>
                      <th className="px-4 py-3 text-white/62 font-medium">Phone Number ID</th>
                      <th className="px-4 py-3 text-white/62 font-medium text-center">Token</th>
                      <th className="px-4 py-3 text-white/62 font-medium text-center">Estado</th>
                      <th className="px-4 py-3 text-white/62 font-medium text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleWA.map(cfg => (
                      <tr key={cfg.id} className="border-b border-white/5 hover:bg-surface-0/50 transition-colors">
                        <td className="px-4 py-3 font-mono font-medium text-white/90">{cfg.phone_number}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                            cfg.api_provider === 'meta'
                              ? 'bg-neon/15 text-neon'
                              : 'bg-surface-2 text-white/78'
                          }`}>
                            {cfg.api_provider}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {cfg.has_token
                            ? <CheckCircle size={15} className="text-lime mx-auto" />
                            : <XCircle size={15} className="text-white/38 mx-auto" />
                          }
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => handleToggleWA(cfg)}
                            title={cfg.is_active ? 'Desactivar' : 'Activar'}
                            className={`transition-colors ${cfg.is_active ? 'text-lime hover:text-lime' : 'text-white/38 hover:text-white/62'}`}
                          >
                            {cfg.is_active ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => openEditWA(cfg)}
                              className="p-1.5 text-white/52 hover:text-white/85 hover:bg-surface-2 rounded-lg transition-colors"
                              title="Editar"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteWA(cfg)}
                              className="p-1.5 text-white/52 hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"
                              title="Eliminar"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        )
      })()}


      {/* ── GOOGLE OAUTH ── */}
      {tab === 'google' && (
        <div className="max-w-2xl space-y-5">

          {/* Status banner */}
          <div className={`flex items-center gap-3 p-4 rounded-xl border ${
            googleSettings.configured
              ? 'bg-lime/[0.07] border-lime/20'
              : 'bg-warn/[0.07] border-warn/20'
          }`}>
            {googleSettings.configured
              ? <CheckCircle size={18} className="text-lime flex-shrink-0" />
              : <Info size={18} className="text-warn flex-shrink-0" />
            }
            <div>
              <p className={`text-sm font-semibold ${googleSettings.configured ? 'text-lime/90' : 'text-warn/90'}`}>
                {googleSettings.configured ? 'Google OAuth configurado' : 'Google OAuth no configurado'}
              </p>
              <p className={`text-xs mt-0.5 ${googleSettings.configured ? 'text-lime' : 'text-warn'}`}>
                {googleSettings.configured
                  ? 'Los usuarios pueden conectar sus Google Calendars'
                  : 'Ingresa las credenciales OAuth2 para habilitar la integración'
                }
              </p>
            </div>
          </div>

          {/* Instructions */}
          <div className="bg-surface-0 border border-white/10 rounded-xl p-4 text-sm text-white/78 space-y-2">
            <p className="font-semibold text-white/90">¿Cómo obtener las credenciales?</p>
            <ol className="list-decimal list-inside space-y-1 text-xs leading-relaxed">
              <li>Ve a <strong>console.cloud.google.com</strong> → Crea o selecciona un proyecto</li>
              <li>Habilita la <strong>Google Calendar API</strong></li>
              <li>Ve a <strong>Credenciales → Crear credenciales → ID de cliente OAuth 2.0</strong></li>
              <li>Tipo: <strong>Aplicación web</strong></li>
              <li>Agrega la URI de redirección autorizada: <code className="bg-surface-1 px-1.5 py-0.5 rounded border text-white/85">{googleForm.redirect_uri || 'https://tu-dominio.com/api/google/callback'}</code></li>
              <li>Copia el <strong>Client ID</strong> y <strong>Client Secret</strong> abajo</li>
            </ol>
          </div>

          <form onSubmit={handleSaveGoogle} className="bg-surface-1 rounded-xl border border-white/[0.07] p-5 space-y-4">
            <h3 className="font-semibold text-white/90">Credenciales OAuth2</h3>

            <div>
              <label className="input-label">Client ID *</label>
              <input
                className="input font-mono text-xs"
                value={googleForm.client_id}
                onChange={e => setG('client_id', e.target.value)}
                placeholder="123456789-xxxxx.apps.googleusercontent.com"
                required
              />
            </div>

            <div>
              <label className="input-label">
                Client Secret {googleSettings.configured ? '(dejar vacío para no cambiar)' : '*'}
              </label>
              <div className="relative">
                <input
                  className="input font-mono text-xs pr-10"
                  type={showSecret ? 'text' : 'password'}
                  value={googleForm.client_secret}
                  onChange={e => setG('client_secret', e.target.value)}
                  placeholder={googleSettings.configured ? '••••••••' : 'GOCSPX-...'}
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/52 hover:text-white/85 transition-colors"
                >
                  {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {googleSettings.configured && googleSettings.client_secret_masked && (
                <p className="text-xs text-white/52 mt-1">
                  Actual: <span className="font-mono">{googleSettings.client_secret_masked}</span>
                </p>
              )}
            </div>

            <div>
              <label className="input-label">Redirect URI *</label>
              <input
                className="input font-mono text-xs"
                value={googleForm.redirect_uri}
                onChange={e => setG('redirect_uri', e.target.value)}
                placeholder="https://tu-dominio.com/api/google/callback"
                required
              />
              <p className="text-xs text-white/52 mt-1">
                Esta URL debe estar registrada en Google Cloud Console como URI de redirección autorizada
              </p>
            </div>

            <button
              type="submit"
              disabled={savingGoogle}
              className="btn-primary w-full"
            >
              {savingGoogle ? (
                <><RefreshCw size={15} className="animate-spin" /> Guardando...</>
              ) : (
                <><Save size={15} /> Guardar configuración</>
              )}
            </button>
          </form>
        </div>
      )}

      {/* ── USERS ── */}
      {tab === 'users' && (() => {
        const visibleUsers = users.filter(u => inSelectedNegocio(u.group_id))
        return (
        <div className="bg-surface-1 rounded-xl border border-white/[0.07] overflow-hidden">
          {selectedNegocioId && (
            <div className="px-4 py-2.5 border-b border-white/5 text-xs text-white/42">
              Mostrando {visibleUsers.length} de {users.length} usuarios
            </div>
          )}
          <div className="overflow-x-auto table-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.07] text-left">
                  <th className="px-4 py-3 text-white/62 font-medium">Usuario</th>
                  <th className="px-4 py-3 text-white/62 font-medium">Rol</th>
                  <th className="px-4 py-3 text-white/62 font-medium">Grupo</th>
                  <th className="px-4 py-3 text-white/62 font-medium text-center">Estado</th>
                  <th className="px-4 py-3 text-white/62 font-medium text-center">Google Calendar</th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map(u => (
                  <tr key={u.id} className="border-b border-white/5 hover:bg-surface-0/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-surface-3 flex items-center justify-center text-xs font-bold text-white/78 flex-shrink-0">
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-white/90">{u.name}</p>
                          <p className="text-xs text-white/52">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                        u.role === 'tecnico'    ? 'bg-surface-1 text-white' :
                        u.role === 'superadmin' ? 'bg-warn/15 text-warn' :
                        u.role === 'subadmin'   ? 'bg-neon/15 text-neon' :
                        u.role === 'verificador'      ? 'text-warn bg-warn/10' :
                        'bg-surface-2 text-white/78'
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white/78">{u.group_name ?? '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                        u.is_active ? 'text-lime bg-lime/10' : 'text-danger bg-danger/10'
                      }`}>
                        {u.is_active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {u.google_connected ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <CheckCircle size={15} className="text-lime" />
                          {u.google_email && (
                            <span className="text-[10px] text-white/52">{u.google_email}</span>
                          )}
                        </div>
                      ) : (
                        <XCircle size={15} className="text-white/38 mx-auto" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )
      })()}


      {/* ── WA Modal ── */}
      {showWAModal && (
        <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4">
          <div className="bg-surface-1 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.07]">
              <h2 className="text-lg font-bold text-white">
                {editingWA ? 'Editar Configuración' : 'Nueva Configuración WhatsApp'}
              </h2>
              <button onClick={() => setShowWAModal(false)}
                className="p-2 hover:bg-surface-2 rounded-lg text-white/62">
                ×
              </button>
            </div>

            <form onSubmit={handleSaveWA} className="px-6 py-5 space-y-4">
              <div>
                <label className="input-label">Nombre Identificador *</label>
                <input className="input" value={waForm.name} onChange={e => setWA('name', e.target.value)}
                  placeholder="Ej: Oficina Central / Ventas" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="input-label">Teléfono *</label>
                  <input className="input" value={waForm.phone_number} onChange={e => setWA('phone_number', e.target.value)}
                    placeholder="+56912345678" required />
                </div>
                <div>
                  <label className="input-label">Proveedor</label>
                  <select className="input" value={waForm.api_provider} onChange={e => setWA('api_provider', e.target.value)}>
                    <option value="meta">Meta (WhatsApp Business API)</option>
                    <option value="twilio">Twilio</option>
                    <option value="manual">Manual</option>
                  </select>
                </div>
              </div>

              {waForm.api_provider === 'meta' && (
                <div>
                  <label className="input-label">Phone Number ID (Meta)</label>
                  <input className="input font-mono text-xs" value={waForm.phone_number_id}
                    onChange={e => setWA('phone_number_id', e.target.value)}
                    placeholder="123456789012345" />
                  <p className="text-xs text-white/52 mt-1">
                    Encuéntralo en Meta Business Manager → WhatsApp → Configuración
                  </p>
                </div>
              )}

              <div>
                <label className="input-label">
                  API Token / Access Token {editingWA && '(dejar vacío para no cambiar)'}
                </label>
                <div className="relative">
                  <input
                    className="input font-mono text-xs pr-10"
                    type={showToken ? 'text' : 'password'}
                    value={waForm.api_token}
                    onChange={e => setWA('api_token', e.target.value)}
                    placeholder={editingWA ? '••••••••' : 'EAAxxxxxxx...'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/52 hover:text-white/85 transition-colors"
                  >
                    {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {editingWA && (
                  <p className="text-xs text-white/52 mt-1">
                    Token configurado: {editingWA.has_token ? '✓ Sí' : '✗ No'}
                  </p>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowWAModal(false)} className="btn-secondary flex-1">
                  Cancelar
                </button>
                <button type="submit" disabled={savingWA} className="btn-primary flex-1">
                  {savingWA ? 'Guardando...' : editingWA ? 'Actualizar' : 'Crear'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Agentes IA tab ────────────────────────────────────────── */}
      {tab === 'ai_agents' && (() => {
        const visibleAgents = agents.filter((a: any) => inSelectedNegocio(a.group_id))
        return (
        <div className="space-y-4">
          <div className="bg-surface-1 rounded-xl border border-white/[0.07] shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
              <div>
                <h2 className="font-semibold text-white/90 flex items-center gap-2">
                  <Bot size={16} className="text-lime" /> Agentes IA
                  <span className="text-white/52 font-normal">
                    ({visibleAgents.length}{selectedNegocioId && agents.length !== visibleAgents.length ? ` de ${agents.length}` : ''})
                  </span>
                </h2>
                <p className="text-xs text-white/42 mt-0.5">Respuestas automáticas por WhatsApp con OpenAI — configura uno por negocio</p>
              </div>
              <button onClick={() => openAgentModal()}
                className="flex items-center gap-1.5 btn-primary text-sm px-4 py-2">
                <Plus size={14} /> Nuevo Agente
              </button>
            </div>

            {agentsLoading ? (
              <div className="px-6 py-10 text-center text-white/42 text-sm flex items-center justify-center gap-2">
                <Loader2 size={16} className="animate-spin" /> Cargando agentes...
              </div>
            ) : visibleAgents.length === 0 ? (
              <div className="px-6 py-14 text-center space-y-3">
                <Bot size={40} className="mx-auto text-white/15" />
                <p className="text-white/52 text-sm font-medium">No hay agentes configurados{selectedNegocioId ? ' para este negocio' : ''}</p>
                <p className="text-white/30 text-xs">Crea el primer agente y asígnalo a un número WhatsApp de cualquier negocio.</p>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {visibleAgents.map(agent => (
                  <div key={agent.id} className="px-6 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${agent.is_active ? 'bg-lime/10' : 'bg-white/5'}`}>
                          <Bot size={18} className={agent.is_active ? 'text-lime' : 'text-white/25'} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-white/90 text-sm">{agent.name}</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${agent.is_active ? 'bg-lime/15 text-lime' : 'bg-white/8 text-white/40'}`}>
                              {agent.is_active ? 'ACTIVO' : 'INACTIVO'}
                            </span>
                            {agent.group_id && (() => {
                              const admin = bizAdmins.find((u: any) => u.group_id === agent.group_id)
                              return (
                                <span className="text-[10px] text-neon border border-neon/20 bg-neon/5 px-1.5 py-0.5 rounded">
                                  {admin ? admin.name : agent.group_name}
                                </span>
                              )
                            })()}
                          </div>
                          {agent.description && (
                            <p className="text-xs text-white/42 mt-0.5 truncate max-w-md">{agent.description}</p>
                          )}
                          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                            <span className="flex items-center gap-1 text-xs text-white/52">
                              <MessageSquare size={10} className="text-lime/60" />
                              {agent.whatsapp_phone} · {agent.whatsapp_config_name}
                            </span>
                            <span className="flex items-center gap-1 text-xs text-white/52">
                              <Zap size={10} className="text-neon/60" /> {agent.openai_model}
                            </span>
                            <span className="text-xs text-white/42">
                              {agent.total_messages_sent ?? 0} mensajes enviados
                            </span>
                            {agent.business_hours_start && (
                              <span className="flex items-center gap-1 text-xs text-white/42">
                                <Clock size={10} /> {agent.business_hours_start}–{agent.business_hours_end}
                              </span>
                            )}
                            {(agent.escalation_keywords ?? []).length > 0 && (
                              <span className="text-xs text-amber-400/70">
                                {agent.escalation_keywords.length} keywords escalación
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button onClick={() => toggleAgentLogs(agent.id)}
                          title="Ver últimas interacciones"
                          className="flex items-center gap-1 text-xs text-white/42 hover:text-white/90 border border-white/10 px-2.5 py-1.5 rounded-lg transition-colors">
                          <Eye size={11} />
                          {agentLogsOpen[agent.id] ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                        </button>
                        <button
                          onClick={() => handleToggleAgent(agent.id, agent.is_active)}
                          title={agent.is_active ? 'Desactivar' : 'Activar'}
                          className={`p-2 rounded-lg transition-colors ${agent.is_active ? 'text-lime hover:bg-lime/10' : 'text-white/30 hover:bg-white/[0.06]'}`}>
                          {agent.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                        </button>
                        <button onClick={() => openAgentModal(agent)}
                          className="p-2 text-white/42 hover:text-white/90 hover:bg-white/[0.06] rounded-lg transition-colors">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => handleDeleteAgent(agent.id)}
                          className="p-2 text-white/42 hover:text-danger hover:bg-danger/10 rounded-lg transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Logs */}
                    {agentLogsOpen[agent.id] && (
                      <div className="mt-4 bg-surface-2 rounded-xl border border-white/[0.07] overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.07]">
                          <span className="text-xs font-semibold text-white/62">Últimas interacciones</span>
                          <button onClick={() => getAIAgentLogs(agent.id, 30).then(l => setAgentLogs(p => ({ ...p, [agent.id]: l })))}
                            className="text-xs text-white/42 hover:text-white/90 flex items-center gap-1">
                            <RefreshCw size={10} /> Actualizar
                          </button>
                        </div>
                        {(!agentLogs[agent.id] || agentLogs[agent.id].length === 0) ? (
                          <p className="text-xs text-white/42 px-4 py-5 text-center">Sin interacciones registradas aún.</p>
                        ) : (
                          <div className="divide-y divide-white/[0.05] max-h-72 overflow-y-auto">
                            {agentLogs[agent.id].map(log => (
                              <div key={log.id} className="px-4 py-3 text-xs">
                                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${log.error ? 'bg-danger' : 'bg-lime'}`} />
                                  <span className="text-white/42">{log.created_at ? new Date(log.created_at).toLocaleString('es-CL') : ''}</span>
                                  <span className="text-white/20">·</span>
                                  <span className="text-white/42">{log.model_used} · {log.tokens_used} tokens · {log.latency_ms}ms</span>
                                </div>
                                {log.error ? (
                                  <p className="text-danger/80">Error: {log.error}</p>
                                ) : (
                                  <div className="space-y-1">
                                    <p className="text-white/42 truncate"><span className="text-white/25">→</span> {log.input_message}</p>
                                    <p className="text-white/75 truncate"><span className="text-lime/50">←</span> {log.output_message}</p>
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
        )
      })()}

      {/* ── Security audit log tab — tecnico sees ALL negocios ──────── */}
      {tab === 'security' && (() => {
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
            {/* Stats globales */}
            {secStats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Intentos fallidos (24h)', value: secStats.failed_logins_24h, color: secStats.failed_logins_24h > 0 ? 'text-amber-400' : 'text-white/70', bg: secStats.failed_logins_24h > 0 ? 'border-amber-500/20' : '' },
                  { label: 'Cuentas bloqueadas ahora', value: secStats.blocked_accounts, color: secStats.blocked_accounts > 0 ? 'text-danger' : 'text-white/70', bg: secStats.blocked_accounts > 0 ? 'border-danger/20' : '' },
                  { label: 'Eventos críticos (24h)', value: secStats.critical_events_24h, color: secStats.critical_events_24h > 0 ? 'text-red-400' : 'text-white/70', bg: secStats.critical_events_24h > 0 ? 'border-red-500/20' : '' },
                  { label: 'Total eventos globales', value: secStats.total_events, color: 'text-white/70', bg: '' },
                ].map(s => (
                  <div key={s.label} className={`bg-surface-1 rounded-xl border px-4 py-3 ${s.bg || 'border-white/[0.07]'}`}>
                    <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-white/42 mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Cuentas bloqueadas (todos los negocios) */}
            <div className="bg-danger/5 border border-danger/20 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-danger/15">
                  <span className="w-2 h-2 rounded-full bg-danger animate-pulse" />
                  <span className="text-sm font-semibold text-danger">
                    {lockedUsers.length} cuenta{lockedUsers.length > 1 ? 's' : ''} bloqueada{lockedUsers.length > 1 ? 's' : ''} en el sistema
                  </span>
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

            {/* Tabla global */}
            <div className="bg-surface-1 rounded-xl border border-white/[0.07] overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 gap-3 flex-wrap">
                <h2 className="font-semibold text-white/90 flex items-center gap-2">
                  <Shield size={16} className="text-white/60" />
                  Auditoría Global — Todos los negocios
                  <span className="text-white/40 font-normal text-sm">({auditTotal})</span>
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

      {/* ── Crear Negocio Modal ──────────────────────────────────── */}
      {showNegocioModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface-1 rounded-2xl border border-white/[0.07] shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07]">
              <h3 className="font-semibold text-white/90 flex items-center gap-2">
                <Building2 size={16} className="text-neon" />
                Crear Negocio
              </h3>
              <button onClick={() => setShowNegocioModal(false)} className="text-white/42 hover:text-white/90 p-1 rounded-lg">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateNegocio} className="px-6 py-5 space-y-5">

              {/* Business info */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-bold text-white/35 uppercase tracking-widest flex items-center gap-1.5">
                  <Building2 size={11} /> Datos del negocio
                </h4>
                <div>
                  <label className="input-label">Nombre del negocio *</label>
                  <input
                    className="input w-full"
                    placeholder="Ej: Clínica García, Inmobiliaria Norte..."
                    value={negocioForm.business_name}
                    onChange={e => setNegocioForm(f => ({ ...f, business_name: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="input-label">Descripción (opcional)</label>
                  <input
                    className="input w-full"
                    placeholder="Ej: Clínica dental en Santiago centro"
                    value={negocioForm.description}
                    onChange={e => setNegocioForm(f => ({ ...f, description: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="input-label">Tipo de negocio *</label>
                  <select
                    className="input w-full"
                    value={negocioForm.tipo}
                    onChange={e => setNegocioForm(f => ({ ...f, tipo: e.target.value }))}
                  >
                    <option value="abogados">Abogados / Tributario</option>
                    <option value="inmobiliaria">Inmobiliaria</option>
                    <option value="clinica">Clínica / Salud</option>
                    <option value="restaurant">Restaurant / Gastronomía</option>
                    <option value="otro">Otro</option>
                  </select>
                  {negocioForm.tipo === 'abogados' && (
                    <p className="text-xs text-lime/70 mt-1.5 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-lime inline-block" />
                      Pipeline fijo con integración AT Informa, Legal Finance y PagaCuotas.
                    </p>
                  )}
                  {negocioForm.tipo !== 'abogados' && (
                    <p className="text-xs text-white/42 mt-1.5 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-white/30 inline-block" />
                      El administrador podrá configurar las etapas del pipeline desde su panel.
                    </p>
                  )}
                </div>
                <div>
                  <label className="input-label">Plan *</label>
                  <div className="flex gap-2 mt-1">
                    {([
                      { key: 'basico',     label: 'Básico',     activeBg: '#475569', activeBorder: '#64748b', activeText: '#ffffff', inactiveBg: 'rgba(71,85,105,0.15)', inactiveBorder: 'rgba(100,116,139,0.40)', inactiveText: '#94a3b8' },
                      { key: 'pro',        label: 'Pro',        activeBg: 'var(--zx-accent-text)', activeBorder: 'var(--zx-accent-text)', activeText: '#ffffff', inactiveBg: 'rgba(53,122,14,0.12)', inactiveBorder: 'rgba(53,122,14,0.40)', inactiveText: '#a78bfa' },
                      { key: 'enterprise', label: 'Enterprise', activeBg: '#d97706', activeBorder: '#d97706', activeText: '#ffffff', inactiveBg: 'rgba(217,119,6,0.12)',  inactiveBorder: 'rgba(217,119,6,0.40)',  inactiveText: '#fbbf24' },
                    ] as const).map(({ key: p, label, activeBg, activeBorder, activeText, inactiveBg, inactiveBorder, inactiveText }) => {
                      const active = negocioForm.plan === p
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setNegocioForm(f => ({ ...f, plan: p }))}
                          className="flex-1 py-3 rounded-xl text-xs font-bold border-2 transition-all duration-150 flex flex-col items-center gap-0.5"
                          style={{
                            background: active ? activeBg : inactiveBg,
                            color: active ? activeText : inactiveText,
                            borderColor: active ? activeBorder : inactiveBorder,
                            boxShadow: active ? `0 4px 14px ${activeBg}55` : 'none',
                            transform: active ? 'translateY(-1px)' : 'none',
                          }}
                        >
                          {PLAN_LIMITS[p].label}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                    {negocioForm.plan === 'basico' && 'Hasta 5 usuarios · 1 número WhatsApp · sin Agente IA'}
                    {negocioForm.plan === 'pro' && 'Hasta 15 usuarios · 3 números WA · 2 Agentes IA · exportar CSV'}
                    {negocioForm.plan === 'enterprise' && 'Usuarios y WA ilimitados · Agentes IA ilimitados · todas las funciones'}
                  </p>
                </div>
              </div>

              {/* Admin info */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-bold text-white/35 uppercase tracking-widest flex items-center gap-1.5">
                  <ShieldCheck size={11} /> Superadministrador del negocio
                </h4>
                <p className="text-xs text-white/42">
                  Este usuario tendrá acceso total al panel del negocio. Solo puede existir uno por negocio.
                </p>
                <div>
                  <label className="input-label">Nombre completo *</label>
                  <input
                    className="input w-full"
                    placeholder="Ej: Carlos García"
                    value={negocioForm.admin_name}
                    onChange={e => setNegocioForm(f => ({ ...f, admin_name: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="input-label">Correo electrónico *</label>
                  <input
                    className="input w-full"
                    type="email"
                    placeholder="admin@clinicagarcia.cl"
                    value={negocioForm.admin_email}
                    onChange={e => setNegocioForm(f => ({ ...f, admin_email: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="input-label">Contraseña *</label>
                  <div className="relative">
                    <input
                      className="input w-full pr-10"
                      type={showAdminPass ? 'text' : 'password'}
                      placeholder="Mínimo 8 caracteres"
                      value={negocioForm.admin_password}
                      onChange={e => setNegocioForm(f => ({ ...f, admin_password: e.target.value }))}
                      required
                      minLength={8}
                    />
                    <button
                      type="button"
                      onClick={() => setShowAdminPass(s => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/52 hover:text-white/85 transition-colors"
                    >
                      {showAdminPass ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <p className="text-xs text-white/35 mt-1 flex items-center gap-1">
                    <KeyRound size={10} /> El administrador deberá cambiar esta contraseña en su primer acceso.
                  </p>
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowNegocioModal(false)} className="btn-secondary flex-1">
                  Cancelar
                </button>
                <button type="submit" disabled={negocioSaving} className="btn-primary flex-1">
                  {negocioSaving ? <><Loader2 size={14} className="animate-spin" /> Creando...</> : <><Plus size={14} /> Crear Negocio</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Agent Modal ───────────────────────────────────────────── */}
      {showAgentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface-1 rounded-2xl border border-white/[0.07] shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07]">
              <h3 className="font-semibold text-white/90 flex items-center gap-2">
                <Bot size={16} className="text-lime" />
                {editAgent ? `Editar: ${editAgent.name}` : 'Nuevo Agente IA'}
              </h3>
              <button onClick={() => setShowAgentModal(false)} className="text-white/42 hover:text-white/90 p-1 rounded-lg">
                <X size={16} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

              {/* Básico */}
              <section className="space-y-3">
                <h4 className="text-[10px] font-bold text-white/35 uppercase tracking-widest">Información básica</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs text-white/52 block mb-1">Nombre del agente *</label>
                    <input className="input w-full" placeholder="Ej: Asistente Clínica García"
                      value={agentForm.name} onChange={e => setAgentForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-white/52 block mb-1">Descripción</label>
                    <input className="input w-full" placeholder="Ej: Bot de ventas para canal WA principal"
                      value={agentForm.description} onChange={e => setAgentForm(f => ({ ...f, description: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-white/52 block mb-1">Negocio (administrador) *</label>
                    <select className="input w-full" value={agentForm.selected_admin_id}
                      onChange={e => {
                        const adminId = e.target.value
                        const admin = bizAdmins.find((u: any) => String(u.id) === adminId)
                        setAgentForm(f => ({
                          ...f,
                          selected_admin_id: adminId,
                          group_id: admin?.group_id ? String(admin.group_id) : '',
                        }))
                      }}>
                      <option value="">— Seleccionar negocio —</option>
                      {bizAdmins.map((u: any) => (
                        <option key={u.id} value={u.id}>
                          {u.name}{u.group_name ? ` (${u.group_name})` : ''}
                        </option>
                      ))}
                    </select>
                    {bizAdmins.length === 0 && (
                      <p className="text-[10px] text-amber-400/70 mt-1">Crea un superadmin para poder asignar agentes.</p>
                    )}
                    <p className="text-[10px] text-white/30 mt-1 flex items-center gap-1">
                      <MessageSquare size={9} /> El administrador del negocio asignará el número WhatsApp desde su panel.
                    </p>
                  </div>
                  <div className="col-span-2 flex items-center gap-3">
                    <button type="button" onClick={() => setAgentForm(f => ({ ...f, is_active: !f.is_active }))}
                      className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${agentForm.is_active ? 'bg-lime' : 'bg-white/20'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${agentForm.is_active ? 'left-5' : 'left-0.5'}`} />
                    </button>
                    <span className="text-sm text-white/78">{agentForm.is_active ? 'Agente activo' : 'Agente inactivo'}</span>
                  </div>
                </div>
              </section>

              {/* Prompt */}
              <section className="space-y-3">
                <h4 className="text-[10px] font-bold text-white/35 uppercase tracking-widest">Personalidad & Base de conocimiento</h4>
                <div>
                  <label className="text-xs text-white/52 block mb-1">Prompt del sistema *</label>
                  <textarea className="input w-full resize-none font-mono text-xs leading-relaxed" rows={9}
                    placeholder="Eres [nombre], asistente de [negocio]...&#10;&#10;Servicios que ofrecemos:&#10;- ...&#10;&#10;Instrucciones:&#10;- Responde siempre en español&#10;- No inventes información"
                    value={agentForm.system_prompt}
                    onChange={e => setAgentForm(f => ({ ...f, system_prompt: e.target.value }))} />
                  <p className="text-[10px] text-white/30 mt-1">Incluye nombre del negocio, servicios, precios, horarios, tono de voz y restricciones.</p>
                </div>
              </section>

              {/* OpenAI */}
              <section className="space-y-3">
                <h4 className="text-[10px] font-bold text-white/35 uppercase tracking-widest">Configuración OpenAI</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs text-white/52 block mb-1">
                      API Key {editAgent ? <span className="text-white/30">(vacío = mantener actual · termina en <code className="text-neon">{editAgent.openai_api_key_hint}</code>)</span> : '*'}
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
                    <label className="text-xs text-white/52 block mb-1">Temperatura: {agentForm.temperature}</label>
                    <input type="range" min="0" max="2" step="0.1" className="w-full accent-lime mt-1"
                      value={agentForm.temperature}
                      onChange={e => setAgentForm(f => ({ ...f, temperature: parseFloat(e.target.value) }))} />
                    <div className="flex justify-between text-[10px] text-white/25 mt-0.5">
                      <span>Preciso</span><span>Creativo</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-white/52 block mb-1">Máx. tokens por respuesta</label>
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
              </section>

              {/* Comportamiento */}
              <section className="space-y-3">
                <h4 className="text-[10px] font-bold text-white/35 uppercase tracking-widest">Comportamiento</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-white/52 block mb-1">Demora respuesta (seg)</label>
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
                <p className="text-[10px] text-white/30">Sin horario = 24/7. Con horario = solo responde en ese rango.</p>
              </section>

              {/* Escalación */}
              <section className="space-y-3">
                <h4 className="text-[10px] font-bold text-white/35 uppercase tracking-widest">Escalación a humano</h4>
                <p className="text-[10px] text-white/42">Si la respuesta del bot contiene alguna de estas palabras, el chat pasa automáticamente a un agente humano.</p>
                <div className="flex gap-2">
                  <input className="input flex-1" placeholder="Ej: asesor humano"
                    value={agentForm.escalation_kw_input}
                    onChange={e => setAgentForm(f => ({ ...f, escalation_kw_input: e.target.value }))}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault()
                        const kw = agentForm.escalation_kw_input.trim()
                        if (kw && !agentForm.escalation_keywords.includes(kw))
                          setAgentForm(f => ({ ...f, escalation_keywords: [...f.escalation_keywords, kw], escalation_kw_input: '' }))
                      }
                    }} />
                  <button type="button" className="btn-secondary px-3 text-sm"
                    onClick={() => {
                      const kw = agentForm.escalation_kw_input.trim()
                      if (kw && !agentForm.escalation_keywords.includes(kw))
                        setAgentForm(f => ({ ...f, escalation_keywords: [...f.escalation_keywords, kw], escalation_kw_input: '' }))
                    }}>
                    + Agregar
                  </button>
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
              </section>
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
    </div>
  )
}
