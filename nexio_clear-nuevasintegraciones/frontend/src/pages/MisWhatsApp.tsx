import { useState, useEffect, useRef, useCallback } from 'react'
import {
  getMyWASessions, createMyWASession, startMyWASession,
  getMyWASessionStatus, getMyWASessionQR, renameMyWASession, deleteMyWASession,
  getMe,
} from '../api'
import toast from 'react-hot-toast'
import {
  Smartphone, Plus, RefreshCw, Trash2, Check, Wifi, WifiOff,
  QrCode, Loader2, X, Pencil, AlertTriangle, Info, KeyRound,
} from 'lucide-react'
import { useAuthStore } from '../store/auth'
import { getLimits } from '../utils/plans'
import { useConfirm } from '../components/ConfirmDialog'

type SessionStatus = 'not_started' | 'connecting' | 'qr_ready' | 'scanning' | 'connected' | 'disconnected' | 'logged_out' | 'service_unavailable'

interface WASession {
  id: number
  name: string
  phone_number: string
  is_active: boolean
  group_id: number | null
  group_name: string | null
  owner_user_id: number | null
  areas: { id: number; name: string }[]
  created_at: string | null
}

// ── QR Modal ─────────────────────────────────────────────────────────────────
function QRModal({ session, onClose, onConnected }: {
  session: WASession
  onClose: () => void
  onConnected: () => void
}) {
  const [status, setStatus] = useState<SessionStatus>('connecting')
  const [qrImage, setQrImage] = useState<string | null>(null)
  const [phone, setPhone] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const justConnectedRef = useRef(false)
  // Once scanning starts, keep spinner until connected or explicit failure
  const scanStartedRef = useRef(false)

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  const startFastPoll = useCallback((pollFn: () => void) => {
    stopPoll()
    pollRef.current = setInterval(pollFn, 1000)
  }, [stopPoll])

  const poll = useCallback(async () => {
    if (!localStorage.getItem('token')) { stopPoll(); return }
    try {
      const s = await getMyWASessionStatus(session.id)
      const st: SessionStatus = s.status
      setPhone(s.phone || null)

      if (st === 'scanning') {
        scanStartedRef.current = true
        setStatus('scanning')
        // Switch to fast poll so we catch connected ASAP
        startFastPoll(poll)
      } else if (st === 'connected') {
        stopPoll()
        // If QR was shown, briefly display scanning spinner before connected
        if (qrImage) {
          setStatus('scanning')
          setQrImage(null)
          await new Promise(r => setTimeout(r, 1500))
        }
        scanStartedRef.current = false
        setStatus('connected')
        if (justConnectedRef.current) {
          toast.success(`✅ WhatsApp conectado: +${s.phone || ''}`)
          justConnectedRef.current = false
        }
        onConnected()
      } else if (st === 'qr_ready') {
        if (!scanStartedRef.current) {
          setStatus(st)
          try {
            const img = await getMyWASessionQR(session.id)
            if (img.qr) {
              setQrImage(img.qr)
              // Poll faster once QR is displayed so we catch scan quickly
              startFastPoll(poll)
            }
          } catch {}
        }
        // If scan already started, keep showing scanning spinner (ignore qr_ready bounce)
      } else if (st === 'logged_out' || st === 'service_unavailable') {
        scanStartedRef.current = false
        setStatus(st)
        stopPoll()
      } else {
        // disconnected/not_started — only update if no QR is shown and scan hasn't started
        if (!scanStartedRef.current && !qrImage) setStatus(st)
      }
    } catch {}
  }, [session.id, stopPoll, startFastPoll, onConnected])

  useEffect(() => {
    const init = async () => {
      const s = await getMyWASessionStatus(session.id).catch(() => ({ status: 'not_started' }))
      if (s.status === 'connected') {
        setStatus('connected')
        setPhone(s.phone)
        return
      }
      justConnectedRef.current = true
      await startMyWASession(session.id).catch(() => {})
      pollRef.current = setInterval(poll, 3000)
      poll()
    }
    init()
    return stopPoll
  }, [])

  const handleRetry = async () => {
    scanStartedRef.current = false
    setStatus('connecting')
    setQrImage(null)
    stopPoll()
    justConnectedRef.current = true
    await startMyWASession(session.id).catch(() => {})
    pollRef.current = setInterval(poll, 3000)
    poll()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.80)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.09)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.25)' }}>
              <QrCode size={15} style={{ color: '#7c87f5' }} />
            </div>
            <div>
              <p className="text-sm font-bold" style={{ color: '#ffffff' }}>Vincular WhatsApp</p>
              <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{session.name}</p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
            style={{ color: 'rgba(255,255,255,0.45)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff'; (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.45)'; (e.currentTarget as HTMLElement).style.background = '' }}>
            <X size={15} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">

          {/* Status indicator */}
          <div className="flex items-center justify-center gap-2.5">
            {status === 'connected' ? (
              <>
                <div className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: '#22c55e' }} />
                <span className="text-sm font-semibold" style={{ color: '#22c55e' }}>Conectado{phone ? ` · +${phone}` : ''}</span>
              </>
            ) : status === 'scanning' ? (
              <>
                <Loader2 size={14} className="animate-spin" style={{ color: '#CCFF00' }} />
                <span className="text-sm font-semibold" style={{ color: '#CCFF00' }}>Conectando…</span>
              </>
            ) : status === 'qr_ready' ? (
              <>
                <div className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: '#25d366' }} />
                <span className="text-sm font-semibold" style={{ color: '#25d366' }}>Escanea el código QR</span>
              </>
            ) : status === 'connecting' ? (
              <>
                <Loader2 size={14} className="animate-spin" style={{ color: 'rgba(255,255,255,0.45)' }} />
                <span className="text-sm" style={{ color: 'rgba(255,255,255,0.62)' }}>Generando código QR…</span>
              </>
            ) : status === 'service_unavailable' ? (
              <>
                <AlertTriangle size={14} style={{ color: '#f59e0b' }} />
                <span className="text-sm" style={{ color: '#f59e0b' }}>Servicio no disponible</span>
              </>
            ) : qrImage ? (
              <>
                <div className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: '#25d366' }} />
                <span className="text-sm font-semibold" style={{ color: '#25d366' }}>Escanea el código QR</span>
              </>
            ) : (
              <>
                <Loader2 size={14} className="animate-spin" style={{ color: 'rgba(255,255,255,0.45)' }} />
                <span className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>Conectando…</span>
              </>
            )}
          </div>

          {/* QR Image / Scanning / Connected */}
          {status === 'connected' ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(34,197,94,0.15)', border: '2px solid rgba(34,197,94,0.40)' }}>
                <Check size={28} style={{ color: '#22c55e' }} />
              </div>
              <p className="text-sm text-center" style={{ color: 'rgba(255,255,255,0.70)' }}>
                WhatsApp vinculado correctamente.<br />Los mensajes llegarán al CRM.
              </p>
            </div>
          ) : status === 'scanning' ? (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="relative flex items-center justify-center">
                <div className="w-20 h-20 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(204,255,0,0.08)', border: '2px solid rgba(204,255,0,0.25)' }}>
                  <KeyRound size={32} style={{ color: '#CCFF00' }} />
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 size={76} className="animate-spin" style={{ color: 'rgba(204,255,0,0.30)' }} />
                </div>
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-semibold" style={{ color: '#CCFF00' }}>Conectando con WhatsApp…</p>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>Esto tarda unos segundos</p>
              </div>
            </div>
          ) : qrImage ? (
            <div className="flex flex-col items-center gap-3">
              <div className="p-2 rounded-xl" style={{ background: '#ffffff' }}>
                <img src={qrImage} alt="QR Code" className="w-48 h-48" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>Abre WhatsApp en tu celular</p>
                <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>Menú → Dispositivos vinculados → Vincular dispositivo</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-48">
              <div className="text-center space-y-3">
                {status === 'service_unavailable' ? (
                  <>
                    <AlertTriangle size={32} className="mx-auto" style={{ color: '#f59e0b' }} />
                    <p className="text-sm" style={{ color: 'rgba(255,255,255,0.52)' }}>El servicio QR no está activo.<br />Contacta al técnico.</p>
                    <button onClick={handleRetry}
                      className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                      style={{ border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.62)' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}>
                      Reintentar
                    </button>
                  </>
                ) : (
                  <>
                    <div className="relative flex items-center justify-center">
                      <Loader2 size={56} className="animate-spin" style={{ color: 'rgba(255,255,255,0.20)' }} />
                      <div className="absolute w-8 h-8 rounded-full flex items-center justify-center"
                        style={{ background: 'rgba(255,255,255,0.06)' }}>
                        <QrCode size={18} style={{ color: 'rgba(255,255,255,0.45)' }} />
                      </div>
                    </div>
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.40)' }}>Generando código QR…</p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Instructions */}
          {status === 'qr_ready' && (
            <div className="rounded-xl p-3 space-y-1.5"
              style={{ background: 'rgba(124,58,237,0.10)', border: '1px solid rgba(124,58,237,0.22)' }}>
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'rgba(147,168,255,0.90)' }}>Instrucciones</p>
              {[
                'Abre WhatsApp en tu teléfono',
                'Toca los 3 puntos (⋮) → Dispositivos vinculados',
                'Toca "Vincular un dispositivo"',
                'Apunta la cámara a este código QR',
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-[9px] font-bold mt-0.5 w-3 flex-shrink-0" style={{ color: 'rgba(147,168,255,0.70)' }}>{i + 1}.</span>
                  <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.65)' }}>{step}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 pb-5 flex gap-2.5">
          {status !== 'connected' && status !== 'service_unavailable' && status !== 'scanning' && (
            <button onClick={handleRetry}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors"
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.80)' }}>
              Nuevo QR
            </button>
          )}
          <button onClick={onClose}
            className={`py-2.5 rounded-xl text-sm font-bold transition-all ${status === 'connected' ? 'flex-1' : 'px-4'}`}
            style={status === 'connected'
              ? { background: '#7c3aed', color: '#ffffff' }
              : { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.70)' }}>
            {status === 'connected' ? 'Listo' : 'Cerrar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Session Card ──────────────────────────────────────────────────────────────
function SessionCard({ session, onQR, onDelete, onRename, onRefresh }: {
  session: WASession & { live_status?: string }
  onQR: () => void
  onDelete: () => void
  onRename: (name: string) => void
  onRefresh: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(session.name)

  const isConnected = session.is_active && session.phone_number !== 'pending'
  const statusLabel = isConnected ? `Conectado · ${session.phone_number}` : 'Sin conectar'

  const handleRename = async () => {
    if (!name.trim()) return
    await onRename(name.trim())
    setEditing(false)
  }

  return (
    <div className="rounded-2xl p-4 space-y-3"
      style={{ background: 'var(--surface)', border: `1px solid ${isConnected ? 'rgba(124,58,237,0.25)' : 'var(--border)'}`, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>

      {/* Top row */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: isConnected ? 'var(--primary-dim)' : 'var(--surface-3)', border: `1px solid ${isConnected ? 'rgba(124,58,237,0.25)' : 'var(--border)'}` }}>
          <Smartphone size={18} style={{ color: isConnected ? 'var(--primary)' : 'var(--text-muted)' }} />
        </div>
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setEditing(false) }}
                className="flex-1 text-sm font-semibold outline-none pb-0.5"
                style={{ background: 'transparent', borderBottom: '1px solid var(--border-2)', color: 'var(--text)' }}
              />
              <button onClick={handleRename} style={{color:'var(--primary)'}}><Check size={14} /></button>
              <button onClick={() => setEditing(false)} style={{color:'var(--text-muted)'}}><X size={14} /></button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold truncate" style={{color:'var(--text)'}}>{session.name}</p>
              <button onClick={() => setEditing(true)} className="transition-colors flex-shrink-0" style={{color:'var(--text-muted)'}}>
                <Pencil size={11} />
              </button>
            </div>
          )}
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: isConnected ? '#22c55e' : 'var(--text-muted)' }} />
            <span className="text-[11px]" style={{ color: isConnected ? '#16a34a' : 'var(--text-muted)' }}>{statusLabel}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onRefresh}
            className="p-1.5 rounded-lg transition-colors" style={{color:'var(--text-muted)'}}>
            <RefreshCw size={13} />
          </button>
          <button onClick={onDelete}
            className="p-1.5 rounded-lg transition-colors" style={{color:'var(--text-muted)'}}
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.color='var(--danger)';(e.currentTarget as HTMLElement).style.background='var(--danger-dim)'}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.color='var(--text-muted)';(e.currentTarget as HTMLElement).style.background=''}}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Areas */}
      {session.areas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {session.areas.map(a => (
            <span key={a.id} className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: 'var(--secondary-dim)', color: 'var(--secondary)', border: '1px solid rgba(6,182,212,0.20)' }}>
              {a.name}
            </span>
          ))}
        </div>
      )}

      {/* Action button */}
      <button onClick={onQR}
        className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all"
        style={isConnected
          ? { background: 'var(--primary-dim)', border: '1px solid rgba(124,58,237,0.25)', color: 'var(--primary)' }
          : { background: 'var(--primary)', color: '#ffffff', boxShadow: '0 4px 16px rgba(124,58,237,0.25)' }
        }>
        {isConnected ? <><Wifi size={14} /> Reconectar / Ver estado</> : <><QrCode size={14} /> Vincular con QR</>}
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function MisWhatsApp() {
  const { user, refreshUser } = useAuthStore()
  const { confirm, dialog: confirmDialog } = useConfirm()
  const [sessions, setSessions] = useState<WASession[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [qrSession, setQrSession] = useState<WASession | null>(null)

  const MAX = (() => {
    const limit = getLimits(user?.negocio_plan ?? 'basico').max_wa_numbers
    return limit === -1 ? Infinity : limit
  })()
  const maxLabel = MAX === Infinity ? 'ilimitados' : MAX

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setSessions(await getMyWASessions())
    } catch { toast.error('Error cargando sesiones') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    refreshUser().then(() => load())
  }, [])

  // Background poll — auto-delete sessions that were unlinked from the phone
  useEffect(() => {
    const checkSessions = async () => {
      const current = await getMyWASessions().catch(() => null)
      if (!current) return
      for (const s of current) {
        if (!s.is_active) continue
        try {
          const status = await getMyWASessionStatus(s.id)
          if (status.status === 'logged_out') {
            await deleteMyWASession(s.id).catch(() => {})
            setSessions(prev => prev.filter(x => x.id !== s.id))
            toast(`📵 ${s.name} fue desvinculado desde el celular y eliminado`, { icon: '⚠️' })
          }
        } catch {}
      }
    }
    const id = setInterval(checkSessions, 30000)
    return () => clearInterval(id)
  }, [])

  const handleCreate = async () => {
    setCreating(true)
    try {
      const newSession = await createMyWASession()
      setSessions(prev => [newSession, ...prev])
      setQrSession(newSession)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Error al crear sesión')
    } finally { setCreating(false) }
  }

  const handleDelete = async (s: WASession) => {
    const ok = await confirm(`Se desconectará el número "${s.name}".`, { title: 'Eliminar sesión WhatsApp', confirmLabel: 'Eliminar' })
    if (!ok) return
    try {
      await deleteMyWASession(s.id)
      setSessions(prev => prev.filter(x => x.id !== s.id))
      toast.success('Sesión eliminada')
    } catch { toast.error('Error al eliminar') }
  }

  const handleRename = async (s: WASession, name: string) => {
    try {
      const updated = await renameMyWASession(s.id, name)
      setSessions(prev => prev.map(x => x.id === s.id ? { ...x, ...updated } : x))
    } catch { toast.error('Error al renombrar') }
  }

  const connectedCount = sessions.filter(s => s.is_active && s.phone_number !== 'pending').length

  return (
    <div className="space-y-5 max-w-2xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Mis WhatsApp</h1>
          <p className="text-xs text-white/45 mt-0.5">
            {connectedCount}/{MAX === Infinity ? '∞' : MAX} números conectados
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="w-9 h-9 flex items-center justify-center border border-white/10 rounded-xl bg-surface-1 text-white/45 hover:text-white/78 transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          {sessions.length < MAX && (
            <button onClick={handleCreate} disabled={creating} className="btn-primary text-sm px-4 py-2">
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Agregar número
            </button>
          )}
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-xl px-4 py-3 text-xs"
        style={{ background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.16)', color: 'rgba(52,81,199,0.90)' }}>
        <Info size={14} className="flex-shrink-0 mt-0.5" style={{ color: '#7c3aed' }} />
        <p>
          Vincula hasta <strong>{maxLabel === 'ilimitados' ? 'números ilimitados' : `${maxLabel} número${maxLabel === 1 ? '' : 's'} de WhatsApp`}</strong> con tu cuenta.
          Los mensajes entrantes aparecerán automáticamente en el chat de cada lead.
          Un mismo número puede atender varios leads en distintas áreas.
        </p>
      </div>

      {/* Sessions */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-white/25" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 rounded-2xl space-y-4"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1.5px dashed rgba(255,255,255,0.08)' }}>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(124,58,237,0.10)', border: '1px solid rgba(124,58,237,0.22)' }}>
            <Smartphone size={24} style={{ color: 'var(--primary)' }} />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-white/70">Sin números vinculados</p>
            <p className="text-xs text-white/38 mt-1">Agrega tu número de WhatsApp para recibir mensajes en el CRM</p>
          </div>
          <button onClick={handleCreate} disabled={creating} className="btn-primary text-sm px-5 py-2.5">
            {creating ? <Loader2 size={14} className="animate-spin" /> : <QrCode size={14} />}
            Vincular primer número
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map(s => (
            <SessionCard
              key={s.id}
              session={s}
              onQR={() => setQrSession(s)}
              onDelete={() => handleDelete(s)}
              onRename={name => handleRename(s, name)}
              onRefresh={load}
            />
          ))}
          {sessions.length >= MAX && MAX !== Infinity && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs"
              style={{ background: 'rgba(255,166,0,0.07)', border: '1px solid rgba(255,166,0,0.20)', color: 'rgba(255,166,0,0.80)' }}>
              <AlertTriangle size={13} className="flex-shrink-0" />
              Límite de {MAX} número{MAX === 1 ? '' : 's'} alcanzado según tu plan. Elimina uno para agregar otro.
            </div>
          )}
        </div>
      )}

      {/* QR Modal */}
      {qrSession && (
        <QRModal
          session={qrSession}
          onClose={() => setQrSession(null)}
          onConnected={() => { setQrSession(null); load() }}
        />
      )}
      {confirmDialog}
    </div>
  )
}
