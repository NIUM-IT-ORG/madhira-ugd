// Service worker: makes the app installable, opens it quickly on slow connections, and lets field staff open
// it on site without signal (the last data they saw; saves wait in the outbox until the signal returns).
//
// - App page: network first; the last copy is kept for offline use.
// - Build files (/assets, names change with every build) and map glyphs: cache first.
// - Map worker (/vendor, names do not change between versions): network first.
// - Map data (/data, except satellite tiles) and the app's own data (GET /api/…): network first, last copy offline.
//   Satellite tiles (Range requests), photos, exports and live updates are never cached.
const SHELL = 'ugd-shell-v2';
const DATA = 'ugd-data'; // removed by the app when someone signs out
const MAX_ASSETS = 80;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/favicon.svg', '/manifest.webmanifest'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

/** Keep a copy of a good response; never store an error or an HTML page in place of a file. */
async function keep(cacheName, request, res, { html = false } = {}) {
  if (!res.ok || res.type !== 'basic' || res.status === 206) return;
  const type = res.headers.get('content-type') ?? '';
  if (html !== type.includes('text/html')) return;
  const c = await caches.open(cacheName);
  await c.put(request, res);
  if (cacheName === SHELL) {
    const keys = await c.keys();
    if (keys.length > MAX_ASSETS) await Promise.all(keys.slice(0, keys.length - MAX_ASSETS).filter((k) => new URL(k.url).pathname.startsWith('/assets/')).map((k) => c.delete(k)));
  }
}

const networkFirst = (e, cacheName, opts) =>
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone();
    e.waitUntil(keep(cacheName, opts?.key ?? e.request, copy, opts));
    return res;
  }).catch(() => caches.match(opts?.key ?? e.request).then((hit) => hit || Response.error())));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || req.headers.has('range')) return;
  const p = url.pathname;
  if (req.mode === 'navigate') return networkFirst(e, SHELL, { key: '/', html: true });
  if (/^\/(assets|glyphs)\//.test(p)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      e.waitUntil(keep(SHELL, req, copy));
      return res;
    })));
    return;
  }
  if (p.startsWith('/vendor/')) return networkFirst(e, SHELL);
  if (p.startsWith('/data/') && !p.endsWith('.pmtiles')) return networkFirst(e, DATA);
  if (p.startsWith('/api/') && !/^\/api\/(events|photos|export|admin|auth|health)/.test(p)) return networkFirst(e, DATA);
});
