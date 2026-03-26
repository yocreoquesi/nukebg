// Service Worker disabled for now — model caching will be handled by HTTP cache headers
// This prevents interference with COOP/COEP and Worker loading in Firefox

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  // Clean up old caches
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
  );
  self.clients.claim();
});
