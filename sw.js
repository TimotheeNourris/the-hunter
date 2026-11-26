/* =========================================================================
   The Hunter — service worker (application installable, v0.12)
   -------------------------------------------------------------------------
   Stratégie :
   - fichiers du site : réseau d'abord, copie en cache ; hors ligne, on sert
     la dernière copie (le site affiche alors la date des données) ;
   - polices Google : cache d'abord (elles ne changent pas) ;
   - rien d'autre n'est intercepté (aucune requête vers des tiers).
   Changer CACHE à chaque version pour purger les anciennes copies.
   ========================================================================= */
const CACHE = 'thehunter-v0.20.0';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/dataset.js',
  './js/data.js',
  './js/calendar.js',
  './js/hunter.js',
  './js/store.js',
  './js/releve.js',
  './js/app.js',
  './assets/favicon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png',
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('thehunter-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  } else if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req));
  }
});
