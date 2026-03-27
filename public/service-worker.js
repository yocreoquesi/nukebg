// Service Worker v2 — cache-busting version bump to clear stale CSP responses
// Model caching handled by HTTP cache headers. SW only does cleanup.
const SW_VERSION = 2;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  // Clean up ALL caches to purge any responses with stale CSP headers
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
  );
  self.clients.claim();
});
