/**
 * The kit gallery at /kit in fixture mode: a table row selects by keyboard, a toast shows, the command palette opens and asks Aletheia.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3700 npx playwright test e2e/ui-kit.spec.ts
 */

import { expect, test } from "@playwright/test";

const URL = "/kit?fixture=1";
const NAV = { timeout: 90_000 };

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

test("gallery renders and the table and toast work", async ({ page }) => {
  await page.goto(URL, NAV);
  await expect(page.getByRole("heading", { name: "Kit gallery" })).toBeVisible(NAV);
  const table = page.getByRole("group", { name: "Rules" });
  await table.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Show toast" }).click();
  await expect(page.getByRole("status").getByText("Saved")).toBeVisible();
});

test("command palette opens with Ctrl+K and asks Aletheia", async ({ page }) => {
  await page.goto(URL, NAV);
  await expect(page.getByRole("heading", { name: "Kit gallery" })).toBeVisible(NAV);
  await page.keyboard.press("Control+k");
  const box = page.getByRole("combobox", { name: "Command palette" });
  await expect(box).toBeVisible();
  await box.fill("what is failing");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: /Aletheia/ })).toBeVisible();
});
