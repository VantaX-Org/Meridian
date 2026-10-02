import { defineConfig, devices } from "@playwright/test";

/**
 * Aurora acceptance suite: smoke, a11y, perf and visual regression, signed in
 * against the recorded API (e2e/fixtures.ts) so no backend is needed.
 *
 * Locally:  npx playwright test            (starts `next dev`, or reuses one)
 *           PLAYWRIGHT_BASE_URL=http://localhost:3001 npx playwright test
 *           PW_CHROMIUM=/path/to/chromium   to run on a Chromium you already have
 * In CI:    the web server is the production build served the way the image
 *           serves it (standalone), so perf budgets measure what customers get.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  // Baselines are Linux Chromium (CI's image); no platform suffix so a refresh
  // from vr-baseline-refresh.yml drops straight in.
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: process.env.CI ? "npm run build && npm run start:standalone" : "npm run dev",
        url: "http://localhost:3000/sign-in",
        reuseExistingServer: !process.env.CI,
        timeout: 600_000,
      },
});
