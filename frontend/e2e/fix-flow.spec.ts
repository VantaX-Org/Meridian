/**
 * The fix screen in fixture mode: from a filtered link to a load file by keyboard, the retired Triage, Exceptions and
 * Approvals addresses redirecting with their filter, the two timing budgets and axe in both themes.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3704 npx playwright test e2e/fix-flow.spec.ts
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const NAV = { timeout: 90_000 };

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([{ name: "mn_session", value: "1", domain: "localhost", path: "/" }]);
  await page.route("**/api/v1/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
});

const count = async (page: import("@playwright/test").Page): Promise<number> =>
  Number(/^(\d+)/.exec((await page.getByTestId("decision-sentence").innerText()) ?? "")?.[1]);

test("a filtered link lands on the grid; accept, undo, accept all and the load file work by keyboard", async ({ page }) => {
  await page.goto("/work?fixture=1&seg=proposed", NAV);
  await expect(page.getByTestId("fix-grid")).toBeVisible(NAV);
  const row = page.getByTestId("fix-grid").getByRole("row").nth(1);
  await row.click();
  const before = await count(page);
  const t0 = Date.now();
  await page.keyboard.press("a");
  await expect.poll(() => count(page), { timeout: 2000 }).toBe(before + 1);
  expect(Date.now() - t0).toBeLessThan(400);
  await page.keyboard.press("Control+z");
  await expect.poll(() => count(page), NAV).toBe(before);
  await page.keyboard.press("Shift+A");
  await expect(page.getByTestId("apply-preview")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect.poll(() => count(page), NAV).toBeGreaterThan(before);
  await page.getByTestId("create-load-file").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("load-dialog")).toBeVisible();
});

for (const [from, to] of [["/work/triage", "triage"], ["/work/exceptions", "exceptions"], ["/approvals", "approvals"]]) {
  test(`${from} redirects to the fix screen with ${to} open`, async ({ page }) => {
    await page.goto(`${from}?fixture=1`, NAV);
    await expect(page).toHaveURL(new RegExp(`/work\\?.*open=${to}`), NAV);
    await expect(page.getByTestId("fix-screen")).toBeVisible(NAV);
  });
}

for (const theme of ["light", "dark"]) {
  test(`axe finds nothing serious in ${theme}`, async ({ page }) => {
    await page.addInitScript((v) => { try { localStorage.setItem("meridian:theme", v); } catch { /* blocked */ } }, theme);
    await page.goto("/work?fixture=1", NAV);
    await expect(page.getByTestId("fix-grid")).toBeVisible(NAV);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });
}
