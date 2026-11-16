/**
 * The rebuilt object screen (design C, Split analyst) at /n/o/{system}/{module} in fixture mode: the header, the score
 * ring and the rule list, then a selected row and the detail tabs, and the Aletheia chat opened from the launcher.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3700 npx playwright test e2e/ui-object.spec.ts
 */

import { expect, test } from "@playwright/test";

const URL = "/n/o/ecc-production/material-master?fixture=1";
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

test("object screen shows header, ring and list, and a row opens the detail tabs", async ({ page }) => {
  await page.goto(URL, NAV);
  await expect(page.getByRole("heading", { level: 1, name: "Material master" })).toBeVisible(NAV);
  await expect(page.getByRole("link", { name: "Fix records" })).toBeVisible();
  await expect(page.getByRole("img", { name: /score/i }).first()).toBeVisible();
  const list = page.getByRole("list", { name: "Failing rules" });
  await expect(list).toBeVisible();
  await list.getByRole("button").nth(1).click();
  await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
  await page.getByRole("tab", { name: "Why" }).click();
  await expect(page.getByRole("link", { name: "Open the rule" })).toBeVisible();
});

test("Aletheia chat opens from the launcher and answers with evidence", async ({ page }) => {
  await page.goto(URL, NAV);
  await page.getByRole("main").getByRole("button", { name: "Ask Aletheia" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "What can I fix first?" }).click();
  await expect(dialog.getByRole("link", { name: "Review fixes" })).toBeVisible();
});
