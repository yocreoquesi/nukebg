// Auto-recovery: if main JS fails to load within 5 seconds (e.g. a stale
// Service Worker is serving a broken cache bundle), clear all caches and
// reload so the fresh network copy can run. Externalized from index.html
// so CSP can drop script-src 'unsafe-inline' without losing this escape
// hatch. The file is tiny and served once per navigation.
setTimeout(function () {
  if (document.getElementById('seo-content') && 'serviceWorker' in navigator) {
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.map(function (k) {
            return caches.delete(k);
          }),
        );
      })
      .then(function () {
        location.reload();
      });
  }
}, 5000);
