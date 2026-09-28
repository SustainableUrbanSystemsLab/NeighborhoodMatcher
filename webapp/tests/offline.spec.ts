import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const TARGET = resolve(REPO, "simulated_data/dataset_A100.csv");
const SUPP = resolve(REPO, "simulated_data/dataset_B_tracts.csv");
const ORIGIN = "http://localhost:4173";

/** Upload both files, accept the agreement on a fresh profile, reach Link Columns. */
async function uploadAndLink(page: Page, target: string, supp: string): Promise<void> {
  await page.goto("/match");
  // A loaded upload card unmounts its file input, which shifts every later
  // input's index (the last one restores a results zip). Fill the
  // supplemental slot first so the target's input is still the first one.
  const inputs = page.locator('input[type="file"]');
  await inputs.nth(1).setInputFiles(supp);
  await expect(page.getByText(basename(supp), { exact: true })).toBeVisible();
  await inputs.nth(0).setInputFiles(target);
  await expect(page.getByText(basename(target), { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  await page.getByRole("button", { name: "Next" }).click();
  // A fresh browser profile gets the data-use agreement first.
  const agree = page.getByRole("button", { name: "Continue" });
  const linking = page.getByText("Column Linking", { exact: true });
  await expect(agree.or(linking)).toBeVisible();
  if (await agree.isVisible()) {
    for (const box of await page.locator('input[type="checkbox"]').all()) await box.check();
    await agree.click();
  }
  await expect(linking).toBeVisible();
}

async function runMatch(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Run Matching" }).click();
  await expect(page.getByText("Rows matched")).toBeVisible({ timeout: 150_000 });
}

test.describe("no request leaves the origin", () => {
  // Without a service worker every fetch — page and Pyodide workers — shows
  // on the network, so the assertion sees the runtime being loaded.
  test.use({ serviceWorkers: "block" });

  test("a full run only talks to this origin", async ({ page }) => {
    const urls: string[] = [];
    page.on("request", (request) => urls.push(request.url()));
    await uploadAndLink(page, TARGET, SUPP);
    await runMatch(page);
    const foreign = urls.filter(
      (u) => !u.startsWith(ORIGIN) && !u.startsWith("data:") && !u.startsWith("blob:")
    );
    expect(foreign).toEqual([]);
    expect(urls.some((u) => u.includes("/pyodide/v") && u.endsWith(".wasm"))).toBe(true);
    expect(urls.some((u) => u.includes("/pyodide/v") && u.endsWith(".whl"))).toBe(true);
  });
});

test("keeps working with the network off after one visit", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.locator("footer")).toContainText("Available offline on this device", {
    timeout: 90_000,
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "Get Started" })).toBeVisible();
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await uploadAndLink(page, TARGET, SUPP);
  await runMatch(page);
  await page.goto("/about");
  await expect(page.getByText("Use it without Internet")).toBeVisible();
  await context.setOffline(false);
});

test("ZIP / census-tract columns are blocked from matching and recorded", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "nbhdmatch-"));
  const target = join(dir, "participants.csv");
  const supp = join(dir, "tracts.csv");
  let t = "pid,census tract,pct_poverty,median_income\n";
  let s = "census tract,pct_poverty,median_income,walkability\n";
  for (let i = 0; i < 30; i++) {
    t += `p${i},${13089020100 + i * 100},${(5 + i * 0.7).toFixed(1)},${40000 + i * 900}\n`;
  }
  for (let j = 0; j < 40; j++) {
    s += `${13089020100 + j * 100},${(5 + j * 0.7).toFixed(1)},${40000 + j * 900},${(3 + j * 0.1).toFixed(1)}\n`;
  }
  writeFileSync(target, t);
  writeFileSync(supp, s);

  await uploadAndLink(page, target, supp);
  await expect(page.getByText("Blocked — identifier")).toBeVisible();
  await expect(page.getByText("cannot be matched on")).toBeVisible();
  await expect(page.getByText("1 blocked (identifier)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run Matching" })).toBeEnabled();
  await runMatch(page);
  await expect(page.getByText("Not used for matching:")).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download results (.zip)" }).click(),
  ]);
  const zip = await JSZip.loadAsync(readFileSync((await download.path())!));
  const info = await zip.file("run_info.csv")!.async("string");
  expect(info).toMatch(/identifier_columns_blocked,.*census tract: census tract identifiers \(by column name\)/);
  expect(info).toMatch(/matching_variables,"?pct_poverty; median_income"?/);
  const linked = await zip.file("linked_dataset.csv")!.async("string");
  expect(linked.split("\n")[0]).toContain("census tract");
});
