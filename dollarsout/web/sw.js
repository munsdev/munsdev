// Service worker for DollarsOut.
//
// Its job is to make the app installable and to survive a dead connection -- NOT to speed anything
// up by serving cached copies. Nothing in web/ is content-hashed, so a cache-first worker would
// pin whatever shell a visitor happened to install and quietly serve it back for weeks; that is
// exactly the stale-deploy problem we already chased down at the CDN layer, except a service
// worker sits closer to the user and outlives a hard refresh.
//
// So: network always wins. The cache is only ever read when the network actually fails.

const CACHE = "dollarsout-shell-v2";

// Enough to render something recognisable offline. Deliberately small -- every entry here is a
// file that could be served stale in an offline session, so it earns its place or stays out.
const SHELL = [
  "/",
  "/styles.css",
  "/js/app.js",
  "/js/api.js",
  "/js/i18n.js",
  "/js/config.js",
  "/js/state.js",
  "/i18n/en.json",
  "/icons/icon-192.png",
];

self.addEventListener("install", (event) => {
  // Take over straight away rather than waiting for every old tab to close, so a deploy is not
  // held hostage by a tab someone left open.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // addAll rejects the whole install if any single request fails; these are best-effort
      // offline fallbacks, so a miss must not block activation.
      Promise.allSettled(SHELL.map((url) => cache.add(url)))
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

/** Anything that is live state or changes the user's data must never be answered from a cache. */
function isApiRequest(url) {
  return [
    "/stats",
    "/catalog",
    "/ledger",
    "/me",
    "/auth/",
    "/claims",
    "/na/",
    "/checkins",
    "/share",
  ].some((p) => url.pathname === p || url.pathname.startsWith(p));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // fonts and the like: leave to the browser
  if (isApiRequest(url)) return;                   // always straight to the network, never cached

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        // Refresh the offline copy only for things we already decided to hold.
        if (response.ok && SHELL.includes(url.pathname)) {
          const cache = await caches.open(CACHE);
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        // Offline: fall back to whatever we have, and to the shell for a navigation so the app
        // opens rather than showing the browser's error page.
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const shell = await caches.match("/");
          if (shell) return shell;
        }
        throw new Error("offline and not cached");
      }
    })()
  );
});
