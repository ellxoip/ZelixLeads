import { useEffect, useState } from 'react'
import LeadDrawer from './LeadDrawer'
import { onOpenLeadDrawer, type LeadDrawerTab } from '../lib/leadDrawerBus'

// Se monta UNA sola vez en el Layout. Escucha el bus y superpone el LeadDrawer
// existente manteniendo intacto el contexto por debajo. Sin re-renders infinitos:
// la suscripción corre una vez ([] deps).
export default function LeadDrawerHost() {
  const [state, setState] = useState<{ leadId: number; tab?: LeadDrawerTab } | null>(null)

  useEffect(() => onOpenLeadDrawer((leadId, initialTab) => setState({ leadId, tab: initialTab })), [])

  if (!state) return null
  return <LeadDrawer leadId={state.leadId} initialTab={state.tab} onClose={() => setState(null)} />
}
