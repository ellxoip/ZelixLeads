import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Search, X, User, DollarSign, Building2, Phone, FileText, ChevronDown, StickyNote, Send, MessageSquare, Smartphone, RefreshCw, ExternalLink, Paperclip, Mic, Square, Clock, Check, CheckCheck, Trash2, Pencil, CheckCircle, RotateCcw, ChevronRight, Mail } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  getCobradorLeads, updateCobradorStage, updateCobradorNotes, updateCobradorMontoPagado,
  getAllWhatsAppConfigs, getWhatsAppMessages, sendWhatsAppMessage, sendWhatsAppMedia, avisoEnvioWhatsApp,
  markMessagesRead, deleteWhatsAppMessage, editWhatsAppMessage,
  getCobradorPortalUrl, markCobradorLeadSeen, markCobradorContactado, unmarkCobradorContactado, sendCobradorEmail,
  getGmailStatus, getGmailAuthUrl, disconnectGmail,
} from '../api'
import { useRealtime } from '../contexts/RealtimeContext'
import { useAuthStore } from '../store/auth'
import { format, isToday, isYesterday } from 'date-fns'
import { es } from 'date-fns/locale'
import { parseDate as parseAsUTC } from '../utils/dates'

interface CobradorLead {
  id: number
  cobrador_id: number
  contact_id: number | null
  nombre: string
  rut?: string | null
  empresa?: string | null
  telefono?: string | null
  email?: string | null
  monto_deuda: number
  monto_pagado: number
  num_cuotas?: number | null
  cuota_inicial?: number | null
  monto_cuota?: number | null
  lf_cuotas_vencidas?: number | null
  lf_total_facturado?: number | null
  lf_total_pagado?: number | null
  proxima_cuota_fecha?: string | null
  proxima_cuota_monto?: number | null
  pagacuotas_cliente_id?: number | null
  portal_url?: string | null
  descripcion?: string | null
  stage: string
  notes?: string | null
  is_new?: boolean
  is_contactado?: boolean
  contactado_at?: string | null
  created_at?: string
  contact?: { id: number; name: string; phone: string; email: string | null } | null
}

const STAGES: Record<string, { label: string; color: string; dot: string }> = {
  pendiente_moroso:  { label: 'Pendiente Moroso',  color: 'rgba(139,92,246,0.15)',  dot: '#8B5CF6' },
  lead_moroso:       { label: 'Lead Moroso',       color: 'rgba(239,68,68,0.15)',   dot: '#EF4444' },
  pago_comprometido: { label: 'Pago Comprometido', color: 'rgba(245,158,11,0.15)',  dot: '#F59E0B' },
  pagado:            { label: 'Pagado',             color: 'rgba(16,185,129,0.15)',  dot: '#10B981' },
}

function fmt(n: number) {
  return `$${Math.round(n).toLocaleString('es-CL')}`
}

function StageBadge({ stage }: { stage: string }) {
  const s = STAGES[stage] ?? { label: stage, color: 'rgba(107,114,128,0.15)', dot: '#6B7280' }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
      style={{ background: s.color, color: s.dot }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }} />
      {s.label}
    </span>
  )
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="flex items-start justify-between py-2 gap-4 border-b border-white/[0.06]">
      <dt className="text-xs font-medium flex-shrink-0 w-28 text-white/45">{label}</dt>
      <dd className="text-sm font-semibold text-right break-all text-white/85">{value}</dd>
    </div>
  )
}

