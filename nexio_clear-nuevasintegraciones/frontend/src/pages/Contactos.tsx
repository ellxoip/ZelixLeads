import { useState, useEffect, useRef } from 'react'
import { getContactsPaged, deleteContact, updateContact, createContact, bulkImportContacts, getGroups, exportContacts, getUsers } from '../api'
import type { Contact } from '../types'
import {
  Plus, Search, Trash2, Phone, Mail, RefreshCw, Edit2, X,
  Upload, Download, MessageSquare, CheckCircle, AlertCircle, Loader2,
  ChevronLeft, ChevronRight, ChevronDown,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/auth'
import ContactModal from '../components/ContactModal'
import { rutOnChange } from '../utils/rut'
import { useConfirm } from '../components/ConfirmDialog'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs font-semibold text-white/62 mb-1">{label}</label>{children}</div>
}

// ── Avatar color helper ───────────────────────────────────────────────────────
const AVATAR_COLORS = [
  { bg: 'rgba(124,58,237,0.13)',  text: '#7c3aed' },
  { bg: 'rgba(34,197,94,0.13)',  text: '#16a34a' },
  { bg: 'rgba(139,92,246,0.13)', text: '#7c3aed' },
  { bg: 'rgba(245,158,11,0.13)', text: '#d97706' },
  { bg: 'rgba(239,68,68,0.13)',  text: '#dc2626' },
  { bg: 'rgba(20,184,166,0.13)', text: '#0d9488' },
]
const avatarColor = (name: string) => AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]

