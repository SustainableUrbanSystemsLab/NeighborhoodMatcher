// Service worker: caches the Pyodide runtime so it downloads once per device
// instead of once per visit.
//
// SCOPE, deliberately narrow — this worker only ever touches the pinned
// Pyodide CDN URLs (runtime, stdlib, numpy wheel: ~15 MB, public, immutable
// because the version is in the path). It does NOT cache:
//   - anything of the user's. Dataset contents never travel over HTTP in this
//     app; they live in memory and postMessage. There is nothing here to leak.
//   - the app's own HTML/JS/CSS, so a deploy is never served stale.
//   - /matcher/*.py, which DOES change per deploy. Serving a stale engine
//     next to a fresh UI would compute results with the wrong code — the one
//     failure mode worth more than the few kilobytes it would save.
//
// Cache-first, with a network fallback: after the first visit the runtime
// loads instantly, and it keeps working on networks that block jsDelivr
// (some campus and hospital networks do), which is the other half of why
// this exists.

const BUILD = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = `pyodide-runtime-${BUILD}`;
const RUNTIME_PREFIX = "https://cdn.jsdelivr.net/pyodide/";

self.addEventListener("install", (event) => {
  // Take over as soon as this build's worker is ready; the previous one only
  // held CDN assets, so there is no in-flight state to preserve.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from older builds (and from older cache-name schemes).
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("pyodide-runtime-") && n !== CACHE)
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !request.url.startsWith(RUNTIME_PREFIX)) {
    return; // everything else goes straight to the network, untouched
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;

      const response = await fetch(request);
      // Opaque (no-cors) responses can't be validated, so only store real
      // successes; a cached error would be poison until the next deploy.
      if (response.ok && response.type !== "opaque") {
        cache.put(request, response.clone()).catch(() => {
          /* quota or private mode — serving from network is still correct */
        });
      }
      return response;
    })().catch(() => fetch(request))
  );
});
