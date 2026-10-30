import { defineConfig, devices } from "@playwright/test";

/**
 * The acceptance suite: every screen of the map, canvas and inspector in fixture mode (`?fixture=1`, the API answered
 * from lib/api/v2/fixtures), axe on every page, the sign-in states and the redirects from old addresses. No backend.
 *
 * Locally:  npx playwright test            (starts `next dev`, or reuses one)
 *           PLAYWRIGHT_BASE_URL=http://localhost:3001 npx playwright test
 *           PW_CHROMIUM=/path/to/chromium   to run on a Chromium you already have
 * In CI:    the web server is the production build served the way the image
 *           serves it (standalone), so perf budgets measure what customers get.
 * Fixture mode only works in a build made with NEXT_PUBLIC_MERIDIAN_DEMO=1 (or in `next dev`): the web server below
 * sets it, and a server you start yourself for PLAYWRIGHT_BASE_URL must be built with it too.
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
  projects: [
    // guided-tours-v2.spec.ts is the help recording script: it runs only under the `recording` project
    // (RECORD_HELP=1), never in the acceptance suite.
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /guided-tours-v2\.spec\.ts/ },
    ...(process.env.RECORD_HELP === "1"
      ? [{
          name: "recording",
          testMatch: /guided-tours-v2\.spec\.ts/,
          fullyParallel: false,
          retries: 0,
          // raw captures land in help-videos-raw/<test-title>/*.webm; the workflow converts to mp4
          outputDir: "help-videos-raw",
          use: {
            ...devices["Desktop Chrome"],
            viewport: { width: 1440, height: 900 },
            colorScheme: "light" as const,
            video: { mode: "on" as const, size: { width: 1440, height: 900 } },
          },
        }]
      : []),
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: process.env.CI ? "npm run build && npm run start:standalone" : "npm run dev",
        url: "http://localhost:3000/sign-in",
        reuseExistingServer: !process.env.CI,
        timeout: 600_000,
        // The demo build: honours ?fixture=1 (lib/api/v2/fixture.ts fixtureAllowed). A customer image never sets it.
        env: { NEXT_PUBLIC_MERIDIAN_DEMO: "1" },
      },
});
