/**
 * Batch 9, people and governance: every route in fixture mode shows its title, one data row and no middle dot.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3709 npx playwright test e2e/n-people.spec.ts
 */

import { expect, test } from "@playwright/test";

const NAV = { timeout: 90_000 };
const ROUTES: [string, string][] = [
  ["/people?fixture=1", "People"],
  ["/people/stewardship?fixture=1", "Stewardship"],
  ["/people/contracts?fixture=1", "Data contracts"],
  ["/people/digests?fixture=1", "Digests"],
  ["/people/assignments?fixture=1", "Assignments"],
  ["/share/demo-token?fixture=1", "Shared with you"],
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

for (const [url, title] of ROUTES) {
  test(`${url} shows its title, a data row and no middle dot`, async ({ page }) => {
    await page.goto(url, NAV);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible(NAV);
    if (!url.includes("/share/")) await expect(page.getByRole("row").nth(1)).toBeVisible(NAV);
    else await expect(page.getByRole("link", { name: "Open the shared page" })).toBeVisible(NAV);
    expect(await page.locator("body").innerText()).not.toContain(String.fromCharCode(0xb7));
  });
}
