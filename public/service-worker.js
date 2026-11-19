const CACHE_NAME = "antardrishti-static-v1";
const STATIC_ASSETS = ["/manifest.webmanifest", "/antardrishti-mark.svg"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(key => key.startsWith("antardrishti-") && key !== CACHE_NAME).map(key => caches.delete(key)))
  ).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/outputs/")) return;
  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
  }
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => new Response(
      "<!doctype html><meta name='viewport' content='width=device-width'><title>Offline</title><body style='font:16px system-ui;background:#0d1421;color:#edf2f8;padding:24px'><h2>Antardrishti is offline</h2><p>Dashboard खोलने के लिए internet connection चालू करें। Login और video files offline cache नहीं किए जाते।</p></body>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
    )));
  }
});
