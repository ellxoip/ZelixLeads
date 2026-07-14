const CACHE = 'crm-v23'
const PRECACHE = ['/', '/index.html']

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)

  // API calls: network first, no cache
  if (url.pathname.startsWith('/api/')) return

  // Navigation: network first, fallback to cached index.html
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    )
    return
  }

  // Assets: cache first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached
      return fetch(e.request).then(res => {
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, clone))
        }
        return res
      }).catch(() => caches.match('/index.html') || Response.error())
    })
  )
})

// ── Push notifications ──────────────────────────────────
self.addEventListener('push', e => {
  let data = { title: 'Nexio CRM', body: 'Nueva notificación', url: '/' }
  try { data = { ...data, ...JSON.parse(e.data?.text() ?? '{}') } } catch {}
  // Use a unique tag per notification so they don't collapse into one
  const tag = 'nexio-' + Date.now()
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url },
      vibrate: [200, 100, 200],
      tag,
      requireInteraction: false,
    })
  )
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = e.notification.data?.url ?? '/'
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
      for (const w of ws) {
        if (w.url.includes(self.location.origin)) { w.focus(); w.navigate(url); return }
      }
      return clients.openWindow(url)
    })
  )
})
