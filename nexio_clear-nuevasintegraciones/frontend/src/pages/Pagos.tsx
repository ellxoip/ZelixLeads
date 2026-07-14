import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getPayments, confirmPayment, revertPayment, exportPayments, uploadPaymentInvoice } from '../api'
import type { PaymentVerification } from '../types'
import {
  CreditCard, CheckCircle, XCircle, RefreshCw, Eye, X,
  SlidersHorizontal, Download, Clock, Building2,
  User, Phone, History, Mail, FileText, ExternalLink, ImageOff,
  Upload, Loader2, Undo2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { parseDate } from '../utils/dates'
import { Link } from 'react-router-dom'
import { getGroups } from '../api'
import { useAuthStore } from '../store/auth'
import type { Group } from '../types'
import VerifyModal from '../components/VerifyModal'

function formatCLP(n: number) {
  return `$${Math.round(n).toLocaleString('es-CL')}`
}

const STATUS_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  pago_exitoso: 'Confirmado',
  rechazado: 'Rechazado',
}

const STATUS_COLOR: Record<string, string> = {
  pendiente:    'text-warn border border-warn/30 bg-warn/10',
  pago_exitoso: 'text-lime border border-lime/30 bg-lime/10',
  rechazado:    'text-danger border border-danger/30 bg-danger/10',
}

const STATUS_DOT: Record<string, string> = {
  pendiente:    'bg-warn',
  pago_exitoso: 'bg-lime',
  rechazado:    'bg-danger',
}

