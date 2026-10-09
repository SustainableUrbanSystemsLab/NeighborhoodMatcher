// Fails when the built site (dist/) could need the Internet at run time.
// Run after `pnpm build` (CI does): `pnpm run check:offline`.
//
//   - no text asset names a CDN, except the inert fallback template inside
//     Pyodide's own loader (`https://cdn.jsdelivr.net/pyodide/v${x}/full/`),
//     which is never used because the worker pins packageBaseUrl;
//   - index.html loads no script, style or font from another origin;
//   - the self-hosted runtime is complete (core files + numpy wheel);
//   - the service worker precaches the runtime and every matcher module;
//   - the demo's sample data is built and precached (/match?demo offline);
//   - the self-host zip exists (skip with --no-zip for a build:web).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(appRoot, "dist");
const expectZip = !process.argv.includes("--no-zip");
const problems = [];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

if (!existsSync(dist)) {
  console.error("[check-offline] dist/ missing — run pnpm build first");
  process.exit(1);
}
const files = walk(dist).filter((f) => !relative(dist, f).startsWith("offline/"));

// 1. CDN / third-party references in text assets.
const TEXT = /\.(js|mjs|html|css|json|webmanifest|py|txt|svg)$/;
const CDN = /https?:\/\/(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|esm\.sh|jspm\.io)[^"'`\s,)]*/g;
const PYODIDE_FALLBACK = /^https:\/\/cdn\.jsdelivr\.net\/pyodide\/v\$\{[A-Za-z_$][\w$]*\}\/full\/$/;
for (const file of files) {
  if (!TEXT.test(file)) continue;
  const text = readFileSync(file, "utf-8");
  for (const hit of text.match(CDN) ?? []) {
    if (PYODIDE_FALLBACK.test(hit)) continue;
    problems.push(`${relative(dist, file)}: references ${hit}`);
  }
}

// 2. index.html must not load anything cross-origin.
const html = readFileSync(join(dist, "index.html"), "utf-8");
for (const m of html.matchAll(/<(script|link)\b[^>]*\b(?:src|href)="(https?:)?\/\/[^"]*"/g)) {
  problems.push(`index.html: cross-origin <${m[1]}> ${m[0].slice(0, 120)}`);
}

// 3. Runtime files.
const pyodideDir = join(dist, "pyodide");
const versions = existsSync(pyodideDir) ? readdirSync(pyodideDir).filter((n) => n.startsWith("v")) : [];
if (versions.length !== 1) {
  problems.push(`dist/pyodide/ should hold exactly one v<version>/ directory, found: ${versions.join(", ") || "none"}`);
} else {
  const dir = join(pyodideDir, versions[0]);
  for (const name of ["pyodide.asm.js", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"]) {
    if (!existsSync(join(dir, name))) problems.push(`missing runtime file pyodide/${versions[0]}/${name}`);
  }
  if (!readdirSync(dir).some((n) => n.startsWith("numpy-") && n.endsWith(".whl"))) {
    problems.push(`missing numpy wheel in pyodide/${versions[0]}/`);
  }
  const wasm = join(dir, "pyodide.asm.wasm");
  if (existsSync(wasm) && statSync(wasm).size < 5_000_000) problems.push("pyodide.asm.wasm is implausibly small");
}

// 4. Precache covers the runtime and the engine.
const swPath = join(dist, "sw.js");
if (!existsSync(swPath)) {
  problems.push("dist/sw.js missing — the offline precache was not built");
} else {
  const sw = readFileSync(swPath, "utf-8");
  for (const needle of ["pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json", "numpy-"]) {
    if (!sw.includes(needle)) problems.push(`sw.js does not precache ${needle}`);
  }
  for (const py of readdirSync(join(dist, "matcher")).filter((n) => n.endsWith(".py"))) {
    if (!sw.includes(`matcher/${py}`)) problems.push(`sw.js does not precache matcher/${py}`);
  }
  if (!sw.includes("index.html")) problems.push("sw.js does not precache index.html");
  for (const name of ["dataset_A100.csv", "dataset_B_tracts.csv", "truth_A100.csv"]) {
    if (!existsSync(join(dist, "demo", name))) problems.push(`missing demo file demo/${name}`);
    else if (!sw.includes(`demo/${name}`)) problems.push(`sw.js does not precache demo/${name}`);
  }
}
if (!existsSync(join(dist, "manifest.webmanifest"))) problems.push("manifest.webmanifest missing (not installable)");

// 5. Self-host bundle.
if (expectZip) {
  const offline = join(dist, "offline");
  const zips = existsSync(offline) ? readdirSync(offline).filter((n) => /^nbhdmatch-site-v.*\.zip$/.test(n)) : [];
  if (zips.length !== 1) problems.push(`expected one dist/offline/nbhdmatch-site-v*.zip, found ${zips.length}`);
}

if (problems.length) {
  console.error("[check-offline] the build is not self-contained:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log(`[check-offline] ok — ${files.length} files, no runtime dependency outside this origin`);
