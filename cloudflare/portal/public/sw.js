// Minimal service worker — its only job is to exist with a fetch handler so the
// admin portal meets the PWA installability bar. The handler is a pass-through:
// the browser fetches normally, nothing is cached.
// ponytail: no offline cache — admin portal is online-only (it talks to D1/Stripe
// live). Add a cache-first shell here if offline admin ever becomes a requirement.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // Intentionally no respondWith — defer to default network handling.
});
