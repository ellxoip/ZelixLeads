import { useState, useEffect, useRef } from 'react'

const fmtCLP = (v: string) => {
  const n = parseFloat(v)
  if (!v || isNaN(n) || n === 0) return ''
  return `$${Math.round(n).toLocaleString('es-CL')}`
}
import { createLead, getContacts, getGroups, getGroupAreas, getUsers, getGroupDefaultAssignment, getLeadsCount } from '../api'
import { useAuthStore } from '../store/auth'
import toast from 'react-hot-toast'
import { X, Plus, Lock, AlertTriangle, Search, ChevronDown } from 'lucide-react'
import ContactModal from './ContactModal'

interface Props { onClose: () => void; onSuccess: () => void }

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="input-label">{label}{required && <span className="text-red-400 ml-0.5">*</span>}</label>
      {children}
    </div>
  )
}

function LockedField({ label, name }: { label: string; name: string }) {
  return (
    <Field label={label}>
      <div className="input flex items-center gap-2 bg-surface-0 text-white/78 cursor-default">
        <Lock size={12} className="text-white/52 flex-shrink-0" />
        <span className="truncate">{name}</span>
      </div>
    </Field>
  )
}

export default function LeadModal({ onClose, onSuccess }: Props) {
  const { user } = useAuthStore()
  const [contacts, setContacts]   = useState<any[]>([])
  const [groups,   setGroups]     = useState<any[]>([])
  const [areas,    setAreas]      = useState<any[]>([])
  const [users,    setUsers]      = useState<any[]>([])
  const [showCM,   setShowCM]     = useState(false)
  const [loading,  setLoading]    = useState(false)
  const [atLeadLimit, setAtLeadLimit] = useState(false)
  // Searchable contact dropdown state
  const [contactSearch, setContactSearch] = useState('')
  const [showContactDrop, setShowContactDrop] = useState(false)
  const contactDropRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (contactDropRef.current && !contactDropRef.current.contains(e.target as Node)) {
        setShowContactDrop(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const isAgendadora  = user?.role === 'agendadora'
  const isVendedor    = user?.role === 'vendedor' || user?.role === 'verificador'
  const isRestricted  = isAgendadora || isVendedor

  const [form, setForm] = useState({
    contact_id:    '',
    area_id:       '',
    group_id:      user?.group_id?.toString() ?? '',
    agendadora_id: isAgendadora ? user!.id.toString() : '',
    vendedor_id:   isVendedor   ? user!.id.toString() : '',
    priority:      'normal',
    source:        'whatsapp',
    notes:         '',
  })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    const maxLeads = user?.negocio_plan_limits?.max_leads ?? -1
    if (maxLeads !== -1) {
      getLeadsCount().then((d: any) => {
        if ((d.total ?? 0) >= maxLeads) setAtLeadLimit(true)
      }).catch(() => {})
    }
    const fetches: Promise<any>[] = [getContacts(), getUsers()]
    if (!isRestricted) fetches.splice(1, 0, getGroups())
    else fetches.splice(1, 0, Promise.resolve([]))
    Promise.all(fetches).then(([c, g, u]) => {
      setContacts(c); setGroups(g); setUsers(u)
    })
  }, [])

  // When group changes: load areas, auto-assign from group
  useEffect(() => {
    if (!form.group_id) return
    const gid = parseInt(form.group_id)
    getGroupAreas(gid).then(setAreas)
    if (!isRestricted) {
      getGroupDefaultAssignment(gid).then((assignment: any) => {
        setForm(f => ({
          ...f,
          agendadora_id: assignment.agendadora ? assignment.agendadora.id.toString() : f.agendadora_id,
          vendedor_id:   assignment.vendedor   ? assignment.vendedor.id.toString()   : f.vendedor_id,
        }))
      }).catch(() => {})
    }
  }, [form.group_id])

  // When area changes: filter users to those assigned to the area (round-robin auto-assign)
  useEffect(() => {
    if (!form.area_id || !form.group_id || isRestricted) return
    const gid = parseInt(form.group_id)
    const aid = parseInt(form.area_id)
    getGroupDefaultAssignment(gid, aid).then((assignment: any) => {
      setForm(f => {
        const area = areas.find((a: any) => a.id === aid)
        const aUsers: any[] = area?.users ?? []
        const gActive = users.filter((u: any) => u.is_active && u.group_id === gid)
        const fallbackAgd =
          aUsers.find((u: any) => u.role === 'agendadora' && u.is_active !== false) ||
          gActive.find((u: any) => u.role === 'agendadora')
        const fallbackVnd =
          aUsers.find((u: any) => ['vendedor','verificador','subadmin'].includes(u.role) && u.is_active !== false) ||
          gActive.find((u: any) => ['vendedor','verificador','subadmin'].includes(u.role))
        return {
          ...f,
          agendadora_id: assignment.agendadora ? assignment.agendadora.id.toString() : (fallbackAgd?.id?.toString() ?? f.agendadora_id),
          vendedor_id:   assignment.vendedor   ? assignment.vendedor.id.toString()   : (fallbackVnd?.id?.toString() ?? f.vendedor_id),
        }
      })
    }).catch(() => {})
  }, [form.area_id, areas, users])

  // Get users filtered by selected area (if area has assigned users)
  const selectedArea = areas.find((a: any) => a.id === parseInt(form.area_id))
  const areaUsers: any[] = selectedArea?.users ?? []

  // All active users in the selected group
  const gUsers = users.filter(u => u.is_active && (form.group_id ? u.group_id === parseInt(form.group_id) : false))

  // For each role bucket: prefer area-assigned users, fall back to all group users
  const areaAgds = areaUsers.filter((u: any) => u.role === 'agendadora' && u.is_active !== false)
  const agendadoras = areaAgds.length > 0 ? areaAgds : gUsers.filter(u => u.role === 'agendadora')

  const areaVnds = areaUsers.filter((u: any) => ['vendedor', 'verificador', 'subadmin'].includes(u.role) && u.is_active !== false)
  const vendedores = areaVnds.length > 0 ? areaVnds : gUsers.filter(u => ['vendedor', 'verificador', 'subadmin'].includes(u.role))

  const myGroup = groups.find((g: any) => g.id === user?.group_id)?.name ?? (isRestricted ? `Grupo ${user?.group_id}` : '')
  const subGroups = groups.filter((g: any) => g.negocio_id !== null && g.negocio_id !== undefined)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.contact_id || !form.area_id || !form.group_id || !form.agendadora_id || !form.vendedor_id) {
      toast.error('Completa los campos requeridos'); return
    }
    setLoading(true)
    try {
      await createLead({
        contact_id:    parseInt(form.contact_id),
        area_id:       parseInt(form.area_id),
        group_id:      parseInt(form.group_id),
        agendadora_id: parseInt(form.agendadora_id),
        vendedor_id:   parseInt(form.vendedor_id),
        notes:         form.notes || null,
        priority:      form.priority,
        source:        form.source || null,
      })
      toast.success('Lead creado')
      onSuccess()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Error al crear lead')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4">
      <div className="bg-surface-1 rounded-2xl shadow-modal w-full max-w-lg max-h-[92vh] flex flex-col">

        <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.07] flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-white">Nuevo Lead</h2>
            <p className="text-xs text-white/52 mt-0.5">Información básica del cliente — el resto se completa en la conversación</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface-2 rounded-lg transition-colors text-white/62">
            <X size={18} />
          </button>
        </div>

        {atLeadLimit && (
          <div className="mx-6 mt-4 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium"
            style={{ background: 'rgba(225,29,72,0.08)', border: '1px solid rgba(225,29,72,0.20)', color: '#e11d48' }}>
            <AlertTriangle size={15} className="flex-shrink-0" />
            <span>Límite de leads del plan alcanzado. Actualiza el plan para crear más.</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          <Field label="Cliente" required>
            <div className="flex gap-2">
              <div className="relative flex-1" ref={contactDropRef}>
                {/* Trigger button showing selected contact or placeholder */}
                <button
                  type="button"
                  onClick={() => setShowContactDrop(v => !v)}
                  className="input w-full flex items-center justify-between gap-2 text-left"
                  style={{ minHeight: 40 }}
                >
                  <span className={form.contact_id ? 'text-white' : 'text-white/40'} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {form.contact_id
                      ? (() => { const c = contacts.find((x: any) => String(x.id) === form.contact_id); return c ? `${c.name} — ${c.phone}` : 'Seleccionar...' })()
                      : 'Seleccionar cliente...'}
                  </span>
                  <ChevronDown size={13} className="text-white/40 flex-shrink-0" />
                </button>
                {showContactDrop && (
                  <div className="absolute z-50 left-0 right-0 top-full mt-1 rounded-xl overflow-hidden shadow-2xl"
                    style={{ background: '#ffffff', border: '1px solid #e6e1f0', maxHeight: 280 }}>
                    {/* Search input */}
                    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-200">
                      <Search size={13} className="flex-shrink-0" style={{ color: '#64748b' }} />
                      <input
                        autoFocus
                        value={contactSearch}
                        onChange={e => setContactSearch(e.target.value)}
                        placeholder="Buscar por nombre, teléfono o RUT..."
                        className="flex-1 bg-transparent text-sm focus:outline-none"
                        style={{ color: '#1c1633' }}
                      />
                      {contactSearch && (
                        <button type="button" onClick={() => setContactSearch('')} style={{ color: '#94a3b8' }}>
                          <X size={12} />
                        </button>
                      )}
                    </div>
                    {/* Options list */}
                    <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
                      {contacts
                        .filter((c: any) => {
                          if (!contactSearch) return true
                          const q = contactSearch.toLowerCase()
                          return (
                            c.name?.toLowerCase().includes(q) ||
                            c.phone?.toLowerCase().includes(q) ||
                            c.rut_persona?.toLowerCase().includes(q) ||
                            c.email?.toLowerCase().includes(q)
                          )
                        })
                        .map((c: any) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => { set('contact_id', String(c.id)); setShowContactDrop(false); setContactSearch('') }}
                            className="w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-colors"
                            style={{
                              background: String(c.id) === form.contact_id ? 'rgba(124,58,237,0.10)' : 'transparent',
                              color: String(c.id) === form.contact_id ? '#7c3aed' : '#1c1633',
                            }}
                            onMouseEnter={e => { if (String(c.id) !== form.contact_id) (e.currentTarget as HTMLElement).style.background = '#faf9fd' }}
                            onMouseLeave={e => { if (String(c.id) !== form.contact_id) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                          >
                            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold"
                              style={{ background: 'rgba(124,58,237,0.12)', color: '#7c3aed' }}>
                              {c.name?.charAt(0)?.toUpperCase() ?? '?'}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold truncate">{c.name}</p>
                              <p className="text-[11px] truncate" style={{ color: '#64748b' }}>{c.phone}{c.rut_persona ? ` · ${c.rut_persona}` : ''}</p>
                            </div>
                          </button>
                        ))}
                      {contacts.filter((c: any) => {
                        if (!contactSearch) return true
                        const q = contactSearch.toLowerCase()
                        return c.name?.toLowerCase().includes(q) || c.phone?.toLowerCase().includes(q) || c.rut_persona?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q)
                      }).length === 0 && (
                        <p className="text-center text-sm py-6" style={{ color: '#94a3b8' }}>Sin resultados</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <button type="button" onClick={() => setShowCM(true)}
                className="btn-secondary px-3 flex-shrink-0" title="Nuevo contacto">
                <Plus size={15} />
              </button>
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            {isRestricted ? (
              <LockedField label="Grupo" name={myGroup} />
            ) : (
              <Field label="Grupo" required>
                <select className="input" value={form.group_id}
                  onChange={e => { set('group_id', e.target.value); set('area_id', '') }} required>
                  <option value="">Seleccionar...</option>
                  {subGroups.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </Field>
            )}

            <Field label="Área Legal" required>
              <select className="input" value={form.area_id}
                onChange={e => set('area_id', e.target.value)}
                required disabled={!form.group_id}>
                <option value="">Seleccionar...</option>
                {areas.map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.users?.length > 0 ? ` (${a.users.length} usuarios)` : ''}
                  </option>
                ))}
              </select>
            </Field>

            {isAgendadora ? (
              <LockedField label="Agendador/a" name={user!.name} />
            ) : (
              <Field label="Agendador/a" required>
                <select className="input" value={form.agendadora_id}
                  onChange={e => set('agendadora_id', e.target.value)} required>
                  <option value="">Seleccionar...</option>
                  {agendadoras.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                {areaAgds.length > 0 && (
                  <p className="text-[10px] mt-0.5" style={{ color: '#60a5fa' }}>
                    Filtrado por área · {agendadoras.length} disponible{agendadoras.length !== 1 ? 's' : ''}
                  </p>
                )}
              </Field>
            )}

            {isVendedor ? (
              <LockedField label="Vendedor" name={user!.name} />
            ) : (
              <Field label="Vendedor" required>
                <select className="input" value={form.vendedor_id}
                  onChange={e => set('vendedor_id', e.target.value)} required>
                  <option value="">Seleccionar...</option>
                  {vendedores.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                {areaVnds.length > 0 && (
                  <p className="text-[10px] mt-0.5" style={{ color: '#60a5fa' }}>
                    Filtrado por área · {vendedores.length} disponible{vendedores.length !== 1 ? 's' : ''}
                  </p>
                )}
              </Field>
            )}

            <Field label="Prioridad">
              <select className="input" value={form.priority} onChange={e => set('priority', e.target.value)}>
                <option value="low">Baja</option>
                <option value="normal">Normal</option>
                <option value="high">Alta</option>
              </select>
            </Field>

            <Field label="Fuente">
              <select className="input" value={form.source} onChange={e => set('source', e.target.value)}>
                <option value="whatsapp">WhatsApp</option>
                <option value="referido">Referido</option>
                <option value="facebook">Facebook</option>
                <option value="instagram">Instagram</option>
                <option value="web">Sitio Web</option>
                <option value="otro">Otro</option>
              </select>
            </Field>
          </div>

          <Field label="Notas iniciales (opcional)">
            <textarea className="input" rows={2} value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Ej: Cliente interesado en liquidación, llamar por las tardes..." />
          </Field>

        </form>

        <div className="px-6 py-4 border-t border-white/[0.07] flex items-center justify-end gap-3 flex-shrink-0">
          <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={handleSubmit} disabled={loading || atLeadLimit} className="btn-primary">
            {loading ? 'Creando...' : 'Crear Lead'}
          </button>
        </div>
      </div>

      {showCM && (
        <ContactModal
          onClose={() => setShowCM(false)}
          onSuccess={c => { setContacts(prev => [c, ...prev]); set('contact_id', c.id.toString()); setShowCM(false) }}
        />
      )}
    </div>
  )
}
