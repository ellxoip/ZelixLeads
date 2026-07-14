import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getLead, getLeadHistory, downloadLeadPdf,
  updateLead, moveLeadStage, retryPagacuotas, getAllWhatsAppConfigs, getUsers,
} from '../api'
import type { Lead, LeadHistory } from '../types'
import { STAGE_LABELS, STAGE_COLORS, STAGE_DOT } from '../types'
import {
  ArrowLeft,
  Download, User, Briefcase, DollarSign, X, FileText, StickyNote, Phone, Mail, ClipboardList, Pencil, ArrowRight, RefreshCw,
  MessageSquare, History, Loader2, GitBranch,
} from 'lucide-react'
import { MoveLeadModal } from '../components/MoveLeadModal'
import { NEXT_STAGE, ADVANCE_NEEDS_MODAL } from '../lib/stages'
import { emitLeadChanged } from '../lib/leadEvents'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { parseDate } from '../utils/dates'
import { useAuthStore } from '../store/auth'
import { WorkOrderModal } from '../components/WorkOrderModal'
import { EditContactModal } from '../components/EditContactModal'
import { EventModal } from '../components/EventModal'
import { ChatTab } from '../components/chat/LeadChat'

function fmt(n: number) { return `$${Math.round(n).toLocaleString('es-CL')}` }


function InfoRow({ label, value, required }: { label: string; value?: string | null; required?: boolean }) {
  if (!required && !value) return null
  return (
    <div className="flex items-start justify-between py-2 last:border-0 gap-4" style={{ borderBottom: '1px solid var(--border)' }}>
      <dt className="text-xs font-medium flex-shrink-0 w-32 flex items-center gap-0.5" style={{ color: 'var(--text-muted)' }}>
        {label}
        {required && <span style={{ color: '#ef4444', fontWeight: 700 }}>*</span>}
      </dt>
      {value
        ? <dd className="text-sm font-semibold text-right" style={{ color: 'var(--text)' }}>{value}</dd>
        : <dd className="text-xs font-medium text-right italic" style={{ color: '#ef4444' }}>Pendiente</dd>
      }
    </div>
  )
}

interface LeadDetailViewProps {
  leadId: number
  onClose?: () => void
  // embedded: render solo el contenido (sin wrapper de página ni modal propio).
  // Lo usa LeadDrawer, que aporta su propio chrome de panel lateral.
  embedded?: boolean
  // Pestaña inicial — permite abrir el Drawer directo en Chat/Historial desde
  // una acción de contexto (p. ej. "contactar" en la tarjeta del Pipeline).
  initialTab?: 'resumen' | 'historial' | 'chat' | 'agenda'
}

