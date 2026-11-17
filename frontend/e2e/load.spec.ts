/**
 * Batch 5: every Load route in fixture mode shows its title, at least one data row and no U+00B7.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3705 npx playwright test e2e/load.spec.ts
 */

import { expect, test } from "@playwright/test";

const NAV = { timeout: 150_000 };

test.setTimeout(300_000);

const ROUTES: [string, string][] = [
  ["/load", "Load"],
  ["/load/plan", "Load order"],
  ["/load/s4", "S/4 readiness"],
  ["/load/go-live", "Go-live readiness"],
  ["/load/waves", "Migration waves"],
  ["/load/waves/w-1", "Wave 1: finance foundations"],
  ["/load/runs", "Migration runs"],
  ["/load/runs/mig-0002", "Run mig-0002"],
  ["/load/templates", "Target templates"],
  ["/load/maps", "Field and value maps"],
  ["/load/compare", "Paired systems"],
  ["/load/compare/pair-0001", "ECC production to S/4HANA quality"],
];

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([{ name: "mn_session", value: "1", domain: "localhost", path: "/" }]);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("meridian:theme", "light");
    } catch {
      /* blocked storage: the page falls back to the system scheme */
    }
  });
  await page.route("**/api/v1/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
});

for (const [path, title] of ROUTES) {
  test(`${path} shows its title and data`, async ({ page }) => {
    await page.goto(`${path}?fixture=1`, NAV);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible(NAV);
    await expect(page.getByRole("main").getByRole("row").nth(1)).toBeVisible(NAV);
    expect(await page.locator("body").innerText()).not.toContain(String.fromCharCode(0xb7));
  });
}
