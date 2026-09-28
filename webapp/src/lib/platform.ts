// Where is this copy running? The desktop app (Tauri) serves the same build
// from the local machine: no service worker, no update prompt, and external
// links handed to the system browser instead of navigating the app window.

import { isTauri } from "@tauri-apps/api/core";

export function isDesktopApp(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

/**
 * In the desktop app, clicks on http(s) links that target a new tab open in
 * the user's default browser (the webview has no tabs). No-op on the web.
 */
export function installExternalLinkHandler(): void {
  if (!isDesktopApp()) return;
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = (event.target as Element | null)?.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const url = anchor.href;
    if (!/^https?:/.test(url) || anchor.target !== "_blank") return;
    event.preventDefault();
    void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url));
  });
}
