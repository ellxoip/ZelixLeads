import { useState, useEffect } from 'react'
import { parseDate } from '../utils/dates'
import {
  X, User, Mail, Phone, Building2, FileText, ExternalLink,
  Upload, Loader2, CheckCircle, XCircle, Eye
} from 'lucide-react'
import toast from 'react-hot-toast'
import { uploadPaymentInvoice } from '../api'
import type { PaymentVerification, Lead } from '../types'

/* ── Utils ───────────────────────────────────────────────── */
function formatCLP(n: number) {
  return `$${Math.round(n).toLocaleString('es-CL')}`
}

/* ── Invoice Preview ─────────────────────────────────────── */
function InvoicePreview({ url }: { url: string }) {
  const isImage = /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)
  const isPdf   = /\.pdf(\?|$)/i.test(url)

  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={url}
          alt="Comprobante de pago"
          className="w-full max-h-56 object-contain rounded-xl border border-white/10 bg-surface-0 cursor-zoom-in hover:opacity-90 transition-opacity"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
        <p className="text-[11px] text-white/52 mt-1 text-center">Click para abrir en tamaño completo</p>
      </a>
    )
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-2.5 p-3 bg-surface-0 border border-white/10 rounded-xl hover:bg-surface-2 transition-colors group">
      {isPdf
        ? <FileText size={20} className="text-danger flex-shrink-0" />
        : <ExternalLink size={20} className="text-white/52 flex-shrink-0" />
      }
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white/85 group-hover:text-white truncate">
          {isPdf ? 'Comprobante PDF' : 'Ver comprobante'}
        </p>
        <p className="text-[11px] text-white/52 truncate">{url}</p>
      </div>
      <ExternalLink size={13} className="text-white/52 flex-shrink-0" />
    </a>
  )
}

/* ── Verify Modal ────────────────────────────────────────── */
interface VerifyModalProps {
  pv: PaymentVerification
  type: 'confirm' | 'reject' | 'view'
  form: any
  setForm: (fn: (f: any) => any) => void
  onConfirm: () => void
  onClose: () => void
  confirming?: boolean
}

