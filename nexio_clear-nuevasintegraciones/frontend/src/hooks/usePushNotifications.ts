import { useEffect, useRef } from 'react'
import { getPushVapidKey, subscribePush, unsubscribePush } from '../api'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

async function _doRegister(forceNew = false): Promise<'ok' | 'denied' | 'unsupported' | 'error'> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'

  const reg = await navigator.serviceWorker.ready

  if (forceNew) {
    const existing = await reg.pushManager.getSubscription()
    if (existing) {
      try { await unsubscribePush(existing.endpoint) } catch {}
      await existing.unsubscribe()
    }
  }

  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    const { public_key } = await getPushVapidKey()
    if (!public_key) return 'error'
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key),
    })
  }

  const json = sub.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return 'error'

  await subscribePush({
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  })
  return 'ok'
}

/** Force unsubscribe + resubscribe — call from UI button */
export async function reRegisterPush(): Promise<'ok' | 'denied' | 'unsupported' | 'error'> {
  return _doRegister(true)
}

export function usePushNotifications(isAuthenticated: boolean) {
  const registered = useRef(false)

  useEffect(() => {
    if (!isAuthenticated) { registered.current = false; return }
    if (registered.current) return
    registered.current = true

    _doRegister(false).catch(() => {
      registered.current = false
    })
  }, [isAuthenticated])
}
