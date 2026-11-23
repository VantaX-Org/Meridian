/**
 * Batch 13 object sub-screens in fixture mode: every route shows its title, one data row, and no U+00B7.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3713 npx playwright test e2e/object-tabs.spec.ts
 */

import { expect, test } from "@playwright/test";

const BASE = "/o/ecc-production/material-master";
const NAV = { timeout: 90_000 };

// ponytail: "row" = any table row, list item or card heading below the title; tighten per screen if fixtures change.
const ROUTES: [string, string][] = [
  ["records", "Records"],
  ["records/000000000000000001", "Hydraulic pump seal kit"],
  ["trend", "Trend"],
  ["runs", "Runs"],
  ["fixes", "Fixes"],
  ["rules", "Rules"],
  ["golden", "Golden records"],
  ["glossary", "Glossary"],
  ["lineage", "Lineage"],
  ["profile", "Profile"],
  ["readiness", "Readiness"],
  ["processes", "Processes"],
  ["processes/design", "Process designer"],
];

test.beforeEach(async ({ page }) => {
  test.setTimeout(150_000); // first hit of each route compiles it in dev
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
    await page.goto(`${BASE}/${path}?fixture=1`, NAV);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible(NAV);
    await expect(page.getByRole("main").locator("tr, li, [role=row], [role=listitem]").locator("visible=true").first()).toBeVisible(NAV);
    expect(await page.locator("body").innerText()).not.toContain(String.fromCharCode(183));
  });
}
