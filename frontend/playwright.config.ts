import { defineConfig, devices } from "@playwright/test";

/**
 * Aurora smoke + acceptance test config (spec §15.1 — WS8).
 *
 * Run locally:   npx playwright test
 * Run in CI:     npx playwright install --with-deps && npx playwright test
 *
 * The dev server starts on port 3000 with the existing `npm run dev`;
 * reuseExistingServer lets developers keep the dashboard open while
 * iterating on specs. Perf-budget assertions (spec §15.1) are expressed
 * as timeouts on the navigation + first-paint metrics in individual
 * specs — we intentionally keep this config minimal so the budget
 * values live next to the tests that enforce them.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
