import { createContext, useContext, useEffect, useRef, useCallback } from 'react'
import { apiUrl } from '../api/client'

export type RealtimeEvent = {
  type: string
  [key: string]: any
}

type Listener = (evt: RealtimeEvent) => void

interface RealtimeContextValue {
  addListener: (fn: Listener) => void
  removeListener: (fn: Listener) => void
}

const RealtimeContext = createContext<RealtimeContextValue>({
  addListener: () => {},
  removeListener: () => {},
})

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const listenersRef = useRef<Set<Listener>>(new Set())
  const esRef        = useRef<EventSource | null>(null)
  const reconnRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wdRef        = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dispatch = useCallback((evt: RealtimeEvent) => {
    listenersRef.current.forEach(fn => { try { fn(evt) } catch { /* ignore */ } })
  }, [])

  useEffect(() => {
    let dead = false

    const connect = () => {
      if (dead) return
      const token = localStorage.getItem('token')
      if (!token) {
        reconnRef.current = setTimeout(connect, 3000)
        return
      }

      if (esRef.current) { esRef.current.close(); esRef.current = null }

      const es = new EventSource(apiUrl(`/api/whatsapp/stream?token=${encodeURIComponent(token)}`))
      esRef.current = es

      const resetWd = () => {
        if (wdRef.current) clearTimeout(wdRef.current)
        wdRef.current = setTimeout(() => {
          es.close()
          esRef.current = null
          if (!dead) reconnRef.current = setTimeout(connect, 200)
        }, 25000)
      }
      resetWd()

      es.onmessage = (e) => {
        resetWd()
        let evt: RealtimeEvent
        try { evt = JSON.parse(e.data) } catch { return }
        if (evt.type === 'connected' || evt.type === 'keepalive') return
        dispatch(evt)
      }

      es.onerror = () => {
        if (wdRef.current) clearTimeout(wdRef.current)
        es.close()
        esRef.current = null
        if (!dead) reconnRef.current = setTimeout(connect, 3000)
      }
    }

    connect()

    // Re-connect when user logs in (token appears in storage)
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'token' && e.newValue && !esRef.current) connect()
    }
    window.addEventListener('storage', onStorage)

    return () => {
      dead = true
      if (wdRef.current) clearTimeout(wdRef.current)
      if (reconnRef.current) clearTimeout(reconnRef.current)
      esRef.current?.close()
      esRef.current = null
      window.removeEventListener('storage', onStorage)
    }
  }, [dispatch])

  const addListener    = useCallback((fn: Listener) => { listenersRef.current.add(fn) }, [])
  const removeListener = useCallback((fn: Listener) => { listenersRef.current.delete(fn) }, [])

  return (
    <RealtimeContext.Provider value={{ addListener, removeListener }}>
      {children}
    </RealtimeContext.Provider>
  )
}

/**
 * Subscribe to one or more SSE event types.
 * handler is called with the full event object.
 * Safe to pass an inline function — uses a ref internally.
 */
export function useRealtime(
  eventTypes: string | string[],
  handler: (evt: RealtimeEvent) => void
) {
  const { addListener, removeListener } = useContext(RealtimeContext)
  const handlerRef = useRef(handler)
  useEffect(() => { handlerRef.current = handler })

  useEffect(() => {
    const types = Array.isArray(eventTypes) ? eventTypes : [eventTypes]
    const fn: Listener = (evt) => {
      if (types.includes(evt.type)) handlerRef.current(evt)
    }
    addListener(fn)
    return () => removeListener(fn)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.isArray(eventTypes) ? eventTypes.join(',') : eventTypes, addListener, removeListener])
}
