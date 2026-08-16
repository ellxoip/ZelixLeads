import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  getWhatsAppMessages, sendWhatsAppMessage, sendWhatsAppMedia, markMessagesRead, avisoEnvioWhatsApp,
  deleteWhatsAppMessage, editWhatsAppMessage,
  getContactAgentState, setContactAgentState, updateContact, updateLead,
} from '../../api'
import { useRealtime } from '../../contexts/RealtimeContext'
import type { Lead } from '../../types'
import {
  Bot, Check, CheckCheck, Clipboard, Clock, FileText, MessageSquare,
  Mic, Paperclip, Pencil, RefreshCw, Send, Square, Trash2, X as XIcon,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { format, isToday, isYesterday } from 'date-fns'
import { es } from 'date-fns/locale'
import { parseDate as parseAsUTC } from '../../utils/dates'
import { rutOnChange } from '../../utils/rut'
import ChatCopilotWidget from './ChatCopilotWidget'

// ── Chat Tab ─────────────────────────────────────────────
/* ── Fill Contact from Chat Modal ────────────────────────── */
function FillContactSplit({ messages, lead, onSave, onClose }: {
  messages: any[]
  lead: Lead
  onSave: (contactData: any, leadData: any) => Promise<void>
  onClose: () => void
}) {
  const endRef = useRef<HTMLDivElement>(null)
  const [saving, setSaving] = useState(false)

  const [contactForm, setContactForm] = useState({
    name: lead.contact?.name ?? '',
    phone: lead.contact?.phone ?? '',
    email: lead.contact?.email ?? '',
    rut_persona: lead.contact?.rut_persona ?? '',
    rut_empresa: lead.contact?.rut_empresa ?? '',
    razon_social: lead.contact?.razon_social ?? '',
    city: lead.contact?.city ?? '',
  })
  const [leadForm, setLeadForm] = useState({
    notes: lead.notes ?? '',
    source: lead.source ?? 'whatsapp',
  })

  const setC = (k: string, v: string) => setContactForm(f => ({ ...f, [k]: v }))
  const setL = (k: string, v: string) => setLeadForm(f => ({ ...f, [k]: v }))

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'auto' }) }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(contactForm, leadForm)
      onClose()
    } catch { toast.error('Error guardando') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-stretch p-2 sm:p-5">
      <div className="bg-surface-1 rounded-2xl shadow-2xl w-full max-w-5xl mx-auto flex overflow-hidden border border-white/[0.07]">

        {/* LEFT — form */}
        <div className="w-full sm:w-[440px] flex-shrink-0 flex flex-col border-r border-white/[0.07]">
          <div className="px-4 sm:px-6 py-4 border-b border-white/[0.07] flex items-center justify-between flex-shrink-0">
            <div>
              <h3 className="font-bold text-white/90">Completar datos del lead</h3>
              <p className="text-xs text-white/45 mt-0.5 hidden sm:block">Rellena mirando el chat a la derecha</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-surface-2 rounded-xl text-white/45"><XIcon size={18} /></button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
            <p className="text-[10px] font-bold text-white/38 uppercase tracking-widest">Contacto</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="input-label">Nombre *</label>
                <input className="input" value={contactForm.name} onChange={e => setC('name', e.target.value)} placeholder="Nombre completo" />
              </div>
              <div>
                <label className="input-label">Teléfono *</label>
                <input className="input" value={contactForm.phone} onChange={e => setC('phone', e.target.value)} placeholder="+56 9 1234 5678" />
              </div>
              <div>
                <label className="input-label">Correo</label>
                <input className="input" type="email" value={contactForm.email} onChange={e => setC('email', e.target.value)} placeholder="correo@email.com" />
              </div>
              <div>
                <label className="input-label">Ciudad</label>
                <input className="input" value={contactForm.city} onChange={e => setC('city', e.target.value)} placeholder="Santiago" />
              </div>
              <div>
                <label className="input-label">RUT Persona</label>
                <input className="input" value={contactForm.rut_persona} onChange={e => setC('rut_persona', rutOnChange(e.target.value))} placeholder="12.345.678-9" />
              </div>
              <div>
                <label className="input-label">RUT Empresa</label>
                <input className="input" value={contactForm.rut_empresa} onChange={e => setC('rut_empresa', rutOnChange(e.target.value))} placeholder="76.000.000-0" />
              </div>
              <div className="col-span-2">
                <label className="input-label">Razón Social</label>
                <input className="input" value={contactForm.razon_social} onChange={e => setC('razon_social', e.target.value)} placeholder="Nombre empresa" />
              </div>
            </div>

            <p className="text-[10px] font-bold text-white/38 uppercase tracking-widest pt-2">Lead</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="input-label">Notas internas</label>
                <textarea className="input" rows={2} value={leadForm.notes} onChange={e => setL('notes', e.target.value)} placeholder="Observaciones adicionales..." />
              </div>
              <div className="col-span-2">
                <label className="input-label">Fuente</label>
                <select className="input" value={leadForm.source} onChange={e => setL('source', e.target.value)}>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="referido">Referido</option>
                  <option value="facebook">Facebook</option>
                  <option value="instagram">Instagram</option>
                  <option value="web">Sitio Web</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
            </div>
          </div>

          <div className="px-4 sm:px-6 py-4 border-t border-white/[0.07] flex gap-3 flex-shrink-0">
            <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 btn-primary disabled:opacity-40">
              {saving ? 'Guardando...' : 'Guardar datos'}
            </button>
          </div>
        </div>

        {/* RIGHT — chat (read-only), dark WA style — hidden on mobile */}
        <div className="hidden sm:flex flex-1 flex-col min-w-0">
          {/* Header */}
          <div className="px-4 py-2.5 flex-shrink-0 border-b border-white/[0.07] flex items-center gap-3 bg-surface-0">
            {lead.contact?.avatar_url ? (
              <img
                src={lead.contact.avatar_url}
                alt={lead.contact?.name}
                className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                onError={e => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                  (e.currentTarget.nextElementSibling as HTMLElement).style.display = 'flex'
                }}
              />
            ) : null}
            <div className="w-9 h-9 rounded-full bg-surface-3 flex items-center justify-center flex-shrink-0"
              style={{ display: lead.contact?.avatar_url ? 'none' : 'flex' }}>
              <span className="font-bold text-sm text-white/62">
                {(lead.contact?.name ?? 'C').charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <p className="text-sm font-medium text-white/90">{lead.contact?.name ?? 'Cliente'}</p>
              {lead.contact?.phone && <p className="text-[11px] text-white/45">{lead.contact.phone}</p>}
            </div>
          </div>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto py-3 px-[3%] space-y-0.5 wa-chat-bg">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full" style={{ color: 'rgba(28,22,51,0.38)' }}>
                <MessageSquare size={26} className="mb-2 opacity-40" />
                <p className="text-xs">Sin mensajes aún</p>
              </div>
            ) : messages.filter((m: any) => m.content || m.media_url).map((m: any) => {
              const out = m.direction === 'out'
              const bubbleBg = out ? 'var(--zx-accent-text)' : '#ffffff'
              const bubbleBorder = out ? 'rgba(53,122,14,0.30)' : 'rgba(28,22,51,0.10)'
              return (
                <div key={m.id} className={`flex ${out ? 'justify-end' : 'justify-start'} mb-0.5`}>
                  <div className="relative max-w-[80%]"
                    style={{ marginRight: out ? 8 : 0, marginLeft: out ? 0 : 8 }}>
                    {/* Bubble */}
                    <div className={out ? 'chat-bubble-out' : ''} style={{
                      backgroundColor: bubbleBg,
                      border: `1px solid ${bubbleBorder}`,
                      borderRadius: out ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                      padding: '6px 10px 8px 10px',
                      boxShadow: out ? '0 1px 3px rgba(53,122,14,0.20)' : '0 1px 3px rgba(0,0,0,0.06)',
                      position: 'relative', zIndex: 1,
                      color: out ? '#ffffff' : 'var(--text)',
                    }}>
                      <ChatMsgContent m={m} out={out} />
                      <div className="flex items-center justify-end gap-1 mt-1" style={{ minHeight: 14 }}>
                        <span style={{ color: out ? 'rgba(255,255,255,0.70)' : 'rgba(28,22,51,0.40)', fontSize: 11, whiteSpace: 'nowrap' }}>
                          {format(parseAsUTC(m.created_at), 'HH:mm', { locale: es })}
                        </span>
                        {out && <WaTicksChat status={m.status} />}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={endRef} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Dark Audio Player ─────────────────────────────────────
function DarkAudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)

  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (playing) { a.pause() } else { a.play() }
    setPlaying(!playing)
  }

  const fmtTime = (s: number) => {
    if (!isFinite(s) || isNaN(s)) return '0:00'
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current
    if (!a || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    a.currentTime = ratio * duration
  }

  return (
    <div className="flex items-center gap-2.5 py-1" style={{ minWidth: 200, maxWidth: 240 }}>
      <audio ref={audioRef} src={src}
        onTimeUpdate={e => {
          const a = e.currentTarget
          setCurrentTime(a.currentTime)
          setProgress(a.duration ? (a.currentTime / a.duration) * 100 : 0)
        }}
        onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
        onEnded={() => { setPlaying(false); setProgress(0); setCurrentTime(0) }}
      />
      {/* Play/Pause */}
      <button onClick={toggle}
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all"
        style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.25)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.15)'}>
        {playing
          ? <Square size={12} fill="white" />
          : <svg width="12" height="12" viewBox="0 0 12 12" fill="white"><polygon points="2,1 11,6 2,11" /></svg>
        }
      </button>
      {/* Waveform / progress bar */}
      <div className="flex-1 flex flex-col gap-1">
        <div className="relative h-1.5 rounded-full cursor-pointer overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.15)' }}
          onClick={handleSeek}>
          <div className="absolute left-0 top-0 h-full rounded-full transition-all"
            style={{ width: `${progress}%`, background: 'rgba(255,255,255,0.75)' }} />
        </div>
        <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {playing || currentTime > 0 ? fmtTime(currentTime) : fmtTime(duration)}
        </span>
      </div>
      {/* Mic icon */}
      <Mic size={14} style={{ color: 'rgba(255,255,255,0.45)', flexShrink: 0 }} />
    </div>
  )
}

