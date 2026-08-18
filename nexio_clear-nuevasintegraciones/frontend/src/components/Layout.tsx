import { useState, useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, UserCheck, GitBranch, Calendar,
  LogOut, Bell, Menu, CreditCard, Shield, ChevronDown, Wrench, Search, X, Smartphone, MessageSquare, Bot, Building2, QrCode, Building, GitBranch as GitBranchIcon, Wallet, Archive, Brain, Eye, Pencil, Plug, Sparkles, Send as SendIcon,
} from 'lucide-react'
import { useAuthStore } from '../store/auth'
import { useReadOnly } from '../hooks/useReadOnly'
import { useReadonlyStore } from '../store/readonly'
import { getNotificationCount, getAgentQueue, getLeadsCount } from '../api'
import { playMessageSound, playNewLeadSound, playNotificationSound } from '../hooks/useNotificationSound'
import { reRegisterPush } from '../hooks/usePushNotifications'
import { canDo } from '../utils/plans'
import InstallPWA from './InstallPWA'
import GlobalSearch from './GlobalSearch'
import LeadDrawerHost from './LeadDrawerHost'
import NotificationPanel from './NotificationPanel'
import { ZelixLeadsLogo } from './ZelixLeadsLogo'
import toast from 'react-hot-toast'
import { useRealtime } from '../contexts/RealtimeContext'

const NAV_SECTIONS = [
  {
    label: 'Principal',
    items: [
      { path: '/',           icon: LayoutDashboard, label: 'Dashboard',      sublabel: 'Vista general',    roles: ['superadmin','subadmin','agendadora','verificador','vendedor'] },
      { path: '/analista',   icon: LayoutDashboard, label: 'Dashboard',      sublabel: 'Cartera cobranza', roles: ['analista'] },
      { path: '/cobrador',   icon: LayoutDashboard, label: 'Dashboard',      sublabel: 'Resumen cobranza', roles: ['cobrador'] },
    ],
  },
  {
    label: 'Ventas',
    items: [
      { path: '/pipeline',   icon: GitBranch,       label: 'Pipeline',       sublabel: 'Embudo ventas',  roles: ['superadmin','subadmin','agendadora'] },
      { path: '/leads',      icon: UserCheck,       label: 'Leads',          sublabel: 'Gestión leads',  roles: ['superadmin','subadmin','agendadora'] },
      { path: '/contactos',  icon: Users,           label: 'Contactos',      sublabel: 'Base clientes',  roles: ['superadmin','subadmin','agendadora'] },
      { path: '/calendario', icon: Calendar,        label: 'Calendario',     sublabel: 'Agenda grupal',  roles: ['superadmin','subadmin','agendadora'] },
      { path: '/mi-pipeline',icon: GitBranch,       label: 'Mi Pipeline',    sublabel: 'Tus clientes',   roles: ['vendedor'] },
      { path: '/agenda',     icon: Calendar,        label: 'Agenda',         sublabel: 'Mis reuniones',  roles: ['vendedor'] },
    ],
  },
  {
    label: 'Comunicación',
    items: [
      { path: '/mis-whatsapp',  icon: Smartphone,      label: 'Mis WhatsApp',   sublabel: 'Vincular mi número', roles: ['agendadora','vendedor','cobrador'] },
      { path: '/whatsapp',      icon: MessageSquare,   label: 'WhatsApp',       sublabel: 'Chat clientes',       roles: ['agendadora','superadmin','subadmin','cobrador'] },
      { path: '/agente-ia',     icon: Bot,             label: 'Agente IA',      sublabel: 'Leads IA pendientes', roles: ['agendadora','superadmin','subadmin'] },
      { path: '/nexin',         icon: Brain,           label: 'Asistente IA',   sublabel: 'Copiloto ZelixLeads', roles: ['superadmin'] },
    ],
  },
  {
    label: 'Cobranza',
    items: [
      { path: '/cobrador/cartera',   icon: Wallet,        label: 'Cartera',      sublabel: 'Mis clientes',     roles: ['cobrador'] },
      { path: '/cobrador/pipeline',  icon: GitBranchIcon, label: 'Pipeline',     sublabel: 'Embudo cobranza',  roles: ['cobrador'] },
      { path: '/cobrador/historial', icon: Archive,       label: 'Historial',    sublabel: 'Clientes pagados', roles: ['cobrador'] },
      { path: '/pagos',              icon: CreditCard,    label: 'Verificar Pagos', sublabel: 'Confirmar cobros', roles: ['verificador'] },
    ],
  },
  {
    label: 'Seguimiento',
    items: [
      { path: '/asistente-seguimiento', icon: UserCheck, label: 'Panel Asistente', sublabel: 'Seguimiento pagos', roles: ['asistente_seguimiento'] },
    ],
  },
  {
    label: 'Administración',
    items: [
      { path: '/admin',   tab: 'users',          icon: Users,              label: 'Usuarios',             sublabel: 'Gestión accesos',   roles: ['superadmin','subadmin'] },
      { path: '/admin',   tab: 'groups',         icon: Building,           label: 'Grupos & Áreas',       sublabel: 'Organización',      roles: ['superadmin','subadmin'] },
      { path: '/admin',   tab: 'pipeline',       icon: GitBranchIcon,      label: 'Etapas',               sublabel: 'Configurar embudo', roles: ['superadmin','subadmin'] },
      { path: '/admin',   tab: 'whatsapp_sessions', icon: Smartphone,      label: 'WhatsApp',             sublabel: 'Sesiones QR',       roles: ['superadmin','subadmin'] },
      { path: '/admin',   tab: 'ai_agents',      icon: Bot,                label: 'Agentes IA',           sublabel: 'Mis agentes',       roles: ['superadmin','subadmin'] },
      { path: '/admin',   tab: 'cobrador_carteras', icon: Users,            label: 'Carteras Cobrador',    sublabel: 'Clientes por cobrador', roles: ['superadmin','subadmin'] },
      { path: '/admin',   tab: 'configuracion',   icon: Shield,             label: 'Configuración',        sublabel: 'Plantillas & reglas',  roles: ['superadmin','subadmin'] },
      { path: '/admin',   tab: 'security',       icon: Shield,             label: 'Seguridad',            sublabel: 'Auditoría ISO 27001', roles: ['superadmin'] },
      { path: '/integraciones',                  icon: Plug,               label: 'Integraciones',        sublabel: 'Estado del ecosistema', roles: ['superadmin'] },
    ],
  },
  {
    label: 'Técnico',
    items: [
      { path: '/tecnico', tab: 'overview',    icon: Wrench,             label: 'Resumen',              sublabel: 'Estado sistema',    roles: ['tecnico'] },
      { path: '/tecnico', tab: 'negocios',    icon: Building2,          label: 'Negocios',             sublabel: 'Clientes CRM',      roles: ['tecnico'] },
      { path: '/tecnico', tab: 'users',       icon: Users,              label: 'Usuarios',             sublabel: 'Gestión accesos',   roles: ['tecnico'] },
      { path: '/tecnico', tab: 'whatsapp',    icon: MessageSquare,      label: 'WhatsApp Meta',        sublabel: 'API oficial',       roles: ['tecnico'] },
      { path: '/tecnico', tab: 'whatsapp_qr', icon: QrCode,             label: 'WhatsApp QR',          sublabel: 'Escaneo QR',        roles: ['tecnico'] },
      { path: '/tecnico', tab: 'ai_agents',   icon: Bot,                label: 'Agentes IA',           sublabel: 'Config agentes',    roles: ['tecnico'] },
      { path: '/tecnico', tab: 'google',      icon: Calendar,           label: 'Google OAuth',         sublabel: 'Credenciales',      roles: ['tecnico'] },
      { path: '/tecnico', tab: 'security',    icon: Shield,             label: 'Seguridad',            sublabel: 'Auditoría global',   roles: ['tecnico'] },
    ],
  },
]


