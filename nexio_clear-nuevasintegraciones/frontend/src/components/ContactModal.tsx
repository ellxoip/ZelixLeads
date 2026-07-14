import { useState } from 'react'
import { createContact } from '../api'
import { useAuthStore } from '../store/auth'
import toast from 'react-hot-toast'
import { X, User } from 'lucide-react'
import { rutOnChange } from '../utils/rut'

interface Props { onClose: () => void; onSuccess: (c: any) => void }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="input-label">{label}</label>{children}</div>
}

export default function ContactModal({ onClose, onSuccess }: Props) {
  const { user } = useAuthStore()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: '', phone: '', rut_persona: '', rut_empresa: '',
    razon_social: '', email: '', address: '', city: '', notes: '',
  })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.phone) { toast.error('Nombre y teléfono son requeridos'); return }
    setLoading(true)
    try {
      const contact = await createContact({ ...form, group_id: user?.group_id ?? null })
      toast.success('Contacto creado')
      onSuccess(contact)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Error al crear contacto')
    } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-[60] p-4">
      <div className="bg-surface-1 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.07] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-surface-2 rounded-lg flex items-center justify-center">
              <User size={16} className="text-white/90" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Nuevo Contacto</h2>
              <p className="text-xs text-white/52">Datos del cliente</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface-2 rounded-lg text-white/62">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Nombre completo *">
              <input className="input" value={form.name} required
                onChange={e => set('name', e.target.value)} placeholder="Juan Pérez González" />
            </Field>
            <Field label="Teléfono *">
              <input className="input" value={form.phone} required
                onChange={e => set('phone', e.target.value)} placeholder="+56 9 7640 6047" />
            </Field>
            <Field label="RUT del Cliente">
              <input className="input" value={form.rut_persona}
                onChange={e => set('rut_persona', rutOnChange(e.target.value))} placeholder="15.489.296-6" />
            </Field>
            <Field label="Email">
              <input type="email" className="input" value={form.email}
                onChange={e => set('email', e.target.value)} placeholder="cliente@email.com" />
            </Field>
          </div>

          <div className="pt-3 border-t border-white/5">
            <p className="text-xs font-semibold text-white/52 uppercase tracking-wide mb-3">Datos Empresa (opcional)</p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="RUT de la Empresa">
                <input className="input" value={form.rut_empresa}
                  onChange={e => set('rut_empresa', rutOnChange(e.target.value))} placeholder="76.585.063-0" />
              </Field>
              <Field label="Ciudad">
                <input className="input" value={form.city}
                  onChange={e => set('city', e.target.value)} placeholder="Santiago" />
              </Field>
              <div className="col-span-2">
                <Field label="Razón Social">
                  <input className="input" value={form.razon_social}
                    onChange={e => set('razon_social', e.target.value)} placeholder="Comercializadora SA" />
                </Field>
              </div>
              <div className="col-span-2">
                <Field label="Dirección">
                  <input className="input" value={form.address}
                    onChange={e => set('address', e.target.value)} placeholder="Av. Principal 123" />
                </Field>
              </div>
            </div>
          </div>

          <Field label="Notas">
            <textarea className="input" rows={2} value={form.notes}
              onChange={e => set('notes', e.target.value)} placeholder="Observaciones..." />
          </Field>
        </form>

        <div className="px-6 py-4 border-t border-white/[0.07] flex justify-end gap-3 flex-shrink-0">
          <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={handleSubmit} disabled={loading} className="btn-primary">
            {loading ? 'Guardando...' : 'Crear Contacto'}
          </button>
        </div>
      </div>
    </div>
  )
}
