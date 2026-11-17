/**
 * Batch 4 work and approvals screens in fixture mode: title, one data row, no middle dot.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3704 npx playwright test e2e/n-work.spec.ts
 */

import { expect, test } from "@playwright/test";

const NAV = { timeout: 90_000 };
const ROUTES: [string, string][] = [
  ["/work", "Work"],
  ["/work/triage", "Triage"],
  ["/work/exceptions", "Exceptions"],
  ["/work/exceptions?view=rules", "Exceptions"],
  ["/work/analytics", "Work analytics"],
  ["/work/requests", "Data requests"],
  ["/approvals", "Approvals"],
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
  test(`${path} shows ${title}, a data row and no middle dot`, async ({ page }) => {
    await page.goto(`${path}${path.includes("?") ? "&" : "?"}fixture=1`, NAV);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible(NAV);
    await expect(page.getByRole("row").nth(1)).toBeVisible(NAV);
    expect(await page.locator("body").innerText()).not.toContain(String.fromCharCode(183));
  });
}