const ALL_NAV_ITEMS = NAV_SECTIONS.flatMap(s => s.items)

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout }    = useAuthStore()
  const location            = useLocation()
  const navigate            = useNavigate()
  const [mobile, setMobile]       = useState(false)
  const [unread, setUnread]       = useState(0)
  const [agentCount, setAgentCount] = useState(0)
  const [pushRegistering, setPushRegistering] = useState(false)
  const [leadsCount, setLeadsCount] = useState(0)
  const [showSearch, setShowSearch] = useState(false)
  const [showNotifPanel, setShowNotifPanel] = useState(false)
  const [collapsedSecs, setCollapsedSecs] = useState<string[]>([])
  /** Menú horizontal: qué sección tiene el submenú abierto (una sola a la vez). */
  const [openSec, setOpenSec] = useState<string | null>(null)
  const navRef = useRef<HTMLElement | null>(null)

  // Modo observador (solo lectura) para superadmin/subadmin.
  const { readOnly, isSupervisor, editUnlocked, unlock, lock } = useReadOnly()
  const touchReadonly = useReadonlyStore(s => s.touch)

  // Marca el body para que el CSS atenúe los botones .danger-action.
  useEffect(() => {
    if (readOnly) document.body.dataset.readonly = 'true'
    else delete document.body.dataset.readonly
    return () => { delete document.body.dataset.readonly }
  }, [readOnly])

  // Mientras la edición esté habilitada, cualquier actividad reinicia el
  // temporizador de re-bloqueo por inactividad (~10 min).
  useEffect(() => {
    if (!isSupervisor || !editUnlocked) return
    const handler = () => touchReadonly()
    window.addEventListener('mousedown', handler)
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('mousedown', handler)
      window.removeEventListener('keydown', handler)
    }
  }, [isSupervisor, editUnlocked, touchReadonly])

  const handleToggleEdit = () => {
    if (editUnlocked) {
      lock()
      toast('Volviste a modo observador (solo lectura)', { icon: '👁' })
    } else {
      const ok = window.confirm(
        '¿Habilitar edición?\n\nPodrás modificar leads, pagos y procesos que afectan el trabajo del equipo. Se volverá a bloquear solo tras 10 min de inactividad.'
      )
      if (!ok) return
      unlock()
      toast('Edición habilitada', { icon: '✏️' })
    }
  }

  // Sound state — skip first load to avoid playing on page open
  const prevUnread     = useRef<number | null>(null)
  const prevLeadCount  = useRef<number | null>(null)

  useEffect(() => {
    const isAgendadora = user?.role === 'agendadora' || user?.role === 'superadmin' || user?.role === 'subadmin'
    const fetchCounts = () => {
      getNotificationCount().then((d: any) => {
        const next = d.unread as number
        if (prevUnread.current !== null && next > prevUnread.current) playNotificationSound()
        prevUnread.current = next
        setUnread(next)
      }).catch(() => {})
      if (isAgendadora) {
        getAgentQueue().then((d: any) => setAgentCount(d.count ?? 0)).catch(() => {})
        getLeadsCount({ stage: 'lead', exclude_ai: true }).then((d: any) => {
          const next = d.total as number
          if (prevLeadCount.current !== null && next > prevLeadCount.current) playNewLeadSound()
          prevLeadCount.current = next
          setLeadsCount(next)
        }).catch(() => {})
      }
    }
    fetchCounts()
    const id = setInterval(fetchCounts, 30000)
    window.addEventListener('lead-stage-changed', fetchCounts)
    window.addEventListener('notifications-updated', fetchCounts)
    return () => {
      clearInterval(id)
      window.removeEventListener('lead-stage-changed', fetchCounts)
      window.removeEventListener('notifications-updated', fetchCounts)
    }
  }, [user?.role])

  // Real-time navbar count updates
  useRealtime(['lead_update', 'notification_update', 'cobrador_sync'], () => {
    getNotificationCount().then((d: any) => {
      const next = d.unread as number
      if (prevUnread.current !== null && next > prevUnread.current) playNotificationSound()
      prevUnread.current = next
      setUnread(next)
    }).catch(() => {})
    const isAgendadora = user?.role === 'agendadora' || user?.role === 'superadmin' || user?.role === 'subadmin'
    if (isAgendadora) {
      getAgentQueue().then((d: any) => setAgentCount(d.count ?? 0)).catch(() => {})
      getLeadsCount({ stage: 'lead', exclude_ai: true }).then((d: any) => {
        const next = d.total as number
        if (prevLeadCount.current !== null && next > prevLeadCount.current) playNewLeadSound()
        prevLeadCount.current = next
        setLeadsCount(next)
      }).catch(() => {})
    }
  })

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setShowSearch(s => !s) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  /**
   * El submenú abierto se cierra al hacer clic fuera o con Escape. Sin esto
   * queda flotando sobre el contenido y hay que volver a la sección para
   * cerrarlo — la molestia clásica de los menús desplegables mal terminados.
   */
  useEffect(() => {
    if (!openSec) return
    const fuera = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenSec(null)
    }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenSec(null) }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', escape)
    }
  }, [openSec])

  // Navegar cierra el submenú (incluye ir por el buscador global o el historial).
  useEffect(() => { setOpenSec(null) }, [location.pathname, location.search])

  const handleLogout = () => { logout(); navigate('/login') }

  const handleReRegisterPush = async () => {
    setPushRegistering(true)
    try {
      const result = await reRegisterPush()
      if (result === 'ok') toast.success('Notificaciones push activadas en este dispositivo')
      else if (result === 'denied') toast.error('Permiso de notificaciones denegado — habilítalo en ajustes del navegador')
      else if (result === 'unsupported') toast.error('Este navegador no soporta notificaciones push')
      else toast.error('Error al activar notificaciones')
    } catch {
      toast.error('Error al activar notificaciones')
    } finally {
      setPushRegistering(false)
    }
  }

  const allItems = NAV_SECTIONS.flatMap(s => s.items)
  const pathItems = allItems.filter((n: any) => location.pathname === n.path || (n.path !== '/' && location.pathname.startsWith(n.path)))
  const pageTitle = (
    pathItems.find((n: any) => n.tab && location.search.includes(`tab=${n.tab}`))?.label
    ?? pathItems.find((n: any) => !n.tab)?.label
    ?? pathItems.find((n: any) => n.tab)?.label
    ?? 'CRM'
  )

  const plan = user?.negocio_plan ?? 'basico'
  const isAiItem = (n: any) => n.path === '/agente-ia' || n.tab === 'ai_agents'
  const userNavItems = ALL_NAV_ITEMS.filter(n => {
    if (!user || !n.roles.includes(user.role)) return false
    // El técnico siempre ve Agentes IA (crea agentes para los negocios)
    if (isAiItem(n) && user.role !== 'tecnico' && !canDo(plan, 'max_ai_agents')) return false
    if (n.path === '/seguimiento' && !canDo(plan, 'seguimiento')) return false
    return true
  })
  const bottomNavItems = userNavItems.slice(0, 4)

  const pageSub = (
    pathItems.find((n: any) => n.tab && location.search.includes(`tab=${n.tab}`))?.sublabel
    ?? pathItems.find((n: any) => !n.tab)?.sublabel
    ?? ''
  )

  const toggleSection = (label: string) =>
    setCollapsedSecs(prev => prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label])

  const filterByPlan = (n: any) => {
    // El técnico siempre ve Agentes IA
    if (isAiItem(n) && user?.role !== 'tecnico' && !canDo(plan, 'max_ai_agents')) return false
    if (n.path === '/seguimiento' && !canDo(plan, 'seguimiento')) return false
    return true
  }

  /** Contenido del menú en versión VERTICAL — hoy solo lo usa el drawer móvil. */
  const SidebarContent = ({ expanded = true }: { expanded?: boolean }) => (
    <div className="flex flex-col h-full">

      {/* ── Marca ── */}
      <div className={`flex items-center flex-shrink-0 ${expanded ? 'gap-3 px-5 pt-6 pb-5' : 'flex-col pt-6 pb-5'}`}>
        <ZelixLeadsLogo size={expanded ? 38 : 30} />
        {expanded && (
          <div className="min-w-0">
            <p className="font-black text-lg leading-none truncate"
              style={{
                fontFamily: '"Space Grotesk", sans-serif', letterSpacing: '-0.03em',
                background: 'linear-gradient(90deg, #a78bfa 0%, var(--zx-lime) 100%)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              }}>
              ZelixLeads
            </p>
            <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-[0.14em]"
              style={{ background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.30)', color: '#67e8f9' }}>
              <Sparkles size={8} /> WhatsApp CRM
            </span>
          </div>
        )}
      </div>

      {/* ── Buscador integrado ── */}
      {expanded ? (
        <button onClick={() => setShowSearch(true)}
          className="mx-4 mb-4 flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl text-xs font-medium transition-all flex-shrink-0"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.40)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(53,122,14,0.55)'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.75)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.09)'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.40)' }}>
          <Search size={13} />
          <span className="flex-1 text-left">Buscar en el CRM…</span>
          <kbd className="text-[9px] px-1.5 py-0.5 rounded-md"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)' }}>⌘K</kbd>
        </button>
      ) : (
        <button onClick={() => setShowSearch(true)} title="Buscar (⌘K)"
          className="mx-auto mb-4 p-2.5 rounded-xl transition-all flex-shrink-0"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.45)' }}>
          <Search size={15} />
        </button>
      )}

      {/* ── Navegación por módulos (acordeón) ── */}
      <nav className="flex-1 overflow-y-auto px-3 pb-2 space-y-1.5">
        {NAV_SECTIONS.map(section => {
          const visible = section.items
            .filter(n => user && n.roles.includes(user.role))
            .filter(filterByPlan)
          if (!visible.length) return null
          const isCollapsed = expanded && collapsedSecs.includes(section.label)
          return (
            <div key={section.label}
              className={expanded ? 'rounded-2xl overflow-hidden' : ''}
              style={expanded ? { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' } : undefined}>
              {expanded && (
                <button onClick={() => toggleSection(section.label)}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 transition-colors">
                  <span className="text-[9px] font-black uppercase tracking-[0.20em]"
                    style={{ color: 'rgba(167,139,250,0.80)' }}>
                    {section.label}
                  </span>
                  <ChevronDown size={11}
                    style={{ color: 'rgba(255,255,255,0.30)', transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.2s' }} />
                </button>
              )}
              {!isCollapsed && (
                <div className={expanded ? 'px-1.5 pb-1.5 space-y-0.5' : 'flex flex-col items-center space-y-1'}>
                  {visible.map(({ path, icon: Icon, label, tab: navTab }: any) => {
                    const DEFAULT_TABS: Record<string, string> = { '/tecnico': 'negocios', '/admin': 'users' }
                    const searchTab = new URLSearchParams(location.search).get('tab')
                    const active = navTab
                      ? location.pathname === path && (searchTab === navTab || (!location.search && DEFAULT_TABS[path] === navTab))
                      : location.pathname === path || (path !== '/' && location.pathname.startsWith(path + '/') && !visible.some((o: any) => o.path !== path && location.pathname.startsWith(o.path)))
                    const badge = path === '/agente-ia' ? agentCount : path === '/leads' ? leadsCount : 0
                    const to = navTab ? `${path}?tab=${navTab}` : path
                    return (
                      <Link
                        key={navTab ? `${path}-${navTab}` : path}
                        to={to}
                        title={!expanded ? label : undefined}
                        onClick={() => setMobile(false)}
                        className={`flex items-center rounded-xl transition-all duration-150 ${expanded ? 'gap-2.5 px-2.5 py-2' : 'justify-center w-10 h-10'}`}
                        style={active ? {
                          background: 'linear-gradient(90deg, var(--zx-accent-text) 0%, var(--zx-lime) 140%)',
                          color: '#ffffff',
                          boxShadow: '0 4px 14px rgba(53,122,14,0.35)',
                        } : {
                          color: 'rgba(255,255,255,0.55)',
                        }}
                        onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.color = '#ffffff'; (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' } }}
                        onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.55)'; (e.currentTarget as HTMLElement).style.background = '' } }}
                      >
                        <span className="relative flex items-center justify-center flex-shrink-0">
                          <Icon size={15} style={{ color: active ? '#ffffff' : 'rgba(255,255,255,0.60)' }} />
                          {!expanded && badge > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 w-2 h-2 rounded-full"
                              style={{ background: path === '/agente-ia' ? 'var(--zx-lime)' : '#e11d48' }} />
                          )}
                        </span>
                        {expanded && <span className="flex-1 truncate text-[12.5px] font-semibold">{label}</span>}
                        {expanded && badge > 0 && (
                          <span className="flex-shrink-0 min-w-[18px] h-[18px] rounded-md flex items-center justify-center text-[9px] font-black px-1"
                            style={{
                              background: active ? 'rgba(255,255,255,0.22)' : path === '/agente-ia' ? 'rgba(6,182,212,0.20)' : 'rgba(225,29,72,0.22)',
                              color: active ? '#ffffff' : path === '/agente-ia' ? '#67e8f9' : '#fda4af',
                            }}>
                            {badge > 99 ? '99+' : badge}
                          </span>
                        )}
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* ── Pie: PWA + tarjeta de usuario ── */}
      <div className="flex-shrink-0 p-3 space-y-2">
        {expanded && <InstallPWA variant="button" />}
        {expanded ? (
          <div className="rounded-2xl p-3"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center gap-2.5 mb-2.5">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 font-black text-sm"
                style={{ background: 'linear-gradient(135deg, var(--zx-accent-text), var(--zx-lime))', color: '#fff', fontFamily: '"Space Grotesk", sans-serif' }}>
                {user?.name?.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold truncate leading-tight" style={{ color: '#ffffff' }}>{user?.name}</p>
                <p className="text-[9px] uppercase tracking-wider font-semibold mt-0.5" style={{ color: 'rgba(167,139,250,0.70)' }}>{user?.role}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={handleReRegisterPush}
                disabled={pushRegistering}
                title="Activar notificaciones push en este dispositivo"
                className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-bold transition-all"
                style={{ background: 'rgba(6,182,212,0.10)', border: '1px solid rgba(6,182,212,0.22)', color: '#67e8f9' }}>
                <Bell size={11} className={pushRegistering ? 'animate-pulse' : ''} /> Push
              </button>
              <button onClick={handleLogout} title="Cerrar sesión"
                className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-bold transition-all"
                style={{ background: 'rgba(225,29,72,0.10)', border: '1px solid rgba(225,29,72,0.22)', color: '#fda4af' }}>
                <LogOut size={11} /> Salir
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <button
              onClick={handleReRegisterPush}
              disabled={pushRegistering}
              title="Activar notificaciones push"
              className="p-2 rounded-xl transition-all"
              style={{ color: 'rgba(255,255,255,0.40)' }}>
              <Bell size={15} className={pushRegistering ? 'animate-pulse' : ''} />
            </button>
            <button onClick={handleLogout} title="Cerrar sesión"
              className="p-2 rounded-xl transition-all"
              style={{ color: 'rgba(255,255,255,0.40)' }}>
              <LogOut size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>

      {/* ── Menú HORIZONTAL (escritorio) ────────────────────────────────────
          Reemplaza a la barra lateral: las secciones viven en una fila arriba y
          cada una abre su submenú hacia abajo. El ancho que ocupaba la lateral
          (268 px) queda para el contenido, que es lo que se mira todo el día.

          El submenú esconde cosas, y hay dos que NO pueden esconderse: los
          leads nuevos y la cola del agente IA. Por eso la sección lleva un
          punto cuando alguno de sus ítems trae contador — si no, un "12 leads
          sin atender" se volvería invisible detrás de un desplegable. */}
      <nav className="hidden md:flex items-center gap-1 px-4 flex-shrink-0 relative z-50"
        style={{
          background: 'linear-gradient(90deg, #1a1038 0%, #130d26 55%, #0e0a1d 100%)',
          borderBottom: '1px solid rgba(53,122,14,0.18)',
          height: '56px',
        }}
        ref={navRef}
      >
        {/* Marca */}
        <Link to="/" className="flex items-center gap-2.5 pr-4 mr-1 flex-shrink-0">
          <ZelixLeadsLogo size={28} />
          <span className="font-black text-[15px] leading-none"
            style={{
              fontFamily: '"Space Grotesk", sans-serif', letterSpacing: '-0.03em',
              background: 'linear-gradient(90deg, #a78bfa 0%, var(--zx-lime) 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>
            ZelixLeads
          </span>
        </Link>

        {/* Secciones */}
        {NAV_SECTIONS.map(section => {
          const visible = section.items
            .filter(n => user && n.roles.includes(user.role))
            .filter(filterByPlan)
          if (!visible.length) return null

          const badgeDe = (path: string) => (path === '/agente-ia' ? agentCount : path === '/leads' ? leadsCount : 0)
          const badgeSeccion = visible.reduce((t: number, n: any) => t + badgeDe(n.path), 0)
          const activa = visible.some((n: any) =>
            location.pathname === n.path || (n.path !== '/' && location.pathname.startsWith(n.path)))
          const abierta = openSec === section.label

          // Una sección con un solo destino no necesita desplegable: sería un
          // clic de más para llegar siempre al mismo lugar.
          const unica = visible.length === 1 ? (visible[0] as any) : null
          const to = (n: any) => (n.tab ? `${n.path}?tab=${n.tab}` : n.path)

          const estilo = {
            height: '38px',
            padding: '0 14px',
            borderRadius: '10px',
            fontSize: '12.5px',
            fontWeight: 700,
            color: activa || abierta ? '#ffffff' : 'rgba(255,255,255,0.62)',
            background: abierta
              ? 'rgba(255,255,255,0.10)'
              : activa
                ? 'linear-gradient(90deg, var(--zx-accent-text) 0%, var(--zx-lime) 160%)'
                : 'transparent',
            boxShadow: activa && !abierta ? '0 4px 14px rgba(53,122,14,0.35)' : 'none',
            transition: 'all 0.15s',
          } as React.CSSProperties

          return (
            <div key={section.label} className="relative flex-shrink-0">
              {unica ? (
                <Link to={to(unica)} onClick={() => setOpenSec(null)}
                  className="flex items-center gap-2" style={estilo}>
                  <unica.icon size={15} />
                  <span>{unica.label}</span>
                  {badgeDe(unica.path) > 0 && (
                    <span className="min-w-[18px] h-[18px] rounded-md flex items-center justify-center text-[9px] font-black px-1"
                      style={{ background: 'rgba(255,255,255,0.22)', color: '#ffffff' }}>
                      {badgeDe(unica.path) > 99 ? '99+' : badgeDe(unica.path)}
                    </span>
                  )}
                </Link>
              ) : (
                <button onClick={() => setOpenSec(abierta ? null : section.label)}
                  className="flex items-center gap-2" style={estilo}>
                  <span>{section.label}</span>
                  {badgeSeccion > 0 && !abierta && (
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#e11d48' }} />
                  )}
                  <ChevronDown size={12} style={{ transform: abierta ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                </button>
              )}

              {/* Submenú: cae bajo su sección, como una pestaña abierta */}
              {abierta && !unica && (
                <div className="absolute left-0 top-full mt-1 py-1.5 rounded-xl overflow-hidden"
                  style={{
                    minWidth: '218px',
                    background: 'linear-gradient(180deg, #1a1038 0%, #130d26 100%)',
                    border: '1px solid rgba(53,122,14,0.22)',
                    boxShadow: '0 14px 38px rgba(10,6,20,0.55)',
                  }}>
                  {visible.map((n: any) => {
                    const { path, icon: Icon, label, sublabel, tab: navTab } = n
                    const searchTab = new URLSearchParams(location.search).get('tab')
                    const DEFAULT_TABS: Record<string, string> = { '/tecnico': 'negocios', '/admin': 'users' }
                    const active = navTab
                      ? location.pathname === path && (searchTab === navTab || (!location.search && DEFAULT_TABS[path] === navTab))
                      : location.pathname === path
                    const badge = badgeDe(path)
                    return (
                      <Link key={navTab ? `${path}-${navTab}` : path} to={to(n)}
                        onClick={() => setOpenSec(null)}
                        className="flex items-center gap-2.5 px-3 py-2 mx-1.5 rounded-lg transition-colors"
                        style={{
                          color: active ? '#ffffff' : 'rgba(255,255,255,0.62)',
                          background: active ? 'linear-gradient(90deg, var(--zx-accent-text) 0%, var(--zx-lime) 160%)' : 'transparent',
                        }}
                        onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)' }}
                        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                        <Icon size={15} className="flex-shrink-0" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[12.5px] font-semibold leading-tight truncate">{label}</span>
                          {sublabel && (
                            <span className="block text-[9.5px] leading-tight truncate" style={{ color: 'rgba(255,255,255,0.38)' }}>
                              {sublabel}
                            </span>
                          )}
                        </span>
                        {badge > 0 && (
                          <span className="flex-shrink-0 min-w-[18px] h-[18px] rounded-md flex items-center justify-center text-[9px] font-black px-1"
                            style={{
                              background: active ? 'rgba(255,255,255,0.22)' : path === '/agente-ia' ? 'rgba(6,182,212,0.20)' : 'rgba(225,29,72,0.22)',
                              color: active ? '#ffffff' : path === '/agente-ia' ? '#67e8f9' : '#fda4af',
                            }}>
                            {badge > 99 ? '99+' : badge}
                          </span>
                        )}
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {/* Buscador + acciones de cuenta (vivían en el pie de la lateral) */}
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          {/* Se muestra solo cuando el navegador ofrece instalar; vivía en el pie
              de la lateral y sin esto habría desaparecido del escritorio. */}
          <InstallPWA variant="button" />
          <button onClick={() => setShowSearch(true)}
            className="flex items-center gap-2 px-3 rounded-xl text-[11.5px] font-medium transition-all"
            style={{ height: '34px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.45)' }}>
            <Search size={13} />
            <span>Buscar…</span>
            <kbd className="text-[9px] px-1.5 py-0.5 rounded-md"
              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)' }}>⌘K</kbd>
          </button>
          <button onClick={handleReRegisterPush} disabled={pushRegistering}
            title="Activar notificaciones push en este dispositivo"
            className="p-2 rounded-xl transition-all" style={{ color: 'rgba(255,255,255,0.45)' }}>
            <Bell size={15} className={pushRegistering ? 'animate-pulse' : ''} />
          </button>
          <button onClick={handleLogout} title="Cerrar sesión"
            className="p-2 rounded-xl transition-all" style={{ color: 'rgba(255,255,255,0.45)' }}>
            <LogOut size={15} />
          </button>
        </div>
      </nav>

      {/* Drawer móvil */}
      {mobile && (
        <>
          <div className="fixed inset-0 z-40 md:hidden" style={{ background: 'rgba(10,6,20,0.70)', backdropFilter: 'blur(6px)' }}
            onClick={() => setMobile(false)} />
          <aside className="fixed left-0 top-0 h-full w-[280px] flex flex-col z-50 md:hidden overflow-hidden"
            style={{ background: 'linear-gradient(180deg, #1a1038 0%, #130d26 55%, #0e0a1d 100%)', borderRight: '1px solid rgba(53,122,14,0.14)' }}>
            <div className="absolute top-4 right-4 z-20">
              <button onClick={() => setMobile(false)}
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: 'rgba(255,255,255,0.45)' }}>
                <X size={16} />
              </button>
            </div>
            <div className="relative z-10 flex flex-col h-full">
              <SidebarContent expanded={true} />
            </div>
          </aside>
        </>
      )}

      {/* Zona principal */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Header transparente con título de página */}
        <header className="flex items-center gap-3 px-4 sm:px-6 flex-shrink-0"
          style={{ paddingTop: 'max(14px, env(safe-area-inset-top))', paddingBottom: '10px' }}>

          {/* Menú móvil */}
          <button onClick={() => setMobile(true)}
            className="md:hidden flex items-center justify-center rounded-2xl flex-shrink-0"
            style={{
              width: '42px', height: '42px',
              background: 'linear-gradient(135deg, var(--zx-accent-text), var(--zx-lime))',
              boxShadow: '0 4px 14px rgba(53,122,14,0.35)', color: '#fff',
            }}>
            <Menu size={19} />
          </button>

          {/* Título de página */}
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-black leading-tight truncate"
              style={{ color: 'var(--text)', fontFamily: '"Space Grotesk", sans-serif', letterSpacing: '-0.02em' }}>
              {pageTitle}
            </h1>
            {pageSub && (
              <p className="text-[10px] font-medium leading-tight truncate" style={{ color: 'var(--text-muted)' }}>
                {pageSub}
              </p>
            )}
          </div>

          {/* Acciones */}
          <div className="ml-auto flex items-center gap-2">

            {/* Búsqueda (móvil — en escritorio vive en el sidebar) */}
            <button onClick={() => setShowSearch(true)}
              className="md:hidden flex items-center justify-center rounded-xl"
              style={{ width: '38px', height: '38px', border: '1px solid rgba(28,22,51,0.12)', background: '#ffffff', color: 'rgba(28,22,51,0.45)' }}>
              <Search size={16} />
            </button>

            {/* Modo observador / edición (superadmin y subadmin) */}
            {isSupervisor && (
              <button
                onClick={handleToggleEdit}
                title={editUnlocked
                  ? 'Edición habilitada — clic para volver a solo lectura'
                  : 'Modo observador — clic para habilitar la edición'}
                className="flex items-center gap-1.5 rounded-full transition-all flex-shrink-0"
                style={{
                  padding: '0 14px',
                  fontSize: '11px',
                  fontWeight: 700,
                  height: '38px',
                  border: editUnlocked ? '1.5px solid rgba(225,29,72,0.30)' : '1.5px solid rgba(28,22,51,0.12)',
                  background: editUnlocked ? 'rgba(225,29,72,0.10)' : '#ffffff',
                  color: editUnlocked ? '#e11d48' : 'rgba(28,22,51,0.55)',
                  boxShadow: editUnlocked ? '0 0 12px rgba(225,29,72,0.15)' : '0 1px 3px rgba(28,22,51,0.06)',
                }}
              >
                {editUnlocked ? <Pencil size={14} /> : <Eye size={14} />}
                <span className="hidden md:inline">
                  {editUnlocked ? 'Edición activa' : 'Observador'}
                </span>
              </button>
            )}

            {/* Notificaciones */}
            <button onClick={() => setShowNotifPanel(v => !v)} className="relative flex-shrink-0"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '38px', height: '38px', borderRadius: '999px',
                background: showNotifPanel || unread > 0 ? 'rgba(225,29,72,0.10)' : '#ffffff',
                border: unread > 0 ? '1.5px solid rgba(225,29,72,0.25)' : '1px solid rgba(28,22,51,0.12)',
                color: unread > 0 ? '#e11d48' : 'rgba(28,22,51,0.45)',
                transition: 'all 0.18s',
                boxShadow: unread > 0 ? '0 0 12px rgba(225,29,72,0.15)' : '0 1px 3px rgba(28,22,51,0.06)',
              }}>
              <Bell size={18} strokeWidth={unread > 0 ? 2.2 : 1.8} className={unread > 0 ? 'bell-ring' : ''} />
              {unread > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[19px] h-[19px] rounded-full flex items-center justify-center text-[10px] font-black px-1"
                  style={{ background: '#e11d48', color: '#fff', boxShadow: '0 2px 8px rgba(225,29,72,0.5)', lineHeight: 1 }}>
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>

            {/* Chip de usuario */}
            <div className="hidden sm:flex items-center gap-2 pl-1 pr-3 py-1 rounded-full"
              style={{ background: '#ffffff', border: '1px solid rgba(28,22,51,0.12)', boxShadow: '0 1px 3px rgba(28,22,51,0.06)' }}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, var(--zx-accent-text), var(--zx-lime))' }}>
                <span style={{ color: '#fff', fontFamily: '"Space Grotesk", sans-serif', fontWeight: 700, fontSize: '0.7rem' }}>
                  {user?.name?.charAt(0)}
                </span>
              </div>
              <div className="leading-tight">
                <p className="text-[11px] font-bold" style={{ color: '#1c1633' }}>{user?.name}</p>
                <p className="text-[8px] uppercase tracking-wider font-semibold" style={{ color: 'rgba(53,122,14,0.70)' }}>{user?.role}</p>
              </div>
            </div>
          </div>
        </header>

        {/* Contenido */}
        <main className="light-zone flex-1 overflow-auto px-4 sm:px-6 pb-24 md:pb-6 pt-1">
          {children}
        </main>
      </div>

      {/* Dock móvil flotante */}
      <nav className="md:hidden fixed left-3 right-3 z-30 flex items-stretch rounded-3xl px-2 pt-1.5"
        style={{
          bottom: 'max(10px, env(safe-area-inset-bottom))',
          background: 'rgba(19,13,38,0.94)',
          border: '1px solid rgba(53,122,14,0.22)',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
          boxShadow: '0 10px 34px rgba(10,6,20,0.45)',
          paddingBottom: '6px',
        }}>
        {bottomNavItems.map(({ path, icon: Icon, label }) => {
          const active = location.pathname === path || (path !== '/' && location.pathname.startsWith(path))
          return (
            <Link key={path} to={path}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[9px] font-bold transition-colors"
              style={{ color: active ? '#ffffff' : 'rgba(255,255,255,0.42)' }}>
              <span className="flex items-center justify-center rounded-xl transition-all"
                style={{
                  width: '34px', height: '30px',
                  background: active ? 'linear-gradient(135deg, var(--zx-accent-text), var(--zx-lime))' : 'transparent',
                  boxShadow: active ? '0 4px 12px rgba(53,122,14,0.40)' : 'none',
                }}>
                <Icon size={16} />
              </span>
              <span className="leading-none">{label}</span>
            </Link>
          )
        })}
        <button onClick={handleLogout}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[9px] font-bold transition-colors"
          style={{ color: 'rgba(255,255,255,0.42)' }}>
          <span className="flex items-center justify-center rounded-xl" style={{ width: '34px', height: '30px' }}>
            <LogOut size={16} />
          </span>
          <span className="leading-none">Salir</span>
        </button>
      </nav>

      <LeadDrawerHost />
      {showSearch && <GlobalSearch onClose={() => setShowSearch(false)} />}
      {showNotifPanel && (
        <NotificationPanel
          onClose={() => setShowNotifPanel(false)}
          onCountChange={count => setUnread(count)}
        />
      )}
    </div>
  )
}
