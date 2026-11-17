/**
 * Insights and Monitor screens (batch 8) in fixture mode: each route shows its title, at least one data row and no
 * middle dot, and the Aletheia chat opens from a screen with its scope.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3708 npx playwright test e2e/insights.spec.ts
 */

import { expect, test } from "@playwright/test";

const NAV = { timeout: 90_000 };
const ROW = "main tbody tr, main [role='listitem'], main li, main .b8-item";

const routes: [string, string][] = [
  ["/insights?fixture=1", "Insights"],
  ["/insights/score?fixture=1", "Score lens"],
  ["/insights/forecast?fixture=1", "Forecast"],
  ["/insights/value?fixture=1", "Value"],
  ["/monitor?fixture=1", "Monitor"],
  ["/monitor?fixture=1&view=objects", "Monitor"],
  ["/monitor?fixture=1&view=after-clean", "Monitor"],
  ["/monitor?fixture=1&view=learned", "Monitor"],
  ["/monitor?fixture=1&view=shifts", "Monitor"],
  ["/monitor?fixture=1&view=config", "Monitor"],
  ["/monitor?fixture=1&view=contracts", "Monitor"],
  ["/monitor?fixture=1&view=gate", "Monitor"],
  ["/monitor?fixture=1&open=schedule", "Monitor"],
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

for (const [url, title] of routes) {
  test(`${url} shows its title and a data row`, async ({ page }) => {
    await page.goto(url, NAV);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible(NAV);
    await expect(page.locator(ROW).first()).toBeVisible(NAV);
    expect(await page.locator("body").innerText()).not.toContain(String.fromCharCode(0xb7));
  });
}

test("Aletheia chat opens from the insights screen", async ({ page }) => {
  await page.goto("/insights?fixture=1", NAV);
  await page.getByRole("button", { name: "Ask Aletheia" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
