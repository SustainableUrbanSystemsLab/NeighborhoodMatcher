import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8"));

// Which build is serving the site. Netlify exposes COMMIT_REF; locally we
// ask git; neither is available in a bare tarball build, hence "unknown".
function commitRef(): string {
  const fromCi = process.env.COMMIT_REF ?? process.env.GITHUB_SHA;
  if (fromCi) return fromCi.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commitRef()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().replace(/\.\d+Z$/, "Z")),
  },
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
