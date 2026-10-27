// Service worker: lets C.A.S.H open offline and receive shared screenshots.
const CACHE = 'cash-v22';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css',
  'js/app.js', 'js/store.js', 'js/util.js', 'js/ui.js', 'js/views.js', 'js/sheets.js',
  'js/flows.js', 'js/calc.js', 'js/categorise.js', 'js/charts.js', 'js/demo.js', 'js/sync.js', 'js/config.js', 'js/detect.js', 'js/pdfimport.js', 'js/year.js', 'js/wrapped.js',
  'icons/logo.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== 'cash-share' && k !== 'cash-cdn').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Android "Share → C.A.S.H": stash the image, then open the app to read it.
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      const form = await e.request.formData();
      const file = form.get('image');
      if (file) await (await caches.open('cash-share')).put('shared-image', new Response(file, { headers: { 'content-type': file.type } }));
      return Response.redirect('./#shared', 303);
    })());
    return;
  }
  if (e.request.method !== 'GET') return;

  // Libraries from the CDN: cache first (they're version-pinned).
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.open('cash-cdn').then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }

  // The app itself: network first so updates show straight away, cache when offline.
  if (url.origin === location.origin) {
    // no-cache = always ask the server whether a file changed, so updates are never missed
    const fresh = e.request.mode === 'navigate' ? fetch(e.request.url, { cache: 'no-cache' }) : fetch(e.request, { cache: 'no-cache' });
    e.respondWith(fresh.then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  }
});