export default function VerifyModal({ pv, type, form, setForm, onConfirm, onClose, confirming }: VerifyModalProps) {
  const contact = pv.lead?.contact
  const lead    = pv.lead
  const [invoiceUrl, setInvoiceUrl] = useState<string | null>(pv.invoice_url)
  const [uploading, setUploading]   = useState(false)
  const [dragOver, setDragOver]     = useState(false)

  const isView = type === 'view'

  const handleFile = async (file: File) => {
    if (isView) return
    const allowed = ['image/jpeg','image/jpg','image/png','image/webp','image/gif','application/pdf']
    if (!allowed.includes(file.type)) { toast.error('Solo imágenes o PDF'); return }
    setUploading(true)
    try {
      const res = await uploadPaymentInvoice(pv.id, file)
      setInvoiceUrl(res.invoice_url)
      setForm((f: any) => ({ ...f, invoice_url: res.invoice_url }))
      toast.success('Comprobante subido')
    } catch { toast.error('Error al subir archivo') }
    finally { setUploading(false) }
  }

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) handleFile(f)
    e.target.value = ''
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files?.[0]; if (f) handleFile(f)
  }

  return (
    <div className="fixed inset-0 bg-surface-1/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-1 rounded-2xl shadow-modal w-full max-w-2xl max-h-[92vh] flex flex-col scale-in">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm text-white ${
              type === 'confirm' ? 'bg-surface-1' :
              type === 'reject' ? 'bg-danger' : 'bg-lime text-black'
            }`}>
              {contact?.name?.charAt(0)?.toUpperCase() ?? '?'}
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                {type === 'confirm' ? 'Confirmar Pago' :
                 type === 'reject' ? 'Rechazar Pago' : 'Detalles del Pago'}
              </h3>
              <p className="text-xs text-white/52">{lead?.area?.name} · {lead?.group?.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface-2 rounded-lg text-white/62 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col md:flex-row gap-0">

            {/* LEFT — client info + comprobante */}
            <div className="md:w-[280px] flex-shrink-0 px-6 py-4 space-y-4 border-b md:border-b-0 md:border-r border-white/[0.07]">
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-white/52 uppercase tracking-widest">Cliente</p>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <User size={12} className="text-white/52 flex-shrink-0" />
                    <p className="text-sm font-semibold text-white/90">{contact?.name ?? '—'}</p>
                  </div>
                  {contact?.email && (
                    <div className="flex items-center gap-2">
                      <Mail size={12} className="text-white/52 flex-shrink-0" />
                      <p className="text-xs text-white/78">{contact.email}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Phone size={12} className="text-white/52 flex-shrink-0" />
                    <p className="text-xs text-white/78">{contact?.phone ?? '—'}</p>
                  </div>
                  {contact?.rut_persona && (
                    <p className="text-xs text-white/62 pl-5">RUT: {contact.rut_persona}</p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] font-bold text-white/52 uppercase tracking-widest">Lead</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/62">Categoría</span>
                  <span className="text-xs font-semibold text-white/85">{lead?.area?.name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/62">Vendedor</span>
                  <span className="text-xs font-semibold text-white/85">{lead?.vendedor?.name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/62">Agendador/a</span>
                  <span className="text-xs font-semibold text-white/85">{lead?.agendadora?.name}</span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-white/[0.07]">
                  <span className="text-xs text-white/62">Honorarios</span>
                  <span className="text-sm font-bold text-white">{formatCLP(lead?.honorarios || 0)}</span>
                </div>
                {(lead?.num_cuotas ?? 1) > 1 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/62">Cuotas</span>
                    <span className="text-xs font-semibold text-white/78">{lead!.num_cuotas} × {formatCLP(lead!.monto_cuota || 0)}</span>
                  </div>
                )}
              </div>

              {/* Comprobante de pago */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-white/52 uppercase tracking-widest">Comprobante de pago</p>

                {invoiceUrl ? (
                  <div className="space-y-2">
                    <InvoicePreview url={invoiceUrl} />
                    {!isView && (
                      <label className="flex items-center justify-center gap-1.5 text-[11px] text-white/62 hover:text-white/90 border border-white/10 hover:border-white/25 px-2 py-1.5 rounded-lg transition-colors bg-surface-1 cursor-pointer">
                        <Upload size={11} /> Reemplazar
                        <input type="file" className="hidden" accept="image/*,.pdf" onChange={onFileInput} />
                      </label>
                    )}
                  </div>
                ) : isView ? (
                  <div className="flex flex-col items-center justify-center py-8 rounded-xl bg-surface-0 border border-white/[0.07]">
                    <FileText size={24} className="text-white/15" />
                    <p className="text-[10px] text-white/52 mt-2">Sin comprobante subido</p>
                  </div>
                ) : (
                  <label
                    onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    className={`flex flex-col items-center justify-center gap-2 py-6 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
                      dragOver ? 'border-white/25 bg-surface-2' : 'border-white/10 bg-surface-0 hover:border-white/15 hover:bg-surface-2'
                    }`}
                  >
                    {uploading
                      ? <Loader2 size={22} className="text-white/52 animate-spin" />
                      : <Upload size={22} className="text-white/38" />
                    }
                    <div className="text-center">
                      <p className="text-xs font-semibold text-white/62">
                        {uploading ? 'Subiendo...' : 'Subir comprobante'}
                      </p>
                      <p className="text-[10px] text-white/52 mt-0.5">JPG, PNG, WEBP o PDF · máx 20 MB</p>
                    </div>
                    <input type="file" className="hidden" accept="image/*,.pdf" onChange={onFileInput} disabled={uploading} />
                  </label>
                )}
              </div>
            </div>

            {/* RIGHT — verification form */}
            <div className="flex-1 px-6 py-4 space-y-4">
              <p className="text-[10px] font-bold text-white/52 uppercase tracking-widest">
                {type === 'confirm' ? 'Detalles del Pago' :
                 type === 'reject' ? 'Motivo del Rechazo' : 'Información del Pago'}
              </p>

              {(type === 'confirm' || (isView && pv.status === 'pago_exitoso')) && (
                <>
                  <div>
                    <label className="input-label">Monto pagado ($)</label>
                    <input type="number" className="input disabled:bg-surface-0 disabled:text-white/78"
                      value={isView ? (pv.payment_amount || '') : form.payment_amount}
                      disabled={isView}
                      onChange={e => setForm((f: any) => ({ ...f, payment_amount: e.target.value }))}
                      placeholder={formatCLP(lead?.honorarios || 0)} />
                    {(isView ? pv.payment_amount : form.payment_amount) && (
                      <p className="text-xs text-lime font-bold mt-1.5 bg-lime/15 px-2 py-0.5 rounded inline-block">
                        {formatCLP(Number(isView ? pv.payment_amount : form.payment_amount))}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="input-label">Método</label>
                      <select className="input disabled:bg-surface-0 disabled:text-white/78"
                        value={isView ? (pv.payment_method || 'transferencia') : form.payment_method}
                        disabled={isView}
                        onChange={e => setForm((f: any) => ({ ...f, payment_method: e.target.value }))}>
                        <option value="transferencia">Transferencia</option>
                        <option value="efectivo">Efectivo</option>
                        <option value="cheque">Cheque</option>
                        <option value="tarjeta">Tarjeta</option>
                      </select>
                    </div>
                    <div>
                      <label className="input-label">Fecha de pago</label>
                      <input type="date" className="input disabled:bg-surface-0 disabled:text-white/78"
                        value={isView ? (pv.payment_date || '') : form.payment_date}
                        disabled={isView}
                        onChange={e => setForm((f: any) => ({ ...f, payment_date: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <label className="input-label">N° referencia / folio</label>
                    <input className="input disabled:bg-surface-0 disabled:text-white/78"
                      value={isView ? (pv.payment_reference || '') : form.payment_reference}
                      disabled={isView}
                      onChange={e => setForm((f: any) => ({ ...f, payment_reference: e.target.value }))}
                      placeholder="Ej: 123456789" />
                  </div>
                </>
              )}

              <div>
                <label className="input-label">Notas</label>
                <textarea className="input disabled:bg-surface-0 disabled:text-white/78"
                  rows={4}
                  value={isView ? (pv.notes || '') : form.notes}
                  disabled={isView}
                  onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))}
                  placeholder={type === 'confirm' ? 'Observaciones del pago...' : 'Motivo del rechazo...'} />
              </div>

              {isView && pv.confirmed_at && (
                <div className="pt-4 border-t border-white/5">
                  <div className="flex items-center gap-2 text-lime font-semibold text-xs">
                    <CheckCircle size={14} />
                    <span>Confirmado el {parseDate(pv.confirmed_at).toLocaleString('es-CL', { timeZone: 'America/Santiago', day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/[0.07] flex gap-3 flex-shrink-0">
          <button onClick={onClose} className="btn-secondary flex-1">
            {isView ? 'Cerrar' : 'Cancelar'}
          </button>
          {!isView && (
            <button onClick={onConfirm} disabled={confirming || uploading}
              className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-30 active:scale-[0.98] ${
                type === 'confirm'
                  ? 'bg-surface-1 hover:bg-surface-2 text-white'
                  : 'bg-danger hover:bg-red-600 text-white'
              }`}>
              {confirming
                ? <><Loader2 size={14} className="animate-spin" /> Procesando...</>
                : type === 'confirm'
                  ? <><CheckCircle size={15} /> Confirmar Pago</>
                  : <><XCircle size={15} /> Rechazar Pago</>
              }
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
