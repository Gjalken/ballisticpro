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
const CACHE_VERSION = 'v81';
const CACHE_NAME = 'ballisticpro-' + CACHE_VERSION;
const NET_TIMEOUT_MS = 3000;

const ASSETS = [
  './', 'index.html', 'manifest.json', 'css/main.css',
  'fonts/inter-latin.woff2', 'fonts/inter-latin-ext.woff2',
  'fonts/jetbrains-mono-latin.woff2', 'fonts/jetbrains-mono-latin-ext.woff2',
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
  'img/silhouettes/bird.png', 'img/silhouettes/duck.png',
  'img/silhouettes/goat.png', 'img/silhouettes/fox.png',
  'img/silhouettes/beaver.png', 'img/silhouettes/muskrat.png',
  'img/silhouettes/goose.png', 'img/silhouettes/coot.png',
  'img/silhouettes/cormorant.png', 'img/silhouettes/quail.png',
  'img/silhouettes/partridge.png', 'img/silhouettes/pheasant.png',
  'img/silhouettes/raptor.png', 'img/silhouettes/parrot.png',
  'img/silhouettes/songbird.png', 'img/silhouettes/mink.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

const BASE_HREF = (self.registration && self.registration.scope) ? self.registration.scope : self.location.href;
const KNOWN_PATHS = new Set(ASSETS.map(a => new URL(a, BASE_HREF).pathname));

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
  return /\.(png|jpg|jpeg|webp|svg|ico|woff2)$/i.test(url.pathname);
}

function cacheMatch(request) {
  return caches.match(request, { ignoreSearch: true });
}

function putInCache(event, request, response) {
  if (!response || response.status !== 200 || response.type !== 'basic') return;
  const reqUrl = new URL(request.url);
  if (!KNOWN_PATHS.has(reqUrl.pathname)) return;
  const cleanUrl = reqUrl.origin + reqUrl.pathname;
  const copy = response.clone();
  event.waitUntil(caches.open(CACHE_NAME).then(c => c.put(cleanUrl, copy)));
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
        if (res && res.ok) { putInCache(event, req, res); done(res); return; }
        // Server answered with an error (404 if the site is taken down, 5xx, …): prefer the
        // cached copy so the installed app keeps working instead of showing an error page.
        cacheMatch(req)
          .then(cached => cached || (req.mode === 'navigate' ? caches.match('index.html') : null))
          .then(cached => done(cached || res));
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
