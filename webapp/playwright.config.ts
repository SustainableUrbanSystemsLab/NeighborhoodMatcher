// End-to-end checks of what no unit test can prove: that a full run never
// leaves this origin, that the site keeps working with the network off
// after one visit, and that identifier columns are blocked and recorded.
// Runs against the production build served by `vite preview` (`pnpm build`
// first); CI installs Chromium and runs it after the build.

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // WKWebView (the macOS desktop app) is WebKit: run the desktop-CSP check
    // there too. The offline tests stay on Chromium.
    { name: "webkit", use: { ...devices["Desktop Safari"] }, grep: /@desktop/ },
  ],
  webServer: {
    command: "pnpm exec vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
