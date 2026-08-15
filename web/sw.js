// Offline app shell. History must open with no network. The Deepgram socket is
// wss:// and never passes through here; sw.js itself is served no-cache (see
// vercel.json) so shell updates are picked up on next load.

const VERSION = "tiro-v1";
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "styles/tokens.css",
  "styles/app.css",
  "src/app.js",
  "src/audio.js",
  "src/bridge.js",
  "src/deepgram.js",
  "src/history.js",
  "src/settings.js",
  "src/tokens.js",
  "src/usage.js",
  "worklets/pcm-processor.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "icons/icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // stale-while-revalidate: serve the cached shell instantly, refresh in the background
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const refresh = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || refresh;
    })
  );
});
