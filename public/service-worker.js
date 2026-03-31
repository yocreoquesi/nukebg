// Service Worker v3 — PWA caching with stale-while-revalidate + cache-first
const CACHE_VERSION = 'nukebg-v3';

// URLs that must NEVER be cached (ML model downloads)
const EXCLUDED_PATTERNS = [
  'github.com',
  'githubusercontent.com',
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
  // Vite outputs files like /assets/index-abc123.js or /assets/style-def456.css
  return /\/assets\/[^/]+\.[a-f0-9]{8,}\.(js|css)$/.test(url);
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
    // Stale-while-revalidate for navigation
    event.respondWith(staleWhileRevalidate(request));
  } else if (isStaticAsset(url)) {
    // Cache-first for hashed assets, fonts, and static files
    event.respondWith(cacheFirst(request));
  }
  // All other requests go to network (no caching)
});

// Strategy: stale-while-revalidate
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cachedResponse = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cachedResponse);

  return cachedResponse || networkFetch;
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
