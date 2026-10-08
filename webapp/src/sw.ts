// Service worker: makes the app usable with no Internet after one visit.
//
// WHAT IS CACHED — the whole build as ONE versioned unit: the app shell
// (index.html, JS, CSS), the matcher's Python sources (/matcher/*.py), the
// self-hosted Pyodide runtime and numpy wheel (/pyodide/v<version>/*), the
// logo, icons and explanatory PDFs. vite-plugin-pwa injects the list
// (self.__WB_MANIFEST) with a content hash per file at build time, so a
// deploy produces a new precache and Workbox drops the old one.
//
// WHAT IS NEVER CACHED — anything of the user's. Dataset contents never
// travel over HTTP in this app (they live in memory and postMessage), so
// there is nothing here to leak.
//
// WHY "PROMPT" RATHER THAN AUTO-UPDATE — the engine (/matcher/*.py) and the
// UI must always come from the same build: workers are created lazily, so a
// worker spun up mid-session must load the same engine the page started
// with. A new build therefore waits (no skipWaiting) until the page asks
// for it — the footer shows "Reload to update" and the reload switches UI
// and engine together.
//
// Not used by the desktop app: everything there is local already, and the
// tauri:// scheme has no service workers (runtime-cache.ts skips it).

/// <reference lib="webworker" />

import { clientsClaim } from "workbox-core";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare let self: ServiceWorkerGlobalScope;

// The page (virtual:pwa-register's updateSW) posts this when the user
// chooses to reload into the new build.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// Legacy: builds before 0.9.0 cached the Pyodide CDN under this prefix.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n.startsWith("pyodide-runtime-"))
          .map((n) => caches.delete(n))
      )
    )
  );
});

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
clientsClaim();

// Client-side routes (/match, /about) reload offline via the shell.
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html")));