// Detecta URLs (http/https) en texto plano y las renderiza como <a>
// clickeables. Mantiene el resto del texto intacto (saltos de línea
// los preserva `whitespace-pre-wrap` del contenedor). Excluye signos
// de puntuación finales comunes (.,;:!?) del href.
const URL_REGEX = /(https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]])/g
function renderLinkified(text: string, linkClass: string): React.ReactNode[] {
  if (!text) return []
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  URL_REGEX.lastIndex = 0
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    const href = match[0]
    parts.push(
      <a
        key={`url-${match.index}`}
        href={href}
        target="_blank"
        rel="noreferrer"
        className={linkClass}
        onClick={(e) => e.stopPropagation()}
      >
        {href}
      </a>,
    )
    lastIndex = match.index + href.length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

// El color del texto se HEREDA de la burbuja (blanco en salientes azules,
// var(--text) en entrantes blancas) — nunca hardcodear text-white aquí: sobre
// la burbuja entrante blanca el mensaje quedaba invisible.
function ChatMsgContent({ m, out = false }: { m: any; out?: boolean }) {
  const type = m.message_type || 'text'
  const url = m.media_url || null
  if (!m.content && !url) return null
  if (url && (type === 'image' || /\.(jpg|jpeg|png|webp|gif)$/i.test(url))) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img src={url} alt="imagen" className="rounded-xl max-w-[220px] max-h-[220px] object-cover cursor-zoom-in" />
        {m.content && m.content !== '[Imagen]' && !/\.(jpg|jpeg|png|gif|webp|mp4|webm|mov|ogg|mp3|m4a|aac|opus|pdf|doc|docx|xls|xlsx)$/i.test(m.content) && (
          <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap">{m.content}</p>
        )}
      </a>
    )
  }
  if (url && (type === 'audio' || /\.(ogg|mp3|m4a|aac|opus|webm)$/i.test(url))) {
    return <DarkAudioPlayer src={url} />
  }
  if (url && (type === 'video' || /\.(mp4|webm|mov)$/i.test(url))) {
    return <video controls src={url} className="rounded-xl max-w-[220px] max-h-[180px]" />
  }
  if (url && type === 'document') {
    const fname = url.split('/').pop() || 'archivo'
    return (
      <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm underline underline-offset-2">
        <FileText size={13} className="flex-shrink-0" />
        <span className="truncate max-w-[180px]">{m.content || fname}</span>
      </a>
    )
  }
  return (
    <p className="leading-relaxed whitespace-pre-wrap text-[13px]" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
      {renderLinkified(m.content, out
        ? 'underline underline-offset-2 text-brand-300 hover:text-brand-200'
        : 'underline underline-offset-2 text-[var(--zx-accent-text)] hover:opacity-80')}
    </p>
  )
}

