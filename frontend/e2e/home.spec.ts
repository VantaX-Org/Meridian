/**
 * Batch 2 routes in fixture mode: Home, Objects, Status. Each shows its title, one data row, and no U+00B7.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3702 npx playwright test e2e/home.spec.ts
 */

import { expect, test } from "@playwright/test";

const NAV = { timeout: 90_000 };
const ROUTES = [
  { url: "/?fixture=1", title: "Home", row: (p: import("@playwright/test").Page) => p.getByRole("list", { name: "Attention items" }).getByRole("button").first() },
  { url: "/o?fixture=1", title: "Objects", row: (p: import("@playwright/test").Page) => p.getByRole("main").getByRole("row").nth(1) },
  { url: "/status?fixture=1", title: "Status", row: (p: import("@playwright/test").Page) => p.getByRole("main").getByRole("row").nth(1) },
];

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([{ name: "mn_session", value: "1", domain: "localhost", path: "/" }]);
  await page.addInitScript(() => {
    try { localStorage.setItem("meridian:theme", "light"); } catch { /* blocked storage */ }
  });
  await page.route("**/api/v1/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
});

for (const r of ROUTES) {
  test(`${r.url} shows title, a data row, no middle dot`, async ({ page }) => {
    await page.goto(r.url, NAV);
    await expect(page.getByRole("heading", { level: 1, name: r.title })).toBeVisible(NAV);
    await expect(r.row(page)).toBeVisible(NAV);
    expect(await page.locator("body").innerText()).not.toContain(String.fromCharCode(0xb7));
    if (r.title === "Home") await page.screenshot({ path: "/private/tmp/claude-501/-Users-reshigan/d1c5bf99-9d06-4fbf-b894-bf4df80b630f/scratchpad/b2-main.png" });
  });
}
