// Packs the built site (dist/) into a zip an institution can host on its own
// static server with no Internet access — dist/offline/nbhdmatch-site-v<version>.zip.
// Runs after `vite build` in `pnpm build` (not in the desktop build, which
// embeds dist/ directly). Uses jszip (already a runtime dependency) so the
// build needs no system `zip`.

import JSZip from "jszip";
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const dist = resolve(appRoot, "dist");
const outDir = resolve(dist, "offline");
const { version } = JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf-8"));
const zipName = `nbhdmatch-site-v${version}.zip`;

const HOSTING = `NeighborhoodMatcher v${version} — self-hosted copy
==================================================

This folder is the complete web app. Nothing in it contacts the Internet:
the Python runtime (pyodide/), the matching engine (matcher/) and every
asset are included, and all matching runs in the visitor's browser — no
data is sent anywhere.

How to host it
--------------
Serve this folder from any static web server (Apache, nginx, IIS, Caddy,
Python's http.server, ...). Two things the server must do:

1. Serve index.html for paths that are not files (/match, /about), so the
   in-app navigation survives a page reload. nginx:  try_files $uri /index.html;
   Apache: a RewriteRule to /index.html (or set ErrorDocument 404 /index.html).

2. Send the right content types for two extensions some servers do not know:
     .wasm  ->  application/wasm      (WebAssembly runtime; required)
     .mjs   ->  text/javascript
   Everything else is standard (.js, .css, .html, .json, .py, .zip, .whl, .pdf).

Serve it over HTTPS (or plain http://localhost). Browsers only enable the
offline cache (service worker) on secure origins; over plain http on an
intranet host the app still works, it just has to be reloaded from the
server each visit.

Optional: long cache lifetimes for /assets/* and /pyodide/* (their paths
change with every build), never for index.html or sw.js.

A quick local test:  python3 -m http.server 8080   (then open http://localhost:8080)

Updating
--------
Replace the whole folder with a newer zip; do not mix files from two versions.
The matching engine and the interface are built together and must stay together.

Source and issue tracker: https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher
`;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (p === outDir) continue; // never pack a previous bundle into the new one
      out.push(...walk(p));
    } else if (entry.isFile()) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(dist);
if (!files.some((f) => f.endsWith("index.html"))) {
  throw new Error("[pack-site] dist/index.html missing — run vite build first");
}

const zip = new JSZip();
for (const file of files) {
  const rel = relative(dist, file).split("\\").join("/");
  zip.file(rel, readFileSync(file), { date: statSync(file).mtime });
}
zip.file("HOSTING.txt", HOSTING);

const blob = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 6 },
});
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, zipName), blob);
console.log(`[pack-site] ${files.length} files → dist/offline/${zipName} (${(blob.length / 1e6).toFixed(1)} MB)`);
