import React, { useState, useEffect, useRef, useCallback } from 'react'
import { getAllWhatsAppConfigs, getWhatsAppMessages, sendWhatsAppMessage, sendWhatsAppMedia, getConversations, markMessagesRead, updateContact, deleteWhatsAppMessage, editWhatsAppMessage, syncWhatsAppChats, syncFullHistory, sendTypingPresence, retryWhatsAppMessage } from '../api'
import { apiUrl } from '../api/client'
import { playMessageSound } from '../hooks/useNotificationSound'
import { useAuthStore } from '../store/auth'
import { MessageSquare, Send, RefreshCw, ExternalLink, Plus, Search, Clock, Clipboard, X, Paperclip, Mic, Square, FileText, Check, CheckCheck, Trash2, Pencil, Info } from 'lucide-react'
import toast from 'react-hot-toast'
import { format, isToday, isYesterday, isSameDay } from 'date-fns'
import { es } from 'date-fns/locale'
import { Link, useSearchParams } from 'react-router-dom'

interface Conversation {
  contact: { id: number; name: string; phone: string; avatar_url?: string | null }
  last_message: string
  last_message_at: string | null
  last_direction: 'in' | 'out'
  unread_count: number
  lead_id: number | null
  whatsapp_config_id: number | null
}

import { parseDate as parseAsUTC } from '../utils/dates'
import { rutOnChange } from '../utils/rut'
import { useRealtime } from '../contexts/RealtimeContext'

function formatConvTime(iso: string | null) {
  if (!iso) return ''
  const d = parseAsUTC(iso)
  if (isToday(d))     return format(d, 'HH:mm')
  if (isYesterday(d)) return 'Ayer'
  return format(d, 'd MMM', { locale: es })
}

function dateSepLabel(iso: string): string {
  const d = parseAsUTC(iso)
  if (isToday(d))     return 'Hoy'
  if (isYesterday(d)) return 'Ayer'
  return format(d, 'dd/MM/yyyy')
}

function formatRecSecs(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// Linkifica URLs http/https en texto plano. Preserva resto del texto.
const URL_REGEX = /(https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]])/g
function renderLinkified(text: string): React.ReactNode[] {
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
        className="underline underline-offset-2 text-brand-300 hover:text-brand-200"
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

function MsgContent({ m }: { m: any }) {
  const type = m.message_type || 'text'
  const url  = m.media_url || null

  if (type === 'sticker' || type === 'image' || (type === 'text' && url && /\.(jpg|jpeg|png|webp|gif)$/i.test(url))) {
    if (!url) return <p className="text-xs opacity-60 italic">📷 Imagen</p>
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img src={url} alt="imagen" className="rounded-xl max-w-[260px] max-h-[260px] object-cover cursor-zoom-in" />
        {m.content && m.content !== '[Imagen]' && (
          <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">{m.content}</p>
        )}
      </a>
    )
  }
  if (type === 'audio' || (url && /\.(ogg|mp3|m4a|aac|opus)$/i.test(url))) {
    if (!url) return <p className="text-xs opacity-60 italic">🎤 Audio</p>
    return <audio controls src={url} className="max-w-[260px] h-10 rounded-xl" />
  }
  if (type === 'video' || (url && /\.(mp4|webm|mov)$/i.test(url))) {
    if (!url) return <p className="text-xs opacity-60 italic">🎥 Video</p>
    return <video controls src={url} className="rounded-xl max-w-[260px] max-h-[200px]" />
  }
  if (type === 'document') {
    if (!url) return <p className="text-xs opacity-60 italic">📄 {m.content || 'Documento'}</p>
    const fname = url.split('/').pop() || 'archivo'
    return (
      <a href={url} target="_blank" rel="noreferrer"
        className="flex items-center gap-2 text-sm underline underline-offset-2 opacity-90">
        <FileText size={14} className="flex-shrink-0" />
        <span className="truncate max-w-[200px]">{m.content || fname}</span>
      </a>
    )
  }
  return <p className="leading-relaxed whitespace-pre-wrap text-sm">{renderLinkified(m.content)}</p>
}

const WA_TICK_LABEL: Record<string, string> = { logged: 'Pendiente', sent: 'Enviado', delivered: 'Entregado', read: 'Leído', failed: 'Error' }
function WaTicks({ status }: { status: string }) {
  const label = WA_TICK_LABEL[status] ?? 'Enviado'
  if (status === 'failed')    return <span title={label} style={{color:'#ef4444', fontSize:13, fontWeight:'bold', lineHeight:1}}>!</span>
  if (status === 'logged')    return <span title={label}><Clock size={13} color="rgba(255,255,255,0.55)" /></span>
  if (status === 'read')      return <span title={label}><CheckCheck size={16} color="#53bdeb" strokeWidth={2.5} /></span>
  if (status === 'delivered') return <span title={label}><CheckCheck size={16} color="rgba(255,255,255,0.75)" strokeWidth={2.5} /></span>
  return <span title={label}><Check size={16} color="rgba(255,255,255,0.75)" strokeWidth={2.5} /></span>
}

