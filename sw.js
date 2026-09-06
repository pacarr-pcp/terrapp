/* TerrApp B2 — service worker. Cachea el "app shell" para uso offline.
   Sube la versión (CACHE) cada vez que cambies un archivo del shell. */
const CACHE = 'terrapp-v7';
const SHELL = [
  './', './index.html', './styles.css', './app.js',
  './manifest.webmanifest', './icon.svg', './data/pesos.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // los POST al backend nunca se cachean
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;       // deja pasar el llamado a Apps Script

  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(()=>{});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
