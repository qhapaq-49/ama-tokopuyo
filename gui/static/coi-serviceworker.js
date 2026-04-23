/* coi-serviceworker: adds COOP/COEP headers via service worker for SharedArrayBuffer */

if (typeof window === 'undefined') {
  // ── Service Worker context ──────────────────────────────────────────────
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

  self.addEventListener('fetch', e => {
    if (e.request.cache === 'only-if-cached' && e.request.mode !== 'same-origin') {
      return;
    }
    e.respondWith(
      fetch(e.request).then(r => {
        const h = new Headers(r.headers);
        h.set('Cross-Origin-Opener-Policy', 'same-origin');
        h.set('Cross-Origin-Embedder-Policy', 'require-corp');
        h.set('Cross-Origin-Resource-Policy', 'cross-origin');
        return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
      })
    );
  });

} else {
  // ── Page context: register the SW and reload once ──────────────────────
  (function () {
    if (window.crossOriginIsolated) return;
    if (!window.isSecureContext) return;
    if (!('serviceWorker' in navigator)) return;

    const src = document.currentScript.src;

    navigator.serviceWorker.register(src, { scope: './' })
      .then(reg => {
        function reload() {
          if (sessionStorage.getItem('coi-reloaded')) return;
          sessionStorage.setItem('coi-reloaded', '1');
          window.location.reload();
        }

        if (reg.installing) {
          reg.installing.addEventListener('statechange', e => {
            if (e.target.state === 'activated') reload();
          });
        } else if (reg.waiting) {
          reg.waiting.postMessage('skipWaiting');
          reg.waiting.addEventListener('statechange', e => {
            if (e.target.state === 'activated') reload();
          });
        } else {
          reload();
        }
      })
      .catch(e => console.error('[coi-sw]', e));
  })();
}
