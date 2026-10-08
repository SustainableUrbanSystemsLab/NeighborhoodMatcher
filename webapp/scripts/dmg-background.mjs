// Renders src-tauri/dmg/background.svg, the picture behind the .dmg's Finder
// window, to src-tauri/dmg/background.tiff: one TIFF holding the image at 1x
// and 2x, which Finder shows sharp on Retina displays (a plain PNG would be
// blurry, or twice the size). The SVG is drawn by Playwright's Chromium on
// macOS, so the text uses the system font; sips and tiffutil ship with macOS.
// The TIFF is committed: run this after editing the SVG (pnpm run dmg:background).

import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

if (process.platform !== "darwin") {
  console.error("dmg-background: needs macOS (sips, tiffutil)");
  process.exit(1);
}

const dir = resolve("src-tauri", "dmg");
const svg = join(dir, "background.svg");
const out = join(dir, "background.tiff");
const width = 660;
const height = 400;

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`dmg-background: ${cmd} failed`);
    process.exit(1);
  }
}

const tmp = mkdtempSync(join(tmpdir(), "nbhdmatch-dmg-bg-"));
const browser = await chromium.launch();
const tiffs = [];
for (const scale of [1, 2]) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  await page.goto(pathToFileURL(svg).href);
  const png = join(tmp, `background@${scale}x.png`);
  await page.screenshot({ path: png });
  await page.close();
  const tiff = png.replace(/\.png$/, ".tiff");
  run("sips", ["-s", "format", "tiff", png, "--out", tiff]);
  run("tiffutil", ["-lzw", tiff, "-out", `${tiff}.lzw`]);
  tiffs.push(`${tiff}.lzw`);
}
await browser.close();
run("tiffutil", ["-cathidpicheck", ...tiffs, "-out", out]);
rmSync(tmp, { recursive: true, force: true });
console.log(`wrote ${out} (${Math.round(statSync(out).size / 1024)} KB)`);
