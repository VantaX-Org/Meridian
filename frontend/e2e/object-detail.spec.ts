/**
 * Object detail keyboard path in fixture mode: J moves, Enter opens the side panel, Escape closes it,
 * group-by writes the URL, and a reload keeps the state.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3918 npx playwright test e2e/object-detail.spec.ts
 */

import { expect, test } from "@playwright/test";

const URL = "/o/ecc-production/material-master?fixture=1";

test.beforeEach(async ({ page }) => {
  test.setTimeout(150_000); // first hit compiles the route in dev
  await page.context().addCookies([{ name: "mn_session", value: "1", domain: "localhost", path: "/" }]);
  await page.route("**/api/v1/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
});

test("rule grid: J, Enter, Escape, group-by, reload", async ({ page }) => {
  await page.goto(URL, { timeout: 120_000 });
  await expect(page.getByTestId("score-hero")).toBeVisible({ timeout: 60_000 });
  const grid = page.getByRole("group", { name: "Every measured rule" });
  await grid.focus();
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/rules\.open=/);
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/rules\.open=/);
  await page.getByLabel("Group by").selectOption({ index: 1 });
  await expect(page).toHaveURL(/rules\.group=/);
  await page.reload();
  await expect(page).toHaveURL(/rules\.group=/);
});