// Used in FillContactSplit (blue bg → white ticks)
const TICK_LABEL: Record<string, string> = { logged: 'Pendiente', sent: 'Enviado', delivered: 'Entregado', read: 'Leído', failed: 'Error' }
function WaTicksChat({ status }: { status: string }) {
  const label = TICK_LABEL[status] ?? 'Enviado'
  if (status === 'failed') return <span title={label} className="text-danger font-bold" style={{ fontSize: 13, lineHeight: 1 }}>!</span>
  if (status === 'logged') return <span title={label}><Clock size={13} color="rgba(255,255,255,0.55)" /></span>
  if (status === 'read') return <span title={label}><CheckCheck size={16} color="#53bdeb" strokeWidth={2.5} /></span>
  if (status === 'delivered') return <span title={label}><CheckCheck size={16} color="rgba(255,255,255,0.75)" strokeWidth={2.5} /></span>
  return <span title={label}><Check size={16} color="rgba(255,255,255,0.75)" strokeWidth={2.5} /></span>
}

// Used in ChatTab (WA green/white bg → proper WA colors)
function WaTicks({ status }: { status: string }) {
  const label = TICK_LABEL[status] ?? 'Enviado'
  if (status === 'failed') return <span title={label} style={{ color: '#ef4444', fontWeight: 'bold', fontSize: 13, lineHeight: 1 }}>!</span>
  if (status === 'logged') return <span title={label}><Clock size={13} color="#8696a0" /></span>
  if (status === 'read') return <span title={label}><CheckCheck size={16} color="#53bdeb" strokeWidth={2.5} /></span>
  if (status === 'delivered') return <span title={label}><CheckCheck size={16} color="#8696a0" strokeWidth={2.5} /></span>
  return <span title={label}><Check size={16} color="#8696a0" strokeWidth={2.5} /></span>
}