/* ── Message context menu ──────────────────────────────────── */
interface MsgMenuProps {
  x: number; y: number
  msg: any
  onClose: () => void
  onDelete: (id: number) => void
  onEdit: (msg: any) => void
  onRetry: (msg: any) => void
}
function MsgMenu({ x, y, msg, onClose, onDelete, onEdit, onRetry }: MsgMenuProps) {
  const isOut = msg.direction === 'out'
  const canEdit = isOut && msg.message_type === 'text' && msg.status !== 'logged'
  const canRetry = isOut && msg.status === 'logged' && msg.message_type === 'text'
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed z-50 rounded-lg overflow-hidden"
        style={{
          top: y, left: x,
          backgroundColor: '#ffffff',
          border: '1px solid rgba(28,22,51,0.12)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          minWidth: 160,
        }}>
        {canRetry && (
          <button
            onClick={() => { onRetry(msg); onClose() }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors"
            style={{color:'#d97706'}}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}>
            <RefreshCw size={15} color="#d97706" />
            Reintentar envío
          </button>
        )}
        {canEdit && (
          <button
            onClick={() => { onEdit(msg); onClose() }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors"
            style={{color:'var(--text-2)'}}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}>
            <Pencil size={15} color="var(--text-muted)" />
            Editar mensaje
          </button>
        )}
        <button
          onClick={() => { onDelete(msg.id); onClose() }}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors"
          style={{color:'var(--danger)'}}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--danger-dim)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}>
          <Trash2 size={15} color="var(--danger)" />
          Eliminar mensaje
        </button>
      </div>
    </>
  )
}

