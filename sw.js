/**
 * BallisticPro — Service Worker
 *
 * Goal: the app must open and calculate with NO signal (hunting / zeroing in the field)
 * and still pick up new versions automatically when there IS signal.
 *
 *  - install  : pre-cache the whole app shell + data (one download, ~0.7 MB).
 *  - code/data (html, js, css, json): NETWORK-FIRST with a short timeout, falling back to
 *    the cache. Online you always get the latest files (no more Ctrl+Shift+R); with bad or
 *    no signal the cached copy is served after NET_TIMEOUT_MS.
 *  - images / icons: CACHE-FIRST (they never change without a version bump).
 *
 * Bump CACHE_VERSION whenever the ASSETS list changes (old caches are deleted on activate).
 */
const CACHE_VERSION = 'v74';
const CACHE_NAME = 'ballisticpro-' + CACHE_VERSION;
const NET_TIMEOUT_MS = 3000;

const ASSETS = [
  './', 'index.html', 'manifest.json', 'css/main.css',
  'js/engine/conversions.js', 'js/engine/atmosphere.js',
  'js/engine/drag-models.js', 'js/engine/stability.js',
  'js/engine/coriolis.js', 'js/engine/solver.js',
  'js/engine/truing.js', 'js/engine/reticle.js',
  'js/engine/mpbr.js', 'js/engine/dope.js',
  'js/i18n.js', 'js/app.js',
  'js/ui/silhouettes.js', 'js/ui/reticle-view.js',
  'js/lib/chart.umd.min.js',
  'js/data/projectiles-firearms.json', 'js/data/projectiles-airgun.json',
  'js/data/weapons.json', 'js/data/scopes.json', 'js/data/reticles.json',
  'js/data/game-animals.json',
  'img/silhouettes/deer.png', 'img/silhouettes/bovine.png',
  'img/silhouettes/camelid.png', 'img/silhouettes/equine.png',
  'img/silhouettes/boar.png', 'img/silhouettes/rabbit.png',
  'img/silhouettes/bird.png', 'img/silhouettes/goat.png',
  'img/silhouettes/fox.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // cache: 'reload' bypasses the HTTP cache so we never precache stale files
      .then(cache => cache.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('ballisticpro-') && k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isStaticImage(url) {
  return /\.(png|jpg|jpeg|webp|svg|ico)$/i.test(url.pathname);
}

function cacheMatch(request) {
  return caches.match(request, { ignoreSearch: true });
}

function putInCache(event, request, response) {
  const copy = response.clone();
  event.waitUntil(caches.open(CACHE_NAME).then(c => c.put(request, copy)));
}

function cacheFirst(event) {
  const req = event.request;
  return cacheMatch(req).then(cached => {
    if (cached) return cached;
    return fetch(req).then(res => {
      if (res && res.ok) putInCache(event, req, res);
      return res;
    });
  });
}

function networkFirst(event) {
  const req = event.request;
  return new Promise(resolve => {
    let settled = false;
    const done = res => { if (!settled) { settled = true; resolve(res); } };

    // Weak signal: after the timeout serve the cached copy, but let the network finish
    // in the background so the cache is fresh for next time.
    const timer = setTimeout(() => {
      cacheMatch(req).then(cached => { if (cached) done(cached); });
    }, NET_TIMEOUT_MS);

    fetch(req, { cache: 'no-cache' })
      .then(res => {
        clearTimeout(timer);
        if (res && res.ok) putInCache(event, req, res);
        done(res);
      })
      .catch(() => {
        clearTimeout(timer);
        cacheMatch(req)
          .then(cached => cached || (req.mode === 'navigate' ? caches.match('index.html') : null))
          .then(cached => done(cached || Response.error()));
      });
  });
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;     // cross-origin: let the browser handle it

  event.respondWith(isStaticImage(url) ? cacheFirst(event) : networkFirst(event));
});
