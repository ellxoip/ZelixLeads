import { useState, useRef, useEffect } from 'react'
import { Brain, Send, Loader2 } from 'lucide-react'
import { nexinChat } from '../api'

type Msg = { role: 'user' | 'assistant'; content: string }

const SUGGESTIONS = [
  '¿Cuántos leads hay en cada etapa del pipeline?',
  '¿Qué reuniones tengo agendadas para los próximos 7 días?',
  '¿Cómo va la cobranza este mes? Dame los KPIs y el ranking de cobradores.',
  '¿Qué vendedor tiene mejor conversión y efectividad de reuniones este mes?',
  '¿Hay alertas u oportunidades del copiloto?',
]

export default function Nexin() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  const send = async (text: string) => {
    const q = text.trim()
    if (!q || loading) return
    setError(null)
    const next: Msg[] = [...messages, { role: 'user', content: q }]
    setMessages(next)
    setInput('')
    setLoading(true)
    try {
      const res = await nexinChat(next)
      setMessages([...next, { role: 'assistant', content: res.reply || '(sin respuesta)' }])
    } catch (e: any) {
      const detail = e?.response?.data?.detail || 'No se pudo contactar al asistente Zelix AI.'
      setError(detail)
      setMessages(next)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 140px)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 mb-2" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center justify-center rounded-xl"
          style={{ width: 44, height: 44, background: 'var(--primary)' }}>
          <Brain size={24} color="#fff" />
        </div>
        <div>
          <h1 style={{ fontWeight: 800, fontSize: 20, color: 'var(--text)' }}>Zelix AI</h1>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Asistente IA · Leads y Pipeline (solo consulta)</p>
        </div>
      </div>

      {/* Mensajes */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4">
        {messages.length === 0 && (
          <div className="max-w-2xl mx-auto text-center py-8">
            <Brain size={40} className="mx-auto mb-3" style={{ color: 'var(--primary)', opacity: 0.7 }} />
            <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
              Pregúntame sobre tus leads, etapas del pipeline y oportunidades. Por ahora solo consulto información.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => send(s)}
                  className="text-left px-4 py-3 rounded-xl text-sm transition-all hover:opacity-80"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className="px-4 py-3 rounded-2xl whitespace-pre-wrap"
              style={{
                maxWidth: '80%', fontSize: 14, lineHeight: 1.55,
                background: m.role === 'user' ? 'var(--primary)' : 'var(--surface-2)',
                color: m.role === 'user' ? '#fff' : 'var(--text)',
                border: m.role === 'user' ? 'none' : '1px solid var(--border)',
              }}>
              {m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="px-4 py-3 rounded-2xl flex items-center gap-2"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              <Loader2 size={16} className="animate-spin" /> Zelix AI está pensando…
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <div className="mb-2 px-4 py-2 rounded-lg text-sm"
          style={{ background: 'rgba(239,68,68,0.10)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)' }}>
          {error}
        </div>
      )}

      {/* Input */}
      <div className="flex items-end gap-2 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
          }}
          placeholder="Escribe tu consulta… (Enter para enviar, Shift+Enter para salto de línea)"
          rows={1}
          className="flex-1 px-4 py-3 rounded-xl resize-none outline-none"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--text)', maxHeight: 120 }}
        />
        <button
          onClick={() => send(input)}
          disabled={loading || !input.trim()}
          className="flex items-center justify-center rounded-xl transition-all disabled:opacity-40"
          style={{ width: 48, height: 48, background: 'var(--primary)', color: '#fff' }}
          aria-label="Enviar">
          {loading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
        </button>
      </div>
    </div>
  )
}
