import { useEffect, useState } from 'react'
import { Send, Plus, Trash2, Bot, CheckCircle2, XCircle, RefreshCw, Loader2, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import { getTelegramBots, createTelegramBot, deleteTelegramBot, getTelegramBotStatus } from '../api'
import { ConfirmDialog } from '../components/ConfirmDialog'

interface TgBot {
  id: number
  name: string
  username: string
  bot_id: string
  group_id: number | null
  is_active: boolean
  mode: 'webhook' | 'polling'
  connected: boolean
  created_at: string | null
}

export default function Telegram() {
  const [bots, setBots] = useState<TgBot[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState<number | null>(null)
  const [toDelete, setToDelete] = useState<TgBot | null>(null)

  const load = () => {
    getTelegramBots()
      .then(setBots)
      .catch(() => toast.error('No se pudieron cargar los bots'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const bot = await createTelegramBot({ name: name.trim(), token: token.trim() })
      toast.success(`Bot ${bot.username} conectado`)
      setName(''); setToken(''); setShowForm(false)
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'No se pudo conectar el bot')
    } finally {
      setSaving(false)
    }
  }

  const handleCheck = async (bot: TgBot) => {
    setChecking(bot.id)
    try {
      const st = await getTelegramBotStatus(bot.id)
      if (st.token_valid) toast.success(`${bot.username} activo (${st.mode})`)
      else toast.error(`Token de ${bot.username} inválido`)
    } catch {
      toast.error('No se pudo verificar el bot')
    } finally {
      setChecking(null)
    }
  }

  const handleDelete = async () => {
    if (!toDelete) return
    try {
      await deleteTelegramBot(toDelete.id)
      toast.success(`Bot ${toDelete.username} desconectado`)
      setToDelete(null)
      load()
    } catch {
      toast.error('No se pudo desconectar el bot')
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">

      {/* Cabecera */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #06b6d4)', boxShadow: '0 4px 14px rgba(124,58,237,0.30)' }}>
            <Send size={20} color="#fff" />
          </div>
          <div>
            <h2 className="text-lg font-black" style={{ fontFamily: '"Space Grotesk", sans-serif' }}>Telegram</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Bots conectados — los chats entran como leads al CRM
            </p>
          </div>
        </div>
        <button className="btn-primary danger-action" onClick={() => setShowForm(v => !v)}>
          <Plus size={15} /> Conectar bot
        </button>
      </div>

      {/* Formulario de conexión */}
      {showForm && (
        <form onSubmit={handleCreate} className="card space-y-4">
          <div>
            <p className="font-bold text-sm mb-1">Conectar un bot de Telegram</p>
            <ol className="text-xs space-y-1 list-decimal list-inside" style={{ color: 'var(--text-3)' }}>
              <li>Abre <a href="https://t.me/BotFather" target="_blank" rel="noreferrer"
                    className="font-semibold inline-flex items-center gap-0.5"
                    style={{ color: 'var(--primary)' }}>@BotFather <ExternalLink size={10} /></a> en Telegram</li>
              <li>Envía <code className="px-1 rounded" style={{ background: 'var(--surface-3)' }}>/newbot</code> y sigue los pasos</li>
              <li>Copia el token que te entrega y pégalo aquí</li>
            </ol>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="input-label">Nombre interno</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)}
                placeholder="Ventas Telegram" required />
            </div>
            <div>
              <label className="input-label">Token de @BotFather</label>
              <input className="input" value={token} onChange={e => setToken(e.target.value)}
                placeholder="123456789:AAH6k..." required />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
            <button type="submit" className="btn-primary danger-action" disabled={saving}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {saving ? 'Validando…' : 'Conectar'}
            </button>
          </div>
        </form>
      )}

      {/* Lista de bots */}
      {loading ? (
        <div className="card flex items-center justify-center py-10">
          <Loader2 className="animate-spin" style={{ color: 'var(--primary)' }} />
        </div>
      ) : bots.length === 0 ? (
        <div className="card flex flex-col items-center py-12 text-center">
          <Bot size={36} style={{ color: 'var(--text-muted)' }} />
          <p className="font-bold mt-3">Sin bots conectados</p>
          <p className="text-xs mt-1 max-w-sm" style={{ color: 'var(--text-muted)' }}>
            Conecta tu primer bot de Telegram y cada mensaje que reciba se convertirá
            en una conversación y un lead dentro de ZelixLeads.
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {bots.map(bot => (
            <div key={bot.id} className="card-hover flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(6,182,212,0.10)', border: '1px solid rgba(6,182,212,0.25)' }}>
                  <Bot size={18} style={{ color: '#0891b2' }} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm truncate">{bot.name}</p>
                  <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{bot.username}</p>
                </div>
                {bot.connected ? (
                  <span className="badge-success"><CheckCircle2 size={11} /> {bot.mode}</span>
                ) : (
                  <span className="badge-danger"><XCircle size={11} /> inactivo</span>
                )}
              </div>
              <div className="flex gap-2">
                <button className="btn-ghost flex-1 !py-1.5 text-xs" onClick={() => handleCheck(bot)} disabled={checking === bot.id}>
                  {checking === bot.id ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  Verificar
                </button>
                <button className="btn-danger danger-action flex-1 !py-1.5 text-xs" onClick={() => setToDelete(bot)}>
                  <Trash2 size={13} /> Desconectar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {toDelete && (
        <ConfirmDialog
          title={`¿Desconectar ${toDelete.username}?`}
          message="El bot dejará de recibir mensajes en el CRM. Las conversaciones históricas se conservan."
          confirmLabel="Desconectar"
          onConfirm={handleDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  )
}
