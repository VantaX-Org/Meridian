/**
 * The admin index and the ten access sections (11a) at /admin and /admin/{section} in fixture mode: each route
 * shows its title, at least one row of data and never the middle dot.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3711 npx playwright test e2e/admin-access.spec.ts
 */

import { expect, test } from "@playwright/test";

const NAV = { timeout: 90_000 };
test.setTimeout(180_000);
const DOT = String.fromCharCode(0xb7);

/** slug, h1 text, and a locator for one real data row or field on that screen. */
const ROUTES: [string, string, string][] = [
  ["", "Administration", "ul li"],
  ["users", "Users", "[role=row], tbody tr"],
  ["roles", "Roles", "[role=row], tbody tr"],
  ["apikeys", "API keys", "[role=row], tbody tr"],
  ["signin", "Sign in and provisioning", "input, .mx-code, [role=row]"],
  ["settings", "Settings", "input"],
  ["scoring", "Scoring", "input"],
  ["notify", "Notifications", "[role=row], tbody tr, input"],
  ["webhooks", "Webhooks", "[role=row], tbody tr, input"],
  ["llm", "Language model", "input, select"],
  ["licence", "Licence", "[role=row], tbody tr, .mx-code"],
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

for (const [slug, title, row] of ROUTES) {
  test(`/admin/${slug} shows its title and data`, async ({ page }) => {
    await page.goto(`/admin${slug ? `/${slug}` : ""}?fixture=1`, NAV);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible(NAV);
    await expect(page.locator("main").locator(row).first()).toBeVisible(NAV);
    expect(await page.locator("main").innerText()).not.toContain(DOT);
  });
}

test("the invite button on the users screen opens a sheet", async ({ page }) => {
  await page.goto("/admin/users?fixture=1", NAV);
  await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible(NAV);
  await page.getByRole("button", { name: "Invite someone" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