// ── Edit modal ────────────────────────────────────────────────────────────────
function EditContactModal({ contact, onClose, onSuccess }: { contact: Contact; onClose: () => void; onSuccess: (c: Contact) => void }) {
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
      <div className="bg-surface-1 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07] flex-shrink-0">
          <h2 className="text-base font-bold text-white">Editar Contacto</h2>
          <button onClick={onClose} className="p-2 hover:bg-surface-2 rounded-lg text-white/62"><X size={18} /></button>
        </div>
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Nombre *">
              <input className="input" value={form.name} onChange={e => set('name', e.target.value)} required />
            </Field>
            <Field label="Teléfono *">
              <input className="input" value={form.phone} onChange={e => set('phone', e.target.value)} required />
            </Field>
            <Field label="Email">
              <input type="email" className="input" value={form.email} onChange={e => set('email', e.target.value)} />
            </Field>
            <Field label="Ciudad">
              <input className="input" value={form.city} onChange={e => set('city', e.target.value)} />
            </Field>
            <Field label="RUT Persona">
              <input className="input" value={form.rut_persona} onChange={e => set('rut_persona', rutOnChange(e.target.value))} placeholder="12.345.678-9" />
            </Field>
            <Field label="RUT Empresa">
              <input className="input" value={form.rut_empresa} onChange={e => set('rut_empresa', rutOnChange(e.target.value))} placeholder="76.000.000-0" />
            </Field>
            <div className="col-span-2">
              <Field label="Razón Social">
                <input className="input" value={form.razon_social} onChange={e => set('razon_social', e.target.value)} />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="Dirección">
                <input className="input" value={form.address} onChange={e => set('address', e.target.value)} />
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

// ── Import Modal ──────────────────────────────────────────────────────────────
function ImportModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { user } = useAuthStore()
  const fileRef  = useRef<HTMLInputElement>(null)
  const [file, setFile]       = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<{ created: number; errors: string[] } | null>(null)
  const [groups, setGroups]   = useState<{ id: number; name: string }[]>([])
  const [selectedGroup, setSelectedGroup] = useState<string>('')

  const isAdmin = user?.role === 'superadmin' || user?.role === 'subadmin'

  useEffect(() => {
    if (isAdmin) {
      import('../api').then(api => api.getGroups()).then(setGroups).catch(() => {})
    }
  }, [isAdmin])

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const ext = f.name.split('.').pop()?.toLowerCase()
    if (!['xlsx', 'xls', 'csv'].includes(ext ?? '')) {
      toast.error('Solo se aceptan archivos .xlsx, .xls o .csv')
      return
    }
    setFile(f)
    setResult(null)
  }

  const handleImport = async () => {
    if (!file) return
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const gid = isAdmin ? selectedGroup : user?.group_id?.toString()
      if (gid) fd.append('group_id', gid)
      const res = await bulkImportContacts(fd)
      setResult(res)
      if (res.created > 0) {
        toast.success(`${res.created} contacto${res.created !== 1 ? 's' : ''} importado${res.created !== 1 ? 's' : ''}`)
        onSuccess()
      } else {
        toast.error('No se importó ningún contacto')
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Error al importar')
    } finally {
      setLoading(false)
    }
  }

  const downloadTemplate = () => {
    const csv = 'nombre,telefono,email,rut_persona,rut_empresa,razon_social,ciudad\nJuan Pérez,+56912345678,juan@email.com,12.345.678-9,,, Santiago\nEmpresa SA,+56987654321,contacto@empresa.cl,,76.000.000-0,Empresa SA,Valparaíso\n'
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    a.download = 'plantilla_contactos.csv'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  return (
    <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4">
      <div className="bg-surface-1 rounded-2xl shadow-modal w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07]">
          <h2 className="text-base font-bold text-white">Importar contactos</h2>
          <button onClick={onClose} className="p-2 hover:bg-surface-2 rounded-lg text-white/62"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="rounded-xl p-3 text-xs space-y-1" style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.18)', color: 'rgba(147,168,255,0.85)' }}>
            <p className="font-semibold">Columnas requeridas:</p>
            <p><strong>nombre</strong>, <strong>telefono</strong> (con código país, ej: +56912345678)</p>
            <p style={{ color: 'rgba(147,168,255,0.60)' }}>Opcionales: email, rut_persona, rut_empresa, razon_social, ciudad</p>
          </div>

          <button
            onClick={downloadTemplate}
            className="flex items-center gap-2 text-sm text-white/78 hover:text-white border border-white/10 hover:border-white/25 rounded-xl px-4 py-2.5 w-full transition-colors">
            <Download size={15} /> Descargar plantilla CSV
          </button>

          {isAdmin && groups.length > 0 && (
            <div>
              <label className="block text-[11px] font-bold text-white/52 uppercase tracking-[0.12em] mb-1.5">
                Asignar al grupo
              </label>
              <select
                value={selectedGroup}
                onChange={e => setSelectedGroup(e.target.value)}
                className="w-full input text-sm"
              >
                <option value="">General</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
          )}

          <div
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
              file ? 'border-lime bg-lime/10' : 'border-white/10 hover:border-white/25 bg-surface-0'
            }`}
          >
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
            {file ? (
              <div className="flex flex-col items-center gap-1">
                <CheckCircle size={20} className="text-lime" />
                <p className="text-sm font-semibold text-lime">{file.name}</p>
                <p className="text-xs text-lime">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-white/52">
                <Upload size={24} />
                <p className="text-sm">Haz clic para seleccionar un archivo</p>
                <p className="text-xs">.xlsx, .xls o .csv</p>
              </div>
            )}
          </div>

          {result && (
            <div className={`rounded-xl p-3 border text-sm ${result.created > 0 ? 'bg-lime/[0.07] border-lime/20 text-lime/90' : 'bg-warn/[0.07] border-warn/20 text-warn/90'}`}>
              <p className="font-semibold">{result.created} contacto{result.created !== 1 ? 's' : ''} importado{result.created !== 1 ? 's' : ''}</p>
              {result.errors.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  <p className="text-xs font-semibold text-warn flex items-center gap-1"><AlertCircle size={11} /> {result.errors.length} filas con errores:</p>
                  {result.errors.slice(0, 5).map((e, i) => (
                    <p key={i} className="text-xs text-warn">{e}</p>
                  ))}
                  {result.errors.length > 5 && <p className="text-xs text-warn">...y {result.errors.length - 5} más</p>}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 pb-5 flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">Cerrar</button>
          <button onClick={handleImport} disabled={!file || loading} className="btn-primary flex-1">
            {loading ? <><Loader2 size={15} className="animate-spin" /> Importando...</> : <><Upload size={15} /> Importar</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Checkbox component ────────────────────────────────────────────────────────
function Checkbox({ checked, indeterminate, onChange }: { checked: boolean; indeterminate?: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate
  }, [indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      onClick={e => e.stopPropagation()}
      className="w-4 h-4 rounded cursor-pointer accent-[#7c3aed]"
    />
  )
}

const PAGE_SIZE = 50

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Contactos() {
  const { user } = useAuthStore()
  const [contacts, setContacts]   = useState<Contact[]>([])
  const [total, setTotal]         = useState(0)
  const [page, setPage]           = useState(1)
  const [pages, setPages]         = useState(1)
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editContact, setEditContact] = useState<Contact | null>(null)
  const [showImport, setShowImport]   = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)
  const [exporting, setExporting]     = useState(false)
  const [deletingId, setDeletingId]   = useState<number | null>(null)
  const { confirm, dialog: confirmDialog } = useConfirm()

  const isAdmin   = !!(user?.role && ['superadmin', 'subadmin'].includes(user.role))
  const canEdit   = !!(user?.role && ['superadmin', 'subadmin', 'agendadora'].includes(user.role))
  const canDelete = !!(user?.role && ['superadmin', 'subadmin'].includes(user.role))

  const [groups, setGroups]           = useState<{ id: number; name: string }[]>([])
  const [groupFilter, setGroupFilter] = useState<string>('')
  const [userFilter, setUserFilter]   = useState<string>('')
  const [contactUsers, setContactUsers] = useState<any[]>([])

  useEffect(() => {
    if (isAdmin) {
      getGroups().then(setGroups).catch(() => {})
      getUsers().catch(() => []).then((us: any[]) =>
        setContactUsers(us.filter((u: any) => ['agendadora', 'vendedor', 'subadmin'].includes(u.role) && u.is_active))
      )
    }
  }, [isAdmin])

  const load = async (p = page) => {
    setLoading(true)
    setSelectedIds(new Set())
    try {
      const res = await getContactsPaged({
        page: p,
        page_size: PAGE_SIZE,
        ...(search ? { search } : {}),
        ...(groupFilter ? { group_id: parseInt(groupFilter) } : {}),
        ...(userFilter  ? { created_by: parseInt(userFilter) } : {}),
      })
      setContacts(res.items)
      setTotal(res.total)
      setPages(res.pages)
      setPage(res.page)
    } catch {
      toast.error('Error cargando contactos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setPage(1)
    const t = setTimeout(() => load(1), 300)
    return () => clearTimeout(t)
  }, [search, groupFilter, userFilter])

  useEffect(() => {
    load(page)
  }, [page])

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selectedIds.size === contacts.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(contacts.map(c => c.id)))
    }
  }

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return
    const ok = await confirm(
      `Se eliminarán ${selectedIds.size} contacto${selectedIds.size > 1 ? 's' : ''} permanentemente. Esta acción no se puede deshacer.`,
      { title: `Eliminar ${selectedIds.size} contacto${selectedIds.size > 1 ? 's' : ''}`, confirmLabel: 'Eliminar' }
    )
    if (!ok) return
    setBulkLoading(true)
    try {
      const results = await Promise.allSettled(Array.from(selectedIds).map(id => deleteContact(id, true)))
      const failed = results.filter(r => r.status === 'rejected' && r.reason?.response?.status !== 404)
      const deleted = results.filter(r => r.status === 'fulfilled' || r.reason?.response?.status === 404).length
      if (deleted > 0) toast.success(`${deleted} contacto${deleted > 1 ? 's eliminados' : ' eliminado'}`)
      if (failed.length > 0) {
        const detail = failed[0].status === 'rejected' ? (failed[0].reason?.response?.data?.detail || 'Error al eliminar') : ''
        toast.error(`${failed.length} no pudo${failed.length > 1 ? 'n' : ''} eliminarse: ${detail}`)
      }
      setSelectedIds(new Set())
      load(page)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Error al eliminar')
    } finally {
      setBulkLoading(false)
    }
  }

  const handleDelete = async (id: number, force = false) => {
    if (!force) {
      const ok = await confirm('¿Eliminar este contacto?', { title: 'Eliminar contacto', confirmLabel: 'Eliminar' })
      if (!ok) return
    }
    setDeletingId(id)
    try {
      await deleteContact(id, force)
      toast.success('Contacto eliminado')
      const remaining = contacts.length - 1
      const newPage = remaining === 0 && page > 1 ? page - 1 : page
      load(newPage)
    } catch (err: any) {
      const detail: string = err?.response?.data?.detail || ''
      if (!force && detail.includes('lead(s) activo') && user?.role === 'superadmin') {
        const ok2 = await confirm(
          'El contacto tiene leads activos. Se eliminarán el contacto y TODOS sus leads permanentemente.',
          { title: 'Forzar eliminación', confirmLabel: 'Eliminar todo' }
        )
        if (ok2) handleDelete(id, true)
      } else {
        toast.error(detail || 'Error al eliminar')
      }
    } finally {
      setDeletingId(null)
    }
  }

  const handleUpdated = (updated: Contact) => {
    setContacts(prev => prev.map(c => c.id === updated.id ? updated : c))
    setEditContact(null)
  }

  const allSelected = contacts.length > 0 && selectedIds.size === contacts.length
  const someSelected = selectedIds.size > 0 && selectedIds.size < contacts.length

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold" style={{ color: '#1c1633' }}>Contactos</h1>
            {isAdmin && (
              <span className="text-xs font-bold px-2.5 py-1 rounded-lg" style={
                groupFilter
                  ? { background: 'rgba(124,58,237,0.10)', color: '#7c3aed', border: '1px solid rgba(124,58,237,0.25)' }
                  : { background: 'rgba(245,158,11,0.10)', color: '#d97706', border: '1px solid rgba(245,158,11,0.30)' }
              }>
                {groupFilter
                  ? groups.find(g => g.id === parseInt(groupFilter))?.name ?? 'Grupo'
                  : '⚠ Todos los grupos'}
              </span>
            )}
          </div>
          <p className="text-sm mt-0.5" style={{ color: 'rgba(28,22,51,0.50)' }}>Directorio de clientes y sus datos de contacto — cada uno puede tener varios expedientes (leads) asociados · <span style={{ color: 'rgba(28,22,51,0.70)', fontWeight: 600 }}>{total} contactos</span></p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canEdit && (
            <button
              onClick={async () => {
                if (!user?.negocio_plan_limits?.export_csv) { toast.error('Exportar CSV requiere plan Pro o superior'); return }
                setExporting(true)
                try {
                  await exportContacts(groupFilter ? { group_id: parseInt(groupFilter) } : undefined)
                } catch {
                  toast.error('Error al exportar')
                } finally {
                  setExporting(false)
                }
              }}
              disabled={exporting}
              title={!user?.negocio_plan_limits?.export_csv ? 'Plan Pro requerido' : 'Exportar CSV'}
              className="hidden sm:flex items-center gap-1.5 text-sm font-semibold px-3 py-2.5 rounded-xl transition-colors disabled:opacity-50"
              style={{ background: '#ffffff', border: '1px solid rgba(28,22,51,0.12)', color: 'rgba(28,22,51,0.70)', boxShadow: '0 1px 3px rgba(28,22,51,0.06)', opacity: user?.negocio_plan_limits?.export_csv ? 1 : 0.4 }}>
              <Download size={14} className={exporting ? 'animate-spin' : ''} /> Exportar
            </button>
          )}
          {canEdit && (
            <button onClick={() => setShowImport(true)}
              className="hidden sm:flex items-center gap-1.5 text-sm font-semibold px-3 py-2.5 rounded-xl transition-colors"
              style={{ background: '#ffffff', border: '1px solid rgba(28,22,51,0.12)', color: 'rgba(28,22,51,0.70)', boxShadow: '0 1px 3px rgba(28,22,51,0.06)' }}>
              <Upload size={14} /> Importar
            </button>
          )}
          {canEdit && (
            <button onClick={() => setShowModal(true)} className="btn-primary">
              <Plus size={16} /> Nuevo
            </button>
          )}
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex gap-2.5 flex-wrap">
        <div className="relative flex-1 min-w-52">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(28,22,51,0.38)' }} />
          <input
            className="w-full h-10 pl-10 pr-3 rounded-xl text-sm outline-none transition"
            style={{
              background: '#ffffff',
              border: '1px solid rgba(28,22,51,0.12)',
              color: '#1c1633',
              boxShadow: '0 1px 3px rgba(28,22,51,0.05)',
            }}
            placeholder="Buscar por nombre, teléfono, RUT..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {isAdmin && groups.length > 0 && (
          <div className="relative">
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(28,22,51,0.38)' }} />
            <select
              value={groupFilter}
              onChange={e => { setGroupFilter(e.target.value); setPage(1) }}
              className="appearance-none h-10 pl-3 pr-8 rounded-xl text-sm font-medium outline-none cursor-pointer"
              style={{
                background: '#ffffff',
                border: '1px solid rgba(28,22,51,0.12)',
                color: 'rgba(28,22,51,0.75)',
                boxShadow: '0 1px 3px rgba(28,22,51,0.05)',
              }}
            >
              <option value="">Todos los grupos</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
        )}
        {isAdmin && contactUsers.length > 0 && (
          <div className="relative">
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(28,22,51,0.38)' }} />
            <select
              value={userFilter}
              onChange={e => { setUserFilter(e.target.value); setPage(1) }}
              className="appearance-none h-10 pl-3 pr-8 rounded-xl text-sm font-medium outline-none cursor-pointer"
              style={{
                background: '#ffffff',
                border: '1px solid rgba(28,22,51,0.12)',
                color: 'rgba(28,22,51,0.75)',
                boxShadow: '0 1px 3px rgba(28,22,51,0.05)',
              }}
            >
              <option value="">Todos los usuarios</option>
              {contactUsers.map((u: any) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        )}
        <button onClick={() => load(page)}
          className="h-10 w-10 flex items-center justify-center rounded-xl transition-colors"
          style={{ background: '#ffffff', border: '1px solid rgba(28,22,51,0.12)', color: 'rgba(28,22,51,0.55)', boxShadow: '0 1px 3px rgba(28,22,51,0.05)' }}>
          <RefreshCw size={15} />
        </button>
      </div>

      {/* ── Bulk action bar ── */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between px-4 py-2.5 rounded-xl" style={{
          background: 'rgba(225,29,72,0.06)',
          border: '1px solid rgba(225,29,72,0.20)',
        }}>
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setSelectedIds(new Set())}
              className="w-5 h-5 flex items-center justify-center rounded transition-colors hover:bg-black/5"
              style={{ color: 'rgba(225,29,72,0.70)' }}>
              <X size={13} />
            </button>
            <span className="text-sm font-semibold" style={{ color: '#e11d48' }}>
              {selectedIds.size} seleccionado{selectedIds.size > 1 ? 's' : ''}
            </span>
          </div>
          <button
            onClick={handleBulkDelete}
            disabled={bulkLoading}
            className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors"
            style={{ background: 'rgba(225,29,72,0.12)', color: '#e11d48' }}>
            {bulkLoading
              ? <><Loader2 size={13} className="animate-spin" /> Eliminando...</>
              : <><Trash2 size={13} /> Eliminar seleccionados</>}
          </button>
        </div>
      )}

      {/* ── Table card ── */}
      <div className="rounded-xl overflow-hidden" style={{
        background: '#ffffff',
        border: '1px solid rgba(28,22,51,0.09)',
        boxShadow: '0 1px 4px rgba(28,22,51,0.06)',
      }}>
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#7c3aed', borderTopColor: 'transparent' }} />
          </div>
        ) : contacts.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: '#f1f5f9' }}>
              <Search size={22} style={{ color: 'rgba(28,22,51,0.35)' }} />
            </div>
            <p className="font-semibold" style={{ color: 'rgba(28,22,51,0.65)' }}>No se encontraron contactos</p>
            <p className="text-sm mt-1" style={{ color: 'rgba(28,22,51,0.40)' }}>Intenta con otros términos o crea un nuevo contacto</p>
          </div>
        ) : (
          <>
            {/* ── Mobile list ── */}
            <div className="sm:hidden">
              {contacts.map((c, idx) => {
                const av = avatarColor(c.name)
                const selected = selectedIds.has(c.id)
                return (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 px-4 py-3 transition-colors"
                    style={{
                      background: selected ? 'rgba(124,58,237,0.06)' : 'transparent',
                      borderBottom: idx < contacts.length - 1 ? '1px solid rgba(28,22,51,0.07)' : 'none',
                      borderLeft: selected ? '3px solid #7c3aed' : '3px solid transparent',
                    }}
                  >
                    {canDelete && (
                      <Checkbox checked={selected} onChange={() => toggleSelect(c.id)} />
                    )}
                    <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold" style={{ background: av.bg, color: av.text }}>
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate" style={{ color: '#1c1633' }}>{c.name}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {c.phone && (
                          <a href={`https://wa.me/${c.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
                            className="flex items-center gap-1 text-[11px]"
                            style={{ color: 'rgba(28,22,51,0.50)' }}>
                            <Phone size={10} />{c.phone}
                          </a>
                        )}
                        {c.rut_persona && <span className="text-[11px]" style={{ color: 'rgba(28,22,51,0.40)' }}>{c.rut_persona}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {canEdit && (
                        <button onClick={() => setEditContact(c)}
                          className="p-1.5 rounded-lg transition-colors"
                          style={{ color: 'rgba(28,22,51,0.40)' }}
                          onMouseEnter={e => (e.currentTarget.style.background = '#f1f5f9')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                          <Edit2 size={14} />
                        </button>
                      )}
                      {canDelete && (
                        <button onClick={() => handleDelete(c.id)} disabled={deletingId === c.id}
                          className="p-1.5 rounded-lg transition-colors disabled:opacity-50"
                          style={{ color: 'rgba(225,29,72,0.45)' }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(225,29,72,0.08)'; e.currentTarget.style.color = '#e11d48' }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(225,29,72,0.45)' }}>
                          {deletingId === c.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* ── Desktop table ── */}
            <div className="hidden sm:block overflow-x-auto table-scroll table-scroll-light">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: '#faf9fd', borderBottom: '1px solid rgba(28,22,51,0.08)' }}>
                    {canDelete && (
                      <th className="pl-5 pr-2 py-3 text-left w-10">
                        <Checkbox
                          checked={allSelected}
                          indeterminate={someSelected}
                          onChange={toggleAll}
                        />
                      </th>
                    )}
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: 'rgba(28,22,51,0.45)' }}>Nombre</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: 'rgba(28,22,51,0.45)' }}>RUT</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: 'rgba(28,22,51,0.45)' }}>Empresa</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: 'rgba(28,22,51,0.45)' }}>Teléfono</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: 'rgba(28,22,51,0.45)' }}>Email</th>
                    <th className="w-24" />
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c, idx) => {
                    const av = avatarColor(c.name)
                    const selected = selectedIds.has(c.id)
                    return (
                      <tr
                        key={c.id}
                        className="group transition-colors"
                        style={{
                          background: selected ? 'rgba(124,58,237,0.06)' : 'transparent',
                          borderBottom: idx < contacts.length - 1 ? '1px solid rgba(28,22,51,0.06)' : 'none',
                          borderLeft: selected ? '3px solid #7c3aed' : '3px solid transparent',
                        }}
                        onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLElement).style.background = 'rgba(28,22,51,0.025)' }}
                        onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                      >
                        {canDelete && (
                          <td className="pl-5 pr-2 py-3 w-10">
                            <Checkbox checked={selected} onChange={() => toggleSelect(c.id)} />
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold" style={{ background: av.bg, color: av.text }}>
                              {c.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-semibold text-sm" style={{ color: '#1c1633' }}>{c.name}</p>
                              {c.city && <p className="text-[11px]" style={{ color: 'rgba(28,22,51,0.45)' }}>{c.city}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: 'rgba(28,22,51,0.55)' }}>{c.rut_persona || '—'}</td>
                        <td className="px-4 py-3">
                          {c.razon_social && <p className="text-sm" style={{ color: '#1c1633' }}>{c.razon_social}</p>}
                          {c.rut_empresa && <p className="text-xs" style={{ color: 'rgba(28,22,51,0.45)' }}>{c.rut_empresa}</p>}
                          {!c.razon_social && !c.rut_empresa && <span style={{ color: 'rgba(28,22,51,0.30)' }}>—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <a href={`https://wa.me/${c.phone.replace(/\D/g, '')}`}
                              target="_blank" rel="noreferrer"
                              className="flex items-center gap-1.5 text-sm transition-colors"
                              style={{ color: 'rgba(28,22,51,0.62)' }}>
                              <Phone size={13} /> {c.phone}
                            </a>
                            <a href={`https://wa.me/${c.phone.replace(/\D/g, '')}`}
                              target="_blank" rel="noreferrer"
                              className="p-1 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                              style={{ background: 'rgba(34,197,94,0.10)', color: '#16a34a' }}
                              title="Abrir en WhatsApp">
                              <MessageSquare size={12} />
                            </a>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {c.email ? (
                            <a href={`mailto:${c.email}`}
                              className="flex items-center gap-1.5 text-sm transition-colors"
                              style={{ color: 'rgba(28,22,51,0.62)' }}>
                              <Mail size={13} /> {c.email}
                            </a>
                          ) : <span style={{ color: 'rgba(28,22,51,0.30)' }}>—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {canEdit && (
                              <button onClick={() => setEditContact(c)}
                                className="p-1.5 rounded-lg transition-colors"
                                style={{ color: 'rgba(28,22,51,0.45)' }}
                                onMouseEnter={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#1c1633' }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(28,22,51,0.45)' }}
                                title="Editar">
                                <Edit2 size={14} />
                              </button>
                            )}
                            {canDelete && (
                              <button onClick={() => handleDelete(c.id)} disabled={deletingId === c.id}
                                className="p-1.5 rounded-lg transition-colors disabled:opacity-50"
                                style={{ color: 'rgba(225,29,72,0.45)' }}
                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(225,29,72,0.08)'; e.currentTarget.style.color = '#e11d48' }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(225,29,72,0.45)' }}
                                title="Eliminar">
                                {deletingId === c.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ── Paginator ── */}
      {pages > 1 && (
        <div className="flex items-center justify-between gap-4 pt-1">
          <p className="text-xs" style={{ color: 'rgba(28,22,51,0.45)' }}>
            Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} de {total}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ border: '1px solid rgba(28,22,51,0.12)', color: 'rgba(28,22,51,0.55)' }}>
              <ChevronLeft size={15} />
            </button>

            {Array.from({ length: pages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === pages || Math.abs(p - page) <= 2)
              .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push('...')
                acc.push(p)
                return acc
              }, [])
              .map((p, i) =>
                p === '...' ? (
                  <span key={`ellipsis-${i}`} className="px-1 text-xs" style={{ color: 'rgba(28,22,51,0.35)' }}>…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p as number)}
                    className="min-w-[30px] h-[30px] rounded-lg text-xs font-semibold transition-colors"
                    style={p === page
                      ? { background: '#7c3aed', color: '#ffffff' }
                      : { border: '1px solid rgba(28,22,51,0.12)', color: 'rgba(28,22,51,0.55)' }}>
                    {p}
                  </button>
                )
              )}

            <button
              onClick={() => setPage(p => Math.min(pages, p + 1))}
              disabled={page === pages}
              className="p-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ border: '1px solid rgba(28,22,51,0.12)', color: 'rgba(28,22,51,0.55)' }}>
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {showModal && (
        <ContactModal
          onClose={() => setShowModal(false)}
          onSuccess={() => { setShowModal(false); setPage(1); load(1) }}
        />
      )}

      {editContact && (
        <EditContactModal
          contact={editContact}
          onClose={() => setEditContact(null)}
          onSuccess={handleUpdated}
        />
      )}

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onSuccess={() => { setShowImport(false); load() }}
        />
      )}

      {confirmDialog}
    </div>
  )
}
