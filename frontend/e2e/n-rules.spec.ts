/**
 * The rebuilt rules screens (design C) in fixture mode: library and each view, the dry run, promotion and a rule page.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3706 npx playwright test e2e/n-rules.spec.ts
 */

import { expect, test } from "@playwright/test";

const NAV = { timeout: 90_000 };
const ROUTES: { path: string; title: string | RegExp; row: string }[] = [
  { path: "/n/rules?fixture=1", title: "Rules", row: "main table tbody tr[id^=mx-row-]" },
  { path: "/n/rules?view=drafts&fixture=1", title: "Rules", row: "main table, main [role=grid], main [role=list], main .mx-card" },
  { path: "/n/rules?view=learned&fixture=1", title: "Rules", row: "main .mx-card" },
  { path: "/n/rules?view=coverage&fixture=1", title: "Rules", row: "main .mx-card" },
  { path: "/n/rules?view=packs&fixture=1", title: "Rules", row: "main .mx-card" },
  { path: "/n/rules?view=fix-drafts&fixture=1", title: "Rules", row: "main .mx-card, main [role=grid]" },
  { path: "/n/rules/dry-run?fixture=1", title: "Try a rule change", row: "main .mx-card" },
  { path: "/n/rules/promotion?fixture=1", title: "Rule promotion", row: "main .mx-card" },
  { path: "/n/r/MM142?fixture=1", title: /.+/, row: "[role=tab]" },
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

for (const r of ROUTES) {
  test(`renders ${r.path}`, async ({ page }) => {
    await page.goto(r.path, NAV);
    await expect(page.getByRole("heading", { level: 1, name: r.title }).first()).toBeVisible(NAV);
    await expect(page.locator(r.row).first()).toBeVisible(NAV);
    expect(await page.locator("body").innerText()).not.toContain(String.fromCharCode(0xb7));
  });
}
