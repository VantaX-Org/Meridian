/**
 * Batch 11b routes in fixture mode: /n/reports, /n/me, /n/me/notifications. Each shows a title, at least one data row
 * and no middle dot.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3721 PW_CHROMIUM=... npx playwright test e2e/n-admin-ops.spec.ts
 */

import { expect, test } from "@playwright/test";

const NAV = { timeout: 90_000 };
test.setTimeout(180_000);
const ROUTES = ["/n/reports", "/n/me", "/n/me/notifications"] as const;

for (const route of ROUTES) {
  test(`${route} shows a title and a data row`, async ({ page }) => {
    await page.context().addCookies([{ name: "mn_session", value: "1", domain: "localhost", path: "/" }]);
    await page.goto(`${route}?fixture=1`, { waitUntil: "domcontentloaded", ...NAV });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible(NAV);
    await expect(page.getByRole("row").nth(1)).toBeVisible(NAV);
    expect(await page.locator("body").innerText()).not.toContain(String.fromCharCode(0xb7));
  });
}
