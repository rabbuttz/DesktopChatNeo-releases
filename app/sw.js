// The phone app's service worker (T-696). vite.config.ts fills in the build stamp and this build's own files below and
// writes it out as sw.js. It keeps the app itself, so the app opens without waiting for the network, and never touches
// anything from elsewhere (Supabase: sign-in, chat, pictures — always the network). A new build waits until the page
// says to go on (its 更新があります), then takes over and the page reloads.
const CACHE = 'dcneo-mobile-mwc3in3m'
const FILES = [...["./","./assets/index-DKqGfqvL.js","./assets/stage-kC3RIk5_.js","./assets/tracking-Cx6TDd-j.js","./assets/vision_bundle-DakWKhpB.js","./assets/index-6XYy_rZ7.css","./assets/tracking-worker-cxzFxgBs.js"], './manifest.webmanifest', './icon-256.png', './icon-512.png']
// The avatar's big files (T-697: MediaPipe's wasm, the face model, the desk's keyboard and animations; vite.config.ts
// copies them in): not fetched on install, kept the first time they are used, and kept across builds (they rarely
// change; a new set comes with a new name here)
const ASSETS = 'dcneo-assets-1'
const ASSET_DIRS = ['mediapipe/', 'models/', 'anims/']

self.addEventListener('install', (e) => {
  // past the HTTP cache: an index.html a few minutes old would point at the last build's files
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))))
})

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting()
})

// a DM notification (T-944, notify.ts) is tapped: the app comes to the front and opens that DM. When the app is open
// it is told so (open-dm, or open-dm-server); when it isn't, it opens at #dm=<otherId> (or #dmsv=<serverId>, for a push
// from dm-push, T-971, which knows only the conversation), which the page reads at start-up.
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const data = e.notification.data || {}
  const otherId = data.otherId
  const serverId = data.serverId
  const hash = otherId ? '#dm=' + encodeURIComponent(otherId) : serverId ? '#dmsv=' + encodeURIComponent(serverId) : ''
  const msg = otherId ? { type: 'open-dm', otherId } : serverId ? { type: 'open-dm-server', serverId } : null
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const win = list.find((c) => c.url.startsWith(self.registration.scope))
      if (!win) return self.clients.openWindow(self.registration.scope + hash)
      const shown = win.focus ? win.focus() : Promise.resolve(win)
      return shown.then((c) => (msg ? (c || win).postMessage(msg) : undefined))
    })
  )
})

// a Web Push from dm-push (T-971): a DM came in while the app is closed. Nothing is shown when a page of the app is on
// screen (notify.ts shows that one itself, and not twice). Otherwise it is a notification, as notify.ts makes them.
self.addEventListener('push', (e) => {
  let d = {}
  try {
    d = e.data ? e.data.json() : {}
  } catch {
    d = {}
  }
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      if (list.some((c) => c.visibilityState === 'visible')) return undefined
      return self.registration.showNotification(d.title || 'DM', {
        body: d.body || '',
        tag: d.server_id ? 'dm-' + d.server_id : undefined,
        data: { serverId: d.server_id },
        icon: './icon-256.png',
        badge: './icon-256.png',
      })
    })
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => (k.startsWith('dcneo-mobile-') && k !== CACHE) || (k.startsWith('dcneo-assets-') && k !== ASSETS)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || !req.url.startsWith(self.registration.scope)) return
  // any page of the app is the app (index.html as kept)
  if (req.mode === 'navigate') {
    e.respondWith(caches.match(self.registration.scope, { cacheName: CACHE }).then((hit) => hit || fetch(req)))
    return
  }
  const path = req.url.slice(self.registration.scope.length)
  if (ASSET_DIRS.some((d) => path.startsWith(d))) {
    e.respondWith(
      caches.open(ASSETS).then((c) =>
        c.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok) void c.put(req, res.clone()).catch(() => {})
              return res
            })
        )
      )
    )
    return
  }
  e.respondWith(caches.match(req, { cacheName: CACHE }).then((hit) => hit || fetch(req)))
})
