// Copies everything the browser must be able to fetch from ITS OWN origin
// into public/, so the app works with no Internet access at all:
//
//   - the matcher Python sources (matcher/src/matcher/*.py) — the engine the
//     tests cover, loaded into Pyodide's virtual FS at runtime;
//   - the explanatory PDFs;
//   - the Pyodide runtime (pyodide.asm.js/.wasm, python_stdlib.zip,
//     pyodide-lock.json) from the installed `pyodide` npm package, plus the
//     numpy wheel that package does not ship. The wheel is downloaded ONCE
//     from the Pyodide CDN at build time, verified against the sha256 in
//     pyodide-lock.json, and cached under webapp/.cache/. Nothing is fetched
//     from a CDN at runtime — the worker loads /pyodide/v<version>/ instead.
//
// Runs on `predev` and `prebuild`. Also invoked by scripts/bump_version.py
// and by CI without node_modules present: the Pyodide step then skips with
// a warning (public/pyodide/ is gitignored, so it never affects the
// "matcher copy is in sync" diff).

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "..");

const matcherSrc = resolve(repoRoot, "matcher/src/matcher");
const matcherDest = resolve(appRoot, "public/matcher");
const pdfSrc = resolve(repoRoot, "matcher/explanatory/output");
const pdfDest = resolve(appRoot, "public/explanatory");
const pyodideDest = resolve(appRoot, "public/pyodide");
const cacheRoot = resolve(appRoot, ".cache/pyodide");

// The runtime files loadPyodide fetches from indexURL. pyodide.mjs itself
// is bundled into the worker chunk by Vite and is not needed here.
const PYODIDE_CORE_FILES = [
  "pyodide.asm.js",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
];
// Python packages the matcher imports at runtime (see matcher.worker.ts).
const PYODIDE_PACKAGES = ["numpy"];

function syncDir(src, dest, predicate) {
  if (!existsSync(src)) {
    console.warn(`[sync-assets] source missing: ${src}`);
    return;
  }
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });

  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!predicate(entry.name)) continue;
    copyFileSync(join(src, entry.name), join(dest, entry.name));
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Locate the installed pyodide package; null when node_modules is absent. */
function pyodidePackageDir() {
  try {
    const require = createRequire(import.meta.url);
    return dirname(require.resolve("pyodide/package.json"));
  } catch {
    return null;
  }
}

async function fetchVerified(url, expectedSha256, cachePath) {
  if (existsSync(cachePath)) {
    const cached = readFileSync(cachePath);
    if (sha256(cached) === expectedSha256) return cached;
    console.warn(`[sync-assets] cached ${cachePath} failed its checksum; re-downloading`);
  }
  console.log(`[sync-assets] downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`[sync-assets] ${url}: HTTP ${res.status}`);
  }
  const data = Buffer.from(await res.arrayBuffer());
  const got = sha256(data);
  if (got !== expectedSha256) {
    throw new Error(
      `[sync-assets] checksum mismatch for ${url}\n  expected ${expectedSha256}\n  got      ${got}`
    );
  }
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, data);
  return data;
}

async function syncPyodide() {
  const pkgDir = pyodidePackageDir();
  if (!pkgDir) {
    console.warn(
      "[sync-assets] pyodide npm package not installed (no node_modules) — skipping the runtime copy"
    );
    return;
  }
  const { version } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8"));
  const dest = join(pyodideDest, `v${version}`);
  if (existsSync(pyodideDest)) rmSync(pyodideDest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });

  for (const name of PYODIDE_CORE_FILES) {
    const src = join(pkgDir, name);
    if (!existsSync(src)) {
      throw new Error(`[sync-assets] ${src} missing — pyodide package layout changed?`);
    }
    copyFileSync(src, join(dest, name));
  }

  // Wheels are resolved exactly the way loadPackage does it at runtime: by
  // the file name and checksum recorded in the lock file next to the core.
  const lock = JSON.parse(readFileSync(join(pkgDir, "pyodide-lock.json"), "utf-8"));
  const wanted = [...PYODIDE_PACKAGES];
  const seen = new Set();
  while (wanted.length) {
    const name = wanted.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const entry = lock.packages[name];
    if (!entry) throw new Error(`[sync-assets] ${name} is not in pyodide-lock.json`);
    for (const dep of entry.depends ?? []) wanted.push(dep);
    const url = `https://cdn.jsdelivr.net/pyodide/v${version}/full/${entry.file_name}`;
    const data = await fetchVerified(
      url,
      entry.sha256,
      join(cacheRoot, `v${version}`, entry.file_name)
    );
    writeFileSync(join(dest, entry.file_name), data);
  }

  console.log(
    `[sync-assets] pyodide v${version} runtime + ${[...seen].join(", ")} synced into public/pyodide/`
  );
}

syncDir(matcherSrc, matcherDest, (n) => n.endsWith(".py"));
syncDir(pdfSrc, pdfDest, (n) => n.endsWith(".pdf"));
await syncPyodide();

console.log("[sync-assets] matcher + explanatory assets synced into public/");