export function LeadDetailView({ leadId, onClose, embedded, initialTab }: LeadDetailViewProps) {
  const navigate   = useNavigate()
  const { user }   = useAuthStore()
  const [lead, setLead]         = useState<Lead | null>(null)
  const [history, setHistory]   = useState<LeadHistory[]>([])
  const [loading, setLoading]   = useState(true)
  const [localNotes, setLocalNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [showOTModal, setShowOTModal] = useState(false)
  const [showEditContact, setShowEditContact] = useState(false)
  const [moveTarget, setMoveTarget] = useState<string | null>(null)
  const [retryingPagacuotas, setRetryingPagacuotas] = useState(false)
  // 'agenda' es una intención, no una pestaña: aterriza en Resumen con la
  // cascada de agendamiento (EventModal) abierta de inmediato.
  const [tab, setTab] = useState<'resumen' | 'historial' | 'chat'>(
    initialTab === 'agenda' ? 'resumen' : (initialTab ?? 'resumen')
  )
  const [advancing, setAdvancing] = useState(false)
  const [waConfigs, setWaConfigs] = useState<any[] | null>(null)
  const [showAgenda, setShowAgenda] = useState(initialTab === 'agenda')
  const [vendors, setVendors] = useState<any[]>([])
  // Flujo B — etapa que quedó bloqueada por un dato faltante (RUT/OT). Al resolver
  // el dato en el modal correspondiente, reintentamos el move hacia esta etapa.
  const [pendingRetryStage, setPendingRetryStage] = useState<string | null>(null)

  // Candado de completitud (espejo del guard 400 del backend): sin Nombre y
  // Apellido, RUT y Correo no se puede agendar reunión ni avanzar el lead.
  const clientDataComplete = (l: Lead | null) => {
    const c = l?.contact
    if (!c) return false
    return (c.name || '').trim().split(/\s+/).length >= 2
      && !!((c.rut_persona || '').trim() || (c.rut_empresa || '').trim())
      && !!((c.email || '').trim())
  }
  // Si la cascada de agenda se abre con datos incompletos (botón verde del
  // Pipeline, Avanzar o initialTab='agenda'), se redirige al modal de contacto
  // y al guardar los datos se reabre la agenda automáticamente.
  const [agendaAfterContact, setAgendaAfterContact] = useState(false)
  useEffect(() => {
    if (showAgenda && lead && !clientDataComplete(lead)) {
      setShowAgenda(false)
      setAgendaAfterContact(true)
      toast.error('Para agendar la reunión primero completa Nombre y Apellido, RUT y Correo en Datos del Cliente')
      setShowEditContact(true)
    }
  }, [showAgenda, lead])

  // Carga lazy de las configuraciones de WhatsApp: solo al abrir la pestaña Chat.
  useEffect(() => {
    if (tab === 'chat' && waConfigs === null) {
      getAllWhatsAppConfigs().then(c => setWaConfigs(c as any[])).catch(() => setWaConfigs([]))
    }
  }, [tab, waConfigs])

  // Carga lazy de vendedores: solo al abrir la cascada de agenda (Flujo A).
  // Fallback: si getUsers falla, se usa el vendedor del propio lead (contexto).
  useEffect(() => {
    if (showAgenda && vendors.length === 0) {
      getUsers()
        .then((us: any[]) => setVendors(us.filter(u => u.role === 'vendedor')))
        .catch(() => { if (lead?.vendedor) setVendors([lead.vendedor]) })
    }
  }, [showAgenda, vendors.length, lead])

  const loadAll = async () => {
    setLoading(true)
    try {
      const [l, h] = await Promise.all([getLead(leadId), getLeadHistory(leadId)])
      setLead(l); setHistory(h)
      setLocalNotes(l.notes || '')
    } catch { toast.error('Error cargando lead') }
    finally { setLoading(false) }
  }

  useEffect(() => { loadAll() }, [leadId])

  const handleUpdateNotes = async () => {
    if (!lead || localNotes === (lead.notes || '')) return
    setSavingNotes(true)
    try {
      const updated = await updateLead(lead.id, { notes: localNotes })
      setLead(updated)
      toast.success('Notas actualizadas')
    } catch {
      toast.error('Error al guardar notas')
      setLocalNotes(lead.notes || '')
    } finally {
      setSavingNotes(false)
    }
  }

  const handleBack = () => {
    if (onClose) onClose()
    else navigate(-1)
  }

  const handleMove = async (stage: string, paymentDate?: string) => {
    if (!lead) return
    const updated = await moveLeadStage(lead.id, { stage, ...(paymentDate ? { payment_commitment_date: paymentDate } : {}) })
    setLead(updated)
    await loadAll()
    emitLeadChanged({ leadId: lead.id, stage })
    setMoveTarget(null)
  }

  // Avance de 1 clic con fallback al modal — misma lógica que el tablero (Fase 1).
  const nextStage = lead ? NEXT_STAGE[lead.current_stage] : undefined
  const handleAdvance = async () => {
    if (!lead || !nextStage || advancing) return
    if (ADVANCE_NEEDS_MODAL.has(nextStage)) { setMoveTarget(nextStage); return }
    setAdvancing(true)
    try {
      const updated = await moveLeadStage(lead.id, { stage: nextStage })
      setLead(updated)
      await loadAll()
      emitLeadChanged({ leadId: lead.id, stage: nextStage })
      toast.success(`Movido a ${STAGE_LABELS[nextStage] ?? nextStage}`)
    } catch (err: any) {
      const detail = err?.response?.data?.detail || 'Error al mover'
      // Flujo A — la guarda pide agendar una reunión: en vez del toast muerto,
      // abrimos EventModal en contexto (cascada agua limpia, sin salir del Drawer).
      if (/agendar una reuni/i.test(detail)) { setShowAgenda(true); return }
      // Candado de completitud de datos: en vez del toast muerto, abrimos el
      // modal de contacto en contexto y reintentamos el avance al guardar.
      if (/obligatorio introducir/i.test(detail)) {
        toast.error(detail)
        setPendingRetryStage(nextStage); setShowEditContact(true); return
      }
      // Flujo B — RUT obligatorio para Cierre. OJO: el string del backend también
      // menciona "Orden de Trabajo", por eso se chequea RUT ANTES que OT.
      if (/RUT registrado|tener RUT/i.test(detail)) {
        setPendingRetryStage(nextStage); setShowEditContact(true); return
      }
      // Flujo B — OT obligatoria. Patrón acotado ("crear la Orden de Trabajo" / "(OT)")
      // que NO colisiona con el string de RUT ("generar la Orden de Trabajo").
      if (/crear la Orden de Trabajo|\(OT\)/i.test(detail)) {
        setPendingRetryStage(nextStage); setShowOTModal(true); return
      }
      if (/fecha|comprometid/i.test(detail)) setMoveTarget(nextStage)
      else toast.error(detail)
    } finally {
      setAdvancing(false)
    }
  }

  // Flujo B — reintento de etapa tras resolver el dato faltante en su modal.
  // Si el backend aún pide algo que solo MoveLeadModal captura (fecha/financials),
  // delegamos en ese modal en lugar de mostrar un toast muerto. No reabre los
  // modales de RUT/OT, así que nunca entra en bucle.
  const retryAdvance = async (stage: string) => {
    if (!lead) return
    try {
      const updated = await moveLeadStage(lead.id, { stage })
      setLead(updated); await loadAll()
      emitLeadChanged({ leadId: lead.id, stage })
      toast.success(`Movido a ${STAGE_LABELS[stage] ?? stage}`)
    } catch (err: any) {
      const detail = err?.response?.data?.detail || 'Error al mover'
      // Tras completar los datos, el backend puede pedir agendar la reunión:
      // continuamos la cascada con EventModal en vez de cortar con un toast.
      if (/agendar una reuni/i.test(detail)) { setShowAgenda(true); return }
      if (/fecha|comprometid|honorarios|cuota|cuotas/i.test(detail)) setMoveTarget(stage)
      else toast.error(detail)
    }
  }

  // Cascada Flujo A: tras crear el evento de reunión, mover el lead a 'reunion'
  // automáticamente. Si el move fallara tras crear el evento (red), avisamos que
  // el evento SÍ se guardó y que la etapa debe moverse a mano (evita confusión).
  const handleAgendaSaved = async (info?: { handled?: boolean; leadId?: number }) => {
    if (!lead) return
    setShowAgenda(false)
    // El modal creó un caso NUEVO en otra categoría y ya lo movió a Reunión:
    // no tocar el lead original, solo refrescar las superficies.
    if (info?.handled) {
      await loadAll()
      emitLeadChanged({ leadId: info.leadId ?? lead.id, stage: 'reunion' })
      toast.success('Caso nuevo agendado en la nueva categoría')
      return
    }
    try {
      const updated = await moveLeadStage(lead.id, { stage: 'reunion' })
      setLead(updated); await loadAll()
      emitLeadChanged({ leadId: lead.id, stage: 'reunion' })
      toast.success('Reunión agendada — lead movido a Reunión')
    } catch {
      await loadAll()
      toast.error('Reunión agendada con éxito, pero la etapa del lead debe actualizarse manualmente')
    }
  }

  // El chat ahora se muestra embebido como pestaña dentro de esta misma vista.


  const handleRetryPagacuotas = async () => {
    if (!lead) return
    setRetryingPagacuotas(true)
    try {
      const res = await retryPagacuotas(lead.id)
      toast.success(res.whatsapp_sent ? 'WhatsApp enviado con link de PagaCuotas' : 'Cliente registrado en PagaCuotas (sin teléfono, no se envió WhatsApp)')
      await loadAll()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Error al conectar con PagaCuotas')
    } finally {
      setRetryingPagacuotas(false)
    }
  }

  const canConfirmPago = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'vendedor'
  const canMove        = user?.role !== 'verificador'

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--primary)' }} />
    </div>
  )
  if (!lead) return <div className="text-center py-16" style={{ color: 'var(--text-muted)' }}>Lead no encontrado</div>

  const latestHistoryWithNote = [...history].reverse().find(h => h.notes)

  const content = (
    <div className="space-y-4">

      {/* Single horizontal header bar */}
      <div className="bg-surface-1 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap" style={{ border: '1px solid var(--border)' }}>
        <button onClick={handleBack}
          className="p-2 rounded-lg hover:bg-surface-2 transition-colors flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
          {onClose ? <X size={18} /> : <ArrowLeft size={18} />}
        </button>

        {/* Name + stage + contact */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-base font-bold text-white leading-tight">{lead.contact?.name}</h1>
            <span className={`badge border text-[11px] ${STAGE_COLORS[lead.current_stage] ?? 'bg-surface-2 text-white/78'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${STAGE_DOT[lead.current_stage] ?? 'bg-white/30'}`} />
              {STAGE_LABELS[lead.current_stage] ?? lead.current_stage}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] mt-0.5 flex-wrap" style={{ color: 'var(--text-muted)' }}>
            {lead.contact?.phone && <span className="flex items-center gap-1"><Phone size={10} />{lead.contact.phone}</span>}
            {lead.contact?.email && <span className="flex items-center gap-1"><Mail size={10} />{lead.contact.email}</span>}
            <span>·</span>
            <span>Lead #{lead.id}</span>
          </div>
        </div>

{canMove && nextStage && (nextStage !== 'pagado_confirmado' || canConfirmPago) && (
          <button onClick={handleAdvance} disabled={advancing}
            title={`Avanzar a ${STAGE_LABELS[nextStage] ?? nextStage}`}
            className="btn-primary text-xs py-1.5 px-3 gap-1.5 flex-shrink-0 disabled:opacity-60">
            {advancing ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />}
            Avanzar
          </button>
        )}
        {canMove && (
          <button onClick={() => setMoveTarget('')}
            title="Mover a otra etapa"
            className="btn-secondary text-xs py-1.5 px-3 gap-1.5 flex-shrink-0">
            <GitBranch size={13} /> Mover
          </button>
        )}
        <button onClick={() => setTab('chat')}
          title="Abrir conversación de WhatsApp"
          className="btn-secondary text-xs py-1.5 px-3 gap-1.5 flex-shrink-0">
          <MessageSquare size={13} /> Chat
        </button>
        <button onClick={() => setShowOTModal(true)}
          className="btn-secondary text-xs py-1.5 px-3 gap-1.5 flex-shrink-0">
          <ClipboardList size={13} /> OT
        </button>
        <button onClick={() => downloadLeadPdf(lead.id, lead.contact?.name).catch(() => toast.error('Error'))}
          className="btn-secondary text-xs py-1.5 px-3 gap-1.5 flex-shrink-0">
          <Download size={13} /> PDF
        </button>
      </div>

      {/* Tabs: Resumen / Historial */}
      <div className="flex items-center gap-1 px-1">
        {([['resumen', 'Resumen', User], ['historial', 'Historial', History], ['chat', 'Chat', MessageSquare]] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setTab(key)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
            style={tab === key
              ? { background: 'var(--primary-dim)', color: 'var(--primary)' }
              : { color: 'var(--text-muted)' }}>
            <Icon size={13} />
            {label}
            {key === 'historial' && history.length > 0 && (
              <span className="text-[10px] font-bold px-1.5 rounded-full" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                {history.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Info grid */}
      {tab === 'resumen' && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Client data */}
        <div className="bg-surface-1 rounded-xl p-5" style={{ border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 bg-surface-2 rounded-lg flex items-center justify-center">
              <User size={13} style={{ color: 'var(--primary)' }} />
            </div>
            <h3 className="font-semibold text-sm flex-1" style={{ color: 'var(--text)' }}>Datos del Cliente</h3>
            <button onClick={() => setShowEditContact(true)}
              className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors" style={{ color: 'var(--text-muted)' }} title="Editar contacto">
              <Pencil size={13} />
            </button>
          </div>
          <dl>
            <InfoRow label="Nombre y Apellido" value={lead.contact?.name} required />
            <InfoRow label="RUT"               value={lead.contact?.rut_persona || lead.contact?.rut_empresa} required />
            <InfoRow label="Teléfono"          value={lead.contact?.phone} required />
            <InfoRow label="Correo Electrónico" value={lead.contact?.email} required />
            {lead.contact?.rut_empresa && (
              <InfoRow label="RUT Empresa" value={lead.contact.rut_empresa} />
            )}
            <InfoRow label="Razón Social" value={lead.contact?.razon_social} />
            <InfoRow label="Domicilio"    value={lead.contact?.address} />
            <InfoRow label="Comuna"       value={lead.contact?.city} />
          </dl>
        </div>

        {/* Service detail */}
        <div className="bg-surface-1 rounded-xl p-5" style={{ border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 bg-surface-2 rounded-lg flex items-center justify-center">
              <Briefcase size={13} style={{ color: 'var(--primary)' }} />
            </div>
            <h3 className="font-semibold text-sm" style={{ color: 'var(--text)' }}>Detalle del Servicio</h3>
          </div>
          <dl>
            <InfoRow label="Área Legal"  value={lead.area?.name} />
            <InfoRow label="Vendedor"    value={lead.vendedor?.name} />
            <InfoRow label="Agendador/a"  value={lead.agendadora?.name} />
            <InfoRow label="Fuente"      value={lead.source ? lead.source.charAt(0).toUpperCase() + lead.source.slice(1) : null} />
            <InfoRow label="Prioridad"   value={lead.priority === 'high' ? 'Alta' : lead.priority === 'low' ? 'Baja' : 'Normal'} />
          </dl>
          {lead.service_description && (
            <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
              <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Descripción del servicio</p>
              <p className="text-sm bg-surface-0 rounded-lg p-3 leading-relaxed" style={{ color: 'var(--text-2)' }}>{lead.service_description}</p>
            </div>
          )}
        </div>

        {/* Payment plan */}
        <div className="bg-surface-1 rounded-xl p-5" style={{ border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 bg-surface-2 rounded-lg flex items-center justify-center">
              <DollarSign size={13} style={{ color: 'var(--primary)' }} />
            </div>
            <h3 className="font-semibold text-sm" style={{ color: 'var(--text)' }}>Plan de Pago</h3>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {[
              ['Honorarios',    lead.honorarios    != null ? fmt(lead.honorarios)    : '—'],
              ['Cuota Inicial', lead.cuota_inicial != null ? fmt(lead.cuota_inicial) : '—'],
              ['N° Cuotas',     lead.num_cuotas    != null ? lead.num_cuotas.toString() : '—'],
              ['Monto Cuota',   lead.monto_cuota   != null ? fmt(lead.monto_cuota)   : '—'],
            ].map(([l, v]) => (
              <div key={l} className="bg-surface-0 rounded-lg p-3" style={{ border: '1px solid var(--border)' }}>
                <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{l}</p>
                <p className="text-base font-bold mt-0.5" style={{ color: 'var(--text)' }}>{v}</p>
              </div>
            ))}
          </div>
          {(lead as any).payment_commitment_date && (
            <div className="mt-2.5 flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{ background: 'rgba(14,165,233,0.08)', border: '1px solid rgba(14,165,233,0.25)' }}>
              <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: '#0284c7' }}>Compromiso de pago</span>
              <span className="text-xs font-semibold ml-auto" style={{ color: '#0284c7' }}>
                {new Date((lead as any).payment_commitment_date + 'T00:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' })}
              </span>
            </div>
          )}
          {['pago_comprometido', 'pago_pendiente'].includes(lead.current_stage) && user?.role !== 'agendadora' && (
            <div className="mt-3 flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg"
              style={{
                background: lead.pagacuotas_status === 'failed' ? 'rgba(239,68,68,0.07)' : 'rgba(16,185,129,0.07)',
                border: `1px solid ${lead.pagacuotas_status === 'failed' ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)'}`,
              }}>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide"
                  style={{ color: lead.pagacuotas_status === 'failed' ? '#ef4444' : '#10b981' }}>
                  PagaCuotas — {lead.pagacuotas_status === 'failed' ? 'Error al registrar' : lead.pagacuotas_status === 'created' ? 'Registrado' : 'Pendiente'}
                </p>
                {lead.pagacuotas_link && (
                  <a href={lead.pagacuotas_link} target="_blank" rel="noopener noreferrer"
                    className="text-[10px] underline" style={{ color: '#10b981' }}>
                    Ver portal
                  </a>
                )}
              </div>
              <button
                onClick={handleRetryPagacuotas}
                disabled={retryingPagacuotas}
                className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
                style={{ background: 'var(--primary)', color: '#fff' }}
              >
                <RefreshCw size={11} className={retryingPagacuotas ? 'animate-spin' : ''} />
                {retryingPagacuotas ? 'Enviando...' : lead.pagacuotas_status === 'failed' ? 'Reintentar y enviar WA' : 'Reenviar WhatsApp'}
              </button>
            </div>
          )}
        </div>

        {/* Last action note OR internal notes stacked in right column */}
        <div className="space-y-4">
          {latestHistoryWithNote && (
            <div className="bg-surface-1 rounded-xl p-5" style={{ border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--primary-dim)' }}>
                  <StickyNote size={13} style={{ color: 'var(--primary)' }} />
                </div>
                <h3 className="font-semibold text-sm" style={{ color: 'var(--text)' }}>Última Gestión</h3>
              </div>
              <div className="bg-surface-0 rounded-xl p-4" style={{ border: '1px solid var(--border)' }}>
                <p className="text-sm leading-relaxed italic" style={{ color: 'var(--text-2)' }}>"{latestHistoryWithNote.notes}"</p>
                <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                  <span className={`badge border text-[10px] ${STAGE_COLORS[latestHistoryWithNote.to_stage]}`}>
                    {STAGE_LABELS[latestHistoryWithNote.to_stage]}
                  </span>
                  <span className="text-[10px] font-medium italic" style={{ color: 'var(--text-muted)' }}>
                    {latestHistoryWithNote.creator?.name} · {format(parseDate(latestHistoryWithNote.created_at), "d MMM yyyy · HH:mm", { locale: es })}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Internal notes */}
          <div className="bg-surface-1 rounded-xl p-5" style={{ border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-surface-2 rounded-lg flex items-center justify-center">
                  {savingNotes ? (
                    <div className="w-3 h-3 border rounded-full animate-spin" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--primary)' }} />
                  ) : (
                    <FileText size={13} style={{ color: 'var(--primary)' }} />
                  )}
                </div>
                <h3 className="font-semibold text-sm" style={{ color: 'var(--text)' }}>Notas Internas</h3>
              </div>
              {savingNotes && <span className="text-[10px] animate-pulse" style={{ color: 'var(--text-muted)' }}>Guardando...</span>}
            </div>
            <textarea
              value={localNotes}
              onChange={e => setLocalNotes(e.target.value)}
              onBlur={handleUpdateNotes}
              className="w-full text-sm bg-surface-0 rounded-xl p-3.5 leading-relaxed focus:outline-none focus:ring-2 resize-none transition-all"
              style={{ color: 'var(--text-2)', border: '1px solid var(--border)', '--tw-ring-color': 'var(--primary-dim)' } as any}
              placeholder="Escribe notas internas aquí... (se guardan automáticamente al salir)"
              rows={5}
            />
          </div>
        </div>
      </div>
      )}

      {/* Historial (timeline completo) */}
      {tab === 'historial' && (
        <div className="bg-surface-1 rounded-xl p-5" style={{ border: '1px solid var(--border)' }}>
          {history.length === 0 ? (
            <p className="text-center text-sm py-8" style={{ color: 'var(--text-muted)' }}>Sin movimientos registrados todavía</p>
          ) : (
            <ol className="relative space-y-4 pl-5">
              {[...history].reverse().map((h, i) => (
                <li key={h.id ?? i} className="relative">
                  <span className="absolute -left-5 top-1 w-2.5 h-2.5 rounded-full"
                    style={{ background: 'var(--primary)', boxShadow: '0 0 0 3px var(--primary-dim)' }} />
                  {i < history.length - 1 && (
                    <span className="absolute -left-[15px] top-4 bottom-[-16px] w-px" style={{ background: 'var(--border)' }} />
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    {h.from_stage && (
                      <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                        {STAGE_LABELS[h.from_stage] ?? h.from_stage}
                      </span>
                    )}
                    {h.from_stage && <ArrowRight size={10} style={{ color: 'var(--text-muted)' }} />}
                    <span className={`badge border text-[10px] ${STAGE_COLORS[h.to_stage] ?? 'bg-surface-2 text-white/78'}`}>
                      {STAGE_LABELS[h.to_stage] ?? h.to_stage}
                    </span>
                  </div>
                  {h.notes && (
                    <p className="text-sm leading-relaxed mt-1.5 italic" style={{ color: 'var(--text-2)' }}>"{h.notes}"</p>
                  )}
                  <p className="text-[10px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>
                    {h.creator?.name ?? 'Sistema'} · {format(parseDate(h.created_at), "d MMM yyyy · HH:mm", { locale: es })}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* Chat embebido (WhatsApp) */}
      {tab === 'chat' && lead && (
        <div className="bg-surface-1 rounded-xl overflow-hidden flex flex-col"
          style={{ border: '1px solid var(--border)', height: '72vh' }}>
          <ChatTab lead={lead} configs={waConfigs ?? []} onLeadUpdate={setLead} />
        </div>
      )}

    </div>
  )

  const modals = (
    <>
      {showOTModal && <WorkOrderModal leadId={leadId} honorarios={lead?.honorarios ?? 0}
        onClose={() => { setShowOTModal(false); setPendingRetryStage(null) }}
        onSaved={async () => {
          setShowOTModal(false)
          await loadAll()
          // Gancho de reintento Flujo B: si veníamos de un avance bloqueado por OT,
          // reanudamos el move automáticamente. 1 clic inicial → flujo terminado.
          if (pendingRetryStage) { const s = pendingRetryStage; setPendingRetryStage(null); await retryAdvance(s) }
        }} autoOpen />}
      {showEditContact && lead?.contact && <EditContactModal contact={lead.contact}
        onClose={() => { setShowEditContact(false); setPendingRetryStage(null); setAgendaAfterContact(false) }}
        onSuccess={async c => {
          setLead(l => l ? { ...l, contact: c } : l)
          setShowEditContact(false)
          // Gancho de agenda: veníamos de intentar agendar con datos incompletos.
          // Con los datos ya completos, reabrimos la cascada de agendamiento.
          if (agendaAfterContact) {
            setAgendaAfterContact(false)
            if (lead && clientDataComplete({ ...lead, contact: c } as Lead)) { setShowAgenda(true); return }
          }
          // Gancho de reintento Flujo B: si el avance estaba bloqueado por RUT,
          // reanudamos el move hacia la etapa pendiente (el backend ya lee el RUT nuevo).
          if (pendingRetryStage) { const s = pendingRetryStage; setPendingRetryStage(null); await retryAdvance(s) }
        }} />}
      {moveTarget !== null && lead && <MoveLeadModal lead={lead} targetStage={moveTarget} labels={STAGE_LABELS} canConfirmPago={canConfirmPago} userRole={user?.role} onConfirm={handleMove} onClose={() => setMoveTarget(null)} />}
      {showAgenda && lead && (
        <EventModal
          event={null}
          vendors={lead.vendedor && !vendors.some(v => v.id === lead.vendedor!.id)
            ? [lead.vendedor, ...vendors]
            : vendors}
          leadId={lead.id}
          lockedLeadName={lead.contact?.name ?? `Lead #${lead.id}`}
          defaultTitle={`Reunión — ${lead.contact?.name ?? ''}`.trim()}
          defaultAssignedTo={lead.vendedor_id ?? undefined}
          defaultDate={new Date().toISOString().slice(0, 10)}
          onClose={() => setShowAgenda(false)}
          onSaved={handleAgendaSaved}
        />
      )}
    </>
  )

  // embedded: solo contenido + modales; el chrome del panel lo aporta LeadDrawer.
  if (embedded) {
    return <>{content}{modals}</>
  }

  if (onClose) {
    return (
      <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4">
        <div className="bg-surface-1 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[95vh] overflow-y-auto p-5" style={{ border: '1px solid var(--border)' }}>
          {content}
        </div>
        {modals}
      </div>
    )
  }

  return (
    <div className="w-full">
      {content}
      {modals}
    </div>
  )
}

export default function LeadDetail() {
  const { id } = useParams()
  if (!id) return <div className="text-center py-16" style={{ color: 'var(--text-muted)' }}>Lead no encontrado</div>
  return <LeadDetailView leadId={parseInt(id)} />
}
