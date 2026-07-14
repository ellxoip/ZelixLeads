import { useRef, useEffect, useCallback } from 'react'
import { useRealtime } from '../contexts/RealtimeContext'

// Anti-saturación: coalesce ráfagas de eventos (SSE multi-usuario + bus same-tab)
// en un único refetch. Evita render-loops y avalanchas de peticiones a la DB
// cuando varios usuarios mueven leads a la vez.

/** Devuelve una versión debounced y estable de `fn`. Limpia el timer al desmontar. */
export function useDebouncedCallback(fn: () => void, ms = 400): () => void {
  const fnRef = useRef(fn)
  useEffect(() => { fnRef.current = fn })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => fnRef.current(), ms)
  }, [ms])
}

/** useRealtime con debounce incorporado para superficies de refetch pesado. */
export function useDebouncedRealtime(
  types: string | string[],
  fn: () => void,
  ms = 400,
) {
  const debounced = useDebouncedCallback(fn, ms)
  useRealtime(types, debounced)
}
