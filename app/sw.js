// The phone app's service worker (T-696). vite.config.ts fills in the build stamp and this build's own files below and
// writes it out as sw.js. It keeps the app itself, so the app opens without waiting for the network, and never touches
// anything from elsewhere (Supabase: sign-in, chat, pictures — always the network). A new build waits until the page
// says to go on (its 更新があります), then takes over and the page reloads.
const CACHE = 'dcneo-mobile-mwdjkxcn'
const FILES = [...["./","./assets/index-LeP5BR9-.js","./assets/stage-DFgiUlM-.js","./assets/tracking-DjmOJaUN.js","./assets/vision_bundle-CFYn_opW.js","./assets/index-DUImnFtD.css","./assets/tracking-worker-cxzFxgBs.js"], './manifest.webmanifest', './icon-256.png', './icon-512.png']
// The avatar's big files (T-697: MediaPipe's wasm, the face model, the desk's keyboard and animations; vite.config.ts
// copies them in): not fetched on install, kept the first time they are used, and kept across builds (they rarely
// change; a new set comes with a new name here)
const ASSETS = 'dcneo-assets-1'
const ASSET_DIRS = ['mediapipe/', 'models/', 'anims/']

self.addEventListener('install', (e) => {
  // past the HTTP cache: an index.html a few minutes old would point at the last build's files
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))))
})

// The number on the app's icon (T-1409, badge.ts): the page sends it whenever it changes and it is kept here (in a
// cache of its own, which survives new builds), so a DM push while the app is closed adds one to it.
const BADGE = 'dcneo-badge'
const BADGE_KEY = './__badge'

function readBadge() {
  return caches
    .open(BADGE)
    .then((c) => c.match(BADGE_KEY))
    .then((r) => (r ? r.text() : '0'))
    .then((t) => Math.max(0, parseInt(t, 10) || 0))
    .catch(() => 0)
}

function keepBadge(n) {
  return caches
    .open(BADGE)
    .then((c) => c.put(BADGE_KEY, new Response(String(n))))
    .catch(() => {})
}

/** one more unread DM while the app isn't on screen: the icon's number goes up (where there are icon numbers) */
function badgeUp() {
  if (typeof self.navigator.setAppBadge !== 'function') return Promise.resolve()
  return readBadge().then((n) =>
    keepBadge(n + 1).then(() => self.navigator.setAppBadge(n + 1).catch(() => {}))
  )
}

// The DM conversation open on screen now (T-1408, notify.ts followDmOnScreen): the page sends it when it changes, so a
// push for it is not left as a notification. Kept only while the worker runs; lost, a push is shown as usual.
let dmOnScreen = null

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting()
  if (e.data && e.data.type === 'badge' && typeof e.data.n === 'number') e.waitUntil(keepBadge(Math.max(0, e.data.n)))
  if (e.data && e.data.type === 'dm-on-screen') dmOnScreen = typeof e.data.serverId === 'string' ? e.data.serverId : null
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

// a Web Push from dm-push (T-971): a DM came in. Every push shows a notification, even while the app is on screen
// (T-1408): iOS takes the push subscription back from an app whose pushes show nothing, and then no DM notice comes
// while the app is closed. So, with the app on screen:
// - that conversation is open: the notification is shown silently and closed at once (nothing is left);
// - notify.ts has already shown this message (same tag, same messageId): it is shown again silently in its place, so
//   it is still one notification and makes no second sound (notify.ts, coming second, skips it the same way).
// With the app not on screen it is a notification as notify.ts makes them, and the icon's number goes up by one
// (T-1409; the page sets the right number again when it comes back).
self.addEventListener('push', (e) => {
  let d = {}
  try {
    d = (e.data ? e.data.json() : {}) || {}
  } catch {
    d = {}
  }
  const serverId = typeof d.server_id === 'string' ? d.server_id : undefined
  const messageId = typeof d.message_id === 'string' ? d.message_id : undefined
  const tag = serverId ? 'dm-' + serverId : 'dm'
  const opts = {
    body: d.body || '',
    tag,
    data: { serverId, messageId },
    icon: './icon-256.png',
    badge: './icon-256.png',
  }
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const onScreen = list.some((c) => c.visibilityState === 'visible')
      if (!onScreen) return Promise.all([self.registration.showNotification(d.title || 'DM', opts), badgeUp()])
      if (serverId && dmOnScreen === serverId) {
        return self.registration
          .showNotification(d.title || 'DM', { ...opts, silent: true })
          .then(() => self.registration.getNotifications({ tag }))
          .then((ns) => ns.forEach((n) => n.close()))
          .catch(() => {})
      }
      return self.registration
        .getNotifications({ tag })
        .catch(() => [])
        .then((ns) => {
          const shown = messageId ? ns.find((n) => n.data && n.data.messageId === messageId) : undefined
          if (!shown) return self.registration.showNotification(d.title || 'DM', opts)
          // the page's one knows who wrote it (otherId, for opening the DM): it is kept as it was
          return self.registration.showNotification(shown.title, { ...opts, body: shown.body, data: shown.data, silent: true })
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
