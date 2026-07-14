import { useEffect } from 'react'
import { LeadDetailView } from '../pages/LeadDetail'

// Panel lateral deslizante reutilizable para abrir un lead en contexto, sin
// salir del tablero. Aporta el chrome (backdrop + slide-in + Esc) y delega
// todo el contenido/acciones a LeadDetailView en modo `embedded`.
export default function LeadDrawer({ leadId, onClose, initialTab }: { leadId: number; onClose: () => void; initialTab?: 'resumen' | 'historial' | 'chat' | 'agenda' }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div className="absolute inset-0 modal-backdrop" onClick={onClose} />

      {/* Panel */}
      <div
        className="absolute right-0 top-0 h-full w-full max-w-2xl shadow-2xl overflow-y-auto lead-drawer-panel"
        style={{ background: 'var(--bg)', borderLeft: '1px solid var(--border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 sm:p-5">
          <LeadDetailView leadId={leadId} onClose={onClose} embedded initialTab={initialTab} />
        </div>
      </div>

      <style>{`
        @keyframes leadDrawerIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .lead-drawer-panel { animation: leadDrawerIn 0.22s cubic-bezier(0.32, 0.72, 0, 1); }
      `}</style>
    </div>
  )
}
