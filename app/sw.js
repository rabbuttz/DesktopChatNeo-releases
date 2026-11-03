// The phone app's service worker (T-696). vite.config.ts fills in the build stamp and this build's own files below and
// writes it out as sw.js. It keeps the app itself, so the app opens without waiting for the network, and never touches
// anything from elsewhere (Supabase: sign-in, chat, pictures — always the network). A new build waits until the page
// says to go on (its 更新があります), then takes over and the page reloads.
const CACHE = 'dcneo-mobile-mw0kxqnm'
const FILES = [...["./","./assets/index-fP1Ip1UM.js","./assets/index-BZ_GWIMI.css"], './manifest.webmanifest', './icon-256.png', './icon-512.png']

self.addEventListener('install', (e) => {
  // past the HTTP cache: an index.html a few minutes old would point at the last build's files
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))))
})

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('dcneo-mobile-') && k !== CACHE).map((k) => caches.delete(k))))
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
  e.respondWith(caches.match(req, { cacheName: CACHE }).then((hit) => hit || fetch(req)))
})
