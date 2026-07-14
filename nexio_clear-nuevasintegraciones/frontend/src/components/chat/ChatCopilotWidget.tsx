import { useState } from 'react'
import { Sparkles, User, Building, FileText, Mail, MapPin, Phone, Zap, Loader2 } from 'lucide-react'
import type { Lead } from '../../types'
import { emitLeadChanged } from '../../lib/leadEvents'

// ─────────────────────────────────────────────────────────────────────────────
// Motor de extracción determinista (pure-JS). Función pura y aislada: es la
// "costura" que mañana puede cambiarse por una llamada a un LLM manteniendo el
// mismo contrato de salida, sin tocar el widget.
// ─────────────────────────────────────────────────────────────────────────────
type PersonType = 'natural' | 'empresa'

export interface Extraction {
  personType: PersonType
  confidence: number // heurística 0..1
  rutUnverified?: boolean // el RUT extraído no valida Módulo-11 → mostrar "verificar"
  fields: {
    name?: string
    last_name?: string
    rut_persona?: string
    rut_empresa?: string
    razon_social?: string
    phone?: string
    email?: string
    address?: string
    city?: string
  }
}

/** Dígito verificador chileno por algoritmo Módulo-11. */
function rutDv(body: string): string {
  let sum = 0
  let mul = 2
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * mul
    mul = mul === 7 ? 2 : mul + 1
  }
  const r = 11 - (sum % 11)
  return r === 11 ? '0' : r === 10 ? 'K' : String(r)
}

