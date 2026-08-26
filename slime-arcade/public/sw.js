// Bump this on any deploy whose change must be audible/visible on the FIRST
// launch rather than the second. The fetch handler below is
// stale-while-revalidate, which means a returning visitor is normally served
// the previously cached page and only picks up a new deploy on the launch
// after next. That is fine for a tweak and actively misleading for a fix you
// are trying to verify -- it looks like the deploy did nothing. Renaming the
// cache empties it, so the next launch goes to the network for everything.
const CACHE = "slime-arcade-v2";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate for same-origin GETs: instant load from cache
// (so it opens offline / on flaky wifi), refreshed in the background on
// every visit so the next launch picks up new deploys automatically.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) return;

  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    )
  );
});
