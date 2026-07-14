import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getNotifications, markNotificationRead, markAllRead } from '../api'
import type { Notification } from '../types'
import {
  Bell, CheckCheck, RefreshCw, DollarSign, Calendar,
  AlertCircle, GitBranch, Users, X
} from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { parseDate } from '../utils/dates'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/auth'

function resolveAction(n: Notification, role: string): { label: string; to: string; state?: any } | null {
  const isVendedor = role === 'vendedor'
  const isDante = role === 'verificador'
  const canSeeLead = ['superadmin', 'subadmin', 'agendadora'].includes(role)
  const canSeePagos = ['verificador', 'superadmin', 'subadmin'].includes(role)
  switch (n.notification_type) {
    case 'calendario':
      if (isVendedor) return { label: 'Ver reunión', to: n.event_id ? `/agenda?event_id=${n.event_id}` : '/agenda' }
      if (isDante) return null
      return { label: 'Ver reunión', to: n.event_id ? `/calendario?event_id=${n.event_id}` : '/calendario' }
    case 'pago_confirmado': case 'pago': case 'pago_rechazado':
      if (canSeePagos) return { label: 'Ver pagos', to: '/pagos' }
      if (isVendedor) return { label: 'Mi pipeline', to: '/mi-pipeline' }
      if (canSeeLead && n.lead_id) return { label: 'Ver lead', to: '/leads', state: { openLeadId: n.lead_id } }
      return null
    case 'lead_nuevo':
      if (isDante) return { label: 'Ver pagos', to: '/pagos' }
      if (isVendedor) return { label: 'Mi pipeline', to: '/mi-pipeline' }
      if (canSeeLead && n.lead_id) return { label: 'Agente IA', to: '/agente-ia', state: { openLeadId: n.lead_id } }
      return null
    case 'etapa':
      if (isDante) return { label: 'Ver pagos', to: '/pagos' }
      if (isVendedor) return { label: 'Mi pipeline', to: '/mi-pipeline' }
      if (canSeeLead && n.lead_id) return { label: 'Ver lead', to: '/leads', state: { openLeadId: n.lead_id } }
      return null
    default:
      if (canSeeLead && n.lead_id) return { label: 'Ver lead', to: '/leads', state: { openLeadId: n.lead_id } }
      return null
  }
}

const TYPE_CONFIG: Record<string, { icon: any; color: string; bg: string; label: string }> = {
  calendario:      { icon: Calendar,    color: '#2563eb', bg: '#eff6ff', label: 'Calendario' },
  pago_confirmado: { icon: CheckCheck,  color: '#16a34a', bg: '#f0fdf4', label: 'Pago confirmado' },
  pago:            { icon: DollarSign,  color: '#0891b2', bg: '#ecfeff', label: 'Pago' },
  etapa:           { icon: GitBranch,   color: '#d97706', bg: '#fffbeb', label: 'Etapa' },
  lead_nuevo:      { icon: Users,       color: '#7c3aed', bg: '#faf5ff', label: 'Nuevo lead' },
  pago_rechazado:  { icon: AlertCircle, color: '#dc2626', bg: '#fef2f2', label: 'Pago rechazado' },
  general:         { icon: Bell,        color: '#475569', bg: '#faf9fd', label: 'Notificación' },
}
function getConfig(t: string) { return TYPE_CONFIG[t] ?? TYPE_CONFIG.general }

interface Props {
  onClose: () => void
  onCountChange?: (count: number) => void
}

