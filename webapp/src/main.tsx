import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/App";
import { registerRuntimeCache } from "@/lib/runtime-cache";
import { installExternalLinkHandler, isDesktopApp } from "@/lib/platform";
import "./main.css";

// Precache the whole build so the app works offline after this visit
// (production only; skipped in the desktop app).
registerRuntimeCache();
// Desktop app only: external links open in the system browser.
installExternalLinkHandler();
// Desktop app only, and only when started with NBHDMATCH_SELFTEST (CI).
if (isDesktopApp()) {
  void import("@/lib/desktop-selftest").then((m) => m.runSelftestIfRequested());
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
