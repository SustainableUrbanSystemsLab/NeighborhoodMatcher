import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Respect PORT when a harness assigns one (e.g. preview tooling).
  server: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : undefined,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Pyodide inside the matcher worker uses dynamic imports, which Rollup
  // cannot emit as IIFE (Vite's default). Force ES modules for workers.
  worker: {
    format: "es",
  },
});
