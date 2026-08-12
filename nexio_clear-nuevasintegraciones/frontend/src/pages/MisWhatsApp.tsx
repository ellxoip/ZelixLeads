/**
 * MIS WHATSAPP — cada usuario vincula su propio número, por la API OFICIAL.
 *
 * La versión anterior de esta pantalla vinculaba por código QR (Baileys), que se
 * conecta haciéndose pasar por WhatsApp Web. Esa vía es la que hace que Meta
 * banee el número, y con él la atención a los clientes que ya están escribiendo.
 * Se retiró; ésta la reemplaza por el camino oficial.
 *
 * El servidor comprueba con Meta que el token realmente mande sobre el número
 * antes de guardarlo, así que acá NO se valida nada por cuenta propia: una
 * segunda opinión escrita en el navegador solo serviría para contradecir a la
 * primera, y la que manda es la de Meta.
 */
import { useEffect, useState, useCallback } from 'react'
import { Smartphone, Plus, Trash2, RefreshCw, ShieldCheck, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import { getMisNumeros, vincularMiNumero, desvincularMiNumero } from '../api'

type Numero = {
  id: number
  name: string
  phone_number: string
  phone_number_id: string | null
  api_provider: string
  is_active: boolean
}

export default function MisWhatsApp() {
  const [numeros, setNumeros] = useState<Numero[]>([])
  const [cargando, setCargando] = useState(true)
  const [abriendo, setAbriendo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [form, setForm] = useState({ name: '', phone_number_id: '', api_token: '' })

  const cargar = useCallback(async () => {
    setCargando(true)
    try { setNumeros(await getMisNumeros()) }
    catch { toast.error('No se pudieron cargar tus números') }
    finally { setCargando(false) }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const vincular = async (e: React.FormEvent) => {
    e.preventDefault()
    setGuardando(true)
    try {
      await vincularMiNumero(form)
      toast.success('Número vinculado — Meta confirmó que es tuyo')
      setForm({ name: '', phone_number_id: '', api_token: '' })
      setAbriendo(false)
      cargar()
    } catch (err: any) {
      // El detalle viene del servidor y ya está redactado para leerse.
      toast.error(err?.response?.data?.detail || 'No se pudo vincular')
    } finally {
      setGuardando(false)
    }
  }

  const desvincular = async (n: Numero) => {
    if (!confirm(`¿Desvincular ${n.phone_number}? Dejarás de recibir sus mensajes en el CRM.`)) return
    try {
      await desvincularMiNumero(n.id)
      setNumeros(prev => prev.filter(x => x.id !== n.id))
      toast.success('Número desvinculado')
    } catch { toast.error('No se pudo desvincular') }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white/90">Mis WhatsApp</h1>
          <p className="text-sm text-white/45 mt-0.5">Tus números conectados por la API oficial de Meta</p>
        </div>
        <div className="flex gap-2">
          <button onClick={cargar} className="btn-secondary h-9 px-3" title="Actualizar">
            <RefreshCw size={14} />
          </button>
          <button onClick={() => setAbriendo(v => !v)}
            className="flex items-center gap-1.5 h-9 px-4 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--primary)', color: '#fff' }}>
            <Plus size={15} /> Vincular número
          </button>
        </div>
      </div>

      <div className="flex items-start gap-2.5 p-3 rounded-xl"
        style={{ background: 'rgba(53,122,14,0.07)', border: '1px solid rgba(53,122,14,0.22)' }}>
        <ShieldCheck size={16} style={{ color: 'var(--primary)' }} className="flex-shrink-0 mt-0.5" />
        <p className="text-xs text-white/55 leading-relaxed">
          Solo por la <strong className="text-white/75">API oficial de Meta</strong>. El acceso por código QR
          se retiró: se conectaba haciéndose pasar por WhatsApp Web y era la vía por la que Meta
          banea números. Los mensajes de tus leads llegan solos por el webhook, sin sincronizar nada.
        </p>
      </div>

      {abriendo && (
        <form onSubmit={vincular} className="p-4 rounded-2xl space-y-3"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <p className="text-xs text-white/50">
            Copia estos dos datos desde <strong className="text-white/70">WhatsApp Manager → Configuración de la API</strong>.
            <a href="https://business.facebook.com/wa/manage/phone-numbers/" target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 ml-1" style={{ color: 'var(--primary)' }}>
              Abrir <ExternalLink size={11} />
            </a>
          </p>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="Nombre (opcional — ej. Mi celular de trabajo)"
            className="w-full px-3 py-2.5 rounded-xl text-sm bg-surface-1 text-white/85 outline-none"
            style={{ border: '1px solid rgba(255,255,255,0.10)' }} />
          <input value={form.phone_number_id} onChange={e => setForm({ ...form, phone_number_id: e.target.value })}
            placeholder="phone_number_id (solo números)" required
            className="w-full px-3 py-2.5 rounded-xl text-sm bg-surface-1 text-white/85 outline-none font-mono"
            style={{ border: '1px solid rgba(255,255,255,0.10)' }} />
          <input value={form.api_token} onChange={e => setForm({ ...form, api_token: e.target.value })}
            placeholder="Token de acceso permanente" required type="password" autoComplete="off"
            className="w-full px-3 py-2.5 rounded-xl text-sm bg-surface-1 text-white/85 outline-none font-mono"
            style={{ border: '1px solid rgba(255,255,255,0.10)' }} />
          <div className="flex gap-2">
            <button type="submit" disabled={guardando}
              className="h-9 px-4 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: 'var(--primary)', color: '#fff' }}>
              {guardando ? 'Comprobando con Meta…' : 'Vincular'}
            </button>
            <button type="button" onClick={() => setAbriendo(false)} className="btn-secondary h-9 px-4">Cancelar</button>
          </div>
        </form>
      )}

      {cargando ? (
        <p className="text-sm text-white/40 py-10 text-center">Cargando…</p>
      ) : numeros.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 rounded-2xl space-y-3"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1.5px dashed rgba(255,255,255,0.08)' }}>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(53,122,14,0.10)', border: '1px solid rgba(53,122,14,0.22)' }}>
            <Smartphone size={24} style={{ color: 'var(--primary)' }} />
          </div>
          <p className="text-sm font-semibold text-white/70">Aún no vinculas ningún número</p>
          <p className="text-xs text-white/38">Los mensajes de tus leads aparecerán en el CRM apenas lo hagas</p>
        </div>
      ) : (
        <div className="space-y-2">
          {numeros.map(n => (
            <div key={n.id} className="flex items-center gap-3 p-3.5 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(53,122,14,0.12)', border: '1px solid rgba(53,122,14,0.25)' }}>
                <Smartphone size={16} style={{ color: 'var(--primary)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white/85 truncate">{n.name}</p>
                <p className="text-xs text-white/40 font-mono truncate">{n.phone_number}</p>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider flex-shrink-0"
                style={{ background: 'rgba(53,122,14,0.14)', color: 'var(--primary)' }}>
                oficial
              </span>
              <button onClick={() => desvincular(n)} title="Desvincular"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-white/35 hover:text-red-400 transition-colors">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