export default function Pagos() {
  const { user } = useAuthStore()
  const [payments, setPayments] = useState<PaymentVerification[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [groups, setGroups] = useState<Group[]>([])
  const [view, setView] = useState<'kanban' | 'history'>('kanban')
  const [confirmModal, setConfirmModal] = useState<{ pv: PaymentVerification; type: 'confirm' | 'reject' | 'view' } | null>(null)
  const [reverting, setReverting] = useState<number | null>(null)
  const [revertConfirmId, setRevertConfirmId] = useState<number | null>(null)
  const [form, setForm] = useState({ payment_amount: '', payment_method: 'transferencia', payment_date: '', payment_reference: '', invoice_url: '', notes: '' })
  const [confirming, setConfirming] = useState(false)
  const [exporting, setExporting] = useState(false)

  const isDante = user?.role === 'verificador'
  const isAdmin = user?.role === 'superadmin' || user?.role === 'subadmin'
  const [searchParams] = useSearchParams()

  useEffect(() => {
    const gid = searchParams.get('group_id')
    if (gid) setGroupFilter(gid)
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      const params: any = {}
      if (statusFilter) params.status = statusFilter
      if (groupFilter) params.group_id = parseInt(groupFilter)
      setPayments(await getPayments(params))
    } catch {
      toast.error('Error cargando pagos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [statusFilter, groupFilter])

  useEffect(() => {
    if (isAdmin || isDante) {
      getGroups().then(setGroups).catch(() => {})
    }
  }, [])

  const handleConfirm = async () => {
    if (!confirmModal) return
    setConfirming(true)
    try {
      await confirmPayment(confirmModal.pv.id, {
        status: confirmModal.type === 'confirm' ? 'pago_exitoso' : 'rechazado',
        payment_amount: form.payment_amount ? parseFloat(form.payment_amount) : null,
        payment_method: form.payment_method || null,
        payment_date: form.payment_date || null,
        payment_reference: form.payment_reference || null,
        invoice_url: form.invoice_url || null,
        notes: form.notes || null,
      })
      toast.success(confirmModal.type === 'confirm' ? 'Pago confirmado exitosamente' : 'Pago rechazado')
      setConfirmModal(null)
      setForm({ payment_amount: '', payment_method: 'transferencia', payment_date: '', payment_reference: '', invoice_url: '', notes: '' })
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Error al procesar')
    } finally {
      setConfirming(false)
    }
  }

  const handleRevert = async (pvId: number) => {
    if (revertConfirmId !== pvId) {
      setRevertConfirmId(pvId)
      setTimeout(() => setRevertConfirmId(prev => prev === pvId ? null : prev), 3000)
      return
    }
    setRevertConfirmId(null)
    setReverting(pvId)
    try {
      await revertPayment(pvId)
      toast.success('Pago revertido a pendiente')
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Error al revertir')
    } finally {
      setReverting(null)
    }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const params: any = {}
      if (statusFilter) params.status = statusFilter
      if (groupFilter) params.group_id = parseInt(groupFilter)
      await exportPayments(params)
      toast.success('Excel descargado')
    } catch {
      toast.error('Error exportando')
    } finally {
      setExporting(false)
    }
  }

  const pendiente = payments.filter(p => p.status === 'pendiente').length
  const exitoso   = payments.filter(p => p.status === 'pago_exitoso').length
  const rechazado = payments.filter(p => p.status === 'rechazado').length

  const kpis = [
    { label: 'Pendientes',  value: pendiente, icon: CreditCard, color: 'bg-warn/15 text-warn' },
    { label: 'Confirmados', value: exitoso,   icon: CheckCircle, color: 'bg-lime/15 text-lime' },
    { label: 'Rechazados',  value: rechazado, icon: XCircle, color: 'bg-danger/15 text-danger' },
  ]

  return (
    <div className="space-y-5">

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Verificación de Pagos</h1>
          <p className="text-white/62 text-sm mt-0.5">{payments.length} registros totales</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} disabled={exporting}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl border border-white/10 bg-surface-1 text-white/78 hover:bg-surface-0 transition-colors disabled:opacity-50">
            <Download size={14} className={exporting ? 'animate-bounce' : ''} />
            {exporting ? 'Exportando...' : 'Excel'}
          </button>
          <button onClick={load} className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl border border-white/10 bg-surface-1 text-white/78 hover:bg-surface-0 transition-colors">
            <RefreshCw size={14} /> Actualizar
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        {kpis.map(k => (
          <div key={k.label} className="bg-surface-1 rounded-xl border border-white/[0.07] shadow-sm p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold text-white/52 uppercase tracking-wide">{k.label}</p>
                <p className="text-2xl font-bold text-white mt-1">{k.value}</p>
              </div>
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${k.color}`}>
                <k.icon size={18} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters + View Toggle */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="flex bg-surface-2 rounded-xl p-1">
          <button onClick={() => setView('kanban')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${view === 'kanban' ? 'bg-surface-1 text-white shadow-sm' : 'text-white/62 hover:text-white/85'}`}>
            <CreditCard size={13} /> Panel
          </button>
          <button onClick={() => setView('history')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${view === 'history' ? 'bg-surface-1 text-white shadow-sm' : 'text-white/62 hover:text-white/85'}`}>
            <History size={13} /> Historial
          </button>
        </div>

        <div className="relative">
          <SlidersHorizontal size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/52 pointer-events-none" />
          <select className="input pl-10 h-10 w-52 appearance-none" value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}>
            <option value="">Todos los estados</option>
            <option value="pendiente">Pendiente</option>
            <option value="pago_exitoso">Pago Exitoso</option>
            <option value="rechazado">Rechazado</option>
          </select>
        </div>

        {(isAdmin || isDante) && groups.length > 0 && (
          <div className="relative">
            <Building2 size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/52 pointer-events-none" />
            <select className="input pl-10 h-10 w-44 appearance-none" value={groupFilter}
              onChange={e => setGroupFilter(e.target.value)}>
              <option value="">Todos los grupos</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-7 h-7 border-2 border-lime border-t-transparent rounded-full animate-spin" />
        </div>
      ) : view === 'kanban' ? (
        <KanbanView payments={payments} isDante={isDante} onAction={setConfirmModal} onRevert={handleRevert} reverting={reverting} revertConfirmId={revertConfirmId} />
      ) : (
        <HistoryView payments={payments} isDante={isDante} onAction={setConfirmModal} onRevert={handleRevert} reverting={reverting} revertConfirmId={revertConfirmId} />
      )}

      {/* Confirm modal */}
      {confirmModal && (
        <VerifyModal
          pv={confirmModal.pv}
          type={confirmModal.type}
          form={form}
          setForm={setForm}
          onConfirm={handleConfirm}
          onClose={() => setConfirmModal(null)}
          confirming={confirming}
        />
      )}
    </div>
  )
}



/* ── Kanban View ─────────────────────────────────────────── */
function KanbanView({ payments, isDante, onAction, onRevert, reverting, revertConfirmId }: {
  payments: PaymentVerification[]
  isDante: boolean
  onAction: (v: any) => void
  onRevert: (id: number) => void
  reverting: number | null
  revertConfirmId: number | null
}) {
  const columns = [
    { status: 'pendiente', label: 'Pendiente de verificación', dot: 'bg-warn' },
    { status: 'pago_exitoso', label: 'Pago Confirmado', dot: 'bg-lime' },
    { status: 'rechazado', label: 'Rechazado', dot: 'bg-danger' },
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {columns.map(col => {
        const colPayments = payments.filter(p => p.status === col.status)
        return (
          <div key={col.status} className="bg-surface-1 rounded-xl border border-white/[0.07] shadow-sm overflow-hidden">
            <div className="px-4 py-3.5 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${col.dot} flex-shrink-0`} />
                <h3 className="font-semibold text-white/85 text-sm">{col.label}</h3>
              </div>
              <span className="bg-surface-2 text-white/78 text-xs font-bold px-2.5 py-1 rounded-full">{colPayments.length}</span>
            </div>
            <div className="p-3 space-y-2.5 max-h-[520px] overflow-y-auto">
              {colPayments.length === 0 ? (
                <p className="text-center text-sm text-white/52 py-8">Sin registros</p>
              ) : colPayments.map(pv => (
                <PaymentCard key={pv.id} pv={pv} isDante={isDante} onAction={onAction} onRevert={onRevert} reverting={reverting} revertConfirmId={revertConfirmId} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ── History View ────────────────────────────────────────── */
function HistoryView({ payments, isDante, onAction, onRevert, reverting, revertConfirmId }: {
  payments: PaymentVerification[]
  isDante: boolean
  onAction: (v: any) => void
  onRevert: (id: number) => void
  reverting: number | null
  revertConfirmId: number | null
}) {
  const sorted = [...payments].sort((a, b) =>
    parseDate(b.created_at).getTime() - parseDate(a.created_at).getTime()
  )

  return (
    <div className="bg-surface-1 rounded-xl border border-white/[0.07] shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-white/5 flex items-center gap-2">
        <History size={16} className="text-white/52" />
        <h3 className="font-semibold text-white/85">Historial completo de pagos</h3>
        <span className="ml-auto text-xs text-white/52">{sorted.length} registros</span>
      </div>
      <div className="divide-y divide-white/5 max-h-[600px] overflow-y-auto">
        {sorted.length === 0 ? (
          <p className="text-center text-sm text-white/52 py-12">Sin registros</p>
        ) : sorted.map((pv, idx) => (
          <div key={pv.id} className={`px-5 py-4 hover:bg-surface-0/60 transition-colors ${idx % 2 === 0 ? '' : 'bg-surface-0/30'}`}>
            <div className="flex items-start gap-4">
              {/* Status indicator */}
              <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 border-2 ${
                  pv.status === 'pago_exitoso' ? 'border-lime/25 bg-lime/10' :
                  pv.status === 'rechazado' ? 'border-danger/30 bg-danger/10' :
                  'border-warn/25 bg-warn/10'
                }`}>
                  {pv.status === 'pago_exitoso' ? <CheckCircle size={16} className="text-lime" /> :
                   pv.status === 'rechazado' ? <XCircle size={16} className="text-danger" /> :
                   <Clock size={16} className="text-warn" />}
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <p className="font-semibold text-white/90 text-sm">{pv.lead?.contact?.name}</p>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_COLOR[pv.status]}`}>
                        {STATUS_LABEL[pv.status]}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap text-xs text-white/52">
                      <span className="flex items-center gap-1">
                        <Phone size={10} /> {pv.lead?.contact?.phone}
                      </span>
                      {pv.lead?.area?.name && (
                        <span className="font-medium text-white/62">{pv.lead.area.name}</span>
                      )}
                      {pv.lead?.group?.name && (
                        <span className="flex items-center gap-1">
                          <Building2 size={10} /> {pv.lead.group.name}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 flex-wrap text-xs text-white/52 mt-0.5">
                      {pv.lead?.vendedor?.name && (
                        <span className="flex items-center gap-1">
                          <User size={10} /> {pv.lead.vendedor.name}
                        </span>
                      )}
                      {pv.payment_method && <span>· {pv.payment_method}</span>}
                      {pv.payment_reference && <span>· {pv.payment_reference}</span>}
                    </div>
                    {pv.notes && (
                      <p className="text-xs text-white/52 mt-1 italic">"{pv.notes}"</p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-base font-bold text-white/90">{formatCLP(pv.payment_amount || pv.lead?.honorarios || 0)}</p>
                    <p className="text-[11px] text-white/52 mt-0.5">
                      {format(parseDate(pv.created_at), "d MMM yyyy · HH:mm", { locale: es })}
                    </p>
                    {pv.confirmed_at && (
                      <p className="text-[11px] text-lime font-medium mt-0.5">
                        Conf: {format(parseDate(pv.confirmed_at), "d MMM yyyy · HH:mm", { locale: es })}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                  <button onClick={() => onAction({ pv, type: 'view' })}
                    className="flex items-center gap-1 text-xs text-white/62 hover:text-white/90 border border-white/10 px-2.5 py-1 rounded-lg transition-colors bg-surface-1 font-medium">
                    <Eye size={11} /> Ver Detalles
                  </button>
                  {isDante && pv.status === 'pago_exitoso' && (
                    <button
                      onClick={() => onRevert(pv.id)}
                      disabled={reverting === pv.id}
                      className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg transition-colors font-medium disabled:opacity-50 ${revertConfirmId === pv.id ? 'bg-danger text-white border border-danger' : 'text-warn border border-warn/25 bg-warn/10 hover:bg-warn/20'}`}>
                      {reverting === pv.id ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={11} />}
                      {revertConfirmId === pv.id ? 'Confirmar' : 'Revertir'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PaymentCard({ pv, isDante, onAction, onRevert, reverting, revertConfirmId }: {
  pv: PaymentVerification
  isDante: boolean
  onAction: (v: any) => void
  onRevert: (id: number) => void
  reverting: number | null
  revertConfirmId: number | null
}) {
  return (
    <div className="bg-surface-1 rounded-xl p-3.5 border border-white/[0.07] shadow-sm hover:shadow-card-lg hover:border-white/10 transition-all">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-full bg-surface-2 border border-white/10 flex items-center justify-center flex-shrink-0">
            <span className="text-white/90 font-bold text-xs">{pv.lead?.contact?.name?.charAt(0) ?? '?'}</span>
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-white/90 text-sm truncate">{pv.lead?.contact?.name}</p>
            <p className="text-xs text-white/52 truncate">{pv.lead?.contact?.phone}</p>
          </div>
        </div>
        <button onClick={() => onAction({ pv, type: 'view' })}
          className="p-1.5 hover:bg-surface-2 rounded-lg text-white/52 hover:text-white/90 flex-shrink-0 transition-colors">
          <Eye size={13} />
        </button>
      </div>

      <div className="space-y-1 mb-2.5">
        <div className="flex items-center justify-between">
          <p className="text-xs text-white/62">{pv.lead?.area?.name}</p>
          <p className="text-sm font-bold text-white/90">{formatCLP(pv.lead?.honorarios || 0)}</p>
        </div>
        {pv.lead?.group?.name && (
          <p className="text-xs text-white/52 flex items-center gap-1">
            <Building2 size={10} /> {pv.lead.group.name}
          </p>
        )}
        {pv.lead?.vendedor?.name && (
          <p className="text-xs text-white/52">
            <span className="font-medium text-white/62">Vendedor/a:</span> {pv.lead.vendedor.name}
          </p>
        )}
        {pv.lead?.agendadora?.name && (
          <p className="text-xs text-white/52">
            <span className="font-medium text-white/62">Agendador/a:</span> {pv.lead.agendadora.name}
          </p>
        )}
        <p className="text-[11px] text-white/38">
          {format(parseDate(pv.created_at), "d MMM yyyy · HH:mm", { locale: es })}
        </p>
      </div>

      {isDante && pv.status === 'pendiente' && (
        <div className="flex gap-2">
          <button onClick={() => onAction({ pv, type: 'confirm' })}
            className="flex-1 text-xs py-1.5 flex items-center justify-center gap-1 bg-surface-1 hover:bg-surface-2 text-white rounded-lg transition-colors font-medium">
            <CheckCircle size={13} /> Verificar pago
          </button>
          <button onClick={() => onAction({ pv, type: 'reject' })}
            className="flex-1 text-xs py-1.5 flex items-center justify-center gap-1 bg-surface-1 border border-white/10 hover:bg-surface-0 text-white/78 rounded-lg transition-colors font-medium">
            <XCircle size={13} /> Rechazar
          </button>
        </div>
      )}
      {pv.status === 'pago_exitoso' && (
        <div className="space-y-1.5 mt-2">
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg"
            style={{ background: 'rgba(163,230,53,0.10)', border: '1px solid rgba(163,230,53,0.25)' }}>
            <CheckCircle size={11} className="text-lime flex-shrink-0" />
            <span className="text-[11px] font-bold text-lime">Pago Confirmado</span>
          </div>
          {pv.payment_amount && pv.payment_amount > 0 ? (
            <p className="text-xs font-bold text-lime">{formatCLP(pv.payment_amount)} pagado</p>
          ) : pv.lead?.honorarios ? (
            <p className="text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Monto: {formatCLP(pv.lead.honorarios)}
            </p>
          ) : null}
          {pv.payment_method && (
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.52)' }}>
              Método: <span className="capitalize font-medium" style={{ color: 'rgba(255,255,255,0.75)' }}>{pv.payment_method}</span>
            </p>
          )}
          {pv.payment_date && (
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.52)' }}>
              Fecha pago: <span className="font-medium" style={{ color: 'rgba(255,255,255,0.75)' }}>{pv.payment_date}</span>
            </p>
          )}
          {pv.confirmed_at && (
            <p className="text-[11px] text-white/52 font-medium flex items-center gap-1">
              <CheckCircle size={10} />
              Conf: {format(parseDate(pv.confirmed_at), "d MMM yyyy · HH:mm", { locale: es })}
            </p>
          )}
          {pv.notes && (
            <p className="text-[11px] italic" style={{ color: 'rgba(255,255,255,0.42)' }}>"{pv.notes}"</p>
          )}
          {isDante && (
            <button
              onClick={() => onRevert(pv.id)}
              disabled={reverting === pv.id}
              className={`w-full mt-1 flex items-center justify-center gap-1.5 text-[11px] py-1.5 rounded-lg transition-colors font-semibold disabled:opacity-50 ${revertConfirmId === pv.id ? 'bg-danger text-white border border-danger' : 'text-warn border border-warn/25 bg-warn/10 hover:bg-warn/20'}`}>
              {reverting === pv.id ? <Loader2 size={10} className="animate-spin" /> : <Undo2 size={10} />}
              {revertConfirmId === pv.id ? 'Confirmar reversión' : 'Revertir pago'}
            </button>
          )}
        </div>
      )}
      {pv.status === 'rechazado' && (
        <p className="text-xs text-white/52 font-medium flex items-center gap-1">
          <XCircle size={11} /> Rechazado {pv.notes ? `· ${pv.notes}` : ''}
        </p>
      )}
      {pv.invoice_url && (
        <a href={pv.invoice_url} target="_blank" rel="noopener noreferrer"
          className="mt-2 flex items-center gap-1.5 text-[11px] text-white/62 hover:text-white/90 border border-white/10 hover:border-white/25 px-2 py-1.5 rounded-lg transition-colors bg-surface-1">
          <FileText size={11} className="flex-shrink-0" /> Ver comprobante
        </a>
      )}
    </div>
  )
}
