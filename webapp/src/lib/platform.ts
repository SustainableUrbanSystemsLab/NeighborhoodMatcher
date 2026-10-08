// Where is this copy running? The desktop app (Tauri) serves the same build
// from the local machine: no service worker, no update prompt, files saved
// straight into the Downloads folder, and links to other sites handed to the
// system browser instead of navigating the app window.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export function isDesktopApp(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

/**
 * Evidence for the desktop self-test (desktop-selftest.ts), gathered from the
 * first moment the bundle runs: whether index.html's inline theme script ran
 * under the app's CSP (it sets data-theme before any of this code), and every
 * CSP violation reported afterwards.
 */
export const cspEvidence = { themeScriptRan: false, violations: [] as string[] };

export function watchCsp(): void {
  if (!isDesktopApp()) return;
  cspEvidence.themeScriptRan = document.documentElement.hasAttribute("data-theme");
  document.addEventListener("securitypolicyviolation", (e) => {
    cspEvidence.violations.push(`${e.violatedDirective} ${e.blockedURI}`);
  });
}

/**
 * Saves a generated file. In the browser this is an ordinary download
 * (returns null — the browser shows where it went). In the desktop app the
 * bytes go to the Rust `save_download` command, which writes them to the
 * Downloads folder without overwriting anything and returns the full path
 * for the page to show: the webview's own download handling cannot be
 * relied on there (WKWebView cancels downloads without a handler).
 */
export async function saveFile(blob: Blob, filename: string): Promise<string | null> {
  if (isDesktopApp()) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return invoke<string>("save_download", bytes, { headers: { "x-filename": filename } });
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Release the object URL on the next tick so the click completes first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return null;
}

/**
 * In the desktop app, clicks on links to another origin (citations, the
 * repository, release downloads) open in the user's default browser; the
 * app window itself never leaves the app. No-op on the web.
 */
export function installExternalLinkHandler(): void {
  if (!isDesktopApp()) return;
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = (event.target as Element | null)?.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;
    let url: URL;
    try {
      url = new URL(anchor.href, window.location.href);
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol) || url.origin === window.location.origin) return;
    event.preventDefault();
    // Static import: the request reaches the app in the same tick as the
    // click, with no chunk to load first.
    void openUrl(url.href);
  });
}
