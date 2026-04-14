const CACHE_NAME = 'figurinhas-v10'
const SCAN_QUEUE_STORE = 'scan-offline-queue'
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

  // API routes: network only (except scan which has offline queue)
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

// ── Offline Scan Queue (IndexedDB) ──
function openScanQueueDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('CompleteAI', 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(SCAN_QUEUE_STORE)) {
        db.createObjectStore(SCAN_QUEUE_STORE, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function enqueueScan(body) {
  const db = await openScanQueueDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SCAN_QUEUE_STORE, 'readwrite')
    tx.objectStore(SCAN_QUEUE_STORE).add({ body, timestamp: Date.now() })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function getQueuedScans() {
  const db = await openScanQueueDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SCAN_QUEUE_STORE, 'readonly')
    const req = tx.objectStore(SCAN_QUEUE_STORE).getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function clearQueuedScan(id) {
  const db = await openScanQueueDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SCAN_QUEUE_STORE, 'readwrite')
    tx.objectStore(SCAN_QUEUE_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// Intercept POST /api/scan when offline → queue for later
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (request.method === 'POST' && url.pathname === '/api/scan') {
    event.respondWith(
      fetch(request.clone()).catch(async () => {
        // Offline → save to queue
        try {
          const body = await request.clone().json()
          await enqueueScan(body)
          return new Response(
            JSON.stringify({
              queued: true,
              message: 'Sem internet. Seu scan foi salvo e será processado quando voltar online.',
            }),
            { status: 202, headers: { 'Content-Type': 'application/json' } }
          )
        } catch {
          return new Response(
            JSON.stringify({ error: 'Sem internet. Tente novamente quando estiver online.' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          )
        }
      })
    )
    return
  }
})

// Process queued scans when back online
self.addEventListener('message', async (event) => {
  if (event.data?.type === 'PROCESS_SCAN_QUEUE') {
    try {
      const queued = await getQueuedScans()
      const results = []

      for (const item of queued) {
        try {
          const res = await fetch('/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item.body),
          })
          if (res.ok) {
            const data = await res.json()
            results.push(data)
            await clearQueuedScan(item.id)
          }
        } catch {
          break // still offline, stop processing
        }
      }

      // Notify client of results
      const clients = await self.clients.matchAll({ type: 'window' })
      for (const client of clients) {
        client.postMessage({ type: 'SCAN_QUEUE_RESULTS', results, remaining: (await getQueuedScans()).length })
      }
    } catch (err) {
      console.error('Process scan queue error:', err)
    }
  }
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
