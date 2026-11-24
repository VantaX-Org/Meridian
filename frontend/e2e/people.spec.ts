/**
 * Batch 9, people and governance: every route in fixture mode shows its title, one data row and no middle dot.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3709 npx playwright test e2e/people.spec.ts
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

test("an admin names an owner and steward for an object, previews the template and applies it", async ({ page }) => {
  await page.goto("/people/assignments?fixture=1", NAV);
  await expect(page.getByRole("heading", { level: 1, name: "Assignments" })).toBeVisible(NAV);
  const assign = page.getByRole("group", { name: "Gaps" }).getByRole("button", { name: "Assign" }).first();
  await expect(assign).toBeEnabled(NAV);
  await assign.click();
  const owner = page.getByRole("combobox", { name: "Owner" });
  await expect(owner).toBeVisible(NAV);
  await owner.selectOption({ index: 1 });
  await page.getByRole("combobox", { name: /^Steward/ }).first().selectOption({ index: 1 });
  await page.getByRole("button", { name: "Save to the template" }).click();
  await expect(page.getByText("Saved. Preview the template to apply it.")).toBeVisible(NAV);
  await page.getByRole("button", { name: "Preview the template" }).click();
  const apply = page.getByRole("button", { name: "Apply the template" });
  await expect(apply).toBeEnabled(NAV);
  await apply.click();
  await expect(page.getByText(/^Template applied: \d+ changes/)).toBeVisible(NAV);
});