/** Formatea el cuerpo del RUT con puntos de miles + guion: XX.XXX.XXX-X */
function formatRut(body: string, dv: string): string {
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv.toUpperCase()}`
}

/**
 * Extrae datos duros combinando el texto de todos los mensajes del chat.
 * `m.content` es el campo real donde Nexio guarda el cuerpo del mensaje.
 */
export function extractFromMessages(messages: any[]): Extraction {
  const contents = messages.map(m => (m?.content ?? '').toString()).filter(Boolean)
  const text = contents.join('\n')
  const fields: Extraction['fields'] = {}

  // ── RUT (persona / empresa) ──
  // Se extrae aunque el dígito verificador no cuadre; se prefiere uno DV-válido
  // y, si el aplicado falla Módulo-11, se marca `rutUnverified` para que la UI
  // pida "verificar" (atrapa typos sin descartar el dato).
  let rutUnverified = false
  const rutCands = [...text.matchAll(/(\d{1,2}[.\s]?\d{3}[.\s]?\d{3})\s*[-–]\s*([0-9kK])/g)].map(m => {
    const body = m[1].replace(/[.\s]/g, '')
    return { body, valid: rutDv(body) === m[2].toUpperCase(), norm: formatRut(body, m[2]), empresa: Number(body) >= 50_000_000 }
  })
  for (const key of ['rut_empresa', 'rut_persona'] as const) {
    const cands = rutCands.filter(r => r.empresa === (key === 'rut_empresa'))
    const best = cands.find(r => r.valid) ?? cands[0]
    if (best) {
      fields[key] = best.norm
      if (!best.valid) rutUnverified = true
    }
  }

  // ── Razón social (marcas jurídicas chilenas + corporativas comunes) ──
  const rs = text.match(
    /([A-ZÁÉÍÓÚÑ][\w& .]{1,40}?(?:SpA|S\.?A\.?|Ltda\.?|Limitada|EIRL|Corp(?:oration)?\b|Inc\b|Company\b|Compañ[íi]a\b|Group\b|Holding\b))/,
  )
  if (rs) fields.razon_social = rs[1].replace(/\s{2,}/g, ' ').trim()

  // ── Teléfono / WhatsApp chileno (móvil: 9 + 8 dígitos) → +56 9 XXXX XXXX ──
  const ph = text.match(/(?:\+?56[\s.\-]?)?9[\s.\-]?\d{4}[\s.\-]?\d{4}/)
  if (ph) {
    const digits = ph[0].replace(/\D/g, '').replace(/^56/, '') // deja 9XXXXXXXX
    if (digits.length === 9) fields.phone = `+56 9 ${digits.slice(1, 5)} ${digits.slice(5)}`
  }

  // ── Email ──
  const em = text.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i)
  if (em) fields.email = em[0].toLowerCase()

  // ── Nombre / Apellido ──
  // (a) con frase gatillo ("me llamo / soy / mi nombre es …")
  const nm = text.match(
    /(?:me llamo|mi nombre es|soy)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2})/i,
  )
  if (nm) {
    const parts = nm[1].replace(/\s{2,}/g, ' ').trim().split(/\s+/)
    fields.name = parts[0]
    if (parts.length > 1) fields.last_name = parts.slice(1).join(' ')
  }

  // (b) fallback: un mensaje que es SOLO un nombre propio (2-3 palabras en
  //     mayúscula inicial), sin correo/dígitos ni marcas de empresa. Cubre el
  //     volcado de datos línea a línea (ej. "Juan Pérez" en su propio mensaje).
  if (!fields.name) {
    for (const raw of contents) {
      const t = raw.trim()
      if (t.length < 3 || t.length > 40) continue
      if (/[@\d]/.test(t)) continue
      if (/(?:SpA|S\.?A\.?|Ltda|EIRL|Corp|Inc|Company|Compañ|Group|Holding)/i.test(t)) continue
      const nmm = t.match(
        /^([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,2})$/,
      )
      if (nmm) {
        const parts = nmm[1].split(/\s+/)
        fields.name = parts[0]
        if (parts.length > 1) fields.last_name = parts.slice(1).join(' ')
        break
      }
    }
  }

  // (c) empresa sin nombre personal → usa la razón social como nombre visible
  //     del contacto (ej. "Juanito Corp" pasa a ser el nombre del contacto).
  if (fields.razon_social && !fields.name) fields.name = fields.razon_social

  // ── Dirección (vías chilenas + numeración), limpia espacios duplicados ──
  const ad = text.match(
    /((?:av\.?|avenida|calle|pasaje|psje\.?|camino)\s+[A-Za-zÁÉÍÓÚÑáéíóúñ0-9 .,#°-]*?\d+[A-Za-zÁÉÍÓÚÑáéíóúñ0-9 .,#°-]*)/i,
  )
  if (ad) fields.address = ad[1].replace(/\s{2,}/g, ' ').trim()

  const personType: PersonType = fields.rut_empresa || fields.razon_social ? 'empresa' : 'natural'
  const found = Object.keys(fields).length
  return { personType, confidence: Math.min(1, found / 4), rutUnverified, fields }
}

// ─────────────────────────────────────────────────────────────────────────────
// Widget flotante — tarjeta integrada al chat.
// ─────────────────────────────────────────────────────────────────────────────
export default function ChatCopilotWidget({
  messages,
  lead,
  onApply,
}: {
  messages: any[]
  lead: Lead
  // Reutiliza la persistencia existente del chat (handleFillSave):
  // updateContact + updateLead → onLeadUpdate.
  onApply: (contactData: any, leadData: any) => Promise<void>
}) {
  const [result, setResult] = useState<Extraction | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [applying, setApplying] = useState(false)

  // Botón explícito con guard de debounce — nunca se auto-ejecuta sobre el SSE.
  const analyze = () => {
    if (analyzing) return
    setAnalyzing(true)
    setTimeout(() => {
      setResult(extractFromMessages(messages))
      setAnalyzing(false)
    }, 250)
  }

  const apply = async () => {
    if (!result || applying) return
    setApplying(true)
    try {
      const c: any = lead.contact ?? {}
      const f = result.fields
      // Merge NO destructivo: solo lo detectado pisa lo actual; el resto se conserva.
      const fullName = f.name ? `${f.name}${f.last_name ? ' ' + f.last_name : ''}` : c.name
      const contactData = {
        name:         fullName,
        phone:        f.phone        ?? c.phone,
        email:        f.email        ?? c.email,
        rut_persona:  f.rut_persona  ?? c.rut_persona,
        rut_empresa:  f.rut_empresa  ?? c.rut_empresa,
        razon_social: f.razon_social ?? c.razon_social,
        address:      f.address      ?? c.address,
        city:         f.city         ?? c.city,
      }
      await onApply(contactData, { notes: lead.notes ?? '', source: lead.source ?? 'whatsapp' })
      // Notifica al Pipeline: levanta bloqueos por RUT y refresca superficies (Fix B).
      emitLeadChanged({ leadId: lead.id })
      setResult(null)
    } finally {
      setApplying(false)
    }
  }

  const f = result?.fields
  const has = !!f && Object.keys(f).length > 0

  return (
    <div
      className="mx-3 mt-3 rounded-xl border p-3"
      style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={14} style={{ color: 'var(--primary)' }} />
        <p className="text-xs font-bold" style={{ color: 'var(--text)' }}>
          Copilot de datos
        </p>
        {result && (
          <span
            className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: 'var(--primary-dim)', color: 'var(--primary)' }}
          >
            {result.personType === 'empresa' ? 'Empresa' : 'Persona'} · {Math.round(result.confidence * 100)}%
          </span>
        )}
      </div>

      {!has && (
        <button
          onClick={analyze}
          disabled={analyzing}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-colors disabled:opacity-60"
          style={{ background: 'var(--surface-2)', color: 'var(--text)' }}
        >
          {analyzing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {analyzing ? 'Analizando…' : result ? 'Re-analizar conversación' : 'Analizar conversación'}
        </button>
      )}

      {has && (
        <>
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {f!.name && f!.name !== f!.razon_social && (
              <Chip icon={User} text={`${f!.name}${f!.last_name ? ' ' + f!.last_name : ''}`} />
            )}
            {f!.razon_social && <Chip icon={Building} text={f!.razon_social} />}
            {f!.phone && <Chip icon={Phone} text={f!.phone} />}
            {f!.rut_persona && <Chip icon={FileText} text={f!.rut_persona} warn={result!.rutUnverified} />}
            {f!.rut_empresa && <Chip icon={FileText} text={f!.rut_empresa} warn={result!.rutUnverified} />}
            {f!.email && <Chip icon={Mail} text={f!.email} />}
            {f!.address && <Chip icon={MapPin} text={f!.address} />}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={apply}
              disabled={applying}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ background: 'var(--primary)' }}
            >
              {applying ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
              {applying ? 'Actualizando…' : 'Auto-llenar y Actualizar Contacto'}
            </button>
            <button
              onClick={() => setResult(null)}
              disabled={applying}
              className="text-[11px] font-semibold px-2.5 py-2.5 rounded-lg transition-colors disabled:opacity-60"
              style={{ color: 'var(--text-muted)' }}
              title="Descartar sugerencia"
            >
              Descartar
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function Chip({ icon: Icon, text, warn }: { icon: typeof User; text: string; warn?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md max-w-full"
      style={warn
        ? { background: 'rgba(234,179,8,0.10)', color: '#a16207', border: '1px solid rgba(234,179,8,0.35)' }
        : { background: 'var(--surface-0)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
    >
      <Icon size={11} className="flex-shrink-0" style={{ color: warn ? '#eab308' : 'var(--primary)' }} />
      <span className="truncate">{text}{warn ? ' · verificar' : ''}</span>
    </span>
  )
}
