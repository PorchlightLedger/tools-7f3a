// Service worker: cache-first, versioned cache. CACHE and the file list are stamped by tools/stamp.js.
const CACHE = 'dispatch-d6bc820035';
const FILES = ["./","./css/app.css","./icons/apple-touch-icon.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./index.html","./js/app.js","./js/backup.js","./js/banners.js","./js/chalk.js","./js/csv.js","./js/ctx.js","./js/dispatchxlsx.js","./js/dom.js","./js/form5988.js","./js/gcss.js","./js/pdf.js","./js/photos.js","./js/photoui.js","./js/pickers.js","./js/readtable.js","./js/roster.js","./js/rules.js","./js/settingsio.js","./js/status.js","./js/store.js","./js/tmdata.js","./js/ui.js","./js/util.js","./js/version.js","./js/views/chalk.js","./js/views/dispatch.js","./js/views/exporter.js","./js/views/fleet.js","./js/views/form.js","./js/views/more.js","./js/views/override.js","./js/views/roster.js","./js/views/tmedit.js","./js/views/today.js","./js/views/walk.js","./js/vin.js","./js/xlsread.js","./js/xlsxread.js","./js/xlsxwrite.js","./js/zip.js","./manifest.webmanifest"];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))  /* bypass the HTTP cache (GitHub Pages sends max-age=600) so a new version never precaches stale files */.then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('dispatch-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== self.location.origin) return; // never touch cross-origin (the app makes none)
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') { const idx = await cache.match('./index.html'); if (idx) return idx; }
    try { const res = await fetch(req); if (res && res.ok && !url.pathname.endsWith('sw.js')) cache.put(req, res.clone()); return res; }
    catch (err) { if (req.mode === 'navigate') { const idx = await cache.match('./index.html'); if (idx) return idx; } return new Response('Offline', { status: 503, statusText: 'Offline' }); }
  })());
});