/* ── Fill Contact Modal ────────────────────────────────────── */
function WaFillContactModal({ messages, conv, onClose }: {
  messages: any[]
  conv: Conversation
  onClose: () => void
}) {
  const [form, setForm] = useState({
    name: conv.contact.name,
    phone: conv.contact.phone,
    email: '',
    rut_persona: '',
    rut_empresa: '',
    razon_social: '',
    city: '',
  })
  const [saving, setSaving] = useState(false)
  const chatText = messages.map(m => `[${m.direction === 'out' ? 'Agente' : 'Cliente'}]: ${m.content}`).join('\n')

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateContact(conv.contact.id, form)
      toast.success('Datos de contacto actualizados')
      onClose()
    } catch { toast.error('Error al guardar') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-1 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07] flex-shrink-0">
          <div>
            <h3 className="font-bold text-white">Rellenar datos de contacto</h3>
            <p className="text-xs text-white/52 mt-0.5">Completa la información desde el chat</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface-2 rounded-xl text-white/52">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* Mini chat preview — WA style */}
          <div className="px-0 pt-0 pb-0">
            <div className="max-h-48 overflow-y-auto py-3 px-[3%] space-y-0.5"
              style={{
                backgroundColor: '#f5f3fa',
                backgroundImage: "radial-gradient(circle, rgba(28,22,51,0.04) 1px, transparent 1px)",
                backgroundSize: "20px 20px",
              }}>
              {messages.length === 0 ? (
                <p className="text-center text-xs py-4" style={{color:'rgba(28,22,51,0.40)'}}>Sin mensajes</p>
              ) : messages.map((m: any) => {
                const isOut = m.direction === 'out'
                const bubbleBg = isOut ? 'var(--zx-accent-text)' : '#ffffff'
                return (
                  <div key={m.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'} mb-0.5`}>
                    <div className="relative max-w-[80%]"
                      style={{marginRight: isOut ? 8 : 0, marginLeft: isOut ? 0 : 8}}>
                      <div style={{
                        position: 'absolute', bottom: 0,
                        ...(isOut ? {right: -8} : {left: -8}),
                        width: 8, height: 13,
                        backgroundColor: bubbleBg,
                        clipPath: isOut ? 'polygon(0 0, 0 100%, 100% 100%)' : 'polygon(100% 0, 0 100%, 100% 100%)',
                      }} />
                      <div className={isOut ? 'chat-bubble-out' : ''}
                        style={{
                          backgroundColor: bubbleBg,
                          borderRadius: isOut ? '7.5px 7.5px 0 7.5px' : '7.5px 7.5px 7.5px 0',
                          padding: '4px 8px 6px 8px',
                          boxShadow: isOut ? '0 1px 3px rgba(53,122,14,0.2)' : '0 1px 3px rgba(0,0,0,0.08)',
                          position: 'relative', zIndex: 1,
                          color: isOut ? '#ffffff' : 'var(--text)',
                          border: isOut ? 'none' : '1px solid rgba(28,22,51,0.10)',
                        }}>
                        <MsgContent m={m} />
                        <div className="flex items-center justify-end gap-1 mt-0.5">
                          <span style={{color: isOut ? 'rgba(255,255,255,0.70)' : 'rgba(28,22,51,0.40)', fontSize:10}}>
                            {format(parseAsUTC(m.created_at), 'HH:mm')}
                          </span>
                          {isOut && <WaTicks status={m.status} />}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="px-6 pb-4 space-y-3 pt-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="input-label">Nombre *</label>
                <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="input-label">Teléfono *</label>
                <input className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div>
                <label className="input-label">Correo</label>
                <input className="input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div>
                <label className="input-label">Ciudad</label>
                <input className="input" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
              </div>
              <div>
                <label className="input-label">RUT Persona</label>
                <input className="input" value={form.rut_persona} onChange={e => setForm(f => ({ ...f, rut_persona: rutOnChange(e.target.value) }))} placeholder="12.345.678-9" />
              </div>
              <div>
                <label className="input-label">RUT Empresa</label>
                <input className="input" value={form.rut_empresa} onChange={e => setForm(f => ({ ...f, rut_empresa: rutOnChange(e.target.value) }))} placeholder="76.000.000-0" />
              </div>
              <div className="col-span-2">
                <label className="input-label">Razón Social</label>
                <input className="input" value={form.razon_social} onChange={e => setForm(f => ({ ...f, razon_social: e.target.value }))} />
              </div>
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-white/[0.07] flex gap-3 flex-shrink-0">
          <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 bg-surface-1 hover:bg-surface-2 disabled:opacity-30 text-white rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors">
            {saving ? 'Guardando...' : 'Guardar datos'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function WhatsApp() {
  const { user } = useAuthStore()
  const isAgendadora = user?.role === 'agendadora'
  const [searchParams] = useSearchParams()
  const autoSelectRef  = useRef(false)

  const [configs, setConfigs]               = useState<any[]>([])
  const [conversations, setConversations]   = useState<Conversation[]>([])
  const [messages, setMessages]             = useState<any[]>([])
  const [selectedConv, setSelectedConv]     = useState<Conversation | null>(null)
  const [selectedConfig, setSelectedConfig] = useState('')
  const [msgText, setMsgText]               = useState('')
  const [sending, setSending]               = useState(false)
  const [search, setSearch]                 = useState('')
  const [showFill, setShowFill]             = useState(false)
  const [loadingInit, setLoadingInit]       = useState(true)
  const [syncing, setSyncing]               = useState(false)

  // Context menu + edit state
  const [ctxMenu, setCtxMenu] = useState<{x:number;y:number;msg:any}|null>(null)
  const [editingMsg, setEditingMsg] = useState<any|null>(null)
  const [editText, setEditText] = useState('')

  // Media state
  const [mediaFile, setMediaFile]       = useState<File | null>(null)
  const [mediaPreview, setMediaPreview] = useState<string | null>(null)
  const [isRecording, setIsRecording]   = useState(false)
  const [recordSecs, setRecordSecs]     = useState(0)

  const messagesEndRef    = useRef<HTMLDivElement>(null)
  const fallbackPollRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const typingTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInputRef      = useRef<HTMLInputElement>(null)
  const mediaRecorderRef  = useRef<MediaRecorder | null>(null)
  const audioChunksRef    = useRef<Blob[]>([])
  const recordTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevUnreadRef     = useRef<Record<number, number>>({})
  const selectedConvRef   = useRef<Conversation | null>(null)
  // Ref to always-current loadConversations so SSE callback doesn't go stale
  const loadConvsRef      = useRef<() => Promise<void>>(() => Promise.resolve())
  const loadMsgsRef       = useRef<(id: number) => Promise<void>>(() => Promise.resolve())

  // Keep ref in sync with state (needed for SSE callbacks which close over stale state)
  selectedConvRef.current = selectedConv

  // Auto-select conversation from ?lead_id=X or ?contact_id=X
  useEffect(() => {
    if (autoSelectRef.current || conversations.length === 0) return
    const leadId = searchParams.get('lead_id')
    const contactId = searchParams.get('contact_id')
    let target = null
    if (leadId) target = conversations.find(c => c.lead_id === parseInt(leadId)) || null
    if (!target && contactId) target = conversations.find(c => c.contact.id === parseInt(contactId)) || null
    if (target) {
      autoSelectRef.current = true
      setSelectedConv(target)
      loadMsgsRef.current(target.contact.id)
    }
  }, [conversations, searchParams])


  // Real-time: handle incoming events from global SSE context
  useRealtime(['new_message', 'status_update', 'refresh'], (evt) => {
    if (evt.type === 'new_message') {
      const msg = evt.message
      const conv = selectedConvRef.current
      if (conv && msg.contact_id === conv.contact.id) {
        setMessages(prev => {
          const idx = prev.findIndex((m: any) => m.id === msg.id)
          if (idx !== -1) {
            const updated = [...prev]
            updated[idx] = { ...prev[idx], ...msg }
            return updated
          }
          return [...prev, msg]
        })
      } else {
        playMessageSound()
      }
      loadConvsRef.current()
      return
    }
    if (evt.type === 'status_update') {
      setMessages(prev =>
        prev.map((m: any) => m.id === evt.db_id ? { ...m, status: evt.status } : m)
      )
      return
    }
    if (evt.type === 'refresh') {
      loadConvsRef.current()
      const conv = selectedConvRef.current
      if (conv) loadMsgsRef.current(conv.contact.id)
    }
  })

  // Initial load
  useEffect(() => {
    Promise.all([getAllWhatsAppConfigs(), loadConversations()]).then(([cfg]) => {
      setConfigs(cfg)
      if (cfg.length) setSelectedConfig(cfg[0].id.toString())
      setLoadingInit(false)
    }).catch(() => setLoadingInit(false))

    // Fallback safety poll every 30s (catches missed events, keeps data fresh)
    fallbackPollRef.current = setInterval(() => {
      loadConversations()
      if (selectedConvRef.current) loadMessages(selectedConvRef.current.contact.id)
    }, 30000)

    return () => {
      if (fallbackPollRef.current) clearInterval(fallbackPollRef.current)
    }
  }, [])

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Cleanup recording on unmount
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
      if (mediaRecorderRef.current && isRecording) mediaRecorderRef.current.stop()
    }
  }, [])

  const loadConversations = async () => {
    try {
      const data = await getConversations()
      const prev = prevUnreadRef.current
      let hasNew = false
      for (const conv of data as Conversation[]) {
        const prevCount = prev[conv.contact.id] ?? conv.unread_count
        if (conv.unread_count > prevCount) hasNew = true
        prev[conv.contact.id] = conv.unread_count
      }
      prevUnreadRef.current = prev
      if (hasNew) playMessageSound()

      setConversations(data)
      const cur = selectedConvRef.current
      if (cur) {
        const updated = data.find((c: Conversation) => c.contact.id === cur.contact.id)
        if (updated) setSelectedConv(updated)
      }
    } catch { /* silent */ }
  }

  // Keep refs up-to-date so SSE handler always calls the latest version
  loadConvsRef.current = loadConversations

  const loadMessages = async (contactId: number) => {
    try {
      const data = await getWhatsAppMessages({ contact_id: contactId })
      setMessages(data.slice().reverse())
    } catch { /* silent */ }
  }
  loadMsgsRef.current = loadMessages

  const openConversation = async (conv: Conversation) => {
    setSelectedConv(conv)
    setMessages([])
    // Auto-select the config that was last used with this contact
    if (conv.whatsapp_config_id) {
      setSelectedConfig(conv.whatsapp_config_id.toString())
    }
    await loadMessages(conv.contact.id)
    if (conv.unread_count > 0) {
      await markMessagesRead(conv.contact.id)
      setConversations(prev =>
        prev.map(c => c.contact.id === conv.contact.id ? { ...c, unread_count: 0 } : c)
      )
    }
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
    if (file.size > 16 * 1024 * 1024) {
      toast.error('El archivo no puede superar 16 MB')
      return
    }
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
      toast.error('No se pudo acceder al micrófono')
    }
  }

  const handleSend = async () => {
    if (!selectedConv || !selectedConfig) {
      toast.error('Selecciona un canal de WhatsApp')
      return
    }
    const hasMedia = !!mediaFile
    const hasText  = !!msgText.trim()
    if (!hasMedia && !hasText) {
      toast.error('Escribe un mensaje o adjunta un archivo')
      return
    }

    // Stop typing indicator immediately on send
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    if (selectedConv && selectedConfig) {
      sendTypingPresence(parseInt(selectedConfig), selectedConv.contact.id, false).catch(() => {})
    }

    // Optimistic insert — show message instantly before API responds
    const optimisticText = hasMedia ? '' : msgText.trim()
    const optimisticId = Date.now() * -1  // negative temp id
    if (!hasMedia && optimisticText) {
      const optimistic = {
        id: optimisticId, contact_id: selectedConv.contact.id,
        direction: 'out', message_type: 'text', content: optimisticText,
        status: 'logged', created_at: new Date().toISOString(),
        whatsapp_config_id: parseInt(selectedConfig),
      }
      setMessages(prev => [...prev, optimistic])
      setMsgText('')
    }

    setSending(true)
    try {
      if (hasMedia) {
        const fd = new FormData()
        fd.append('file', mediaFile!)
        fd.append('contact_id', selectedConv.contact.id.toString())
        fd.append('whatsapp_config_id', selectedConfig)
        fd.append('caption', msgText.trim())
        if (selectedConv.lead_id) fd.append('lead_id', selectedConv.lead_id.toString())
        const mediaResult = await sendWhatsAppMedia(fd)
        if (mediaResult?.status === 'logged') toast.error('WhatsApp no conectado — archivo guardado sin enviar')
        clearMedia()
        setMsgText('')
      } else {
        const result = await sendWhatsAppMessage({
          contact_id: selectedConv.contact.id,
          whatsapp_config_id: parseInt(selectedConfig),
          message: optimisticText,
          lead_id: selectedConv.lead_id ?? undefined,
        })
        if (result?.status === 'logged') toast.error('WhatsApp no conectado — mensaje guardado sin enviar')
        // Replace optimistic with real message from API
        if (result?.id) {
          setMessages(prev => prev.map(m => m.id === optimisticId ? { ...result, direction: 'out' } : m))
        } else {
          setMessages(prev => prev.filter(m => m.id !== optimisticId))
        }
      }
      await loadMessages(selectedConv.contact.id)
      await loadConversations()
    } catch {
      toast.error('Error enviando mensaje')
    } finally {
      setSending(false)
    }
  }

  const handleDeleteMsg = async (id: number) => {
    try {
      await deleteWhatsAppMessage(id)
      setMessages(prev => prev.filter(m => m.id !== id))
    } catch { toast.error('Error al eliminar') }
  }

  const handleEditMsg = async () => {
    if (!editingMsg || !editText.trim()) return
    try {
      const updated = await editWhatsAppMessage(editingMsg.id, editText)
      setMessages(prev => prev.map(m => m.id === updated.id ? updated : m))
      setEditingMsg(null)
      setEditText('')
    } catch { toast.error('Error al editar') }
  }

  const handleRetryMsg = async (msg: any) => {
    // Optimistically mark as 'sent' so the user sees it's being retried
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, status: 'sent' } : m))
    try {
      const updated = await retryWhatsAppMessage(msg.id)
      setMessages(prev => prev.map(m => m.id === msg.id ? updated : m))
      if (updated.status === 'logged') {
        // Still couldn't send — revert optimistic
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, status: 'logged' } : m))
        toast.error('WhatsApp no conectado — reintenta más tarde')
      }
    } catch {
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, status: 'logged' } : m))
      toast.error('Error al reenviar')
    }
  }

  const filtered = conversations.filter(c =>
    !search ||
    c.contact.name.toLowerCase().includes(search.toLowerCase()) ||
    c.contact.phone.includes(search)
  )

  const totalUnread = conversations.reduce((s, c) => s + c.unread_count, 0)

  const isImage = mediaFile?.type.startsWith('image/')
  const isAudio = mediaFile?.type.startsWith('audio/')

  return (
    <div className="flex flex-col h-full space-y-4" style={{ minHeight: 0 }}>

      {/* Descripción */}
      {configs.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl px-4 py-3 text-xs flex-shrink-0" style={{ background: 'rgba(53,122,14,0.08)', border: '1px solid rgba(53,122,14,0.18)', color: 'rgba(53,122,14,0.90)' }}>
          <Info size={15} className="flex-shrink-0 mt-0.5" />
          <p>Aquí puede ver y responder los mensajes de WhatsApp de sus clientes. Seleccione una conversación de la lista izquierda para abrir el chat. Puede escribir mensajes, enviar archivos y ver el historial completo de cada cliente.</p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-white">WhatsApp</h1>
          {!loadingInit && configs.length > 0 && (
            <p className="text-white/62 text-sm mt-0.5">
              {conversations.length} conversaciones
              {totalUnread > 0 && (
                <span className="ml-2 text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{backgroundColor:'var(--danger)', color:'#ffffff'}}>
                  {totalUnread} nuevos
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {configs.length > 1 && !isAgendadora && (
            <div className="relative">
              <select className="input h-9 pl-3 pr-8 text-sm appearance-none w-52"
                value={selectedConfig} onChange={e => setSelectedConfig(e.target.value)}>
                {configs.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
          {configs.length > 0 && (
            <button onClick={loadConversations} className="btn-secondary h-9 px-3" title="Actualizar">
              <RefreshCw size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Empty state — no active WhatsApp configs */}
      {!loadingInit && configs.length === 0 && (
        <div className="flex flex-col items-center justify-center flex-1 py-20 rounded-2xl space-y-4"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1.5px dashed rgba(255,255,255,0.08)' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(53,122,14,0.10)', border: '1px solid rgba(53,122,14,0.22)' }}>
            <MessageSquare size={28} style={{ color: 'var(--primary)' }} />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-white/70">Sin números de WhatsApp conectados</p>
            <p className="text-xs text-white/38 mt-1">Vincula un número para ver y responder mensajes de tus clientes</p>
          </div>
          <p className="text-xs text-white/38 text-center max-w-sm">
            Los números se conectan por la API oficial de Meta desde Configuración.
            Los mensajes entran solos por el webhook: no hay nada que sincronizar a mano.
          </p>
        </div>
      )}

      {/* Main panel */}
      {(loadingInit || configs.length > 0) && (
      <div className="flex flex-1 rounded-xl overflow-hidden shadow-card-lg border border-surface-4"
        style={{ minHeight: 0, height: 'calc(100vh - 200px)' }}>

        {/* ── Conversations sidebar ── */}
        <div className={`${selectedConv ? 'hidden sm:flex' : 'flex'} w-full sm:w-80 flex-shrink-0 flex-col bg-surface-1`} style={{borderRight:'1px solid var(--border)'}}>
          {/* Sidebar search */}
          <div className="px-3 py-2.5" style={{backgroundColor:'var(--surface-2)', borderBottom:'1px solid var(--border)'}}>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{color:'var(--text-muted)'}} />
              <input
                className="w-full pl-8 pr-3 h-8 text-sm rounded-full outline-none"
                style={{backgroundColor:'var(--surface-3)', color:'var(--text)', border:'1px solid var(--border)'}}
                placeholder="Buscar o empezar un chat"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-surface-1">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-6" style={{color:'var(--text-muted)'}}>
                <MessageSquare size={32} className="mb-2 opacity-30" />
                <p className="text-sm text-center">
                  {search ? 'Sin resultados' : 'Los mensajes aparecerán aquí'}
                </p>
              </div>
            ) : (
              filtered.map(conv => {
                const selected = selectedConv?.contact.id === conv.contact.id
                return (
                  <button key={conv.contact.id} onClick={() => openConversation(conv)}
                    className="w-full text-left border-b transition-colors"
                    style={{
                      backgroundColor: selected ? 'var(--primary-dim)' : 'transparent',
                      borderColor: 'var(--border)',
                    }}
                    onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--surface-2)' }}
                    onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}>
                    <div className="flex items-center gap-3 px-4 py-3">
                      {/* Avatar */}
                      <div className="relative flex-shrink-0">
                        {conv.contact.avatar_url ? (
                          <img
                            src={conv.contact.avatar_url}
                            alt={conv.contact.name}
                            className="w-12 h-12 rounded-full object-cover"
                            onError={e => {
                              (e.currentTarget as HTMLImageElement).style.display = 'none';
                              (e.currentTarget.nextElementSibling as HTMLElement).style.display = 'flex'
                            }}
                          />
                        ) : null}
                        <div className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg"
                          style={{
                            backgroundColor:'var(--primary-dim)', color:'var(--primary)',
                            display: conv.contact.avatar_url ? 'none' : 'flex'
                          }}>
                          {conv.contact.name.charAt(0).toUpperCase()}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium truncate" style={{color:'var(--text)'}}>
                            {conv.contact.name}
                          </span>
                          <span className="text-[11px] flex-shrink-0 ml-2" style={{
                            color: conv.unread_count > 0 ? 'var(--primary)' : 'var(--text-muted)'
                          }}>
                            {formatConvTime(conv.last_message_at)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <p className="text-xs truncate flex-1" style={{color:'var(--text-3)'}}>
                            {conv.last_direction === 'out' && (
                              <Check size={13} className="inline mr-0.5 -mt-0.5" color="var(--text-muted)" />
                            )}
                            {conv.last_message || '—'}
                          </p>
                          {conv.unread_count > 0 && (
                            <span className="ml-2 flex-shrink-0 min-w-[20px] h-5 text-[11px] font-bold rounded-full flex items-center justify-center px-1"
                              style={{backgroundColor:'var(--primary)', color:'#ffffff'}}>
                              {conv.unread_count > 9 ? '9+' : conv.unread_count}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* ── Chat panel ── */}
        {!selectedConv ? (
          <div className="hidden sm:flex flex-1 flex-col items-center justify-center" style={{backgroundColor:'var(--surface-2)'}}>
            <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4" style={{backgroundColor:'var(--primary-dim)'}}>
              <MessageSquare size={36} color="var(--primary)" />
            </div>
            <p className="font-light text-2xl mb-2" style={{color:'var(--text-3)'}}>WhatsApp Web</p>
            <p className="text-sm" style={{color:'var(--text-muted)'}}>Selecciona una conversación para comenzar</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-w-0">

            {/* Chat header */}
            <div className="flex items-center justify-between px-4 py-2.5 flex-shrink-0 border-b"
              style={{backgroundColor:'var(--surface)', borderColor:'var(--border)'}}>
              <div className="flex items-center gap-2 sm:gap-3">
                <button onClick={() => setSelectedConv(null)}
                  className="sm:hidden p-1.5 rounded-lg transition-colors"
                  style={{ color: 'var(--text-muted)' }}>
                  ←
                </button>
                {selectedConv.contact.avatar_url ? (
                  <img
                    src={selectedConv.contact.avatar_url}
                    alt={selectedConv.contact.name}
                    className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                    onError={e => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                      (e.currentTarget.nextElementSibling as HTMLElement).style.display = 'flex'
                    }}
                  />
                ) : null}
                <div className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{backgroundColor:'var(--primary-dim)', display: selectedConv.contact.avatar_url ? 'none' : 'flex'}}>
                  <span className="font-bold text-sm" style={{color:'var(--primary)'}}>
                    {selectedConv.contact.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-sm" style={{color:'var(--text)'}}>{selectedConv.contact.name}</p>
                  <p className="text-xs" style={{color:'var(--text-muted)'}}>{selectedConv.contact.phone}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {selectedConv.lead_id ? (
                  <Link to="/leads" state={{ openLeadId: selectedConv.lead_id }}
                    className="text-xs py-1.5 px-3 rounded-lg font-medium transition-colors"
                    style={{color:'var(--primary)', backgroundColor:'var(--primary-dim)', border:'1px solid rgba(53,122,14,0.20)'}}>
                    Ver Lead →
                  </Link>
                ) : (
                  <Link to="/leads" state={{ createFor: selectedConv.contact.id }}
                    className="flex items-center gap-1 text-xs py-1.5 px-3 rounded-lg font-medium"
                    style={{backgroundColor:'var(--primary)', color:'#ffffff'}}>
                    <Plus size={12} /> Crear Lead
                  </Link>
                )}
              </div>
            </div>

            {/* Messages — light chat background */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 flex flex-col"
              style={{
                backgroundColor: '#f5f3fa',
                backgroundImage: "radial-gradient(circle, rgba(28,22,51,0.04) 1px, transparent 1px)",
                backgroundSize: "20px 20px",
              }}>
              {messages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center" style={{color:'rgba(28,22,51,0.40)'}}>
                  <Clock size={24} className="mb-2 opacity-30" />
                  <p className="text-sm">Sin mensajes aún</p>
                </div>
              ) : (
                <>
                  <div className="flex-1" />
                  <div className="py-4 px-[3%] space-y-1">
                    {messages.map((m: any, idx: number) => {
                      const isOut = m.direction === 'out'
                      const bubbleBg = isOut ? 'var(--zx-accent-text)' : '#ffffff'
                      const prev = messages[idx - 1]
                      const showSep = !prev || !isSameDay(parseAsUTC(m.created_at), parseAsUTC(prev.created_at))
                      return (
                        <div key={m.id}>
                          {showSep && (
                            <div className="flex justify-center my-3">
                              <span style={{
                                backgroundColor: 'rgba(28,22,51,0.08)',
                                color: 'rgba(28,22,51,0.55)',
                                fontSize: 12,
                                padding: '3px 10px',
                                borderRadius: 8,
                                boxShadow: '0 1px 0.5px rgba(0,0,0,0.06)',
                              }}>
                                {dateSepLabel(m.created_at)}
                              </span>
                            </div>
                          )}
                          <div className={`flex ${isOut ? 'justify-end' : 'justify-start'} mb-0.5 group`}>
                            <div className="relative max-w-[72%]"
                              style={{marginRight: isOut ? 8 : 0, marginLeft: isOut ? 0 : 8}}>
                              <div style={{
                                position: 'absolute', bottom: 0,
                                ...(isOut ? {right: -8} : {left: -8}),
                                width: 8, height: 13,
                                backgroundColor: bubbleBg,
                                clipPath: isOut ? 'polygon(0 0, 0 100%, 100% 100%)' : 'polygon(100% 0, 0 100%, 100% 100%)',
                              }} />
                              <div
                                className={isOut ? 'chat-bubble-out' : ''}
                                onContextMenu={e => { e.preventDefault(); setCtxMenu({x: e.clientX, y: e.clientY, msg: m}) }}
                                style={{
                                  backgroundColor: bubbleBg,
                                  borderRadius: isOut ? '7.5px 7.5px 0 7.5px' : '7.5px 7.5px 7.5px 0',
                                  padding: '6px 9px 8px 9px',
                                  boxShadow: isOut ? '0 1px 3px rgba(53,122,14,0.2)' : '0 1px 3px rgba(0,0,0,0.08)',
                                  color: isOut ? '#ffffff' : 'var(--text)', position: 'relative', zIndex: 1, cursor: 'default',
                                  overflow: 'hidden',
                                  wordBreak: 'break-word',
                                  border: isOut ? 'none' : '1px solid rgba(28,22,51,0.10)',
                                }}>
                                <MsgContent m={m} />
                                <div className="flex items-center justify-end gap-1 mt-1" style={{minHeight:16}}>
                                  {isOut && m.status === 'logged' && m.id > 0 && (
                                    <button
                                      onClick={() => handleRetryMsg(m)}
                                      title="No enviado — haz clic para reintentar"
                                      style={{fontSize:10, color:'#fbbf24', cursor:'pointer', opacity:0.9}}
                                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity='1'}
                                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity='0.9'}>
                                      ↺ No enviado
                                    </button>
                                  )}
                                  <span style={{color: isOut ? 'rgba(255,255,255,0.70)' : 'rgba(28,22,51,0.40)', fontSize:11, whiteSpace:'nowrap'}}>
                                    {format(parseAsUTC(m.created_at), "HH:mm")}
                                  </span>
                                  {isOut && <WaTicks status={m.status} />}
                                </div>
                              </div>
                              <button
                                onClick={e => setCtxMenu({x: e.clientX, y: e.clientY, msg: m})}
                                className="absolute top-1 opacity-0 group-hover:opacity-100 transition-opacity rounded-full p-0.5"
                                style={{
                                  ...(isOut ? {left: -22} : {right: -22}),
                                  backgroundColor: bubbleBg, color: isOut ? 'rgba(255,255,255,0.60)' : 'rgba(28,22,51,0.40)',
                                }}>
                                ▾
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                </>
              )}
            </div>

            {/* Media preview bar */}
            {(mediaFile || isRecording) && (
              <div className="px-4 py-2 flex items-center gap-3 flex-shrink-0 border-t"
                style={{backgroundColor:'var(--surface-2)', borderColor:'var(--border)'}}>
                {isRecording ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-danger animate-pulse flex-shrink-0" />
                    <span className="text-sm font-semibold text-danger">{formatRecSecs(recordSecs)}</span>
                    <span className="text-xs" style={{color:'var(--text-muted)'}}>Grabando audio...</span>
                  </>
                ) : isImage && mediaPreview ? (
                  <>
                    <img src={mediaPreview} alt="preview" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
                    <span className="text-xs truncate flex-1" style={{color:'var(--text-3)'}}>{mediaFile!.name}</span>
                  </>
                ) : isAudio ? (
                  <>
                    <Mic size={18} color="#8696a0" className="flex-shrink-0" />
                    <audio controls src={mediaPreview!} className="h-8 flex-1" />
                  </>
                ) : (
                  <>
                    <FileText size={18} color="#8696a0" className="flex-shrink-0" />
                    <span className="text-xs truncate flex-1" style={{color:'var(--text-3)'}}>{mediaFile!.name}</span>
                  </>
                )}
                {!isRecording && (
                  <button onClick={clearMedia} className="p-1 rounded-full transition-colors flex-shrink-0"
                    style={{color:'var(--text-muted)'}}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor='var(--surface-4)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor='transparent'}>
                    <X size={15} />
                  </button>
                )}
              </div>
            )}

            {/* Input bar */}
            <div className="flex items-end gap-2 px-4 py-3 flex-shrink-0"
              style={{backgroundColor:'var(--surface)', borderTop:'1px solid var(--border)'}}>
              <input ref={fileInputRef} type="file"
                accept="image/*,audio/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx"
                className="hidden" onChange={handleFileSelect} />

              {/* Attach */}
              <button onClick={() => fileInputRef.current?.click()}
                disabled={isRecording}
                title="Adjuntar"
                className="p-2 rounded-full transition-colors flex-shrink-0 disabled:opacity-30"
                style={{color:'var(--text-muted)'}}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor='var(--surface-3)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor='transparent'}>
                <Paperclip size={20} />
              </button>

              {/* Textarea */}
              <textarea
                className="flex-1 resize-none text-sm outline-none"
                style={{
                  backgroundColor: 'var(--surface-3)',
                  color: 'var(--text)',
                  borderRadius: 8,
                  padding: '9px 12px',
                  minHeight: 42,
                  maxHeight: 120,
                  border: '1px solid var(--border)',
                  lineHeight: '1.5',
                }}
                rows={1}
                value={msgText}
                onChange={e => {
                  setMsgText(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
                  // Typing presence — debounced, stops after 3s idle
                  if (selectedConv && selectedConfig) {
                    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
                    sendTypingPresence(parseInt(selectedConfig), selectedConv.contact.id, true).catch(() => {})
                    typingTimerRef.current = setTimeout(() => {
                      sendTypingPresence(parseInt(selectedConfig), selectedConv.contact.id, false).catch(() => {})
                    }, 3000)
                  }
                }}
                placeholder={mediaFile ? 'Añade un pie de foto (opcional)...' : 'Escribe un mensaje aquí'}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
                }}
              />

              {/* Mic / Stop */}
              <button onClick={toggleRecording}
                disabled={!!mediaFile && !isRecording}
                title={isRecording ? 'Detener grabación' : 'Grabar audio'}
                className="p-2 rounded-full transition-colors flex-shrink-0 disabled:opacity-30"
                style={{
                  backgroundColor: isRecording ? 'var(--danger)' : 'transparent',
                  color: isRecording ? '#ffffff' : 'var(--text-muted)',
                }}>
                {isRecording ? <Square size={20} /> : <Mic size={20} />}
              </button>

              {/* Send */}
              <button onClick={handleSend}
                disabled={sending || isRecording || (!msgText.trim() && !mediaFile)}
                className="p-2.5 rounded-full flex items-center justify-center transition-colors flex-shrink-0 disabled:opacity-30"
                style={{backgroundColor:'var(--primary)', color:'#ffffff'}}>
                {sending
                  ? <RefreshCw size={18} className="animate-spin" />
                  : <Send size={18} />
                }
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      {showFill && selectedConv && (
        <WaFillContactModal
          messages={messages}
          conv={selectedConv}
          onClose={() => setShowFill(false)}
        />
      )}

      {/* Context menu */}
      {ctxMenu && (
        <MsgMenu
          x={ctxMenu.x} y={ctxMenu.y} msg={ctxMenu.msg}
          onClose={() => setCtxMenu(null)}
          onDelete={handleDeleteMsg}
          onEdit={msg => { setEditingMsg(msg); setEditText(msg.content) }}
          onRetry={handleRetryMsg}
        />
      )}

      {/* Edit modal */}
      {editingMsg && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end justify-center z-50 pb-6 px-4">
          <div className="bg-surface-1 rounded-2xl shadow-card-lg w-full max-w-lg overflow-hidden" style={{border:'1px solid var(--border)'}}>
            <div className="px-5 py-3.5 flex items-center justify-between" style={{borderBottom:'1px solid var(--border)'}}>
              <p className="font-semibold text-sm" style={{color:'var(--text)'}}>Editar mensaje</p>
              <button onClick={() => setEditingMsg(null)} className="p-1 rounded-full transition-colors" style={{color:'var(--text-muted)'}}
                onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='var(--surface-3)'}
                onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background=''}>
                <X size={16} />
              </button>
            </div>
            <div className="p-4">
              <textarea
                autoFocus
                className="w-full resize-none text-sm rounded-xl px-3 py-2.5 outline-none"
                style={{backgroundColor:'var(--surface-3)', border:'1px solid var(--border-2)', color:'var(--text)'}}
                rows={3}
                value={editText}
                onChange={e => setEditText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditMsg() } }}
              />
            </div>
            <div className="px-4 pb-4 flex gap-3">
              <button onClick={() => setEditingMsg(null)}
                className="flex-1 py-2 rounded-xl text-sm transition-colors" style={{border:'1px solid var(--border-2)', color:'var(--text-3)'}}>
                Cancelar
              </button>
              <button onClick={handleEditMsg}
                className="flex-1 py-2 rounded-xl text-sm font-semibold transition-colors"
                style={{backgroundColor:'var(--primary)', color:'#ffffff'}}>
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
