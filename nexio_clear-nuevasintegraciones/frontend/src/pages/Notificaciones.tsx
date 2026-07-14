import { useState, useEffect } from 'react'
import { getNotifications, markNotificationRead, markAllRead } from '../api'
import type { Notification } from '../types'
import {
  Bell, CheckCheck, RefreshCw, DollarSign, Calendar,
  AlertCircle, GitBranch, Users, ChevronRight
} from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { parseDate } from '../utils/dates'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/auth'

// Resolves where clicking a notification should navigate to.
// Each role has restricted route access — this must respect that:
//   vendedor  → /agenda, /mi-pipeline, /whatsapp
//   dante     → /pagos
//   agendadora, superadmin, subadmin → /leads/:id, /calendario, /pagos, etc.
function resolveAction(n: Notification, role: string): { label: string; to: string; state?: any } | null {
  const isVendedor = role === 'vendedor'
  const isDante = role === 'verificador'
  const canSeeLead = ['superadmin', 'subadmin', 'agendadora'].includes(role)
  const canSeePagos = ['verificador', 'superadmin', 'subadmin'].includes(role)

  switch (n.notification_type) {
    case 'calendario':
      if (isVendedor) {
        if (n.event_id) return { label: 'Ver reunión', to: `/agenda?event_id=${n.event_id}` }
        return { label: 'Ver agenda', to: '/agenda' }
      }
      if (isDante) return null
      if (n.event_id) return { label: 'Ver reunión', to: `/calendario?event_id=${n.event_id}` }
      return { label: 'Ver calendario', to: '/calendario' }

    case 'pago_confirmado':
    case 'pago':
    case 'pago_rechazado':
      if (canSeePagos) return { label: 'Ver pagos', to: '/pagos' }
      if (isVendedor) return { label: 'Ver mi pipeline', to: '/mi-pipeline' }
      if (canSeeLead && n.lead_id) return { label: 'Ver lead', to: '/leads', state: { openLeadId: n.lead_id } }
      return null

    case 'lead_nuevo':
      if (isDante) return { label: 'Ver pagos', to: '/pagos' }
      if (isVendedor) return { label: 'Ver mi pipeline', to: '/mi-pipeline' }
      if (canSeeLead && n.lead_id) return { label: 'Ver en Agente IA', to: '/agente-ia', state: { openLeadId: n.lead_id } }
      return null

    case 'etapa':
      if (isDante) return { label: 'Ver pagos', to: '/pagos' }
      if (isVendedor) return { label: 'Ver mi pipeline', to: '/mi-pipeline' }
      if (canSeeLead && n.lead_id) return { label: 'Ver lead', to: '/leads', state: { openLeadId: n.lead_id } }
      return null

    case 'general':
    default:
      if (canSeeLead && n.lead_id) return { label: 'Ver lead', to: '/leads', state: { openLeadId: n.lead_id } }
      return null
  }
}

const TYPE_CONFIG: Record<string, { icon: any; color: string; bg: string }> = {
  calendario:      { icon: Calendar,    color: 'text-neon',       bg: 'bg-neon/15' },
  pago_confirmado: { icon: CheckCheck,  color: 'text-lime',       bg: 'bg-lime/15' },
  pago:            { icon: DollarSign,  color: 'text-white/78',   bg: 'bg-surface-2' },
  etapa:           { icon: GitBranch,   color: 'text-warn',       bg: 'bg-warn/15' },
  lead_nuevo:      { icon: Users,       color: 'text-white/78',   bg: 'bg-surface-2' },
  pago_rechazado:  { icon: AlertCircle, color: 'text-danger',     bg: 'bg-danger/15' },
  general:         { icon: Bell,        color: 'text-white/62',   bg: 'bg-surface-2' },
}

function getConfig(type: string) {
  return TYPE_CONFIG[type] ?? TYPE_CONFIG.general
}

