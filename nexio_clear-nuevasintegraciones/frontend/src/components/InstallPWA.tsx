import { useState, useEffect } from 'react'
import { Download, Smartphone } from 'lucide-react'
import toast from 'react-hot-toast'

interface Props {
  variant?: 'button' | 'banner'
}

export default function InstallPWA({ variant = 'button' }: Props) {
  const [prompt, setPrompt] = useState<any>(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', () => { setInstalled(true); setPrompt(null) })
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (installed) return null

  const handleInstall = async () => {
    if (prompt) {
      prompt.prompt()
      const { outcome } = await prompt.userChoice
      if (outcome === 'accepted') setPrompt(null)
    } else {
      toast('En iPhone: toca Compartir → "Agregar a inicio". En Android: menú ⋮ → "Instalar app"', {
        icon: '📱', duration: 5000,
      })
    }
  }

  if (variant === 'banner') {
    return (
      <div className="flex items-center justify-between px-4 py-3 rounded-xl gap-3"
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}>
        <div className="min-w-0 flex items-center gap-2.5">
          <Smartphone size={16} className="flex-shrink-0" style={{ color: 'rgba(255,255,255,0.35)' }} />
          <div className="min-w-0">
            <p className="text-xs font-semibold leading-tight" style={{ color: 'rgba(255,255,255,0.80)' }}>Descargar App</p>
            <p className="text-[10px] leading-tight mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>Accede sin navegador, funciona offline</p>
          </div>
        </div>
        <button onClick={handleInstall}
          className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg flex-shrink-0 transition-opacity hover:opacity-80"
          style={{ background: '#7c3aed', color: '#ffffff' }}>
          <Download size={12} /> Instalar
        </button>
      </div>
    )
  }

  // variant="button" — used inside dark sidebar
  return (
    <button onClick={handleInstall}
      className="flex items-center gap-2 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150"
      style={{ color: 'rgba(255,255,255,0.52)' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ffffff'; (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.52)'; (e.currentTarget as HTMLElement).style.background = '' }}>
      <Download size={16} className="flex-shrink-0" />
      <span className="truncate flex-1">Descargar App</span>
    </button>
  )
}
