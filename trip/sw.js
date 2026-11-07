const CACHE_VERSION = "my-travels-shell-v20";
const APP_SHELL = [
  "/trip/",
  "/trip/index.html",
  "/trip/css/trip.css",
  "/trip/js/trip.js",
  "/trip/js/activity-navigation.js",
  "/trip/js/destination-presentation.js",
  "/trip/js/offline-vault.js",
  "/trip/js/pending-sync.js",
  "/trip/manifest.webmanifest",
  "/trip/icons/apple-touch-icon.png",
  "/trip/icons/icon-192.png",
  "/trip/icons/icon-512.png",
  "/trip/icons/my-travels-globe.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin === self.location.origin && requestUrl.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then(async (response) => {
        if (response.ok && requestUrl.origin === self.location.origin) {
          const copy = response.clone();
          const cache = await caches.open(CACHE_VERSION);
          await cache.put(event.request, copy);
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/trip/")))
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_URLS") return;
  const urls = Array.isArray(event.data.urls) ? event.data.urls : [];
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(async (cache) => {
        const results = [];
        for (const url of urls) {
          try {
            const parsed = new URL(url, self.location.origin);
            if (parsed.origin === self.location.origin && parsed.pathname.startsWith("/api/")) {
              throw new Error("Protected API responses are not stored in Cache Storage");
            }
            const response = await fetch(url, { credentials: "same-origin" });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            await cache.put(url, response);
            results.push({ url, ok: true });
          } catch (error) {
            results.push({ url, ok: false, message: error.message });
          }
        }
        return results;
      })
      .then((results) => event.source?.postMessage({ type: "CACHE_COMPLETE", results }))
  );
});
