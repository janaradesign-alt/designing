/* Hindsight service worker.
   Caches the app shell so it opens instantly and works offline.
   API responses are never cached, so no personal data is stored by the worker. */
const VERSION = "hindsight-v1";
const SHELL = [
  "/", "/css/app.css", "/js/app.js", "/js/core.js", "/js/router.js", "/js/views-auth.js", "/js/views-main.js", "/js/views-share.js",
  "/js/views-inbox.js", "/js/views-me.js", "/fonts/newsreader-latin-wght-normal.woff2", "/fonts/newsreader-latin-wght-italic.woff2",
  "/fonts/figtree-latin-wght-normal.woff2", "/icons/icon.svg", "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname === "/healthz") return;
  // Network first, so updates arrive immediately. Fall back to the cache when offline.
  event.respondWith(
    fetch(req).then((res) => {
      if (res.ok && (url.pathname.match(/\.(js|css|woff2|svg|png|webmanifest)$/) || req.mode === "navigate")) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req.mode === "navigate" ? "/" : req, copy));
      }
      return res;
    }).catch(() => caches.match(req.mode === "navigate" ? "/" : req).then((hit) => hit || Response.error()))
  );
});
