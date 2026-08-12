import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import toast from 'react-hot-toast'
import { Lock, Mail, Eye, EyeOff, Send, ShieldCheck, Zap } from 'lucide-react'
import { NexioLogo } from '../components/NexioLogo'
import InstallPWA from '../components/InstallPWA'
import api from '../api/client'

const PERKS = [
  { icon: Send,        text: 'Mensajería vía WhatsApp' },
  { icon: Zap,         text: 'Leads e IA en tiempo real' },
  { icon: ShieldCheck, text: 'Acceso seguro por roles' },
]

// Las cuentas del equipo YA NO viven acá. Estaban en este archivo con su
// contraseña en texto plano, y este archivo se compila en un bundle público:
// cualquiera que abriera leads.zelix.cl podía leerlas y entrar como SuperAdmin.
// Ahora las pide el servidor con /api/auth/panel-credenciales y solo las
// entrega si la clave es correcta. Ver ese endpoint para el porqué completo.
type CuentaEquipo = { email: string; rol: string; pw: string }

// Las claves son los roles TAL COMO los guarda la base, porque ahora la lista
// llega del servidor y no de una constante escrita a mano acá.
const ROLE_COLORS: Record<string, string> = {
  superadmin:  'var(--zx-accent-text)',
  subadmin:    '#a78bfa',
  tecnico:     '#0891b2',
  verificador: '#f59e0b',
  cobrador:    '#e11d48',
  vendedor:    'var(--zx-lime)',
  agendadora:  '#10b981',
}

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [loading, setLoading]   = useState(false)
  const [showDemo, setShowDemo] = useState(false)
  const [demoLoading, setDemoLoading] = useState<string | null>(null)
  const [claveEquipo, setClaveEquipo] = useState('')
  const [cuentas, setCuentas] = useState<CuentaEquipo[] | null>(null)
  const [abriendo, setAbriendo] = useState(false)
  const login    = useAuthStore(s => s.login)
  const navigate = useNavigate()

  function homeFor(role?: string) {
    if (role === 'tecnico')    return '/tecnico'
    if (role === 'vendedor')   return '/'
    if (role === 'verificador') return '/pagos'
    if (role === 'agendadora') return '/'
    return '/'
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await login(email, password)
      const role = useAuthStore.getState().user?.role
      toast.success('¡Bienvenido a ZelixLeads!')
      navigate(homeFor(role))
    } catch (err: any) {
      if (!err?.response) {
        toast.error('Backend no disponible. Verifica la URL de la API')
      } else {
        toast.error(err?.response?.data?.detail || 'Credenciales incorrectas')
      }
    } finally {
      setLoading(false)
    }
  }

  // Pide las credenciales al servidor. Si la clave no es la correcta, no llega
  // absolutamente nada: la comprobación NO ocurre en el navegador.
  const pedirCuentas = async (e: React.FormEvent) => {
    e.preventDefault()
    setAbriendo(true)
    try {
      const { data } = await api.post('/api/auth/panel-credenciales', { clave: claveEquipo })
      setCuentas(data.cuentas)
      setClaveEquipo('')
    } catch (err: any) {
      toast.error(err?.response?.status === 401 ? 'Clave incorrecta' : 'No se pudo abrir')
    } finally {
      setAbriendo(false)
    }
  }

  const handleDemoLogin = async (acc: { email: string; pw: string; label: string }) => {
    setDemoLoading(acc.email)
    setEmail(acc.email)
    setPassword(acc.pw)
    try {
      await login(acc.email, acc.pw)
      const role = useAuthStore.getState().user?.role
      toast.success(`Demo: ${acc.label}`)
      navigate(homeFor(role))
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'No se pudo iniciar la cuenta demo')
    } finally {
      setDemoLoading(null)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden px-4 py-10"
      style={{ background: 'linear-gradient(160deg, #f7f5fc 0%, #ece6fa 48%, #e3f4f9 100%)' }}>

      {/* Blobs decorativos suaves */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute rounded-full" style={{
          top: '-18%', right: '-10%', width: 560, height: 560,
          background: 'radial-gradient(circle, rgba(53,122,14,0.16) 0%, transparent 68%)',
        }} />
        <div className="absolute rounded-full" style={{
          bottom: '-20%', left: '-12%', width: 620, height: 620,
          background: 'radial-gradient(circle, rgba(6,182,212,0.14) 0%, transparent 68%)',
        }} />
        <div className="absolute inset-0" style={{
          backgroundImage: 'linear-gradient(rgba(53,122,14,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(53,122,14,0.045) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
        }} />

        {/* Mensajes ondulando de punta a punta — todos los tamaños */}
        {[
          { top: '6%',  dur: 46, delay: -6,  wave: 8,  rtl: false, w: 132, lines: 2, size: 1.35 },
          { top: '15%', dur: 58, delay: -30, wave: 10, rtl: true,  w: 104, lines: 1, size: 0.65 },
          { top: '24%', dur: 52, delay: -18, wave: 9,  rtl: false, w: 92,  lines: 1, size: 1.0  },
          { top: '34%', dur: 60, delay: -44, wave: 11, rtl: true,  w: 118, lines: 2, size: 0.8  },
          { top: '46%', dur: 50, delay: -10, wave: 9,  rtl: false, w: 126, lines: 1, size: 1.6  },
          { top: '58%', dur: 56, delay: -35, wave: 10, rtl: true,  w: 96,  lines: 1, size: 0.55 },
          { top: '66%', dur: 48, delay: -40, wave: 7,  rtl: true,  w: 142, lines: 2, size: 1.2  },
          { top: '76%', dur: 62, delay: -12, wave: 11, rtl: false, w: 100, lines: 1, size: 0.7  },
          { top: '84%', dur: 54, delay: -25, wave: 8,  rtl: true,  w: 122, lines: 2, size: 1.45 },
          { top: '93%', dur: 58, delay: -50, wave: 9,  rtl: false, w: 108, lines: 1, size: 0.9  },
        ].map(({ top, dur, delay, wave, rtl, w, lines, size }, i) => (
          <div key={i} className={`login-msg ${rtl ? 'login-msg--rtl' : ''}`}
            style={{
              top,
              animationDuration: `${dur}s`,
              animationDelay: `${delay}s`,
              ['--msg-op' as any]: size < 0.8 ? 0.55 : size > 1.25 ? 0.95 : 0.8,
              filter: size < 0.8 ? 'blur(1.2px)' : 'none',
              scale: String(size),
            }}>
            <div className="login-msg-wave flex items-center gap-2"
              style={{ animationDuration: `${wave}s`, animationDelay: `${delay * 0.5}s` }}>
              {!rtl && (
                <span className="flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0"
                  style={{
                    background: 'linear-gradient(135deg, var(--zx-accent-text), var(--zx-lime))',
                    boxShadow: '0 3px 10px rgba(53,122,14,0.35)',
                  }}>
                  <Send size={11} color="#fff" />
                </span>
              )}
              <div className="rounded-2xl px-3 py-2"
                style={{
                  width: w,
                  background: 'rgba(255,255,255,0.82)',
                  border: '1px solid rgba(53,122,14,0.20)',
                  boxShadow: '0 10px 26px rgba(53,122,14,0.14), inset 0 1px 0 rgba(255,255,255,0.9)',
                  backdropFilter: 'blur(5px)',
                  borderBottomLeftRadius: rtl ? 16 : 4,
                  borderBottomRightRadius: rtl ? 4 : 16,
                }}>
                <div className="h-1.5 rounded-full mb-1.5"
                  style={{
                    width: '82%',
                    background: rtl
                      ? 'linear-gradient(90deg, rgba(6,182,212,0.55), rgba(6,182,212,0.20))'
                      : 'linear-gradient(90deg, rgba(53,122,14,0.50), rgba(53,122,14,0.18))',
                  }} />
                {lines > 1 && (
                  <div className="h-1.5 rounded-full"
                    style={{ width: '55%', background: 'rgba(28,22,51,0.12)' }} />
                )}
              </div>
              {rtl && (
                <span className="flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0"
                  style={{
                    background: 'linear-gradient(135deg, var(--zx-lime), var(--zx-accent-text))',
                    boxShadow: '0 3px 10px rgba(6,182,212,0.35)',
                  }}>
                  <Send size={11} color="#fff" style={{ transform: 'scaleX(-1)' }} />
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Marca */}
      <div className="relative z-10 flex flex-col items-center mb-7">
        <NexioLogo size={54} />
        <h1 className="mt-3 text-3xl font-black tracking-tight leading-none"
          style={{
            fontFamily: '"Space Grotesk", sans-serif', letterSpacing: '-0.03em',
            background: 'linear-gradient(90deg, var(--zx-accent-text) 0%, var(--zx-lime) 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
          ZelixLeads
        </h1>
        <span className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.16em]"
          style={{ background: 'rgba(6,182,212,0.10)', border: '1px solid rgba(6,182,212,0.35)', color: '#0891b2' }}>
          <Send size={10} /> WhatsApp CRM
        </span>
      </div>

      {/* Tarjeta de acceso */}
      <div className="relative z-10 w-full max-w-[400px] rounded-3xl p-7 sm:p-8"
        style={{
          background: '#ffffff',
          border: '1px solid rgba(53,122,14,0.14)',
          boxShadow: '0 24px 60px rgba(28,22,51,0.14), 0 4px 16px rgba(53,122,14,0.08)',
        }}>

        <h2 className="text-xl font-black leading-tight mb-1"
          style={{ color: '#1c1633', fontFamily: '"Space Grotesk", sans-serif', letterSpacing: '-0.02em' }}>
          Inicia sesión
        </h2>
        <p className="text-[13px] mb-6" style={{ color: 'rgba(28,22,51,0.50)' }}>
          Tu embudo de leads, conectado a WhatsApp.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Email */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-[0.14em] mb-1.5"
              style={{ color: 'rgba(28,22,51,0.45)' }}>
              Correo electrónico
            </label>
            <div className="relative">
              <Mail size={14} className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'rgba(28,22,51,0.30)' }} />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full pl-11 pr-4 py-3 text-sm rounded-xl transition-all focus:outline-none"
                style={{ background: '#f7f5fc', border: '1px solid rgba(28,22,51,0.14)', color: '#1c1633' }}
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--zx-accent-text)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(53,122,14,0.14)' }}
                onBlur={e  => { e.currentTarget.style.borderColor = 'rgba(28,22,51,0.14)'; e.currentTarget.style.boxShadow = 'none' }}
                placeholder="tu@empresa.com"
              />
            </div>
          </div>

          {/* Contraseña */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-[0.14em] mb-1.5"
              style={{ color: 'rgba(28,22,51,0.45)' }}>
              Contraseña
            </label>
            <div className="relative">
              <Lock size={14} className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'rgba(28,22,51,0.30)' }} />
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full pl-11 pr-12 py-3 text-sm rounded-xl transition-all focus:outline-none"
                style={{ background: '#f7f5fc', border: '1px solid rgba(28,22,51,0.14)', color: '#1c1633' }}
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--zx-accent-text)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(53,122,14,0.14)' }}
                onBlur={e  => { e.currentTarget.style.borderColor = 'rgba(28,22,51,0.14)'; e.currentTarget.style.boxShadow = 'none' }}
                placeholder="••••••••"
              />
              <button type="button" onClick={() => setShowPw(!showPw)}
                className="absolute right-4 top-1/2 -translate-y-1/2 transition-colors"
                style={{ color: 'rgba(28,22,51,0.32)' }}>
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Entrar */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl text-sm font-bold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: 'linear-gradient(90deg, var(--zx-accent-text) 0%, var(--zx-lime) 130%)',
              color: '#ffffff',
              boxShadow: '0 8px 24px rgba(53,122,14,0.35)',
              fontFamily: '"Space Grotesk", sans-serif',
            }}
            onMouseEnter={e => { if (!loading) { (e.currentTarget as HTMLElement).style.boxShadow = '0 12px 32px rgba(53,122,14,0.50)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)' } }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(53,122,14,0.35)'; (e.currentTarget as HTMLElement).style.transform = '' }}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2.5">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Verificando...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                Entrar <Send size={13} strokeWidth={2.5} />
              </span>
            )}
          </button>
        </form>

        {/* Cuentas del equipo — protegidas por clave, resueltas en el SERVIDOR */}
        <div className="mt-5">
          <button type="button" onClick={() => setShowDemo(v => !v)}
            className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all"
            style={{
              background: showDemo ? 'rgba(53,122,14,0.08)' : '#f7f5fc',
              border: '1px solid rgba(53,122,14,0.22)',
              color: 'var(--zx-accent-text)',
            }}>
            <span className="inline-flex items-center gap-1.5">
              <Zap size={12} /> Cuentas del equipo
            </span>
            <span style={{ transform: showDemo ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', fontSize: 10 }}>▼</span>
          </button>

          {showDemo && cuentas === null && (
            <form onSubmit={pedirCuentas} className="mt-2.5 rounded-2xl p-3"
              style={{ background: '#f7f5fc', border: '1px solid rgba(28,22,51,0.10)' }}>
              <p className="text-[10px] mb-2" style={{ color: 'rgba(28,22,51,0.55)' }}>
                Clave de acceso para ver las credenciales del equipo.
              </p>
              <div className="flex gap-2">
                <input type="password" value={claveEquipo} autoComplete="off"
                  onChange={e => setClaveEquipo(e.target.value)}
                  placeholder="Clave"
                  className="flex-1 px-3 py-2 rounded-xl text-xs outline-none"
                  style={{ border: '1px solid rgba(28,22,51,0.15)', background: '#fff' }} />
                <button type="submit" disabled={abriendo || !claveEquipo}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold disabled:opacity-50"
                  style={{ background: 'var(--zx-accent-text)', color: '#fff' }}>
                  {abriendo ? '…' : 'Ver'}
                </button>
              </div>
            </form>
          )}

          {showDemo && cuentas !== null && (
            <div className="mt-2.5 rounded-2xl p-2 space-y-1 overflow-y-auto"
              style={{ maxHeight: 240, background: '#f7f5fc', border: '1px solid rgba(28,22,51,0.10)' }}>
              {cuentas.map(acc => {
                const color = ROLE_COLORS[acc.rol] || 'var(--zx-accent-text)'
                const busy = demoLoading === acc.email
                return (
                  <button key={acc.email} type="button"
                    onClick={() => handleDemoLogin({ email: acc.email, pw: acc.pw, label: acc.rol })}
                    disabled={demoLoading !== null}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all disabled:opacity-50"
                    style={{ background: '#ffffff', border: '1px solid rgba(28,22,51,0.08)' }}>
                    <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-[10px] font-black"
                      style={{ background: `${color}18`, color, border: `1px solid ${color}40` }}>
                      {busy ? '…' : acc.rol.charAt(0).toUpperCase()}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[11px] font-bold leading-tight truncate" style={{ color: '#1c1633' }}>{acc.email}</span>
                      <span className="block text-[9px] leading-tight truncate font-mono" style={{ color: 'rgba(28,22,51,0.45)' }}>{acc.pw}</span>
                    </span>
                    <span className="flex-shrink-0 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider"
                      style={{ background: `${color}14`, color }}>
                      {acc.rol}
                    </span>
                  </button>
                )
              })}
              <p className="text-[9px] text-center pt-1 pb-0.5" style={{ color: 'rgba(28,22,51,0.35)' }}>
                Toca una cuenta para entrar con ella.
              </p>
            </div>
          )}
        </div>

        {/* Canal único del sistema: WhatsApp */}
        <div className="mt-5 flex items-start gap-2.5 p-3 rounded-2xl"
          style={{ background: 'rgba(53,122,14,0.07)', border: '1px solid rgba(53,122,14,0.22)' }}>
          <span className="flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--zx-lime), var(--zx-accent-text))' }}>
            <Send size={13} color="#fff" />
          </span>
          <p className="text-[11px] leading-snug" style={{ color: 'rgba(28,22,51,0.60)' }}>
            <strong style={{ color: 'var(--zx-accent-text)' }}>Conectado a WhatsApp.</strong> Toda la
            mensajería del CRM viaja por WhatsApp, en tiempo real.
          </p>
        </div>

        <div className="mt-4">
          <InstallPWA variant="banner" />
        </div>
      </div>

      {/* Bullets de valor */}
      <div className="relative z-10 mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 max-w-md">
        {PERKS.map(({ icon: Icon, text }) => (
          <span key={text} className="inline-flex items-center gap-1.5 text-[11px] font-semibold"
            style={{ color: 'rgba(28,22,51,0.48)' }}>
            <Icon size={12} style={{ color: 'var(--zx-accent-text)' }} /> {text}
          </span>
        ))}
      </div>

      <p className="relative z-10 text-[9px] mt-5" style={{ color: 'rgba(28,22,51,0.28)' }}>
        © 2026 ZelixLeads · CRM Platform · v1.0
      </p>
    </div>
  )
}
