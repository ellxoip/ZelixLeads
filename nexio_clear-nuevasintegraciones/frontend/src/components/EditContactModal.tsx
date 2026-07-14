import { useState } from 'react'
import { X, Lock } from 'lucide-react'
import toast from 'react-hot-toast'
import { updateContact } from '../api'
import type { Contact } from '../types'
import { rutOnChange } from '../utils/rut'
import { useAuthStore } from '../store/auth'
import { useReadOnly } from '../hooks/useReadOnly'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>{label}</label>
      {children}
    </div>
  )
}

export function EditContactModal({ contact, onClose, onSuccess }: {
  contact: Contact; onClose: () => void; onSuccess: (c: Contact) => void
}) {
  const role = useAuthStore(s => s.user?.role)
  const { editUnlocked } = useReadOnly()
  // Identidad (RUT + nombre + razón social) protegida una vez que hay RUT.
  // Solo el superadmin, con la edición habilitada, puede corregirla.
  const hasRut = !!((contact.rut_persona || '').trim() || (contact.rut_empresa || '').trim())
  const canEditIdentity = role === 'superadmin' && editUnlocked
  const lockIdentity = hasRut && !canEditIdentity

  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name:         contact.name         ?? '',
    phone:        contact.phone        ?? '',
    email:        contact.email        ?? '',
    rut_persona:  contact.rut_persona  ?? '',
    rut_empresa:  contact.rut_empresa  ?? '',
    razon_social: contact.razon_social ?? '',
    city:         contact.city         ?? '',
    address:      contact.address      ?? '',
    notes:        contact.notes        ?? '',
  })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.phone) { toast.error('Nombre y teléfono son requeridos'); return }
    setLoading(true)
    try {
      const updated = await updateContact(contact.id, form)
      toast.success('Contacto actualizado')
      onSuccess(updated)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Error al actualizar')
    } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-[60] p-4">
      <div className="bg-surface-1 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] flex flex-col" style={{ border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07] flex-shrink-0">
          <h2 className="text-base font-bold text-white">Editar Contacto</h2>
          <button onClick={onClose} className="p-2 hover:bg-surface-2 rounded-lg" style={{ color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto px-6 py-4">
          {lockIdentity && (
            <div className="flex items-start gap-2 mb-3 px-3 py-2 rounded-lg"
              style={{ background: 'rgba(234,179,8,0.10)', border: '1px solid rgba(234,179,8,0.30)' }}>
              <Lock size={13} style={{ color: '#eab308', marginTop: 1, flexShrink: 0 }} />
              <span className="text-[11px] leading-snug" style={{ color: '#a16207' }}>
                <strong>Identidad protegida.</strong> El nombre, la razón social y el RUT no se pueden
                cambiar en un contacto que ya tiene RUT (evita romper los sistemas vinculados).
                Un superadministrador con la edición habilitada puede corregirlos.
              </span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre *">
              <input className="input" value={form.name} onChange={e => set('name', e.target.value)}
                disabled={lockIdentity} required />
            </Field>
            <Field label="Teléfono *">
              <input className="input" value={form.phone} onChange={e => set('phone', e.target.value)} required />
            </Field>
            <Field label="Email">
              <input type="email" className="input" value={form.email} onChange={e => set('email', e.target.value)} />
            </Field>
            <Field label="Comuna">
              <input className="input" value={form.city} onChange={e => set('city', e.target.value)} placeholder="Ej: Providencia" />
            </Field>
            <Field label="RUT Persona">
              <input className="input" value={form.rut_persona} onChange={e => set('rut_persona', rutOnChange(e.target.value))}
                disabled={lockIdentity} placeholder="12.345.678-9" />
            </Field>
            <Field label="RUT Empresa">
              <input className="input" value={form.rut_empresa} onChange={e => set('rut_empresa', rutOnChange(e.target.value))}
                disabled={lockIdentity} placeholder="76.000.000-0" />
            </Field>
            <div className="col-span-2">
              <Field label="Razón Social">
                <input className="input" value={form.razon_social} onChange={e => set('razon_social', e.target.value)}
                  disabled={lockIdentity} />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="Domicilio">
                <input className="input" value={form.address} onChange={e => set('address', e.target.value)} placeholder="Av. Principal 123" />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="Notas">
                <textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
              </Field>
            </div>
          </div>
        </form>
        <div className="px-6 py-4 border-t border-white/[0.07] flex justify-end gap-3 flex-shrink-0">
          <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={handleSave} disabled={loading} className="btn-primary">
            {loading ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}
