import { expect, test, type Page } from "@playwright/test";

// A phone: the step indicator once made every Match step scroll sideways
// (and pushed its first step off the left edge).
test.use({ viewport: { width: 375, height: 812 } });

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBe(0);
}

test("the Match page never scrolls sideways on a phone", async ({ page }) => {
  await page.goto("/match");
  await expect(page.getByRole("link", { name: "Try it with sample data" })).toBeVisible();
  await expectNoSidewaysScroll(page);

  await page.goto("/match?demo");
  await expect(page.getByText("Column Linking", { exact: true })).toBeVisible();
  await expectNoSidewaysScroll(page);

  await page.getByRole("button", { name: "Run Matching" }).click();
  await expect(page.getByText("Rows matched")).toBeVisible({ timeout: 150_000 });
  await expectNoSidewaysScroll(page);
});
