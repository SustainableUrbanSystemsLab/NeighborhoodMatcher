// The desktop app serves this same build under the Content-Security-Policy in
// src-tauri/tauri.conf.json. Tauri attaches it to HTML responses only, adds
// the sha256 of every inline <script> to script-src (the theme pre-paint
// script in index.html), and — because dangerousDisableAssetCspModification
// lists style-src — leaves style-src alone so 'unsafe-inline' keeps working
// for React style attributes. Workers get no CSP (their scripts are not HTML).
//
// This test reproduces exactly that on the production build and runs a full
// match: in Chromium (the engine of WebView2, Windows) and WebKit (the engine
// of WKWebView, macOS). A policy that blocked Pyodide, the worker, or any
// style would fail here instead of on a researcher's machine.

import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..");
const REPO = resolve(APP, "..");

function desktopCsp(): string {
  const conf = JSON.parse(readFileSync(resolve(APP, "src-tauri/tauri.conf.json"), "utf-8"));
  const csp: string = conf.app.security.csp;
  const html = readFileSync(resolve(APP, "dist/index.html"), "utf-8");
  const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => `'sha256-${createHash("sha256").update(m[1]!).digest("base64")}'`);
  return csp
    .split(";")
    .map((d) => d.trim())
    .map((d) => (d.startsWith("script-src ") ? `${d} ${hashes.join(" ")}` : d))
    .join("; ");
}

test.use({ serviceWorkers: "block" }); // the desktop app has none

test("@desktop the app runs a full match under the desktop CSP", async ({ page }) => {
  const csp = desktopCsp();
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "content-security-policy": csp },
    });
  });
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __csp: string[] }).__csp.push(
        `${e.violatedDirective} ${e.blockedURI}`
      );
    });
  });

  await page.goto("/match");
  const inputs = page.locator('input[type="file"]');
  await inputs.nth(1).setInputFiles(resolve(REPO, "simulated_data/dataset_B_tracts.csv"));
  await expect(page.getByText("dataset_B_tracts.csv", { exact: true })).toBeVisible();
  await inputs.nth(0).setInputFiles(resolve(REPO, "simulated_data/dataset_A100.csv"));
  await expect(page.getByText("dataset_A100.csv", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  const agree = page.getByRole("button", { name: "Continue" });
  const linking = page.getByText("Column Linking", { exact: true });
  await expect(agree.or(linking)).toBeVisible();
  if (await agree.isVisible()) {
    for (const box of await page.locator('input[type="checkbox"]').all()) await box.check();
    await agree.click();
  }
  await expect(linking).toBeVisible();
  await page.getByRole("button", { name: "Run Matching" }).click();
  await expect(page.getByText("Rows matched")).toBeVisible({ timeout: 150_000 });

  const violations = await page.evaluate(
    () => (window as unknown as { __csp: string[] }).__csp
  );
  expect(violations).toEqual([]);
  // The policy really was in force (a typo would make this test vacuous).
  const blocked = await page.evaluate(async () => {
    try {
      await fetch("https://example.com/", { mode: "no-cors" });
      return false;
    } catch {
      return true;
    }
  });
  expect(blocked).toBe(true);
});
