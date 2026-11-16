/**
 * Master data and match screens (batch 7a) in fixture mode: every route shows its title, a data row and no middle dot.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3707 npx playwright test e2e/n-mdm.spec.ts
 */

import { expect, test } from "@playwright/test";

const NAV = { timeout: 90_000 };

const ROUTES: { path: string; title: string | RegExp; row: "row" | "link" | "item" }[] = [
  { path: "/n/mdm", title: "Master data", row: "link" },
  { path: "/n/mdm/golden", title: "Golden records", row: "row" },
  { path: "/n/mdm/golden/gr-0", title: /\S/, row: "row" },
  { path: "/n/mdm/match", title: "Match review", row: "row" },
  { path: "/n/mdm/match/gr-0", title: "Match cluster", row: "row" },
  { path: "/n/mdm/match-rules", title: "Match rules", row: "row" },
  { path: "/n/mdm/survivorship", title: "Survivorship", row: "item" },
];

test.setTimeout(150_000);

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

for (const r of ROUTES) {
  test(`${r.path} shows title, a data row and no middle dot`, async ({ page }) => {
    await page.goto(`${r.path}?fixture=1`, NAV);
    await expect(page.getByRole("heading", { level: 1, name: r.title })).toBeVisible(NAV);
    if (r.row === "row") await expect(page.getByRole("row").nth(1)).toBeVisible(NAV);
    else if (r.row === "item") await expect(page.getByRole("main").getByRole("listitem").first()).toBeVisible(NAV);
    else await expect(page.getByRole("main").getByRole("link").first()).toBeVisible(NAV);
    expect(await page.locator("body").innerText()).not.toContain(String.fromCharCode(0xb7));
  });
}
