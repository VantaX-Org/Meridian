/**
 * Batch 7b routes in fixture mode: every catalogue, glossary, lineage, process and change request route shows its title,
 * at least one data row and no middle dot.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3717 npx playwright test e2e/mdm-catalogue.spec.ts
 */

import { expect, test } from "@playwright/test";

const NAV = { timeout: 90_000 };

// the dev server compiles each route on first visit
test.setTimeout(150_000);
const ROUTES: [string, string | RegExp][] = [
  ["/mdm/catalogue", "Catalogue"],
  ["/mdm/glossary", "Glossary"],
  ["/mdm/reference", "Reference data"],
  ["/mdm/links", "Links"],
  ["/mdm/mining", "Data mining"],
  ["/mdm/lineage", "Lineage"],
  ["/mdm/issues", "Record issues"],
  ["/mdm/processes", "Process discovery"],
  ["/requests", "Change requests"],
  ["/requests/new", "New request"],
  ["/requests/CR-1001", "New spare part: hydraulic seal kit"],
  ["/requests/analytics", "Process analytics"],
  ["/requests/workflows", "Workflows"],
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
  test(`${path} shows its title and a data row`, async ({ page }) => {
    await page.goto(`${path}?fixture=1`, NAV);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible(NAV);
    // a grid row (header plus one), a list item, a graph node label, or a form field (the new request form) counts as data
    await expect(page.getByRole("main").locator("tbody tr, [role=row], li, svg g text, input, textarea, select").nth(1)).toBeVisible(NAV);
    expect(await page.locator("body").innerText()).not.toContain(String.fromCharCode(0xb7));
  });
}
