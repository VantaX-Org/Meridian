/**
 * Aurora visual regression — one screenshot per workspace route at 1440×900,
 * signed in with the recorded API and the clock pinned to the recording, so
 * the surfaces show the same figures and relative times on every run.
 *
 * Baselines live in `aurora-visual.spec.ts-snapshots/` and are generated on
 * Linux Chromium (CI's image; `vr-baseline-refresh.yml` produces them):
 *   npm run e2e:update
 */

import { expect, ROUTES, test } from "./fixtures";

test.use({ viewport: { width: 1440, height: 900 } });

for (const r of ROUTES) {
  test(`visual — ${r.name}`, async ({ app }) => {
    await app.goto(r.path, { waitUntil: "load" });
    await expect(app.getByRole("heading", { level: 1, name: r.heading })).toBeVisible();
    // fonts, charts and lazy tab bodies settle
    await app.waitForTimeout(1500);
    await expect(app).toHaveScreenshot(`${r.name}.png`, {
      fullPage: false,
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
    });
  });
}

// Printing the executive report: no rail, no top bar, no buttons.
test("visual — executive-report print", async ({ app }) => {
  await app.goto("/?tab=report", { waitUntil: "load" });
  await expect(app.getByRole("heading", { level: 1, name: "Executive report" })).toBeVisible();
  await app.emulateMedia({ media: "print" });
  await app.waitForTimeout(1500);
  await expect(app).toHaveScreenshot("executive-report-print.png", {
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.02,
    threshold: 0.2,
  });
});