export default function NotificationPanel({ onClose, onCountChange }: Props) {
  const { user } = useAuthStore()
  const role = user?.role ?? ''
  const navigate = useNavigate()
  const panelRef = useRef<HTMLDivElement>(null)

  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [unreadOnly, setUnreadOnly] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = await getNotifications(unreadOnly ? { unread_only: true } : {})
      setNotifications(data)
      onCountChange?.(data.filter((n: Notification) => !n.is_read).length)
    } catch {
      toast.error('Error cargando notificaciones')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [unreadOnly])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const handleRead = async (id: number) => {
    await markNotificationRead(id)
    setNotifications(prev => {
      const next = prev.map(n => n.id === id ? { ...n, is_read: true } : n)
      onCountChange?.(next.filter(n => !n.is_read).length)
      return next
    })
    window.dispatchEvent(new CustomEvent('notifications-updated'))
  }

  const handleReadAll = async () => {
    await markAllRead()
    setNotifications(prev => {
      const next = prev.map(n => ({ ...n, is_read: true }))
      onCountChange?.(0)
      return next
    })
    window.dispatchEvent(new CustomEvent('notifications-updated'))
    toast.success('Todas marcadas como leídas')
  }

  const handleAction = async (n: Notification, to: string, state?: any) => {
    if (!n.is_read) await markNotificationRead(n.id).catch(() => {})
    onClose()
    navigate(to, state ? { state } : undefined)
  }

  const unread = notifications.filter(n => !n.is_read).length

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />

      <div
        ref={panelRef}
        className="fixed z-50 flex flex-col"
        style={{
          top: '60px',
          right: '16px',
          width: '400px',
          maxHeight: '560px',
          background: '#ffffff',
          border: '1.5px solid #e6e1f0',
          borderRadius: '16px',
          boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
          animation: 'dropIn 0.18s ease',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1.5px solid #f1f5f9', background: '#faf9fd' }}>
          <Bell size={20} style={{ color: unread > 0 ? '#dc2626' : '#64748b' }} />
          <span className="font-bold flex-1" style={{ color: '#130d26', fontSize: '16px', fontFamily: '"Space Grotesk", sans-serif' }}>
            Notificaciones
          </span>
          {unread > 0 && (
            <span className="px-2.5 py-1 rounded-full text-xs font-bold"
              style={{ background: '#fef2f2', color: '#dc2626', border: '1.5px solid #fecaca' }}>
              {unread} sin leer
            </span>
          )}
          <div className="flex items-center gap-1 ml-1">
            {unread > 0 && (
              <button onClick={handleReadAll} title="Marcar todas como leídas"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#dcfce7'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#f0fdf4'}>
                <CheckCheck size={14} /> Leer todas
              </button>
            )}
            <button onClick={onClose}
              className="p-2 rounded-lg transition-all ml-1"
              style={{ color: '#94a3b8' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#1e293b'; (e.currentTarget as HTMLElement).style.background = '#f1f5f9' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#94a3b8'; (e.currentTarget as HTMLElement).style.background = '' }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-3 px-5 py-2.5 flex-shrink-0"
          style={{ borderBottom: '1px solid #f1f5f9', background: '#ffffff' }}>
          <button
            onClick={() => setUnreadOnly(v => !v)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
            style={{
              background: unreadOnly ? '#eff6ff' : '#faf9fd',
              border: `1.5px solid ${unreadOnly ? '#bfdbfe' : '#e6e1f0'}`,
              color: unreadOnly ? '#2563eb' : '#64748b',
            }}>
            Solo no leídas
          </button>
          <button onClick={load}
            className="p-2 rounded-lg transition-all ml-auto"
            style={{ color: '#94a3b8' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#1e293b'; (e.currentTarget as HTMLElement).style.background = '#f1f5f9' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#94a3b8'; (e.currentTarget as HTMLElement).style.background = '' }}>
            <RefreshCw size={14} />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto" style={{ overscrollBehavior: 'contain' }}>
          {loading ? (
            <div className="flex items-center justify-center h-36">
              <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: '#2563eb', borderTopColor: 'transparent' }} />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-44 gap-3">
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: '#faf9fd' }}>
                <Bell size={22} style={{ color: '#cbd5e1' }} />
              </div>
              <p className="font-semibold" style={{ color: '#64748b', fontSize: '15px' }}>Sin notificaciones</p>
              <p className="text-sm" style={{ color: '#94a3b8' }}>Todo está al día</p>
            </div>
          ) : (
            <div>
              {notifications.map((n, i) => {
                const cfg = getConfig(n.notification_type)
                const Icon = cfg.icon
                const action = resolveAction(n, role)
                return (
                  <div
                    key={n.id}
                    onClick={action ? () => handleAction(n, action.to, action.state) : undefined}
                    className="flex items-start gap-4 px-5 py-4 transition-all"
                    style={{
                      background: n.is_read ? '#ffffff' : '#fafbff',
                      borderBottom: i < notifications.length - 1 ? '1px solid #f1f5f9' : 'none',
                      borderLeft: !n.is_read ? `4px solid ${cfg.color}` : '4px solid transparent',
                      cursor: action ? 'pointer' : 'default',
                    }}
                    onMouseEnter={e => { if (action) (e.currentTarget as HTMLElement).style.background = '#faf9fd' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = n.is_read ? '#ffffff' : '#fafbff' }}
                  >
                    {/* Icon */}
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: cfg.bg }}>
                      <Icon size={20} style={{ color: cfg.color }} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-bold leading-snug" style={{ color: '#130d26', fontSize: '14px' }}>
                          {n.title}
                        </p>
                        {!n.is_read && (
                          <button
                            onClick={e => { e.stopPropagation(); handleRead(n.id) }}
                            className="flex-shrink-0 text-xs font-semibold transition-colors whitespace-nowrap px-2 py-0.5 rounded"
                            style={{ color: '#64748b', background: '#f1f5f9' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#16a34a'; (e.currentTarget as HTMLElement).style.background = '#f0fdf4' }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#64748b'; (e.currentTarget as HTMLElement).style.background = '#f1f5f9' }}>
                            ✓ Leer
                          </button>
                        )}
                      </div>
                      <p className="mt-1 leading-relaxed" style={{ color: '#475569', fontSize: '13px' }}>
                        {n.message}
                      </p>
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                          {format(parseDate(n.created_at), "d MMM yyyy · HH:mm", { locale: es })}
                        </span>
                        {action && (
                          <span className="font-semibold" style={{ color: cfg.color, fontSize: '12px' }}>
                            {action.label} →
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes dropIn {
          from { transform: translateY(-6px) scale(0.98); opacity: 0; }
          to   { transform: translateY(0) scale(1); opacity: 1; }
        }
      `}</style>
    </>
  )
}
