// Registers the precaching service worker (src/sw.ts) and exposes its state
// to the UI: whether this device can now run the app offline, and whether a
// newer build is waiting for a reload.
//
// Production only: in dev the worker would sit between Vite's HMR and the
// page for no benefit. Skipped inside the desktop app, where everything is
// local already and the tauri:// scheme has no service workers.

import { useSyncExternalStore } from "react";
import { registerSW } from "virtual:pwa-register";
import { isDesktopApp } from "@/lib/platform";

export type OfflineStatus =
  /** no service worker here (dev build, desktop app, unsupported browser) */
  | { kind: "unavailable" }
  /** worker registered; the first precache is still downloading */
  | { kind: "installing" }
  /** every file the app needs is cached — works offline on this device */
  | { kind: "ready" }
  /** a newer build is waiting; `apply` reloads into it */
  | { kind: "update-available"; apply: () => void };

let status: OfflineStatus = { kind: "unavailable" };
const listeners = new Set<() => void>();

function setStatus(next: OfflineStatus): void {
  status = next;
  for (const fn of listeners) fn();
}

export function getOfflineStatus(): OfflineStatus {
  return status;
}

/** React hook: the current offline/update state, re-rendering on change. */
export function useOfflineStatus(): OfflineStatus {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getOfflineStatus,
    getOfflineStatus
  );
}

export function registerRuntimeCache(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (isDesktopApp()) return;

  let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
  updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      // A controller already present means this device was precached by an
      // earlier visit; otherwise the first install is in progress.
      if (navigator.serviceWorker.controller && !registration?.installing) {
        setStatus({ kind: "ready" });
      } else {
        setStatus({ kind: "installing" });
      }
    },
    onOfflineReady() {
      setStatus({ kind: "ready" });
    },
    onNeedRefresh() {
      setStatus({
        kind: "update-available",
        apply: () => {
          void updateSW?.(true);
        },
      });
    },
    onRegisterError(err) {
      // Not fatal: without the worker the app simply needs the network.
      console.warn("Offline cache unavailable:", err);
      setStatus({ kind: "unavailable" });
    },
  });
}