export default function Notificaciones() {
  const { user } = useAuthStore()
  const role = user?.role ?? ''
  const navigate = useNavigate()

  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [unreadOnly, setUnreadOnly] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      setNotifications(await getNotifications(unreadOnly ? { unread_only: true } : {}))
    } catch {
      toast.error('Error cargando notificaciones')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [unreadOnly])

  const handleRead = async (id: number) => {
    await markNotificationRead(id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
    window.dispatchEvent(new CustomEvent('notifications-updated'))
  }

  const handleReadAll = async () => {
    await markAllRead()
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    window.dispatchEvent(new CustomEvent('notifications-updated'))
    toast.success('Todas marcadas como leídas')
  }

  // Mark read then navigate
  const handleAction = async (n: Notification, to: string, state?: any) => {
    if (!n.is_read) await markNotificationRead(n.id).catch(() => {})
    navigate(to, state ? { state } : undefined)
  }

  const unread = notifications.filter(n => !n.is_read).length

  return (
    <div className="space-y-5 max-w-2xl mx-auto">

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Notificaciones</h1>
          {unread > 0 ? (
            <p className="text-sm text-white/78 font-medium mt-0.5">{unread} sin leer</p>
          ) : (
            <p className="text-white/62 text-sm mt-0.5">Al día con todo</p>
          )}
        </div>
        <div className="flex gap-2">
          {unread > 0 && (
            <button onClick={handleReadAll} className="btn-secondary text-sm">
              <CheckCheck size={15} /> Marcar todas
            </button>
          )}
          <button onClick={load} className="btn-secondary h-10 px-3">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* Filter */}
      <label className="flex items-center gap-2.5 cursor-pointer w-fit">
        <div className={`w-9 h-5 rounded-full transition-colors relative ${unreadOnly ? 'bg-surface-1' : 'bg-surface-3'}`}
          onClick={() => setUnreadOnly(v => !v)}>
          <div className={`absolute top-0.5 w-4 h-4 bg-surface-1 rounded-full shadow transition-transform ${unreadOnly ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </div>
        <span className="text-sm text-white/78 font-medium">Solo no leídas</span>
      </label>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-7 h-7 border-2 border-lime border-t-transparent rounded-full animate-spin" />
        </div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 bg-surface-2 rounded-xl flex items-center justify-center mx-auto mb-3">
            <Bell size={22} className="text-white/52" />
          </div>
          <p className="font-medium text-white/78">Sin notificaciones</p>
          <p className="text-sm text-white/52 mt-1">Todo está al día por aquí</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map(n => {
            const cfg = getConfig(n.notification_type)
            const Icon = cfg.icon
            const action = resolveAction(n, role)

            return (
              <div key={n.id}
                onClick={action ? () => handleAction(n, action.to, action.state) : undefined}
                className={`bg-surface-1 rounded-xl border transition-all ${
                  action ? 'cursor-pointer hover:bg-surface-0' : ''
                } ${
                  !n.is_read
                    ? 'border-l-4 border-l-lime border-white/[0.07] shadow-sm'
                    : 'border-white/[0.07]'
                }`}>
                <div className="flex gap-4 p-4">
                  <div className={`w-9 h-9 rounded-lg ${cfg.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                    <Icon size={16} className={cfg.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`font-semibold text-sm ${!n.is_read ? 'text-white' : 'text-white/85'}`}>
                          {n.title}
                        </p>
                        <p className="text-sm text-white/62 mt-0.5 leading-relaxed">{n.message}</p>
                      </div>
                      {!n.is_read && (
                        <button onClick={e => { e.stopPropagation(); handleRead(n.id) }}
                          className="flex-shrink-0 text-xs text-white/90 hover:text-white font-medium hover:underline whitespace-nowrap">
                          Marcar leída
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <p className="text-xs text-white/52">
                        {format(parseDate(n.created_at), "d MMM yyyy · HH:mm", { locale: es })}
                      </p>
                      {action && (
                        <span className="flex items-center gap-1 text-xs font-semibold text-white/85">
                          {action.label} <ChevronRight size={12} />
                        </span>
                      )}
                      {!n.is_read && (
                        <span className="w-2 h-2 rounded-full bg-surface-1 flex-shrink-0 ml-auto" />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
