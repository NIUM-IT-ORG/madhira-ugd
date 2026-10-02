// Minimal service worker: makes the app installable and opens it quickly on slow connections.
// Only the app's own files are cached. API calls, map data and photos always go to the server.
const CACHE = 'ugd-shell-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/favicon.svg', '/manifest.webmanifest'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/data/')) return;
  // Hashed build files, glyphs and the map worker never change under the same name: cache first.
  if (/^\/(assets|glyphs|vendor)\//.test(url.pathname)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
      return res;
    })));
    return;
  }
  // Pages: network first, cached shell when offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then((res) => {
      caches.open(CACHE).then((c) => c.put('/', res.clone()));
      return res;
    }).catch(() => caches.match('/')));
  }
});
