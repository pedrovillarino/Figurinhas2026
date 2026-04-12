const CACHE_NAME = 'figurinhas-v9'
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
]

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Fetch: network-first for API/data, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET requests
  if (request.method !== 'GET') return

  // Skip Supabase and external API calls
  if (url.hostname !== self.location.hostname) return

  // API routes: network only
  if (url.pathname.startsWith('/api/')) return

  // Next.js data/RSC requests: network first, no cache
  if (url.pathname.startsWith('/_next/data/') || url.searchParams.has('_rsc')) return

  // Static assets (_next/static): cache first
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached || fetch(request).then((response) => {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          return response
        })
      )
    )
    return
  }

  // HTML pages: network first, fallback to cache
  event.respondWith(
    fetch(request)
      .then((response) => {
        const clone = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
        return response
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
  )
})

// ── Push Notifications ──
self.addEventListener('push', (event) => {
  if (!event.data) return

  try {
    const data = event.data.json()
    const options = {
      body: data.body || '',
      icon: data.icon || '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [200, 100, 200],
      data: { url: data.url || '/trades' },
      actions: [
        { action: 'open', title: 'Abrir' },
      ],
    }

    event.waitUntil(
      self.registration.showNotification(data.title || 'Complete Aí', options)
    )
  } catch {
    // Fallback for plain text
    event.waitUntil(
      self.registration.showNotification('Complete Aí', {
        body: event.data.text(),
        icon: '/icon-192.png',
      })
    )
  }
})

// Click on notification → open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const url = event.notification.data?.url || '/trades'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // If app is already open, focus it
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      // Otherwise open new window
      return self.clients.openWindow(url)
    })
  )
})
