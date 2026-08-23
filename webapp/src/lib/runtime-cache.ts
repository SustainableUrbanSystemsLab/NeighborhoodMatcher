// Registers the Pyodide-runtime service worker (public/sw.js).
//
// Production only: in dev the worker would sit between Vite's HMR and the
// page for no benefit, and the runtime is usually already warm there.
//
// The registration URL carries the build id so a deploy installs a fresh
// worker, which then evicts the previous build's cache on activate.

import { BUILD } from "@/lib/about";

export function registerRuntimeCache(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(BUILD.commit)}`, { scope: "/" })
      .catch((err) => {
        // Not fatal: without the worker the runtime simply downloads again.
        console.warn("Runtime cache unavailable:", err);
      });
  });
}
