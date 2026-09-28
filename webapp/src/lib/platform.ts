// Where is this copy running? The desktop app (Tauri) serves the same build
// from the local machine: no service worker, no update prompt, external
// links opened by the system browser.

import { isTauri } from "@tauri-apps/api/core";

export function isDesktopApp(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}
