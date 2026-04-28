// Service Worker v4 — PWA caching with network-first (navigation) + cache-first (assets)
const CACHE_VERSION = 'nukebg-v5';

// URLs that must NEVER be cached (ML model + CDN assets)
const EXCLUDED_PATTERNS = [
  'huggingface.co',
  'cdn-lfs',
  'cdn.jsdelivr.net',
];

// App shell to pre-cache on install
const APP_SHELL = ['/', '/index.html'];

function isExcluded(url) {
  return EXCLUDED_PATTERNS.some((pattern) => url.includes(pattern));
}

function isNavigationRequest(request) {
  return request.mode === 'navigate';
}

function isHashedAsset(url) {
  // Vite outputs files like /assets/index-CgG6YtGA.js (base64url hashes, not hex)
  return /\/assets\/[^/]+-[a-zA-Z0-9_-]{8,}\.(js|css)$/.test(url);
}

function isFontRequest(url) {
  return url.includes('/fonts/');
}

function isStaticAsset(url) {
  return (
    isHashedAsset(url) ||
    isFontRequest(url) ||
    /\.(svg|png|ico|webp|woff2?)(\?.*)?$/.test(url)
  );
}

// Install: pre-cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: purge old version caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key))
        )
      )
  );
  self.clients.claim();
});

// Fetch: route requests through appropriate strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = request.url;

  // Skip excluded URLs entirely — let them go straight to network
  if (isExcluded(url)) return;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  if (isNavigationRequest(request)) {
    // Network-first for navigation so a new release shows up on the very next
    // load instead of one navigation late. Hashed asset URLs in the fresh HTML
    // never collide with cached ones, so cache-first below stays safe.
    event.respondWith(networkFirst(request));
  } else if (isStaticAsset(url)) {
    // Cache-first for hashed assets, fonts, and static files
    event.respondWith(cacheFirst(request));
  }
  // All other requests go to network (no caching)
});

// Strategy: network-first (cache fallback for offline)
async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (_err) {
    const cachedResponse = await cache.match(request);
    return cachedResponse || new Response('Offline', { status: 503 });
  }
}

// Strategy: cache-first
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) return cachedResponse;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (_err) {
    return new Response('Network error', { status: 503 });
  }
}
