import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import toast, { Toaster } from 'react-hot-toast'
import { apiUrl } from '../api/client'

interface Pago {
  id: number
  monto: number
  metodo: string | null
  referencia: string | null
  notas: string | null
  status: 'pendiente' | 'confirmado' | 'rechazado'
  created_at: string
}

interface ClienteData {
  id: number
  nombre: string
  rut: string | null
  razon_social: string | null
  email: string | null
  phone: string | null
  tipo_servicio: string | null
  area_name: string | null
  vendedor_name: string | null
  honorarios: number
  cuota_inicial: number
  num_cuotas: number
  monto_cuota: number
  cuotas_pagadas: number
  cuotas_restantes: number
  total_pagado: number
  saldo_pendiente: number
  created_at: string
  pagos: Pago[]
}

const fmt = (n: number) =>
  '$' + Math.round(n).toLocaleString('es-CL')

const statusBadge = (s: string) => {
  const map: Record<string, { label: string; color: string }> = {
    pendiente: { label: 'En revisión', color: '#F59E0B' },
    confirmado: { label: 'Confirmado', color: '#22C55E' },
    rechazado: { label: 'Rechazado', color: '#EF4444' },
  }
  const { label, color } = map[s] || { label: s, color: '#9CA3AF' }
  return (
    <span
      style={{
        background: color + '22',
        color,
        border: `1px solid ${color}44`,
        borderRadius: 8,
        padding: '2px 10px',
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  )
}

export default function PagarCuota() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<ClienteData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [form, setForm] = useState({
    monto: '',
    metodo: 'Transferencia bancaria',
    referencia: '',
    notas: '',
  })

  const load = async () => {
    try {
      const res = await fetch(apiUrl(`/api/pagar/${token}`))
      if (!res.ok) throw new Error('Enlace no válido')
      setData(await res.json())
    } catch {
      setError('Este enlace no es válido o ha expirado.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.monto || parseFloat(form.monto) <= 0) {
      toast.error('Ingresa un monto válido')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(apiUrl(`/api/pagar/${token}/pagar`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monto: parseFloat(form.monto),
          metodo: form.metodo,
          referencia: form.referencia || null,
          notas: form.notas || null,
        }),
      })
      if (!res.ok) throw new Error()
      setSuccess(true)
      setForm({ monto: '', metodo: 'Transferencia bancaria', referencia: '', notas: '' })
      await load()
      toast.success('✅ Pago registrado. Será verificado a la brevedad.')
    } catch {
      toast.error('Error al registrar el pago. Intenta nuevamente.')
    } finally {
      setSubmitting(false)
    }
  }

  const bg = '#0A0A0A'
  const glass = 'rgba(255,255,255,0.04)'
  const border = 'rgba(255,255,255,0.08)'
  const lime = '#CCFF00'
  const cyan = '#00F0FF'
  const text = '#E8E8E8'
  const muted = '#888'

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: muted, fontSize: 16 }}>Cargando...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center', color: text }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <h2 style={{ color: '#EF4444', marginBottom: 8 }}>Enlace no válido</h2>
          <p style={{ color: muted }}>{error}</p>
          <p style={{ color: muted, fontSize: 13, marginTop: 8 }}>Si crees que es un error, contacta a Abogados Tributarios.</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  const progreso = data.num_cuotas > 0
    ? Math.round((data.cuotas_pagadas / data.num_cuotas) * 100)
    : 0

  return (
    <div style={{ minHeight: '100vh', background: bg, color: text, fontFamily: "'Manrope', 'Space Grotesk', sans-serif", padding: '24px 16px 80px' }}>
      <Toaster position="top-center" />

      {/* Header */}
      <div style={{ maxWidth: 680, margin: '0 auto 32px', textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: cyan, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 8 }}>
          Portal de Pago
        </div>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: text }}>
          Abogados Tributarios
        </h1>
        <p style={{ margin: '8px 0 0', color: muted, fontSize: 14 }}>
          Gestiona el pago de tus honorarios de forma segura
        </p>
      </div>

      <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Cliente card */}
        <div style={{ background: glass, border: `1px solid ${border}`, borderRadius: 16, padding: 24, backdropFilter: 'blur(10px)' }}>
          <div style={{ fontSize: 11, color: cyan, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 16 }}>
            Datos del Cliente
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
            <Field label="Cliente" value={data.nombre} />
            <Field label="RUT del Cliente" value={data.rut || 'N/A'} />
            <Field label="Razón Social" value={data.razon_social || 'N/A'} />
            <Field label="Email" value={data.email || 'N/A'} />
            <Field label="Teléfono" value={data.phone || 'N/A'} />
            <Field label="Área Legal" value={data.area_name || data.tipo_servicio || 'N/A'} />
          </div>
        </div>

        {/* Plan de pago */}
        <div style={{ background: glass, border: `1px solid ${border}`, borderRadius: 16, padding: 24, backdropFilter: 'blur(10px)' }}>
          <div style={{ fontSize: 11, color: lime, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 16 }}>
            Plan de Pago
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <AmountCard label="Honorarios Totales" value={fmt(data.honorarios)} accent={lime} />
            <AmountCard label="Cuota Inicial" value={fmt(data.cuota_inicial)} accent={lime} />
            <AmountCard label="N° de Cuotas" value={`${data.num_cuotas}`} accent={lime} />
            <AmountCard label="Monto por Cuota" value={fmt(data.monto_cuota)} accent={lime} />
          </div>

          {/* Progress bar */}
          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
              <span style={{ color: muted }}>Cuotas pagadas: <strong style={{ color: text }}>{data.cuotas_pagadas} / {data.num_cuotas}</strong></span>
              <span style={{ color: lime, fontWeight: 700 }}>{progreso}%</span>
            </div>
            <div style={{ height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progreso}%`, background: `linear-gradient(90deg, ${lime}, ${cyan})`, borderRadius: 8, transition: 'width 0.5s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 13 }}>
              <span style={{ color: muted }}>Total pagado: <strong style={{ color: '#22C55E' }}>{fmt(data.total_pagado)}</strong></span>
              <span style={{ color: muted }}>Saldo pendiente: <strong style={{ color: data.saldo_pendiente > 0 ? '#F59E0B' : '#22C55E' }}>{fmt(data.saldo_pendiente)}</strong></span>
            </div>
          </div>
        </div>

        {/* Payment form */}
        {data.saldo_pendiente > 0 ? (
          <div style={{ background: glass, border: `1px solid ${border}`, borderRadius: 16, padding: 24, backdropFilter: 'blur(10px)' }}>
            <div style={{ fontSize: 11, color: cyan, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 16 }}>
              Registrar Pago
            </div>
            {success && (
              <div style={{ background: '#22C55E15', border: '1px solid #22C55E44', borderRadius: 10, padding: '12px 16px', marginBottom: 16, color: '#22C55E', fontSize: 14 }}>
                ✅ Tu pago fue registrado y está siendo verificado. Te contactaremos a la brevedad.
              </div>
            )}
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: muted, display: 'block', marginBottom: 6 }}>
                  Monto a pagar *
                </label>
                <input
                  type="number"
                  min="1"
                  placeholder={`Ej: ${Math.round(data.monto_cuota)}`}
                  value={form.monto}
                  onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
                  required
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: muted, display: 'block', marginBottom: 6 }}>
                  Método de pago
                </label>
                <select
                  value={form.metodo}
                  onChange={e => setForm(f => ({ ...f, metodo: e.target.value }))}
                  style={inputStyle}
                >
                  <option>Transferencia bancaria</option>
                  <option>Webpay</option>
                  <option>MercadoPago</option>
                  <option>Cheque</option>
                  <option>Efectivo</option>
                  <option>Otro</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: muted, display: 'block', marginBottom: 6 }}>
                  N° de operación / referencia
                </label>
                <input
                  type="text"
                  placeholder="Ej: 123456789 (número de transferencia)"
                  value={form.referencia}
                  onChange={e => setForm(f => ({ ...f, referencia: e.target.value }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: muted, display: 'block', marginBottom: 6 }}>
                  Observaciones (opcional)
                </label>
                <textarea
                  placeholder="Cualquier detalle adicional..."
                  value={form.notas}
                  onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                  rows={3}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  background: submitting ? 'rgba(204,255,0,0.3)' : lime,
                  color: '#0A0A0A',
                  border: 'none',
                  borderRadius: 10,
                  padding: '14px 24px',
                  fontSize: 15,
                  fontWeight: 800,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                  letterSpacing: 0.5,
                }}
              >
                {submitting ? 'Registrando...' : '💳 Registrar Pago'}
              </button>
            </form>
            <p style={{ fontSize: 12, color: muted, marginTop: 14, lineHeight: 1.5 }}>
              Al registrar tu pago, nuestro equipo lo verificará y te confirmará a la brevedad.
              Si tienes dudas, contáctanos directamente.
            </p>
          </div>
        ) : (
          <div style={{ background: '#22C55E10', border: '1px solid #22C55E44', borderRadius: 16, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
            <h3 style={{ color: '#22C55E', margin: '0 0 8px' }}>¡Plan de pago completado!</h3>
            <p style={{ color: muted, margin: 0, fontSize: 14 }}>Has completado todos los pagos de tu plan. ¡Gracias!</p>
          </div>
        )}

        {/* Payment history */}
        {data.pagos.length > 0 && (
          <div style={{ background: glass, border: `1px solid ${border}`, borderRadius: 16, padding: 24, backdropFilter: 'blur(10px)' }}>
            <div style={{ fontSize: 11, color: muted, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 16 }}>
              Historial de Pagos
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.pagos.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '12px 16px' }}>
                  <div>
                    <div style={{ fontWeight: 600, color: text }}>{fmt(p.monto)}</div>
                    <div style={{ fontSize: 12, color: muted, marginTop: 2 }}>
                      {p.metodo || '—'}{p.referencia ? ` · Ref: ${p.referencia}` : ''}
                    </div>
                    <div style={{ fontSize: 11, color: muted, marginTop: 2 }}>
                      {p.created_at ? new Date(p.created_at).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                    </div>
                  </div>
                  <div>{statusBadge(p.status)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ textAlign: 'center', color: muted, fontSize: 12, padding: '8px 0' }}>
          Abogados Tributarios — Portal seguro de pagos<br />
          <span style={{ fontSize: 11 }}>Este documento es confidencial y de uso exclusivo del cliente indicado.</span>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#00F0FF', marginBottom: 3, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 14, color: '#E8E8E8' }}>{value}</div>
    </div>
  )
}

function AmountCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ background: accent + '10', border: `1px solid ${accent}30`, borderRadius: 10, padding: '12px 16px' }}>
      <div style={{ fontSize: 11, color: accent, marginBottom: 4, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#E8E8E8' }}>{value}</div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 10,
  padding: '10px 14px',
  color: '#E8E8E8',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
}