function StageSelector({ lead, onUpdate }: { lead: CobradorLead; onUpdate: (l: CobradorLead) => void }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = async (stage: string) => {
    if (stage === lead.stage) { setOpen(false); return }
    setSaving(true); setOpen(false)
    try {
      const updated = await updateCobradorStage(lead.id, stage)
      onUpdate(updated)
      toast.success('Etapa actualizada')
    } catch { toast.error('Error al actualizar') }
    finally { setSaving(false) }
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(v => !v)} disabled={saving}
        className="flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold transition-all w-full"
        style={{ border: '1px solid rgba(28,22,51,0.14)', background: '#fff', color: 'var(--text)' }}>
        {saving
          ? <div className="w-3 h-3 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--primary)' }} />
          : <span className="w-2 h-2 rounded-full" style={{ background: STAGES[lead.stage]?.dot ?? '#6B7280' }} />}
        <span className="flex-1 text-left">{STAGES[lead.stage]?.label ?? lead.stage}</span>
        <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-xl overflow-hidden"
          style={{ background: '#fff', border: '1px solid rgba(28,22,51,0.14)', boxShadow: '0 8px 24px rgba(28,22,51,0.12)' }}>
          {Object.entries(STAGES).map(([key, s]) => (
            <button key={key} onClick={() => handleSelect(key)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-gray-50"
              style={{ color: lead.stage === key ? s.dot : 'var(--text)', background: lead.stage === key ? s.color : 'transparent' }}>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.dot }} />
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Chat helpers (identical to Leads.tsx) ─────────────────────────────────────

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
    parts.push(<a key={`url-${match.index}`} href={href} target="_blank" rel="noreferrer" className={linkClass}>{href}</a>)
    lastIndex = match.index + href.length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

function formatRecSecs(s: number) {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

const TICK_LABEL: Record<string, string> = { logged: 'Pendiente', sent: 'Enviado', delivered: 'Entregado', read: 'Leído', failed: 'Error' }

const WA_TICK_LABEL: Record<string, string> = { logged: 'Pendiente', sent: 'Enviado', delivered: 'Entregado', read: 'Leído', failed: 'Error' }
function WaTicks({ status }: { status: string }) {
  const label = WA_TICK_LABEL[status] ?? 'Enviado'
  if (status === 'failed')    return <span title={label} style={{ color:'#ef4444', fontSize:13, fontWeight:'bold', lineHeight:1 }}>!</span>
  if (status === 'logged')    return <span title={label}><Clock size={13} color="rgba(28,22,51,0.45)" /></span>
  if (status === 'read')      return <span title={label}><CheckCheck size={14} color="#53bdeb" strokeWidth={2.5} /></span>
  if (status === 'delivered') return <span title={label}><CheckCheck size={14} color="rgba(28,22,51,0.45)" strokeWidth={2.5} /></span>
  return <span title={label}><Check size={14} color="rgba(28,22,51,0.45)" strokeWidth={2.5} /></span>
}

function ChatMsgContent({ m }: { m: any }) {
  const type = m.message_type || 'text'
  const url = m.media_url || null
  if (type === 'image' || type === 'sticker' || (url && /\.(jpg|jpeg|png|webp|gif)$/i.test(url))) {
    if (!url) return <p className="text-xs opacity-60 italic">📷 Imagen</p>
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img src={url} alt="imagen" className="rounded-xl max-w-[220px] max-h-[220px] object-cover cursor-zoom-in" />
        {m.content && m.content !== '[Imagen]' && <p className="mt-1 text-sm whitespace-pre-wrap">{m.content}</p>}
      </a>
    )
  }
  if (type === 'audio' || (url && /\.(ogg|mp3|m4a|aac|opus|webm)$/i.test(url))) {
    if (!url) return <p className="text-xs opacity-60 italic">🎤 Audio</p>
    return <audio controls src={url} className="max-w-[220px] h-10 rounded-xl" />
  }
  if (type === 'video' || (url && /\.(mp4|webm|mov)$/i.test(url))) {
    if (!url) return <p className="text-xs opacity-60 italic">🎥 Video</p>
    return <video controls src={url} className="rounded-xl max-w-[220px] max-h-[160px]" />
  }
  if (type === 'document') {
    if (!url) return <p className="text-xs opacity-60 italic">📄 {m.content || 'Documento'}</p>
    const fname = url.split('/').pop() || 'archivo'
    return (
      <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm underline opacity-90">
        <FileText size={14} className="flex-shrink-0" />
        <span className="truncate max-w-[180px]">{m.content || fname}</span>
      </a>
    )
  }
  return <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{m.content}</p>
}

function ChatMsgMenu({ x, y, msg, onClose, onDelete, onEdit, onRetry }: {
  x: number; y: number; msg: any
  onClose: () => void
  onDelete: (id: number) => void
  onEdit: (msg: any) => void
  onRetry: (msg: any) => void
}) {
  const isOut = msg.direction === 'out'
  const canEdit = isOut && msg.message_type === 'text' && msg.status !== 'logged'
  const canRetry = isOut && msg.status === 'logged' && msg.message_type === 'text'
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed z-50 rounded-xl overflow-hidden"
        style={{ top: y, left: x, background:'#fff', border:'1px solid rgba(28,22,51,0.12)', boxShadow:'0 8px 24px rgba(0,0,0,0.14)', minWidth:160 }}>
        {canRetry && (
          <button onClick={() => { onRetry(msg); onClose() }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-amber-50 transition-colors"
            style={{ color:'#d97706' }}>
            <RefreshCw size={14} color="#d97706" />Reintentar envío
          </button>
        )}
        {canEdit && (
          <button onClick={() => { onEdit(msg); onClose() }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-gray-50 transition-colors"
            style={{ color:'var(--text)' }}>
            <Pencil size={14} color="#6B7280" />Editar mensaje
          </button>
        )}
        <button onClick={() => { onDelete(msg.id); onClose() }}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-red-50 transition-colors"
          style={{ color:'#EF4444' }}>
          <Trash2 size={14} color="#EF4444" />Eliminar mensaje
        </button>
      </div>
    </>
  )
}

// ── WA Audio Player (identical to Leads.tsx) ──────────────────────────────────

function WaAudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const toggle = () => { const a = audioRef.current; if (!a) return; playing ? a.pause() : a.play(); setPlaying(!playing) }
  const fmtTime = (s: number) => { if (!isFinite(s) || isNaN(s)) return '0:00'; return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}` }
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => { const a = audioRef.current; if (!a || !duration) return; const rect = e.currentTarget.getBoundingClientRect(); a.currentTime = ((e.clientX - rect.left) / rect.width) * duration }
  return (
    <div className="flex items-center gap-2.5 py-1" style={{ minWidth:200, maxWidth:240 }}>
      <audio ref={audioRef} src={src}
        onTimeUpdate={e => { const a = e.currentTarget; setCurrentTime(a.currentTime); setProgress(a.duration ? (a.currentTime/a.duration)*100 : 0) }}
        onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
        onEnded={() => { setPlaying(false); setProgress(0); setCurrentTime(0) }} />
      <button onClick={toggle} className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background:'#25d366', color:'#fff' }}>
        {playing ? <Square size={12} fill="white" /> : <svg width="12" height="12" viewBox="0 0 12 12" fill="white"><polygon points="2,1 11,6 2,11" /></svg>}
      </button>
      <div className="flex-1 flex flex-col gap-1">
        <div className="relative h-1.5 rounded-full cursor-pointer overflow-hidden" style={{ background:'rgba(17,27,33,0.15)' }} onClick={handleSeek}>
          <div className="absolute left-0 top-0 h-full rounded-full" style={{ width:`${progress}%`, background:'#25d366' }} />
        </div>
        <span style={{ fontSize:10, color:'rgba(17,27,33,0.5)' }}>{playing || currentTime > 0 ? fmtTime(currentTime) : fmtTime(duration)}</span>
      </div>
      <Mic size={14} style={{ color:'rgba(17,27,33,0.4)', flexShrink:0 }} />
    </div>
  )
}

function WaChatMsgContent({ m }: { m: any }) {
  const type = m.message_type || 'text'
  const url = m.media_url || null
  if (!m.content && !url) return null
  if (url && (type === 'image' || /\.(jpg|jpeg|png|webp|gif)$/i.test(url))) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img src={url} alt="imagen" className="rounded-xl max-w-[220px] max-h-[220px] object-cover cursor-zoom-in" />
        {m.content && m.content !== '[Imagen]' && !/\.(jpg|jpeg|png|gif|webp|mp4|webm|mov|ogg|mp3|m4a|aac|opus|pdf|doc|docx|xls|xlsx)$/i.test(m.content) && (
          <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color:'#111b21' }}>{m.content}</p>
        )}
      </a>
    )
  }
  if (url && (type === 'audio' || /\.(ogg|mp3|m4a|aac|opus|webm)$/i.test(url))) return <WaAudioPlayer src={url} />
  if (url && (type === 'video' || /\.(mp4|webm|mov)$/i.test(url))) return <video controls src={url} className="rounded-xl max-w-[220px] max-h-[180px]" />
  if (url && type === 'document') {
    const fname = url.split('/').pop() || 'archivo'
    return (
      <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm underline underline-offset-2" style={{ color:'#111b21' }}>
        <FileText size={13} className="flex-shrink-0" />
        <span className="truncate max-w-[180px]">{m.content || fname}</span>
      </a>
    )
  }
  return <p className="leading-relaxed whitespace-pre-wrap text-[13px]" style={{ color:'#111b21', wordBreak:'break-word', overflowWrap:'anywhere' }}>{renderLinkified(m.content, 'underline underline-offset-2 text-[#027eb5] hover:text-[#015d87]')}</p>
}

// ── Chat Tab ──────────────────────────────────────────────────────────────────

function ChatTab({ lead }: { lead: CobradorLead }) {
  const { user } = useAuthStore()
  const [messages, setMessages]         = useState<any[]>([])
  const [configs, setConfigs]           = useState<any[]>([])
  const [selectedConfigId, setSelectedConfigId] = useState('')
  const [msgText, setMsgText]           = useState('')
  const [sending, setSending]           = useState(false)
  const [loadingMsgs, setLoadingMsgs]   = useState(true)
  const [loadingUrl, setLoadingUrl]     = useState(false)
  const [mediaFile, setMediaFile]       = useState<File | null>(null)
  const [mediaPreview, setMediaPreview] = useState<string | null>(null)
  const [isRecording, setIsRecording]   = useState(false)
  const [micBusy, setMicBusy]           = useState(false)
  const [recordSecs, setRecordSecs]     = useState(0)
  const [ctxMenu, setCtxMenu]           = useState<{ x: number; y: number; msg: any } | null>(null)
  const [editingMsg, setEditingMsg]     = useState<any | null>(null)
  const [editText, setEditText]         = useState('')

  const endRef           = useRef<HTMLDivElement>(null)
  const fileInputRef     = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef   = useRef<Blob[]>([])
  const recordTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollRef          = useRef<ReturnType<typeof setInterval> | null>(null)

  const configId = selectedConfigId || configs[0]?.id?.toString() || ''

  useEffect(() => {
    getAllWhatsAppConfigs().then((all: any[]) => {
      const list = all.filter((c: any) => c.is_active !== false)
      setConfigs(list)
      if (list.length > 0) setSelectedConfigId(list[0].id.toString())
    }).catch(() => {})
  }, [user?.id])

  const loadMessages = async () => {
    if (!lead.contact_id) { setLoadingMsgs(false); return }
    try {
      const data = await getWhatsAppMessages({ contact_id: lead.contact_id })
      setMessages(data.slice().reverse())
    } catch { /* silent */ }
    finally { setLoadingMsgs(false) }
  }

  useEffect(() => {
    if (!lead.contact_id) { setLoadingMsgs(false); return }
    setLoadingMsgs(true)
    loadMessages()
    markMessagesRead(lead.contact_id).catch(() => {})

    const contactId = lead.contact_id

    pollRef.current = setInterval(() => {
      getWhatsAppMessages({ contact_id: contactId }).then(data => setMessages(data.slice().reverse())).catch(() => {})
    }, 8000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
    }
  }, [lead.contact_id])

  useRealtime(['new_message', 'status_update', 'refresh'], (evt) => {
    const contactId = lead.contact_id
    if (!contactId) return
    if (evt.type === 'new_message' && evt.message?.contact_id === contactId) {
      setMessages(prev => {
        const idx = prev.findIndex((m: any) => m.id === evt.message.id)
        if (idx !== -1) { const u = [...prev]; u[idx] = { ...prev[idx], ...evt.message }; return u }
        return [...prev, evt.message]
      })
    }
    if (evt.type === 'status_update') {
      setMessages(prev => prev.map((m: any) => m.id === evt.db_id ? { ...m, status: evt.status } : m))
    }
    if (evt.type === 'refresh') {
      getWhatsAppMessages({ contact_id: contactId }).then(data => setMessages(data.slice().reverse())).catch(() => {})
    }
  })

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const clearMedia = useCallback(() => {
    if (mediaPreview) URL.revokeObjectURL(mediaPreview)
    setMediaFile(null); setMediaPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [mediaPreview])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 16 * 1024 * 1024) { toast.error('El archivo no puede superar 16 MB'); return }
    clearMedia(); setMediaFile(file); setMediaPreview(URL.createObjectURL(file))
  }

  const toggleRecording = async () => {
    if (isRecording) {
      if (mediaRecorderRef.current) mediaRecorderRef.current.stop()
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
      setIsRecording(false); return
    }
    if (micBusy) return
    setMicBusy(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioChunksRef.current = []
      const mimeTypes = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg','audio/mp4']
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
        clearMedia(); setMediaFile(file); setMediaPreview(URL.createObjectURL(blob)); setRecordSecs(0)
      }
      mr.start(250); setIsRecording(true); setRecordSecs(0)
      recordTimerRef.current = setInterval(() => setRecordSecs(s => s + 1), 1000)
    } catch { toast.error('Permite el acceso al micrófono en tu navegador') }
    finally { setMicBusy(false) }
  }

  const handleSend = async () => {
    if (!lead.contact_id || !configId) { toast.error('Sin número WhatsApp configurado'); return }
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
        const result = await sendWhatsAppMedia(fd)
        { const aviso = avisoEnvioWhatsApp(result); if (aviso) toast.error(aviso) }
        clearMedia(); setMsgText('')
      } else {
        const result = await sendWhatsAppMessage({ contact_id: lead.contact_id, whatsapp_config_id: parseInt(configId), message: msgText.trim() })
        { const aviso = avisoEnvioWhatsApp(result); if (aviso) toast.error(aviso) }
        setMsgText('')
      }
      loadMessages()
    } catch { toast.error('Error enviando mensaje') }
    finally { setSending(false) }
  }

  const handleDeleteMsg = async (id: number) => {
    try { await deleteWhatsAppMessage(id); setMessages(prev => prev.filter(m => m.id !== id)); setCtxMenu(null) }
    catch { toast.error('Error al eliminar') }
  }

  const handleEditMsg = async () => {
    if (!editingMsg || !editText.trim()) return
    try {
      const updated = await editWhatsAppMessage(editingMsg.id, editText)
      setMessages(prev => prev.map(m => m.id === updated.id ? updated : m))
      setEditingMsg(null); setEditText('')
    } catch { toast.error('Error al editar') }
  }

  const isImage = mediaFile?.type.startsWith('image/')
  const isAudio = mediaFile?.type.startsWith('audio/')

  if (!lead.contact_id) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center gap-3">
        <MessageSquare size={28} style={{ color: '#25D366', opacity: 0.6 }} />
        <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>Sin contacto vinculado</p>
        {lead.telefono && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Tel: {lead.telefono}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages — WA background */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 flex flex-col wa-chat-bg">
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center" style={{ color:'rgba(17,27,33,0.40)' }}>
            {loadingMsgs
              ? <div className="w-5 h-5 border-2 rounded-full animate-spin mb-2" style={{ borderColor:'rgba(17,27,33,0.12)', borderTopColor:'#25d366' }} />
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
                    const label = isToday(d) ? 'Hoy' : isYesterday(d) ? 'Ayer' : format(d, "d 'de' MMMM yyyy", { locale: es })
                    items.push(
                      <div key={`sep-${dateStr}`} className="flex items-center justify-center my-3">
                        <span className="text-[11px] font-medium px-3 py-1 rounded-full"
                          style={{ background:'#ffffff', color:'rgba(17,27,33,0.6)', boxShadow:'0 1px 0.5px rgba(11,20,26,0.13)' }}>
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
                            padding:'6px 10px 5px 10px',
                            boxShadow:'0 1px 0.5px rgba(11,20,26,0.13)',
                            position:'relative', zIndex:1, cursor:'default',
                          }}>
                          <WaChatMsgContent m={m} />
                          <div className="flex items-center justify-end gap-1" style={{ minHeight:15, marginTop:2 }}>
                            <span style={{ color:'rgba(17,27,33,0.5)', fontSize:11, whiteSpace:'nowrap' }}>
                              {format(parseAsUTC(m.created_at), 'HH:mm', { locale: es })}
                            </span>
                            {out && (
                              <span title={TICK_LABEL[m.status] ?? 'Enviado'}>
                                {m.status === 'failed' ? <span style={{ color:'#ef4444', fontWeight:'bold', fontSize:13 }}>!</span>
                                  : m.status === 'logged' ? <Clock size={13} color="#8696a0" />
                                  : m.status === 'read' ? <CheckCheck size={16} color="#53bdeb" strokeWidth={2.5} />
                                  : m.status === 'delivered' ? <CheckCheck size={16} color="#8696a0" strokeWidth={2.5} />
                                  : <Check size={16} color="#8696a0" strokeWidth={2.5} />}
                              </span>
                            )}
                          </div>
                        </div>
                        <button onClick={e => setCtxMenu({ x: e.clientX, y: e.clientY, msg: m })}
                          className="absolute top-1 opacity-0 group-hover:opacity-100 transition-opacity rounded-full p-0.5"
                          style={{ ...(out ? { left:-20 } : { right:-20 }), background: out ? WA_OUT : WA_IN, fontSize:12, color:'rgba(17,27,33,0.45)' }}>
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
        <div className="px-4 py-2 flex items-center gap-3 flex-shrink-0" style={{ borderTop:'1px solid #e9edef', backgroundColor:'#f0f2f5' }}>
          {isRecording ? (
            <>
              <span className="w-2 h-2 rounded-full animate-pulse flex-shrink-0" style={{ backgroundColor:'#ef4444' }} />
              <span className="text-sm font-semibold" style={{ color:'#ef4444' }}>{formatRecSecs(recordSecs)}</span>
              <span className="text-xs" style={{ color:'#54656f' }}>Grabando...</span>
            </>
          ) : isImage && mediaPreview ? (
            <>
              <img src={mediaPreview} alt="preview" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
              <span className="text-xs truncate flex-1" style={{ color:'#54656f' }}>{mediaFile!.name}</span>
            </>
          ) : isAudio ? (
            <>
              <Mic size={16} style={{ color:'#54656f', flexShrink:0 }} />
              <audio controls src={mediaPreview!} className="h-8 flex-1" />
            </>
          ) : (
            <>
              <FileText size={16} style={{ color:'#54656f', flexShrink:0 }} />
              <span className="text-xs truncate flex-1" style={{ color:'#54656f' }}>{mediaFile!.name}</span>
            </>
          )}
          {!isRecording && (
            <button onClick={clearMedia} className="p-1 rounded-full flex-shrink-0" style={{ color:'#54656f' }}>
              <X size={13} />
            </button>
          )}
        </div>
      )}

      {/* Input bar — identical to Leads.tsx */}
      <div className="flex items-end gap-2 px-2 py-2 flex-shrink-0" style={{ backgroundColor:'#f0f2f5', borderTop:'1px solid #e9edef' }}>
        <input ref={fileInputRef} type="file" accept="image/*,audio/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx"
          className="hidden" onChange={handleFileSelect} />
        <button onClick={() => fileInputRef.current?.click()} disabled={!configId || isRecording}
          title="Adjuntar" className="p-2 rounded-full transition-colors flex-shrink-0 disabled:opacity-30"
          style={{ color:'#54656f' }}>
          <Paperclip size={22} />
        </button>
        <textarea
          className="flex-1 resize-none text-sm outline-none rounded-xl px-4 py-2.5"
          style={{ minHeight:42, maxHeight:100, lineHeight:'1.5', backgroundColor:'#ffffff', border:'none', color:'#111b21' }}
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
        {msgText.trim() || mediaFile ? (
          <button onClick={handleSend} disabled={sending || isRecording || !configId}
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-30"
            style={{ backgroundColor:'#00a884', color:'#ffffff' }}>
            {sending ? <RefreshCw size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        ) : (
          <button onClick={toggleRecording} disabled={!configId || micBusy}
            title={isRecording ? 'Detener grabación' : 'Grabar audio'}
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-30"
            style={{ backgroundColor: isRecording ? '#ef4444' : '#00a884', color:'#ffffff' }}>
            {isRecording ? <Square size={18} /> : <Mic size={18} />}
          </button>
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCtxMenu(null)} />
          <div className="fixed z-50 rounded-xl shadow-2xl overflow-hidden"
            style={{ top:ctxMenu.y, left:ctxMenu.x, background:'#fff', border:'1px solid rgba(28,22,51,0.12)', minWidth:160 }}>
            {ctxMenu.msg.direction === 'out' && ctxMenu.msg.message_type === 'text' && (
              <button onClick={() => { setEditingMsg(ctxMenu.msg); setEditText(ctxMenu.msg.content); setCtxMenu(null) }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-gray-50"
                style={{ color:'#111b21' }}>
                <Pencil size={14} style={{ color:'#8696a0' }} /> Editar mensaje
              </button>
            )}
            <button onClick={() => handleDeleteMsg(ctxMenu.msg.id)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-red-50"
              style={{ color:'#ef4444' }}>
              <Trash2 size={14} style={{ color:'#ef4444' }} /> Eliminar mensaje
            </button>
          </div>
        </>
      )}

      {/* Edit modal */}
      {editingMsg && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end justify-center z-50 pb-6 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden" style={{ border:'1px solid rgba(28,22,51,0.10)' }}>
            <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom:'1px solid rgba(28,22,51,0.10)' }}>
              <p className="font-semibold text-sm" style={{ color:'#111b21' }}>Editar mensaje</p>
              <button onClick={() => setEditingMsg(null)} className="p-1 rounded-full hover:bg-gray-100">
                <X size={15} style={{ color:'rgba(28,22,51,0.50)' }} />
              </button>
            </div>
            <div className="p-4">
              <textarea autoFocus className="w-full resize-none text-sm rounded-xl px-3 py-2.5 outline-none"
                style={{ background:'rgba(28,22,51,0.04)', border:'1px solid rgba(28,22,51,0.12)', color:'#111b21' }}
                rows={3} value={editText}
                onChange={e => setEditText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditMsg() } }}
              />
            </div>
            <div className="px-4 pb-4 flex gap-2">
              <button onClick={() => setEditingMsg(null)}
                className="flex-1 py-2 rounded-xl text-sm border" style={{ color:'rgba(28,22,51,0.60)' }}>
                Cancelar
              </button>
              <button onClick={handleEditMsg}
                className="flex-1 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ background:'#00a884' }}>
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function DetailPanel({ lead, onUpdate, onClose }: {
  lead: CobradorLead
  onUpdate: (l: CobradorLead) => void
  onClose?: () => void
}) {
  const [activeTab, setActiveTab] = useState<'info' | 'chat' | 'notas' | 'correo'>('info')
  const [notes, setNotes] = useState(lead.notes ?? '')
  const [montoPagado, setMontoPagado] = useState(() => {
    const pc = lead.monto_pagado === 0 && (lead.cuota_inicial ?? 0) > 0
      ? lead.cuota_inicial! : (lead.proxima_cuota_monto ?? lead.monto_cuota ?? 0)
    return String(lead.monto_pagado + pc)
  })
  const [savingNotes, setSavingNotes] = useState(false)
  const [savingMonto, setSavingMonto] = useState(false)

  useEffect(() => {
    const pc = lead.monto_pagado === 0 && (lead.cuota_inicial ?? 0) > 0
      ? lead.cuota_inicial! : (lead.proxima_cuota_monto ?? lead.monto_cuota ?? 0)
    setNotes(lead.notes ?? '')
    setMontoPagado(String(lead.monto_pagado + pc))
  }, [lead.id, lead.notes, lead.monto_pagado])

  const handleSaveNotes = async () => {
    if (notes === (lead.notes ?? '')) return
    setSavingNotes(true)
    try {
      const updated = await updateCobradorNotes(lead.id, notes)
      onUpdate(updated); toast.success('Notas guardadas')
    } catch { toast.error('Error al guardar') }
    finally { setSavingNotes(false) }
  }

  const handleSaveMonto = async () => {
    const val = parseFloat(montoPagado) || 0
    if (val === lead.monto_pagado) return
    setSavingMonto(true)
    try {
      const updated = await updateCobradorMontoPagado(lead.id, val)
      onUpdate(updated); toast.success('Monto actualizado')
    } catch { toast.error('Error al guardar') }
    finally { setSavingMonto(false) }
  }

  const [advancingStage, setAdvancingStage] = useState(false)
  const STAGE_ORDER = ['pendiente_moroso', 'lead_moroso', 'pago_comprometido', 'pagado']
  const nextStage = STAGE_ORDER[STAGE_ORDER.indexOf(lead.stage) + 1] ?? null

  const handleAdvanceStage = async () => {
    if (!nextStage || advancingStage) return
    setAdvancingStage(true)
    try {
      const updated = await updateCobradorStage(lead.id, nextStage)
      onUpdate({ ...lead, ...updated })
      toast.success(`Movido a ${STAGES[nextStage]?.label ?? nextStage}`)
    } catch { toast.error('Error al avanzar etapa') }
    finally { setAdvancingStage(false) }
  }

  const [gmailStatus, setGmailStatus] = useState<{ connected: boolean; gmail_email: string | null; configured: boolean } | null>(null)
  const [loadingGmail, setLoadingGmail] = useState(false)

  useEffect(() => {
    getGmailStatus().then(setGmailStatus).catch(() => {})
  }, [])

  const handleConnectGmail = async () => {
    try {
      const { url } = await getGmailAuthUrl()
      const popup = window.open(url, 'gmail-oauth', 'width=500,height=620,scrollbars=yes')
      const handler = (e: MessageEvent) => {
        if (e.data?.googleGmail === 'connected') {
          window.removeEventListener('message', handler)
          popup?.close()
          getGmailStatus().then(setGmailStatus)
          toast.success(`Gmail conectado: ${e.data.email}`)
        } else if (e.data?.googleGmail === 'error') {
          window.removeEventListener('message', handler)
          toast.error('Error conectando Gmail')
        }
      }
      window.addEventListener('message', handler)
    } catch { toast.error('No se pudo obtener URL de autorización') }
  }

  const handleDisconnectGmail = async () => {
    setLoadingGmail(true)
    try { await disconnectGmail(); setGmailStatus(s => s ? { ...s, connected: false, gmail_email: null } : null); toast.success('Gmail desconectado') }
    catch { toast.error('Error') }
    finally { setLoadingGmail(false) }
  }

  const defaultSubject = `Recordatorio de pago - ${lead.empresa || lead.nombre}`
  const defaultBody = `Estimado/a ${lead.nombre},\n\nLe recordamos que tiene una cuota pendiente de pago.\n\nMonto a cancelar: $${lead.proxima_cuota_monto?.toLocaleString('es-CL') ?? lead.monto_cuota?.toLocaleString('es-CL') ?? '0'}\nFecha vencimiento: ${lead.proxima_cuota_fecha ?? 'a la brevedad'}\n\nPara realizar su pago o consultar su situación, por favor contáctenos.\n\nSaludos,\nEquipo de Cobranza`
  const [emailSubject, setEmailSubject] = useState(defaultSubject)
  const [emailBody, setEmailBody] = useState(defaultBody)
  const [emailDest, setEmailDest] = useState(lead.email ?? '')
  const [sendingEmail, setSendingEmail] = useState(false)

  const handleSendEmail = async () => {
    if (!emailSubject.trim() || !emailBody.trim() || !emailDest.trim() || sendingEmail) return
    setSendingEmail(true)
    try {
      await sendCobradorEmail(lead.id, emailSubject, emailBody, emailDest)
      toast.success(`Correo enviado a ${emailDest}`)
    } catch (e: any) {
      const detail = (e as any)?.response?.data?.detail || 'Error al enviar correo'
      // If no email on lead, try sending directly via override
      toast.error(detail)
    } finally { setSendingEmail(false) }
  }

  const [markingContactado, setMarkingContactado] = useState(false)

  const handleContactado = async () => {
    if (lead.is_contactado || markingContactado) return
    setMarkingContactado(true)
    try {
      const result = await markCobradorContactado(lead.id)
      onUpdate({ ...lead, is_contactado: true, contactado_at: result.contactado_at, stage: result.stage })
      toast.success(result.lf_updated ? '✅ Marcado como contactado en ZelixLeads y Legal Finance' : '✅ Marcado como contactado')
    } catch { toast.error('Error al marcar como contactado') }
    finally { setMarkingContactado(false) }
  }

  const handleDescontactar = async () => {
    if (!lead.is_contactado || markingContactado) return
    setMarkingContactado(true)
    try {
      const result = await unmarkCobradorContactado(lead.id)
      onUpdate({ ...lead, is_contactado: false, contactado_at: null, stage: result.stage })
      toast.success(result.lf_updated ? '↩️ Revertido a Moroso en ZelixLeads y Legal Finance' : '↩️ Revertido a Moroso')
    } catch { toast.error('Error al revertir contactado') }
    finally { setMarkingContactado(false) }
  }

  const pendiente = lead.monto_deuda - lead.monto_pagado
  const pct = lead.monto_deuda > 0 ? Math.min((lead.monto_pagado / lead.monto_deuda) * 100, 100) : 0

  const TABS = [
    { key: 'info',   label: 'Info' },
    { key: 'chat',   label: 'Chat' },
    { key: 'notas',  label: 'Notas' },
    { key: 'correo', label: 'Correo' },
  ] as const

  return (
    <div className="flex flex-col h-full">
      {/* Header — dark like Leads */}
      <div className="px-5 py-3.5 border-b border-white/[0.07] flex items-center gap-3 flex-shrink-0">
        {onClose && (
          <button onClick={onClose}
            className="p-2 rounded-xl text-white/38 hover:text-white/78 hover:bg-surface-2 transition-colors flex-shrink-0">
            <X size={18} />
          </button>
        )}
        <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-base text-white"
          style={{ background: `${STAGES[lead.stage]?.dot ?? 'var(--zx-accent-text)'}33`, border: `1.5px solid ${STAGES[lead.stage]?.dot ?? 'var(--zx-accent-text)'}55` }}>
          {lead.nombre.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-white truncate leading-tight">{lead.nombre}</h2>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {lead.telefono && (
              <a href={`tel:${lead.telefono}`}
                className="flex items-center gap-1 text-[11px] text-white/40 hover:text-lime transition-colors"
                title="Llamar">
                <Phone size={10} />{lead.telefono}
              </a>
            )}
            <StageBadge stage={lead.stage} />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {nextStage && (
            <button
              onClick={handleAdvanceStage}
              disabled={advancingStage}
              title={`Mover a ${STAGES[nextStage]?.label}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:scale-105"
              style={{ background: `${STAGES[nextStage]?.dot ?? '#F59E0B'}18`, color: STAGES[nextStage]?.dot ?? '#F59E0B', border: `1px solid ${STAGES[nextStage]?.dot ?? '#F59E0B'}33` }}>
              {advancingStage
                ? <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                : <><ChevronRight size={13} />{STAGES[nextStage]?.label}</>}
            </button>
          )}
          {lead.telefono && (
            <a href={`https://wa.me/${lead.telefono.replace(/[^0-9]/g, '')}`}
              target="_blank" rel="noreferrer"
              title="Llamar por WhatsApp"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold flex-shrink-0 transition-all hover:scale-105"
              style={{ background: '#25D36622', color: '#25D366', border: '1px solid #25D36644' }}>
              <Phone size={13} />
              Llamar
            </a>
          )}
        </div>
      </div>

      {/* Tabs — lime active like Leads */}
      <div className="flex border-b border-white/[0.07] px-3 flex-shrink-0">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-4 py-3 text-xs font-bold border-b-2 transition-all ${
              activeTab === t.key
                ? 'border-lime text-white'
                : 'border-transparent text-white/35 hover:text-white/60 hover:border-white/15'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'chat' ? (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <ChatTab lead={lead} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-surface-0">
          {activeTab === 'info' && (
            <>
              {/* HONORARIOS */}
              <div className="rounded-xl overflow-hidden border border-white/[0.08]">
                <div className="px-4 py-2.5 flex items-center gap-2 border-b border-white/[0.08] bg-surface-2">
                  <DollarSign size={13} className="text-primary" />
                  <span className="text-xs font-black uppercase tracking-wider text-white/70">Honorarios</span>
                </div>
                <div className="bg-surface-1 px-4 pb-1">
                  <InfoRow label="Total facturado" value={lead.monto_deuda > 0 ? fmt(lead.monto_deuda) : undefined} />
                  <InfoRow label="Nº Cuotas" value={lead.num_cuotas != null ? String(lead.num_cuotas) : '1'} />
                  <InfoRow label="Cuota inicial" value={lead.cuota_inicial != null && lead.cuota_inicial > 0 ? fmt(lead.cuota_inicial) : undefined} />
                  <InfoRow label="Monto cuota" value={lead.monto_cuota != null && lead.monto_cuota > 0 ? fmt(lead.monto_cuota) : undefined} />
                </div>
              </div>

              {/* Saldo — 3 stat cards */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl p-3 text-center bg-surface-2 border border-white/[0.07]">
                  <p className="text-[9px] font-bold uppercase tracking-wider mb-1 text-primary/70">Total facturado</p>
                  <p className="text-xs font-black text-primary">{fmt(lead.monto_deuda)}</p>
                </div>
                <div className="rounded-xl p-3 text-center bg-surface-2 border border-white/[0.07]">
                  <p className="text-[9px] font-bold uppercase tracking-wider mb-1 text-lime/70">Total pagado</p>
                  <p className="text-xs font-black text-lime">{fmt(lead.monto_pagado)}</p>
                </div>
                <div className="rounded-xl p-3 text-center bg-surface-2 border border-white/[0.07]">
                  <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: pendiente > 0 ? 'rgba(239,68,68,0.8)' : 'rgba(163,230,53,0.8)' }}>Pendiente</p>
                  <p className="text-xs font-black" style={{ color: pendiente > 0 ? '#ef4444' : '#a3e635' }}>{fmt(Math.max(pendiente, 0))}</p>
                </div>
              </div>

              {/* Próxima cuota */}
              {lead.proxima_cuota_fecha && (
                <div className="rounded-xl px-4 py-3 flex items-center justify-between bg-surface-2 border border-white/[0.07]">
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-amber-400/70">Próxima cuota</p>
                    <p className="text-sm font-black mt-0.5 text-white">{lead.proxima_cuota_fecha}</p>
                  </div>
                  {lead.proxima_cuota_monto != null && lead.proxima_cuota_monto > 0 && (
                    <p className="text-base font-black text-amber-400">{fmt(lead.proxima_cuota_monto)}</p>
                  )}
                </div>
              )}

              {/* Cuotas vencidas */}
              {(lead.lf_cuotas_vencidas ?? 0) > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                  style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0 bg-red-500" />
                  <span className="text-xs font-semibold text-red-400">
                    {lead.lf_cuotas_vencidas} cuota{(lead.lf_cuotas_vencidas ?? 0) > 1 ? 's' : ''} vencida{(lead.lf_cuotas_vencidas ?? 0) > 1 ? 's' : ''} · Legal Finance
                  </span>
                </div>
              )}

              <div>
                <label className="text-xs font-bold uppercase tracking-wider mb-1.5 block text-white/40">Etapa</label>
                <StageSelector lead={lead} onUpdate={onUpdate} />
              </div>

              {/* CONTACTADO */}
              <div className="rounded-xl overflow-hidden border border-white/[0.08]">
                <div className="px-3 py-2 bg-surface-2 border-b border-white/[0.07] flex items-center gap-2">
                  <CheckCircle size={12} className="text-white/30" />
                  <span className="text-[10px] font-black uppercase tracking-wider text-white/40">Gestión de contacto</span>
                </div>
                <div className="bg-surface-1 p-3">
                  {lead.is_contactado ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.25)' }}>
                          <CheckCircle size={15} style={{ color: '#10B981' }} />
                        </div>
                        <div>
                          <p className="text-xs font-bold" style={{ color: '#10B981' }}>Contactado</p>
                          {lead.contactado_at && (
                            <p className="text-[10px] text-white/35 mt-0.5">
                              {new Date(lead.contactado_at).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </p>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={handleDescontactar}
                        disabled={markingContactado}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:bg-red-500/10"
                        style={{ color: 'rgba(248,113,113,0.8)', border: '1px solid rgba(239,68,68,0.20)' }}>
                        {markingContactado
                          ? <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          : <><RotateCcw size={11} />Revertir</>}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={handleContactado}
                      disabled={markingContactado}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all hover:scale-[1.01] active:scale-[0.99]"
                      style={{
                        background: 'linear-gradient(135deg, rgba(53,122,14,0.20) 0%, rgba(99,102,241,0.12) 100%)',
                        color: '#818cf8',
                        border: '1.5px solid rgba(99,102,241,0.30)',
                      }}>
                      {markingContactado
                        ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        : <><Phone size={14} />Marcar como Contactado</>}
                    </button>
                  )}
                </div>
              </div>

              {/* Datos del deudor */}
              <div className="rounded-xl p-4 bg-surface-2 border border-white/[0.07]">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-primary/10">
                    <User size={13} className="text-primary" />
                  </div>
                  <h4 className="text-sm font-bold text-white/80">Datos del Deudor</h4>
                </div>
                <dl>
                  <InfoRow label="Nombre"   value={lead.nombre} />
                  <InfoRow label="RUT"      value={lead.rut} />
                  <InfoRow label="Empresa"  value={lead.empresa} />
                  <InfoRow label="Teléfono" value={lead.telefono} />
                  <InfoRow label="Email"    value={lead.email} />
                </dl>
              </div>

              {lead.descripcion && (
                <div className="rounded-xl p-4 bg-surface-2 border border-white/[0.07]">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText size={13} className="text-amber-400" />
                    <h4 className="text-sm font-bold text-white/80">Descripción</h4>
                  </div>
                  <p className="text-sm text-white/55 leading-relaxed">{lead.descripcion}</p>
                </div>
              )}
            </>
          )}

          {activeTab === 'correo' && (
            <div className="space-y-3">
              {!gmailStatus?.connected ? (
                <div className="rounded-xl overflow-hidden border border-white/[0.08]">
                  <div className="px-4 py-2.5 flex items-center gap-2 border-b border-white/[0.08] bg-surface-2">
                    <Mail size={12} className="text-primary" />
                    <span className="text-xs font-black uppercase tracking-wider text-white/70">Conectar Gmail</span>
                  </div>
                  <div className="bg-surface-1 p-4 text-center space-y-3">
                    <p className="text-xs text-white/40">Conecta tu Gmail para enviar correos directamente desde el panel.</p>
                    {!gmailStatus?.configured && (
                      <p className="text-[10px] text-amber-400/70">Google OAuth no configurado. Contacta al administrador.</p>
                    )}
                    <button onClick={handleConnectGmail} disabled={!gmailStatus?.configured}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all"
                      style={{ background: 'rgba(234,67,53,0.15)', color: '#ea4335', border: '1.5px solid rgba(234,67,53,0.30)', opacity: !gmailStatus?.configured ? 0.4 : 1 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                      Conectar Gmail
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl overflow-hidden border border-white/[0.08]">
                  <div className="px-4 py-2.5 flex items-center gap-2 border-b border-white/[0.08] bg-surface-2">
                    <Mail size={12} className="text-emerald-400" />
                    <span className="text-xs font-black uppercase tracking-wider text-white/70">Enviar Correo</span>
                    <span className="ml-auto text-[10px] text-emerald-400 font-semibold truncate max-w-[140px]">{gmailStatus.gmail_email}</span>
                    <button onClick={handleDisconnectGmail} disabled={loadingGmail}
                      className="text-white/25 hover:text-red-400 transition-colors text-xs ml-1" title="Desconectar">✕</button>
                  </div>
                  <div className="bg-surface-1 p-3 space-y-2">
                    <input className="w-full text-xs rounded-lg px-3 py-2 outline-none bg-surface-2 border border-white/10 text-white/85 placeholder:text-white/25 focus:border-white/25"
                      placeholder="Correo destinatario" type="email" value={emailDest} onChange={e => setEmailDest(e.target.value)} />
                    <input className="w-full text-xs rounded-lg px-3 py-2 outline-none bg-surface-2 border border-white/10 text-white/85 placeholder:text-white/25 focus:border-white/25"
                      placeholder="Asunto" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} />
                    <textarea className="w-full resize-none text-xs rounded-lg px-3 py-2 outline-none bg-surface-2 border border-white/10 text-white/85 placeholder:text-white/25 focus:border-white/25"
                      rows={8} value={emailBody} onChange={e => setEmailBody(e.target.value)} placeholder="Cuerpo del correo..." />
                    <button onClick={handleSendEmail}
                      disabled={sendingEmail || !emailSubject.trim() || !emailBody.trim() || !emailDest.trim()}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all"
                      style={{ background: 'rgba(53,122,14,0.18)', color: '#818cf8', border: '1.5px solid rgba(53,122,14,0.35)', opacity: !emailSubject.trim() || !emailBody.trim() || !emailDest.trim() ? 0.4 : 1 }}>
                      {sendingEmail
                        ? <div className="w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{ borderColor: 'transparent', borderTopColor: '#818cf8' }} />
                        : <><Mail size={12} />Enviar Correo</>}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'notas' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <StickyNote size={13} style={{ color: '#8B5CF6' }} />
                <h4 className="text-sm font-bold text-white/80">Notas internas</h4>
              </div>
              <textarea
                className="w-full resize-none text-sm rounded-xl px-3 py-2.5 outline-none bg-surface-2 border border-white/10 text-white/85 placeholder:text-white/30 focus:border-white/25"
                rows={10} value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Observaciones, acuerdos, historial de contacto..."
                style={{ minHeight: 180 }} />
              <button onClick={handleSaveNotes} disabled={savingNotes || notes === (lead.notes ?? '')}
                className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2"
                style={{ background: notes === (lead.notes ?? '') ? 'rgba(53,122,14,0.08)' : 'rgba(53,122,14,0.20)', color: '#818cf8', border: '1px solid rgba(53,122,14,0.30)', opacity: notes === (lead.notes ?? '') ? 0.5 : 1 }}>
                {savingNotes && <div className="w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{ borderColor: 'transparent', borderTopColor: '#818cf8' }} />}
                Guardar Notas
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type SortKey = 'urgencia' | 'deuda' | 'nombre' | 'recientes'

export default function CobradoresCartera() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [leads, setLeads]             = useState<CobradorLead[]>([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [stageFilter, setStageFilter] = useState(() => searchParams.get('stage') ?? '')
  const [sortBy, setSortBy]           = useState<SortKey>('urgencia')
  const [selected, setSelected]       = useState<CobradorLead | null>(null)
  const [showDetail, setShowDetail]   = useState(false)

  const load = () => {
    setLoading(true)
    getCobradorLeads()
      .then((data: CobradorLead[]) => {
        setLeads(data)
        if (selected) {
          const fresh = data.find(l => l.id === selected.id)
          if (fresh) setSelected(fresh)
        }
        // Deep-link: /cobrador/cartera?lead=ID abre el detalle directo
        const leadParam = searchParams.get('lead')
        if (leadParam) {
          const target = data.find(l => l.id === parseInt(leadParam))
          if (target) { setSelected(target); setShowDetail(true) }
          setSearchParams(prev => { prev.delete('lead'); return prev }, { replace: true })
        }
      })
      .catch(() => toast.error('Error cargando cartera'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  // ── Auto-sync: reload when backend syncs new morosos ──────────────────────
  useRealtime('cobrador_sync', (evt) => {
    if (evt.created > 0 || evt.updated > 0) {
      load()
      if (evt.created > 0) {
        toast.success(`📋 ${evt.created} nuevo${evt.created > 1 ? 's' : ''} moroso${evt.created > 1 ? 's' : ''} en tu cartera`, { duration: 6000 })
      }
    }
  })

  // ── Incoming call SSE listener ─────────────────────────────────────────────
  const [incomingCall, setIncomingCall] = useState<{
    call_id: string; session_id: string; from_phone: string
    contact_name: string; contact_id: number | null; is_video: boolean
  } | null>(null)
  const callRingtoneRef = useRef<HTMLAudioElement | null>(null)

  useRealtime(['incoming_call', 'call_ended'], (evt) => {
    if (evt.type === 'incoming_call') {
      setIncomingCall({
        call_id: evt.call_id,
        session_id: evt.session_id,
        from_phone: evt.from_phone,
        contact_name: evt.contact_name,
        contact_id: evt.contact_id,
        is_video: evt.is_video,
      })
      try {
        const ctx = new AudioContext()
        const playBeep = () => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.connect(gain); gain.connect(ctx.destination)
          osc.frequency.value = 440
          gain.gain.setValueAtTime(0.3, ctx.currentTime)
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8)
          osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.8)
        }
        playBeep()
        const interval = setInterval(playBeep, 2000)
        ;(callRingtoneRef as any).current = { pause: () => clearInterval(interval), currentTime: 0 }
      } catch { /* silent */ }
    }
    if (evt.type === 'call_ended') {
      if (callRingtoneRef.current) { callRingtoneRef.current.pause(); callRingtoneRef.current.currentTime = 0 }
      setIncomingCall(null)
    }
  })

  const dismissCall = () => {
    if (callRingtoneRef.current) { callRingtoneRef.current.pause(); callRingtoneRef.current.currentTime = 0 }
    setIncomingCall(null)
  }

  const handleUpdate = (updated: CobradorLead) => {
    setLeads(prev => prev.map(l => l.id === updated.id ? updated : l))
    setSelected(updated)
  }

  const filtered = leads.filter(l => {
    if (stageFilter && l.stage !== stageFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        l.nombre.toLowerCase().includes(q) ||
        (l.empresa ?? '').toLowerCase().includes(q) ||
        (l.rut ?? '').includes(q)
      )
    }
    return true
  }).sort((a, b) => {
    switch (sortBy) {
      case 'urgencia': {
        const ua = (a.lf_cuotas_vencidas ?? 0) * 1e12 + Math.max(a.monto_deuda - a.monto_pagado, 0)
        const ub = (b.lf_cuotas_vencidas ?? 0) * 1e12 + Math.max(b.monto_deuda - b.monto_pagado, 0)
        return ub - ua
      }
      case 'deuda':     return Math.max(b.monto_deuda - b.monto_pagado, 0) - Math.max(a.monto_deuda - a.monto_pagado, 0)
      case 'nombre':    return a.nombre.localeCompare(b.nombre, 'es')
      case 'recientes': return (b.created_at ?? '').localeCompare(a.created_at ?? '')
      default:          return 0
    }
  })

  const stageCounts = leads.reduce<Record<string, number>>((acc, l) => {
    acc[l.stage] = (acc[l.stage] ?? 0) + 1
    return acc
  }, {})
  const totalPendiente = filtered.reduce((a, l) => a + Math.max(l.monto_deuda - l.monto_pagado, 0), 0)

  return (
    <div className="flex flex-col h-full">
      {/* ── Incoming call overlay ── */}
      {incomingCall && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-6 px-10 py-8 rounded-3xl shadow-2xl"
            style={{ background: 'linear-gradient(135deg, #1c1633 0%, #130d26 100%)', border: '1px solid rgba(37,211,102,0.25)', minWidth: 320 }}>
            {/* Pulsing avatar */}
            <div className="relative flex items-center justify-center">
              <div className="absolute w-28 h-28 rounded-full animate-ping opacity-20" style={{ background: '#25D366' }} />
              <div className="absolute w-24 h-24 rounded-full animate-ping opacity-10 animation-delay-150" style={{ background: '#25D366', animationDelay: '0.3s' }} />
              <div className="w-20 h-20 rounded-full flex items-center justify-center text-white font-black text-3xl z-10"
                style={{ background: 'linear-gradient(135deg, #25D366 0%, #128C7E 100%)', boxShadow: '0 0 30px rgba(37,211,102,0.5)' }}>
                {incomingCall.contact_name.charAt(0).toUpperCase()}
              </div>
            </div>

            {/* Caller info */}
            <div className="text-center">
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#25D366' }}>
                {incomingCall.is_video ? '📹 Videollamada entrante' : '📞 Llamada entrante WhatsApp'}
              </p>
              <h2 className="text-2xl font-black text-white">{incomingCall.contact_name}</h2>
              <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>{incomingCall.from_phone}</p>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-6">
              {/* Reject */}
              <button
                onClick={dismissCall}
                className="flex flex-col items-center gap-2">
                <div className="w-16 h-16 rounded-full flex items-center justify-center transition-transform hover:scale-110"
                  style={{ background: '#ef4444', boxShadow: '0 4px 20px rgba(239,68,68,0.5)' }}>
                  <Phone size={26} className="text-white rotate-[135deg]" />
                </div>
                <span className="text-xs text-white/50">Ignorar</span>
              </button>

              {/* Answer on phone */}
              <a href={`https://wa.me/${incomingCall.from_phone.replace(/[^0-9]/g, '')}`}
                target="_blank" rel="noreferrer"
                onClick={dismissCall}
                className="flex flex-col items-center gap-2">
                <div className="w-16 h-16 rounded-full flex items-center justify-center transition-transform hover:scale-110"
                  style={{ background: '#25D366', boxShadow: '0 4px 20px rgba(37,211,102,0.5)' }}>
                  <Phone size={26} className="text-white" />
                </div>
                <span className="text-xs text-white/50">Contestar</span>
              </a>
            </div>

            <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
              Contesta desde el celular con WhatsApp abierto
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-4 flex-shrink-0 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-black" style={{ color: 'var(--text)', fontFamily: '"Space Grotesk", sans-serif' }}>
            Cartera de Clientes
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {filtered.length} de {leads.length} cliente{leads.length !== 1 ? 's' : ''} · pendiente {fmt(totalPendiente)} · sincronización automática
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-3 flex-shrink-0 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input className="input pl-9 w-full" placeholder="Buscar cliente, empresa, RUT..."
            value={search} onChange={e => setSearch(e.target.value)} />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }}>
              <X size={13} />
            </button>
          )}
        </div>
        <select className="input" value={sortBy} onChange={e => setSortBy(e.target.value as SortKey)} style={{ minWidth: 170 }} title="Ordenar por">
          <option value="urgencia">Más urgentes primero</option>
          <option value="deuda">Mayor deuda pendiente</option>
          <option value="recientes">Más recientes</option>
          <option value="nombre">Nombre A-Z</option>
        </select>
      </div>

      {/* Stage filter chips */}
      <div className="flex gap-2 mb-5 flex-shrink-0 flex-wrap">
        <button onClick={() => setStageFilter('')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all"
          style={stageFilter === ''
            ? { background: '#1c1633', color: '#fff', border: '1px solid #1c1633' }
            : { background: '#fff', color: 'rgba(28,22,51,0.55)', border: '1px solid rgba(28,22,51,0.14)' }}>
          Todas
          <span className="text-[10px] font-black px-1.5 rounded-full"
            style={stageFilter === '' ? { background: 'rgba(255,255,255,0.20)' } : { background: 'rgba(28,22,51,0.06)' }}>
            {leads.length}
          </span>
        </button>
        {Object.entries(STAGES).map(([k, s]) => {
          const active = stageFilter === k
          return (
            <button key={k} onClick={() => setStageFilter(active ? '' : k)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all"
              style={active
                ? { background: s.dot, color: '#fff', border: `1px solid ${s.dot}` }
                : { background: '#fff', color: s.dot, border: `1px solid ${s.dot}44` }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: active ? '#fff' : s.dot }} />
              {s.label}
              <span className="text-[10px] font-black px-1.5 rounded-full"
                style={active ? { background: 'rgba(255,255,255,0.25)' } : { background: s.color }}>
                {stageCounts[k] ?? 0}
              </span>
            </button>
          )
        })}
      </div>

      {/* Cards grid */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--primary)' }} />
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 gap-2" style={{ color: 'var(--text-muted)' }}>
            <User size={32} style={{ opacity: 0.25 }} />
            <p className="text-sm">Sin resultados</p>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-4">
          {filtered.map(lead => {
            const s = STAGES[lead.stage] ?? { dot: '#6B7280', label: lead.stage, color: 'rgba(107,114,128,0.15)' }
            const pct = lead.monto_deuda > 0 ? Math.min((lead.monto_pagado / lead.monto_deuda) * 100, 100) : 0
            const pendiente = Math.max(lead.monto_deuda - lead.monto_pagado, 0)
            const isSelected = selected?.id === lead.id
            return (
              <button key={lead.id} onClick={() => {
                setSelected(lead); setShowDetail(true)
                // Mark as seen — removes NUEVO badge
                if (lead.is_new) {
                  markCobradorLeadSeen(lead.id).then(() => {
                    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, is_new: false } : l))
                  }).catch(() => {})
                }
              }}
                className="relative group text-left rounded-2xl overflow-hidden flex flex-col transition-all hover:-translate-y-0.5"
                style={{
                  background: '#ffffff',
                  border: isSelected ? `2px solid ${s.dot}` : '1px solid rgba(28,22,51,0.10)',
                  boxShadow: isSelected
                    ? `0 4px 20px ${s.dot}33`
                    : '0 1px 6px rgba(28,22,51,0.07)',
                }}>
                {/* Top accent bar */}
                <div className="h-1.5 w-full flex-shrink-0"
                  style={{ background: `linear-gradient(90deg, ${s.dot}, ${s.dot}88)` }} />

                <div className="p-4 flex flex-col gap-3 flex-1">
                  {/* Avatar + name */}
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-black text-base text-white"
                      style={{ background: `linear-gradient(135deg, ${s.dot} 0%, ${s.dot}aa 100%)`, boxShadow: '0 3px 10px rgba(0,0,0,0.15)' }}>
                      {lead.nombre.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[13px] font-bold truncate leading-tight" style={{ color: '#1c1633' }}>{lead.nombre}</p>
                        {lead.is_new && (
                          <span className="flex-shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded-full animate-pulse"
                            style={{ background: 'var(--zx-accent-text)', color: '#fff' }}>
                            NUEVO
                          </span>
                        )}
                        {lead.is_contactado && (
                          <span className="flex-shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded-full"
                            style={{ background: 'rgba(16,185,129,0.15)', color: '#10B981' }}>
                            CONTACTADO
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] truncate mt-0.5 font-medium" style={{ color: 'rgba(28,22,51,0.50)' }}>
                        {lead.empresa || lead.telefono || lead.rut || '—'}
                      </p>
                    </div>
                  </div>

                  {/* Stage + cuotas vencidas */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: s.color, color: s.dot }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }} />
                      {s.label}
                    </span>
                    {(lead.lf_cuotas_vencidas ?? 0) > 0 && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: 'rgba(239,68,68,0.10)', color: '#DC2626' }}>
                        {lead.lf_cuotas_vencidas} cuota{(lead.lf_cuotas_vencidas??0)>1?'s':''} vencida{(lead.lf_cuotas_vencidas??0)>1?'s':''}
                      </span>
                    )}
                  </div>

                  {/* Monto deuda + progreso */}
                  <div className="rounded-xl px-3 py-2.5" style={{ background: '#faf9fd', border: '1px solid #e6e1f0' }}>
                    <div className="flex justify-between text-[10px] mb-1.5" style={{ color: 'rgba(28,22,51,0.55)' }}>
                      <span className="font-semibold">Deuda total</span>
                      <span className="font-bold" style={{ color: '#1c1633' }}>{fmt(lead.monto_deuda)}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden mb-1.5" style={{ background: 'rgba(28,22,51,0.08)' }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: s.dot }} />
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span style={{ color: '#10B981', fontWeight: 600 }}>Cobrado: {fmt(lead.monto_pagado)}</span>
                      <span style={{ color: pendiente > 0 ? '#EF4444' : '#10B981', fontWeight: 600 }}>
                        Pendiente: {fmt(pendiente)}
                      </span>
                    </div>
                  </div>

                  {/* Próxima cuota — rojo si está vencida */}
                  {lead.proxima_cuota_fecha && (() => {
                    const d = new Date(lead.proxima_cuota_fecha + 'T00:00:00')
                    const today = new Date(); today.setHours(0, 0, 0, 0)
                    const diffDays = isNaN(d.getTime()) ? null : Math.round((d.getTime() - today.getTime()) / 86400000)
                    const overdue = diffDays != null && diffDays < 0
                    const dueToday = diffDays === 0
                    const label = overdue ? `Cuota vencida hace ${Math.abs(diffDays!)}d`
                      : dueToday ? 'Cuota vence hoy'
                      : `Próx. cuota: ${lead.proxima_cuota_fecha}`
                    const c = overdue ? { bg: 'rgba(239,68,68,0.07)', border: 'rgba(239,68,68,0.22)', text: '#DC2626', amount: '#EF4444' }
                      : dueToday ? { bg: 'rgba(249,115,22,0.07)', border: 'rgba(249,115,22,0.22)', text: '#C2410C', amount: '#EA580C' }
                      : { bg: 'rgba(245,158,11,0.07)', border: 'rgba(245,158,11,0.20)', text: '#D97706', amount: '#F59E0B' }
                    return (
                      <div className="flex items-center justify-between text-[10px] px-2.5 py-1.5 rounded-lg"
                        style={{ background: c.bg, border: `1px solid ${c.border}` }}>
                        <span style={{ color: c.text, fontWeight: 700 }}>{label}</span>
                        {lead.proxima_cuota_monto && <span style={{ color: c.amount, fontWeight: 700 }}>{fmt(lead.proxima_cuota_monto)}</span>}
                      </div>
                    )
                  })()}

                  {/* CTA */}
                  <div className="mt-auto pt-1">
                    <div className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all"
                      style={isSelected ? {
                        background: s.dot, color: '#fff', border: `1px solid ${s.dot}`,
                        boxShadow: `0 2px 8px ${s.dot}44`,
                      } : {
                        background: `${s.dot}15`, color: s.dot,
                        border: `1px solid ${s.dot}33`,
                      }}>
                      {isSelected ? '✓ Abierto' : 'Ver cliente →'}
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Fixed right drawer (same as Leads) ── */}
      {selected && showDetail && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/20 z-40 backdrop-blur-[1px]"
            onClick={() => { setShowDetail(false); setSelected(null) }} />

          {/* Drawer */}
          <div className="fixed right-0 top-0 bottom-0 w-full max-w-2xl bg-surface-1 shadow-2xl z-50 flex flex-col border-l border-white/[0.07]">

            {/* Accent line */}
            <div className="h-0.5 flex-shrink-0"
              style={{ background: `linear-gradient(90deg, ${STAGES[selected.stage]?.dot ?? 'var(--zx-accent-text)'} 0%, rgba(53,122,14,0.35) 100%)` }} />

            <DetailPanel
              key={selected.id}
              lead={selected}
              onUpdate={handleUpdate}
              onClose={() => { setShowDetail(false); setSelected(null) }}
            />
          </div>
        </>
      )}
    </div>
  )
}
