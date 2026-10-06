// Service worker: makes the app open with no signal, and keeps map tiles,
// fonts and styles that have been seen (or downloaded in Settings) for offline use.

const VERSION = '1.1.2';
const SHELL_CACHE = `dtr-shell-${VERSION}`;
const MAP_CACHE = 'dtr-map-v1';
const MAP_CACHE_MAX = 6000;

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'vendor/maplibre-gl/maplibre-gl.js',
  'vendor/maplibre-gl/maplibre-gl.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'data/centres/index.json',
  'data/centres/nottingham-chilwell.json',
  'data/centres/tamworth-polesworth.json',
  'js/app.js',
  'js/version.js',
  'js/device/gps.js',
  'js/device/nosleep-media.js',
  'js/device/voice.js',
  'js/device/wakelock.js',
  'js/lib/events.js',
  'js/lib/geo.js',
  'js/lib/idb.js',
  'js/lib/net.js',
  'js/lib/polyline.js',
  'js/lib/storage.js',
  'js/lib/sun.js',
  'js/lib/units.js',
  'js/nav/guidance.js',
  'js/nav/instructions.js',
  'js/nav/route-model.js',
  'js/nav/session.js',
  'js/nav/tracker.js',
  'js/services/centres.js',
  'js/services/compiler.js',
  'js/services/geocode.js',
  'js/services/offline.js',
  'js/services/router.js',
  'js/services/snapper.js',
  'js/services/speedlimits.js',
  'js/services/uturns.js',
  'js/ui/centres.js',
  'js/ui/dom.js',
  'js/ui/editor.js',
  'js/ui/home.js',
  'js/ui/icons.js',
  'js/ui/map.js',
  'js/ui/navigate.js',
  'js/ui/preview.js',
  'js/ui/record.js',
  'js/ui/settings.js',
];

/** Must match tileCacheKey() in js/services/offline.js. */
function tileCacheKey(url) {
  const m = /^(https:\/\/tiles\.openfreemap\.org\/planet)\/[^/]+\/(\d+\/\d+\/\d+\.pbf)/.exec(url);
  return m ? `${m[1]}/_/${m[2]}` : url;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('dtr-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

async function networkFirst(request, fallbackUrl, ms = 4000) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await Promise.race([fetch(request), timeout(ms)]);
    if (res && res.ok) {
      cache.put(fallbackUrl || request, res.clone());
      return res;
    }
    throw new Error(`HTTP ${res && res.status}`);
  } catch (err) {
    const cached = await cache.match(fallbackUrl || request, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) {
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, res.clone());
  }
  return res;
}

let putsSincePrune = 0;

async function pruneMapCache(cache) {
  if (++putsSincePrune < 200) return;
  putsSincePrune = 0;
  const keys = await cache.keys();
  const excess = keys.length - MAP_CACHE_MAX;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

async function tile(event) {
  const request = event.request;
  const key = tileCacheKey(request.url);
  const cache = await caches.open(MAP_CACHE);
  const cached = await cache.match(key);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) {
    event.waitUntil(cache.put(key, res.clone()).then(() => pruneMapCache(cache)));
  }
  return res;
}

async function staleWhileRevalidate(event) {
  const request = event.request;
  const cache = await caches.open(MAP_CACHE);
  const cached = await cache.match(request);
  const update = fetch(request).then((res) => {
    if (res.ok) return cache.put(request, res.clone()).then(() => res);
    return res;
  });
  if (cached) {
    event.waitUntil(update.catch(() => {}));
    return cached;
  }
  return update;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') {
      event.respondWith(networkFirst(request, 'index.html'));
    } else if (url.pathname.includes('/data/')) {
      event.respondWith(networkFirst(request));
    } else {
      event.respondWith(cacheFirst(request));
    }
    return;
  }

  if (url.hostname === 'tiles.openfreemap.org') {
    if (url.pathname.startsWith('/planet/') && url.pathname.endsWith('.pbf')) event.respondWith(tile(event));
    else event.respondWith(staleWhileRevalidate(event));
    return;
  }

  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(tile(event));
  }
  // Routing, place search and map-data APIs go straight to the network.
});
