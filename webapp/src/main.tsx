import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/App";
import { registerRuntimeCache } from "@/lib/runtime-cache";
import "./main.css";

// Cache the Pyodide runtime after the first visit (public CDN assets only).
registerRuntimeCache();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
