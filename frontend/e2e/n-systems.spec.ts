/**
 * Batch 10, Systems, in fixture mode: list, connect wizard and the system screen with every tab.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3710 npx playwright test e2e/n-systems.spec.ts
 */

import { expect, test, type Page } from "@playwright/test";

const NAV = { timeout: 90_000 };
const SYS = "a1b2c3d4-0001-4000-8000-000000000001";
const MIDDLE_DOT = String.fromCharCode(0xb7);

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([{ name: "mn_session", value: "1", domain: "localhost", path: "/" }]);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("meridian:theme", "light");
    } catch {
      /* blocked storage */
    }
  });
  await page.route("**/api/v1/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
});

const noDot = async (page: Page) => expect(await page.locator("body").innerText()).not.toContain(MIDDLE_DOT);

test("systems list shows rows and links to the wizard", async ({ page }) => {
  await page.goto("/s?fixture=1", NAV);
  await expect(page.getByRole("heading", { level: 1, name: "Systems" })).toBeVisible(NAV);
  await expect(page.getByRole("row").nth(1)).toBeVisible(NAV);
  await expect(page.getByRole("link", { name: "Connect a system" })).toBeVisible();
  await noDot(page);
});

test("connect wizard shows the form with a masked password", async ({ page }) => {
  await page.goto("/s/new?fixture=1", NAV);
  await expect(page.getByRole("heading", { level: 1, name: "Connect a system" })).toBeVisible(NAV);
  await expect(page.getByLabel("System name")).toBeVisible();
  await expect(page.locator('input[type="password"]').first()).toBeVisible();
  await noDot(page);
});

for (const tab of ["extractions", "design", "config", "pilot", "reference", "custom"]) {
  test(`system screen tab ${tab}`, async ({ page }) => {
    await page.goto(`/s/${SYS}?fixture=1&tab=${tab}`, NAV);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible(NAV);
    await expect(page.getByRole("tab", { selected: true })).toBeVisible(NAV);
    await expect(page.getByRole("tabpanel")).toBeVisible(NAV);
    await expect(page.getByRole("tabpanel").locator("h2, [role=row], li, [role=status]").first()).toBeVisible(NAV);
    await noDot(page);
  });
}
