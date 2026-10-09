import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");

test("demo mode runs the sample pair, scores it, and leaves no trace", async ({ page }) => {
  await page.goto("/match");
  await page.getByRole("link", { name: "Try it with sample data" }).click();
  await expect(page).toHaveURL(/\/match\?demo$/);
  // Straight to Link Columns: synthetic data needs no data-use agreement.
  await expect(page.getByText("Column Linking", { exact: true })).toBeVisible();
  await expect(page.getByText("100 synthetic participants × 73,056 census tracts")).toBeVisible();
  await expect(page.getByText("5 columns linked")).toBeVisible();

  await page.getByRole("button", { name: "Run Matching" }).click();
  await expect(page.getByText("Rows matched")).toBeVisible({ timeout: 150_000 });
  const key = page.locator("div", { has: page.getByText("Answer key (sample data only)") }).last();
  const text = await key.innerText();
  // Floors from matcher/analysis/benchmark_simulated.py: overall >= 0.85.
  const nearest = Number(/true one for (\d+) of 100 participants/.exec(text)?.[1]);
  expect(nearest).toBeGreaterThanOrEqual(85);
  const [, right, written] = /(\d+) of (\d+)\s+links? written/.exec(text) ?? [];
  expect(Number(written)).toBeGreaterThan(0);
  expect(Number(right)).toBeGreaterThanOrEqual(0.9 * Number(written));

  // The sample files download as they are in simulated_data/.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /sample target file/ }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("dataset_A100.csv");
  expect(readFileSync((await download.path())!, "utf-8")).toBe(
    readFileSync(resolve(REPO, "simulated_data/dataset_A100.csv"), "utf-8")
  );

  await page.getByRole("button", { name: "Exit demo" }).click();
  await expect(page).toHaveURL(/\/match$/);
  await expect(page.getByRole("link", { name: "Try it with sample data" })).toBeVisible();
  // Not in Recent runs, and no agreement recorded on the user's behalf.
  expect(await page.evaluate(() => localStorage.getItem("nbhdmatch:runs"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("nbhdmatch:agreement"))).toBeNull();
});

test("your own file ends the demo, and the agreement applies again", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "nbhdmatch-demo-"));
  const own = join(dir, "participants.csv");
  let csv = "pid,pct_poverty,median_income\n";
  for (let i = 0; i < 10; i++) csv += `p${i},${(5 + i).toFixed(1)},${40000 + i * 1000}\n`;
  writeFileSync(own, csv);

  await page.goto("/match?demo");
  await expect(page.getByText("Column Linking", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  // Replace the sample target with the user's file.
  await page.getByRole("button", { name: "Remove" }).first().click();
  await expect(page).toHaveURL(/\/match$/);
  await expect(page.getByText("100 synthetic participants")).toHaveCount(0);
  await page.locator('input[type="file"]').first().setInputFiles(own);
  await expect(page.getByText("participants.csv", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Data Use Agreement" })).toBeVisible();
});

test("browser Back leaves the demo", async ({ page }) => {
  await page.goto("/match");
  await page.getByRole("link", { name: "Try it with sample data" }).click();
  await expect(page.getByText("Column Linking", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/match$/);
  await expect(page.getByRole("link", { name: "Try it with sample data" })).toBeVisible();
  await expect(page.getByText("100 synthetic participants")).toHaveCount(0);
});

test("exiting the demo mid-run drops the run", async ({ page }) => {
  await page.goto("/match?demo");
  await expect(page.getByText("Column Linking", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Run Matching" }).click();
  await page.getByRole("button", { name: "Exit demo" }).click();
  await expect(page).toHaveURL(/\/match$/);
  await expect(page.getByRole("link", { name: "Try it with sample data" })).toBeVisible();
  // The abandoned run must not take the page anywhere afterwards.
  await page.waitForTimeout(5_000);
  await expect(page.getByRole("link", { name: "Try it with sample data" })).toBeVisible();
  await expect(page.getByText("Rows matched")).toHaveCount(0);
  await expect(page.getByText("Matching failed")).toHaveCount(0);
});
