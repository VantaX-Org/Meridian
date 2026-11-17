/**
 * Batch 3 (Runs): every route in fixture mode shows its title, one data row and no middle dot.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3703 npx playwright test e2e/n-runs.spec.ts
 */

import { expect, test } from "@playwright/test";

const NAV = { timeout: 90_000 };
test.setTimeout(180_000); // the first hit on each route compiles it under next dev
const id = (n: number) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = id(499);
const B = id(498);

const ROUTES: { name: string; url: string; title: string | RegExp; row: string }[] = [
  { name: "runs", url: "/runs?fixture=1", title: "Runs", row: "table tbody tr, [role=row]" },
  { name: "jobs", url: "/runs?view=jobs&fixture=1", title: "Runs", row: "table tbody tr, [role=row]" },
  { name: "sets", url: "/runs?view=sets&fixture=1", title: "Runs", row: "table tbody tr, [role=row]" },
  { name: "run", url: `/run/${A}?fixture=1`, title: /.+/, row: "table tbody tr, [role=row]" },
  { name: "compare", url: `/run/${A}/vs/${B}?fixture=1`, title: "Compare runs", row: "table tbody tr, [role=row]" },
  { name: "agreement", url: `/run/${A}/agreement?fixture=1`, title: "Agreement with the cleaned file", row: "table tbody tr, [role=row]" },
];

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([{ name: "mn_session", value: "1", domain: "localhost", path: "/" }]);
  await page.addInitScript(() => {
    try { localStorage.setItem("meridian:theme", "light"); } catch { /* blocked storage */ }
  });
  await page.route("**/api/v1/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
});

for (const r of ROUTES) {
  test(`${r.name} shows its title and a data row, no middle dot`, async ({ page }) => {
    await page.goto(r.url, NAV);
    await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: r.title }).first()).toBeVisible(NAV);
    await expect(page.locator(r.row).nth(1)).toBeVisible(NAV);
    expect(await page.locator("body").innerText()).not.toContain(String.fromCharCode(183));
  });
}

test("start a run sheet opens from the runs list", async ({ page }) => {
  await page.goto("/runs?fixture=1", NAV);
  await page.getByRole("button", { name: "Start a run" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible(NAV);
});

test("extract-target sheet opens from ?open=extract-target", async ({ page }) => {
  await page.goto(`/run/${A}?open=extract-target&fixture=1`, NAV);
  await expect(page.getByRole("dialog")).toBeVisible(NAV);
});
