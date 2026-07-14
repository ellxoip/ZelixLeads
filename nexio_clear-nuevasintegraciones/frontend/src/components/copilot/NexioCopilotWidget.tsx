import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { getInsights, dismissInsight, updateContact } from '../../api'
import { onLeadChanged, emitLeadChanged } from '../../lib/leadEvents'
import { openLeadDrawer } from '../../lib/leadDrawerBus'
import toast from 'react-hot-toast'
import { useDebouncedCallback } from '../../hooks/useDebouncedRealtime'
import CopilotCard from './CopilotCard'
import type { Insight } from './types'

// Contenedor inteligente del Nexio Copilot. Se monta en la parte superior de la
// landing "Hoy". Aditivo: si no hay insights, no renderiza nada (cero ruido).
export default function NexioCopilotWidget() {
  const [insights, setInsights] = useState<Insight[]>([])

  // Mismo patrón de refresco coalescido que el Dashboard.
  const refresh = useDebouncedCallback(() => {
    getInsights().then(setInsights).catch(() => {})
  }, 350)

  useEffect(() => { refresh() }, [refresh])
  // Tubería de eventos: cualquier cambio de lead re-evalúa → las tarjetas
  // aparecen/desaparecen solas (UX líquida).
  useEffect(() => onLeadChanged(refresh), [refresh])

  const act = async (i: Insight) => {
    const a = i.action
    // Dismiss optimista (UX líquida) — la tarjeta se evapora al instante.
    setInsights(prev => prev.filter(x => x.id !== i.id))

    if (a.kind === 'autofill') {
      // 1-clic: inyecta los datos extraídos del chat en el contacto, sin digitar.
      try {
        await updateContact(a.contactId, a.fields)
        toast.success('Datos del chat guardados en el contacto')
      } catch {
        toast.error('No se pudo guardar el dato extraído')
      }
      openLeadDrawer(a.leadId, 'resumen') // el Drawer re-fetchea → refleja el cambio
    } else if (a.kind === 'drawer') {
      openLeadDrawer(a.leadId, a.tab)
    } else {
      openLeadDrawer(a.leadId) // 'agenda' / 'work_order' → cascadas Flujo A / OT
    }
    // Confirmación por el bus: re-evalúa y repinta el resto de superficies.
    emitLeadChanged({ leadId: a.leadId })
  }

  const dismiss = (i: Insight) => {
    setInsights(prev => prev.filter(x => x.id !== i.id))
    dismissInsight(i.id).catch(() => {})
  }

  if (insights.length === 0) return null

  return (
    <div className="rounded-2xl p-3 mb-1"
      style={{ background: 'var(--surface-0)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2 px-1 pb-2.5">
        <Sparkles size={14} style={{ color: 'var(--primary)' }} />
        <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          Nexio Copilot
        </h3>
        <span className="text-[10px] font-bold px-1.5 rounded-full"
          style={{ background: 'var(--primary-dim)', color: 'var(--primary)' }}>
          {insights.length}
        </span>
      </div>
      {/* Carrusel líquido de tarjetas */}
      <div className="grid gap-2.5 sm:grid-cols-2">
        {insights.map(i => (
          <CopilotCard key={i.id} insight={i} onAct={act} onDismiss={dismiss} />
        ))}
      </div>
    </div>
  )
}
