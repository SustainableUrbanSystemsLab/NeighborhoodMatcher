import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8"));
// The Pyodide runtime is served from this origin under /pyodide/v<version>/
// (copied there by scripts/sync-assets.mjs), so the worker's indexURL must
// name the exact version that was installed.
const pyodideVersion: string = JSON.parse(
  readFileSync(path.resolve(__dirname, "node_modules/pyodide/package.json"), "utf-8")
).version;

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
    __PYODIDE_VERSION__: JSON.stringify(pyodideVersion),
  },
  plugins: [
    react(),
    tailwindcss(),
    // Offline after one visit: src/sw.ts precaches the whole build (app
    // shell, matcher sources, Pyodide runtime, numpy wheel, PDFs) as one
    // versioned unit. Registration and the "reload for the new build" flow
    // live in src/lib/runtime-cache.ts.
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false,
      manifest: {
        name: "NeighborhoodMatcher",
        short_name: "NbhdMatch",
        description:
          "Match participant-level data to neighborhood-scale records, entirely in the browser.",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#ffffff",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/logo.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      injectManifest: {
        globPatterns: [
          "**/*.{html,js,css,svg,png,ico,webmanifest,py,json,wasm,zip,whl,pdf}",
        ],
        // The self-host bundle offered on the About page is a download, not
        // something the app needs to run.
        globIgnores: ["offline/**"],
        // Workbox's default (2 MiB) would silently drop pyodide.asm.wasm.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  // Pyodide's loader resolves its own files at runtime relative to indexURL;
  // pre-bundling it would rewrite those paths (Pyodide's bundler guide).
  optimizeDeps: { exclude: ["pyodide"] },
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
