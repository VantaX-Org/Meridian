/**
 * Aurora visual-regression spec — WS8 §15.2.
 *
 * Uses Playwright's native `toHaveScreenshot()` for baseline comparison —
 * no external tooling (Chromatic, Percy) required. Baselines live under
 * `e2e/aurora-visual.spec.ts-snapshots/` and are committed to git.
 *
 * Update baselines with:
 *   npx playwright test --update-snapshots e2e/aurora-visual.spec.ts
 *
 * Philosophy:
 *   - One screenshot per workspace at a fixed viewport (1440×900)
 *   - maxDiffPixelRatio: 0.02 — allows 2% pixel drift (font hinting,
 *     antialiasing differences across machines) without flagging
 *   - disableAnimations: true — zero-tolerance for animation state
 *     leaking into snapshots (spec §12 motion all uses reduced-motion)
 *   - threshold: 0.2 per pixel — permissive channel delta so sub-pixel
 *     rendering differences don't flag
 *
 * These tests only run when explicitly requested (grep "visual") so
 * the main suite stays fast. CI runs a separate job with browser-pinned
 * Chromium for reproducibility.
 */

import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

const AURORA_ROUTES = [
  { path: "/command-centre", name: "command-centre" },
  { path: "/workbench", name: "workbench" },
  { path: "/process", name: "process" },
  { path: "/admin", name: "admin" },
] as const;

for (const route of AURORA_ROUTES) {
  test(`visual — ${route.name}`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: "networkidle" });

    // Let any layout-deferred render settle (fonts, virtualization).
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot(`${route.name}.png`, {
      fullPage: false,
      animations: "disabled",
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
    });
  });
}
