// The desktop app serves this same build under the Content-Security-Policy in
// src-tauri/tauri.conf.json. Tauri attaches it to HTML responses only, adds
// the sha256 of every inline <script> to script-src (the theme pre-paint
// script in index.html), and — because dangerousDisableAssetCspModification
// lists style-src — leaves style-src alone so 'unsafe-inline' keeps working
// for React style attributes. Workers get no CSP (their scripts are not HTML).
//
// These tests reproduce exactly that on the production build: in Chromium
// (the engine of WebView2, Windows) and WebKit (the engine of WKWebView,
// macOS). The real apps are also run in CI (desktop.yml self-test); these
// catch a broken policy or desktop code path in seconds, locally.

import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyDesktopCsp, cspViolations, emulateTauri } from "./desktop-env";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test.use({ serviceWorkers: "block" }); // the desktop app has none

test("@desktop the app runs a full match under the desktop CSP", async ({ page }) => {
  await applyDesktopCsp(page);

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

  expect(await cspViolations(page)).toEqual([]);
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

test("@desktop the self-test passes in the page (emulated Tauri IPC)", async ({ page }) => {
  await applyDesktopCsp(page);
  await emulateTauri(page, { selftest: true });
  await page.goto("/");

  const report = await page.waitForFunction(
    () =>
      (window as unknown as { __ipc: { cmd: string; args: unknown }[] }).__ipc.find(
        (c) => c.cmd === "selftest_report"
      ),
    undefined,
    { timeout: 120_000 }
  );
  const call = (await report.jsonValue()) as { args: { ok: boolean; detail: string } };
  expect(call.args.detail).toContain("matched 30 rows on pct_poverty, median_income");
  expect(call.args.ok).toBe(true);

  const save = await page.evaluate(() =>
    (window as unknown as { __ipc: { cmd: string; headers?: Record<string, string>; bytes?: number }[] }).__ipc.find(
      (c) => c.cmd === "save_download"
    )
  );
  expect(save?.headers?.["x-filename"]).toBe("selftest-results.zip");
  expect(save?.bytes ?? 0).toBeGreaterThan(1000);
  // The only violation is the self-test's own probe of the network.
  const violations = await cspViolations(page);
  expect(violations.length).toBe(1);
  expect(violations[0]).toMatch(/^connect-src https:\/\/example\.com/);
});

test("@desktop outside self-test mode the app never reports", async ({ page }) => {
  await emulateTauri(page, { selftest: false });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Get Started" })).toBeVisible();
  await page.waitForTimeout(1500);
  const cmds = await page.evaluate(() =>
    (window as unknown as { __ipc: { cmd: string }[] }).__ipc.map((c) => c.cmd)
  );
  expect(cmds).toEqual(["selftest_mode"]);
  await expect(page.locator("footer")).toContainText("Desktop app");
});

test("@desktop links to other sites open in the system browser", async ({ page }) => {
  await emulateTauri(page, { selftest: false });
  await page.goto("/about#offline");
  const release = page.getByRole("link", { name: "All releases" });
  await release.click();
  await expect(page).toHaveURL(/\/about/); // the window stayed on the app
  // The opener call is asynchronous: wait for it rather than read once.
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __ipc: { cmd: string; args: { url?: string } }[] }).__ipc
          .filter((c) => c.cmd === "plugin:opener|open_url")
          .map((c) => c.args.url)
      )
    )
    .toEqual(["https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/releases/latest"]);
});
