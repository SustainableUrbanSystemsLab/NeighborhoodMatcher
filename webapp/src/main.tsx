import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/App";
import { registerRuntimeCache } from "@/lib/runtime-cache";
import "./main.css";

// Precache the whole build so the app works offline after this visit
// (production only; skipped in the desktop app).
registerRuntimeCache();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
