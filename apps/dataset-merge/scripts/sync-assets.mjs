// Copies matcher Python sources and explanatory PDFs into public/ so the
// browser can fetch them and load them into Pyodide's virtual FS.
// Runs on `predev` and `prebuild`.

import { copyFileSync, mkdirSync, readdirSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "../..");

const matcherSrc = resolve(repoRoot, "version-3/src/matcher");
const matcherDest = resolve(appRoot, "public/matcher");
const pdfSrc = resolve(repoRoot, "version-3/explanatory/output");
const pdfDest = resolve(appRoot, "public/explanatory");

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

syncDir(matcherSrc, matcherDest, (n) => n.endsWith(".py"));
syncDir(pdfSrc, pdfDest, (n) => n.endsWith(".pdf"));

console.log("[sync-assets] matcher + explanatory assets synced into public/");