// Audio player for WhatsApp-style light bubbles
function WaAudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)

  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    playing ? a.pause() : a.play()
    setPlaying(!playing)
  }
  const fmtTime = (s: number) => {
    if (!isFinite(s) || isNaN(s)) return '0:00'
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`
  }
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current
    if (!a || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    a.currentTime = ((e.clientX - rect.left) / rect.width) * duration
  }

  return (
    <div className="flex items-center gap-2.5 py-1" style={{ minWidth: 200, maxWidth: 240 }}>
      <audio ref={audioRef} src={src}
        onTimeUpdate={e => {
          const a = e.currentTarget
          setCurrentTime(a.currentTime)
          setProgress(a.duration ? (a.currentTime / a.duration) * 100 : 0)
        }}
        onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
        onEnded={() => { setPlaying(false); setProgress(0); setCurrentTime(0) }}
      />
      <button onClick={toggle}
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: '#25d366', color: '#fff' }}>
        {playing
          ? <Square size={12} fill="white" />
          : <svg width="12" height="12" viewBox="0 0 12 12" fill="white"><polygon points="2,1 11,6 2,11" /></svg>
        }
      </button>
      <div className="flex-1 flex flex-col gap-1">
        <div className="relative h-1.5 rounded-full cursor-pointer overflow-hidden"
          style={{ background: 'rgba(17,27,33,0.15)' }} onClick={handleSeek}>
          <div className="absolute left-0 top-0 h-full rounded-full"
            style={{ width: `${progress}%`, background: '#25d366' }} />
        </div>
        <span style={{ fontSize: 10, color: 'rgba(17,27,33,0.5)' }}>
          {playing || currentTime > 0 ? fmtTime(currentTime) : fmtTime(duration)}
        </span>
      </div>
      <Mic size={14} style={{ color: 'rgba(17,27,33,0.4)', flexShrink: 0 }} />
    </div>
  )
}

// Message content for WA-style light bubbles (dark text)
function WaChatMsgContent({ m }: { m: any }) {
  const type = m.message_type || 'text'
  const url = m.media_url || null
  if (!m.content && !url) return null
  if (url && (type === 'image' || /\.(jpg|jpeg|png|webp|gif)$/i.test(url))) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img src={url} alt="imagen" className="rounded-xl max-w-[220px] max-h-[220px] object-cover cursor-zoom-in" />
        {m.content && m.content !== '[Imagen]' && !/\.(jpg|jpeg|png|gif|webp|mp4|webm|mov|ogg|mp3|m4a|aac|opus|pdf|doc|docx|xls|xlsx)$/i.test(m.content) && (
          <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: '#111b21' }}>{m.content}</p>
        )}
      </a>
    )
  }
  if (url && (type === 'audio' || /\.(ogg|mp3|m4a|aac|opus|webm)$/i.test(url))) {
    return <WaAudioPlayer src={url} />
  }
  if (url && (type === 'video' || /\.(mp4|webm|mov)$/i.test(url))) {
    return <video controls src={url} className="rounded-xl max-w-[220px] max-h-[180px]" />
  }
  if (url && type === 'document') {
    const fname = url.split('/').pop() || 'archivo'
    return (
      <a href={url} target="_blank" rel="noreferrer"
        className="flex items-center gap-2 text-sm underline underline-offset-2"
        style={{ color: '#111b21' }}>
        <FileText size={13} className="flex-shrink-0" />
        <span className="truncate max-w-[180px]">{m.content || fname}</span>
      </a>
    )
  }
  return (
    <p className="leading-relaxed whitespace-pre-wrap text-[13px]"
      style={{ color: '#111b21', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
      {renderLinkified(m.content, 'underline underline-offset-2 text-[#027eb5] hover:text-[#015d87]')}
    </p>
  )
}

function formatRecSecs(s: number) {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

function ChatTab({ lead, configs, onLeadUpdate, onClearUnread }: { lead: Lead; configs: any[]; onLeadUpdate: (l: Lead) => void; onClearUnread?: (contactId: number) => void }) {
  const [messages, setMessages] = useState<any[]>([])
  const [msgText, setMsgText] = useState('')
  const [sending, setSending] = useState(false)
  const [showFill, setShowFill] = useState(false)
  const [mediaFile, setMediaFile] = useState<File | null>(null)
  const [mediaPreview, setMediaPreview] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordSecs, setRecordSecs] = useState(0)
  const [micBusy, setMicBusy] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; msg: any } | null>(null)
  const [editingMsg, setEditingMsg] = useState<any | null>(null)
  const [editText, setEditText] = useState('')
  const [loadingMsgs, setLoadingMsgs] = useState(true)
  const [selectedConfigId, setSelectedConfigId] = useState<string>('')
  const [agentInfo, setAgentInfo] = useState<{ agent: { id: number; name: string } | null; state: string | null } | null>(null)

  const endRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Phone configs for this area (many-to-many junction table, most reliable source)
  const areaConfigs: any[] = (lead.area?.phone_configs ?? []).filter((c: any) => c.is_active !== false)

  // Auto-select when lead/area changes
  useEffect(() => {
    const first = areaConfigs[0]?.id?.toString()
      ?? (lead.area?.whatsapp_config_id != null ? lead.area.whatsapp_config_id.toString() : null)
      ?? configs.find((c: any) => c.group_id === lead.group_id)?.id?.toString()
      ?? configs[0]?.id?.toString()
      ?? ''
    setSelectedConfigId(first)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.area?.id])

  const activeConfig = areaConfigs.find((c: any) => c.id.toString() === selectedConfigId)
    ?? configs.find((c: any) => c.id.toString() === selectedConfigId)
    ?? areaConfigs[0]
    ?? configs.find((c: any) => c.id === lead.area?.whatsapp_config_id)
    ?? configs.find((c: any) => c.group_id === lead.group_id)
    ?? configs[0]
  const configId = activeConfig?.id?.toString() ?? ''

  const loadMessages = async () => {
    try {
      const data = await getWhatsAppMessages({ contact_id: lead.contact_id })
      setMessages(data.slice().reverse())
    } catch { /* silent */ }
    finally { setLoadingMsgs(false) }
  }

  useEffect(() => {
    setLoadingMsgs(true)
    loadMessages()
    markMessagesRead(lead.contact_id)
      .then(() => onClearUnread?.(lead.contact_id))
      .catch(() => { })

    const contactId = lead.contact_id

    pollRef.current = setInterval(() => {
      getWhatsAppMessages({ contact_id: contactId })
        .then(data => setMessages(data.slice().reverse()))
        .catch(() => { })
    }, 8000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
    }
  }, [lead.id])

  // Real-time message updates via global SSE context
  useRealtime(['new_message', 'status_update', 'refresh'], (evt) => {
    const contactId = lead.contact_id
    if (evt.type === 'new_message' && evt.message?.contact_id === contactId) {
      setMessages(prev => {
        if (prev.some((m: any) => m.id === evt.message.id)) return prev
        return [...prev, evt.message]
      })
    }
    if (evt.type === 'status_update') {
      setMessages(prev =>
        prev.map((m: any) => m.id === evt.db_id ? { ...m, status: evt.status } : m)
      )
    }
    if (evt.type === 'refresh') {
      getWhatsAppMessages({ contact_id: contactId })
        .then(data => setMessages(data.slice().reverse()))
        .catch(() => { })
    }
  })

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // Load agent state for this contact
  useEffect(() => {
    getContactAgentState(lead.contact_id).then(setAgentInfo).catch(() => { })
  }, [lead.contact_id])

  const handleAgentToggle = async () => {
    if (!agentInfo?.agent) return
    const newState = agentInfo.state === 'active' ? 'paused' : 'active'
    try {
      await setContactAgentState(agentInfo.agent.id, lead.contact_id, newState)
      setAgentInfo(prev => prev ? { ...prev, state: newState } : prev)
      toast.success(newState === 'active' ? 'Agente reactivado' : 'Tomaste el control del chat')
    } catch { toast.error('Error actualizando agente') }
  }

  const clearMedia = useCallback(() => {
    if (mediaPreview) URL.revokeObjectURL(mediaPreview)
    setMediaFile(null)
    setMediaPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [mediaPreview])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 16 * 1024 * 1024) { toast.error('El archivo no puede superar 16 MB'); return }
    clearMedia()
    setMediaFile(file)
    setMediaPreview(URL.createObjectURL(file))
  }

  const toggleRecording = async () => {
    if (isRecording) {
      if (mediaRecorderRef.current) mediaRecorderRef.current.stop()
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
      setIsRecording(false)
      return
    }
    if (micBusy) return
    setMicBusy(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioChunksRef.current = []
      const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4']
      const mimeType = mimeTypes.find(t => MediaRecorder.isTypeSupported(t)) || ''
      const ext = mimeType.startsWith('audio/webm') ? 'webm' : mimeType.startsWith('audio/mp4') ? 'mp4' : 'ogg'
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      mediaRecorderRef.current = mr
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const actualMime = mr.mimeType || mimeType || 'audio/ogg'
        const blob = new Blob(audioChunksRef.current, { type: actualMime })
        const file = new File([blob], `audio_${Date.now()}.${ext}`, { type: actualMime })
        clearMedia()
        setMediaFile(file)
        setMediaPreview(URL.createObjectURL(blob))
        setRecordSecs(0)
      }
      mr.start(250)
      setIsRecording(true)
      setRecordSecs(0)
      recordTimerRef.current = setInterval(() => setRecordSecs(s => s + 1), 1000)
    } catch {
      toast.error('Permite el acceso al micrófono en tu navegador')
    } finally {
      setMicBusy(false)
    }
  }

  const handleSend = async () => {
    if (!configId) { toast.error('Sin número WhatsApp configurado para este lead'); return }
    const hasMedia = !!mediaFile
    const hasText = !!msgText.trim()
    if (!hasMedia && !hasText) { toast.error('Escribe un mensaje o adjunta un archivo'); return }
    setSending(true)
    try {
      if (hasMedia) {
        const fd = new FormData()
        fd.append('file', mediaFile!)
        fd.append('contact_id', lead.contact_id.toString())
        fd.append('whatsapp_config_id', configId)
        fd.append('caption', msgText.trim())
        fd.append('lead_id', lead.id.toString())
        const mediaResult = await sendWhatsAppMedia(fd)
        { const aviso = avisoEnvioWhatsApp(mediaResult); if (aviso) toast.error(aviso) }
        clearMedia()
        setMsgText('')
      } else {
        const result = await sendWhatsAppMessage({ contact_id: lead.contact_id, whatsapp_config_id: parseInt(configId), message: msgText, lead_id: lead.id })
        { const aviso = avisoEnvioWhatsApp(result); if (aviso) toast.error(aviso) }
        setMsgText('')
      }
      loadMessages()
    } catch { toast.error('Error enviando mensaje') }
    finally { setSending(false) }
  }

  const handleDeleteMsg = async (id: number) => {
    try {
      await deleteWhatsAppMessage(id)
      setMessages(prev => prev.filter(m => m.id !== id))
      setCtxMenu(null)
    } catch { toast.error('Error al eliminar') }
  }

  const handleEditMsg = async () => {
    if (!editingMsg || !editText.trim()) return
    try {
      const updated = await editWhatsAppMessage(editingMsg.id, editText)
      setMessages(prev => prev.map(m => m.id === updated.id ? updated : m))
      setEditingMsg(null); setEditText('')
    } catch { toast.error('Error al editar') }
  }

  const handleFillSave = async (contactData: any, leadData: any) => {
    const updatedContact = await updateContact(lead.contact_id, contactData)
    const payload: Record<string, any> = {}
    if (leadData.notes !== '') payload.notes = leadData.notes || null
    if (leadData.source) payload.source = leadData.source
    const updatedLead = Object.keys(payload).length > 0
      ? await updateLead(lead.id, payload)
      : lead
    onLeadUpdate({ ...updatedLead, contact: updatedContact })
    toast.success('Datos guardados')
  }

  const isImage = mediaFile?.type.startsWith('image/')
  const isAudio = mediaFile?.type.startsWith('audio/')

  return (
    <div className="flex flex-col h-full">
      {/* Chat sub-header */}
      <div className="px-4 py-2 bg-surface-0 border-b border-white/[0.07] flex items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {activeConfig ? (
            areaConfigs.length > 1 ? (
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-lime flex-shrink-0" />
                <select
                  value={selectedConfigId}
                  onChange={e => setSelectedConfigId(e.target.value)}
                  className="text-[11px] font-medium text-white/70 bg-surface-1 border border-white/10 rounded-md px-2 py-1 outline-none cursor-pointer"
                >
                  {areaConfigs.map((c: any) => (
                    <option key={c.id} value={c.id.toString()}>{c.phone_number}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-lime flex-shrink-0" />
                <span className="text-[11px] font-medium text-white/70 truncate max-w-[120px]">{activeConfig.phone_number}</span>
              </div>
            )
          ) : (
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-warn flex-shrink-0" />
              <span className="text-[11px] text-warn font-medium">Sin número configurado</span>
            </div>
          )}
        </div>
        {/* Agent badge + control */}
        {agentInfo?.agent && (
          <button
            onClick={handleAgentToggle}
            title={agentInfo.state === 'active' ? `Agente activo: ${agentInfo.agent.name}` : 'Agente pausado — tú tienes el control'}
            className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors flex-shrink-0 ${agentInfo.state === 'active'
                ? 'bg-lime/10 text-lime border-lime/25 hover:bg-danger/10 hover:text-danger hover:border-danger/25'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/25 hover:bg-lime/10 hover:text-lime hover:border-lime/25'
              }`}
          >
            <Bot size={11} />
            {agentInfo.state === 'active' ? 'IA activa' : 'Tú tienes control'}
          </button>
        )}
        <button
          onClick={() => setShowFill(true)}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-white/62 bg-surface-1 border border-white/10 hover:border-white/20 hover:bg-surface-2 px-2.5 py-1.5 rounded-lg transition-colors flex-shrink-0"
        >
          <Clipboard size={11} /> Rellenar datos
        </button>
      </div>

      {/* Copilot de datos — extracción determinista aditiva (reusa handleFillSave) */}
      <ChatCopilotWidget messages={messages} lead={lead} onApply={handleFillSave} />

      {/* Messages — WhatsApp background */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 flex flex-col wa-chat-bg">
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center" style={{ color: 'rgba(17,27,33,0.40)' }}>
            {loadingMsgs
              ? <div className="w-5 h-5 border-2 rounded-full animate-spin mb-2" style={{ borderColor: 'rgba(17,27,33,0.12)', borderTopColor: '#25d366' }} />
              : <MessageSquare size={26} className="mb-2 opacity-40" />
            }
            <p className="text-xs">{loadingMsgs ? 'Cargando mensajes...' : 'Sin mensajes aún'}</p>
          </div>
        ) : (
          <>
            <div className="flex-1" />
            <div className="py-3 px-3">
              {(() => {
                const items: React.ReactNode[] = []
                let lastDateStr = ''
                messages.filter((m: any) => m.content || m.media_url).forEach((m: any) => {
                  const d = parseAsUTC(m.created_at)
                  const dateStr = format(d, 'yyyy-MM-dd')
                  if (dateStr !== lastDateStr) {
                    lastDateStr = dateStr
                    const label = isToday(d) ? 'Hoy'
                      : isYesterday(d) ? 'Ayer'
                        : format(d, "d 'de' MMMM yyyy", { locale: es })
                    items.push(
                      <div key={`sep-${dateStr}`} className="flex items-center justify-center my-3">
                        <span className="text-[11px] font-medium px-3 py-1 rounded-full"
                          style={{ background: '#ffffff', color: 'rgba(17,27,33,0.6)', boxShadow: '0 1px 0.5px rgba(11,20,26,0.13)' }}>
                          {label}
                        </span>
                      </div>
                    )
                  }
                  const out = m.direction === 'out'
                  const WA_OUT = '#d9fdd3'
                  const WA_IN = '#ffffff'
                  items.push(
                    <div key={m.id} className={`flex ${out ? 'justify-end' : 'justify-start'} mb-[3px] group`}>
                      <div className={`relative max-w-[78%] ${out ? 'wa-bubble-out-wrap' : 'wa-bubble-in-wrap'}`}
                        style={{ marginRight: out ? 10 : 0, marginLeft: out ? 0 : 10 }}>
                        <div
                          onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, msg: m }) }}
                          style={{
                            backgroundColor: out ? WA_OUT : WA_IN,
                            borderRadius: out ? '7.5px 0px 7.5px 7.5px' : '0px 7.5px 7.5px 7.5px',
                            padding: '6px 10px 5px 10px',
                            boxShadow: '0 1px 0.5px rgba(11,20,26,0.13)',
                            position: 'relative', zIndex: 1, cursor: 'default',
                          }}>
                          <WaChatMsgContent m={m} />
                          <div className="flex items-center justify-end gap-1" style={{ minHeight: 15, marginTop: 2 }}>
                            <span style={{ color: 'rgba(17,27,33,0.5)', fontSize: 11, whiteSpace: 'nowrap' }}>
                              {format(parseAsUTC(m.created_at), 'HH:mm', { locale: es })}
                            </span>
                            {out && <WaTicks status={m.status} />}
                          </div>
                        </div>
                        <button
                          onClick={e => setCtxMenu({ x: e.clientX, y: e.clientY, msg: m })}
                          className="absolute top-1 opacity-0 group-hover:opacity-100 transition-opacity rounded-full p-0.5"
                          style={{ ...(out ? { left: -20 } : { right: -20 }), background: out ? WA_OUT : WA_IN, fontSize: 12, color: 'rgba(17,27,33,0.45)' }}>
                          ▾
                        </button>
                      </div>
                    </div>
                  )
                })
                return items
              })()}
              <div ref={endRef} />
            </div>
          </>
        )}
      </div>

      {/* Media preview */}
      {(mediaFile || isRecording) && (
        <div className="px-4 py-2 flex items-center gap-3 flex-shrink-0" style={{ borderTop: '1px solid #e9edef', backgroundColor: '#f0f2f5' }}>
          {isRecording ? (
            <>
              <span className="w-2 h-2 rounded-full animate-pulse flex-shrink-0" style={{ backgroundColor: '#ef4444' }} />
              <span className="text-sm font-semibold" style={{ color: '#ef4444' }}>{formatRecSecs(recordSecs)}</span>
              <span className="text-xs" style={{ color: '#54656f' }}>Grabando...</span>
            </>
          ) : isImage && mediaPreview ? (
            <>
              <img src={mediaPreview} alt="preview" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
              <span className="text-xs truncate flex-1" style={{ color: '#54656f' }}>{mediaFile!.name}</span>
            </>
          ) : isAudio ? (
            <>
              <Mic size={16} style={{ color: '#54656f', flexShrink: 0 }} />
              <audio controls src={mediaPreview!} className="h-8 flex-1" />
            </>
          ) : (
            <>
              <FileText size={16} style={{ color: '#54656f', flexShrink: 0 }} />
              <span className="text-xs truncate flex-1" style={{ color: '#54656f' }}>{mediaFile!.name}</span>
            </>
          )}
          {!isRecording && (
            <button onClick={clearMedia}
              className="p-1 rounded-full flex-shrink-0 transition-colors"
              style={{ color: '#54656f' }}>
              <XIcon size={13} />
            </button>
          )}
        </div>
      )}

      {/* Input bar — WhatsApp style */}
      <div className="flex items-end gap-2 px-2 py-2 flex-shrink-0" style={{ backgroundColor: '#f0f2f5', borderTop: '1px solid #e9edef' }}>
        <input ref={fileInputRef} type="file"
          accept="image/*,audio/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx"
          className="hidden" onChange={handleFileSelect} />

        {/* Attach */}
        <button onClick={() => fileInputRef.current?.click()}
          disabled={!configId || isRecording}
          title="Adjuntar"
          className="p-2 rounded-full transition-colors flex-shrink-0 disabled:opacity-30"
          style={{ color: '#54656f' }}>
          <Paperclip size={22} />
        </button>

        {/* Textarea */}
        <textarea
          className="flex-1 resize-none text-sm outline-none rounded-xl px-4 py-2.5"
          style={{
            minHeight: 42,
            maxHeight: 100,
            lineHeight: '1.5',
            backgroundColor: '#ffffff',
            border: 'none',
            color: '#111b21',
          }}
          rows={1}
          disabled={!configId}
          value={msgText}
          onChange={e => {
            setMsgText(e.target.value)
            e.target.style.height = 'auto'
            e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px'
          }}
          placeholder={mediaFile ? 'Pie de foto (opcional)...' : configId ? 'Escribe un mensaje...' : 'Sin configuración WhatsApp'}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
        />

        {/* Mic / Send */}
        {msgText.trim() || mediaFile ? (
          <button onClick={handleSend}
            disabled={sending || isRecording || !configId}
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-30 transition-opacity"
            style={{ backgroundColor: '#00a884', color: '#ffffff' }}>
            {sending ? <RefreshCw size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        ) : (
          <button onClick={toggleRecording}
            disabled={!configId || micBusy}
            title={isRecording ? 'Detener grabación' : 'Grabar audio'}
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-30 transition-colors"
            style={{
              backgroundColor: isRecording ? '#ef4444' : '#00a884',
              color: '#ffffff',
            }}>
            {isRecording ? <Square size={18} /> : <Mic size={18} />}
          </button>
        )}
      </div>

      {showFill && (
        <FillContactSplit
          messages={messages}
          lead={lead}
          onSave={handleFillSave}
          onClose={() => setShowFill(false)}
        />
      )}

      {/* Context menu */}
      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCtxMenu(null)} />
          <div className="fixed z-50 rounded-xl shadow-2xl overflow-hidden bg-surface-1 border border-white/10"
            style={{ top: ctxMenu.y, left: ctxMenu.x, minWidth: 160 }}>
            {ctxMenu.msg.direction === 'out' && ctxMenu.msg.message_type === 'text' && (
              <button
                onClick={() => { setEditingMsg(ctxMenu.msg); setEditText(ctxMenu.msg.content); setCtxMenu(null) }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-surface-2 transition-colors text-white/85">
                <Pencil size={14} className="text-white/45" /> Editar mensaje
              </button>
            )}
            <button
              onClick={() => handleDeleteMsg(ctxMenu.msg.id)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-danger/10 transition-colors text-danger">
              <Trash2 size={14} className="text-danger" /> Eliminar mensaje
            </button>
          </div>
        </>
      )}

      {/* Edit modal */}
      {editingMsg && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end justify-center z-50 pb-6 px-4">
          <div className="bg-surface-1 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-white/[0.07]">
            <div className="px-5 py-3 border-b border-white/[0.07] flex items-center justify-between">
              <p className="font-semibold text-white/90 text-sm">Editar mensaje</p>
              <button onClick={() => setEditingMsg(null)} className="p-1 rounded-full hover:bg-surface-2 text-white/45">
                <XIcon size={15} />
              </button>
            </div>
            <div className="p-4">
              <textarea autoFocus
                className="w-full resize-none text-sm rounded-xl border border-white/10 bg-surface-0 text-white/90 px-3 py-2.5 outline-none focus:border-white/25"
                rows={3} value={editText}
                onChange={e => setEditText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditMsg() } }}
              />
            </div>
            <div className="px-4 pb-4 flex gap-2">
              <button onClick={() => setEditingMsg(null)}
                className="flex-1 py-2 rounded-xl border border-white/10 text-sm text-white/62 hover:bg-surface-2">
                Cancelar
              </button>
              <button onClick={handleEditMsg}
                className="flex-1 py-2 rounded-xl text-sm font-semibold btn-primary">
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export { ChatTab }
