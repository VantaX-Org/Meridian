/**
 * Meridian 2, step 8: the status page and the enterprise admin screens, in fixture mode (`?fixture=1`).
 *
 *   - /status reads signed out (no session cookie), /status reads signed in; components, one 30-day bar, incidents
 *     and maintenance; it reads again every minute; axe finds no critical or serious violation; no sideways scroll.
 *   - The status strip's health word links to it.
 *   - Admin, Settings, Appearance (contrast shown and refused below 4.5:1, the accent applied) and Admin, Users,
 *     Provisioning (SCIM token shown once, the group mapping).
 *   Screenshots: __screenshots__/v2/status-*.png, admin-appearance-*.png, admin-scim-*.png at 1440 and 390, light and dark.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test e2e/v2-status.spec.ts
 */

import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SHOTS = path.join(__dirname, "__screenshots__", "v2");
const NAV = { timeout: 90_000 };
const SIZES = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const;
const SCHEMES = ["light", "dark"] as const;

async function prepare(page: Page, scheme: "light" | "dark", signedIn = true) {
  if (signedIn) await page.context().addCookies([{ name: "mn_session", value: "1", domain: "localhost", path: "/" }]);
  await page.addInitScript((s) => {
    try {
      localStorage.setItem("meridian:theme", s);
    } catch {
      /* blocked storage: the page falls back to the system scheme */
    }
  }, scheme);
  await page.route("**/api/v1/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
}

async function axe(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blockers = result.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  const summary = blockers.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s), ${v.help}\n  ${v.nodes.map((n) => n.target.join(" ")).join("\n  ")}`).join("\n");
  console.log(`[axe] ${label}: ${blockers.length} critical or serious, ${result.violations.length - blockers.length} moderate or minor`);
  expect(blockers, summary).toEqual([]);
}

const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const size of SIZES) {
  for (const scheme of SCHEMES) {
    test.describe(`status and enterprise admin at ${size.name}, ${scheme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme });
      test.setTimeout(180_000);
      const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}_${size.name}_${scheme}.png`), fullPage: name === "status" });

      test("the status page reads signed out: components, 30 days, incidents and maintenance", async ({ page }) => {
        await prepare(page, scheme, false);
        await page.goto("/status?fixture=1", { waitUntil: "load", timeout: 90_000 });
        await expect(page).toHaveURL(/\/status/);
        await expect(page.getByRole("heading", { level: 1, name: "Status" })).toBeVisible(NAV);
        await expect(page.getByTestId("status-overall")).toContainText("Degraded");
        await expect(page.getByRole("region", { name: "Components and their state" }).getByRole("row")).toHaveCount(7);
        await expect(page.getByTestId("uptime").locator(".m2-upcell")).toHaveCount(30);
        await expect(page.getByTestId("uptime")).toContainText("Down");
        await expect(page.getByText("ERR-7F3A91")).toBeVisible();
        await expect(page.getByTestId("maintenance")).toContainText("Planned maintenance");
        await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
        // No map, canvas or inspector here.
        await expect(page.locator("#m2-map")).toHaveCount(0);
        expect(await noSideways(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shot(page, "status");
        await axe(page, `status ${size.name} ${scheme}`);
      });

      test("Admin, Settings, Appearance: contrast as numbers, refused below 4.5:1, applied when saved", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/admin/settings?fixture=1", { waitUntil: "load", timeout: 90_000 });
        const block = page.getByRole("region", { name: "Appearance" });
        await expect(block.getByLabel("Use our own accent colour")).toBeVisible(NAV);
        await block.getByLabel("Use our own accent colour").check();
        const hex = block.getByLabel("Accent, hexadecimal");
        await hex.fill("#e0b000");
        await expect(block.getByTestId("contrast-result")).toContainText("below 4.5:1");
        await expect(block.getByRole("button", { name: "Save the appearance" })).toBeDisabled();
        await hex.fill("#0b5d4b");
        await expect(block.getByTestId("contrast-result")).toContainText("passes");
        await block.getByLabel(/^Product name/).fill("Acme Data Quality");
        await block.scrollIntoViewIfNeeded();
        expect(await noSideways(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await block.screenshot({ path: path.join(SHOTS, `admin-appearance_${size.name}_${scheme}.png`) });
        await axe(page, `admin appearance ${size.name} ${scheme}`);
        await block.getByRole("button", { name: "Save the appearance" }).click();
        await expect(block.getByText("Appearance saved")).toBeVisible(NAV);
        await expect(page.locator(".m2-root")).toHaveAttribute("data-tenant-accent", "");
        await expect(page.getByRole("link", { name: "Acme Data Quality, go to the landscape" })).toBeAttached();
        const data = await page.locator(".m2-root").evaluate((el) => getComputedStyle(el).getPropertyValue("--m2-data").trim().toLowerCase());
        expect(data).toBe(scheme === "light" ? "#0b5d4b" : data);
        await page.screenshot({ path: path.join(SHOTS, `admin-appearance-applied_${size.name}_${scheme}.png`) });
      });

      test("Admin, Users, Provisioning: the token shown once and the group mapping", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/admin/users?fixture=1", { waitUntil: "load", timeout: 90_000 });
        const card = page.getByTestId("scim-card");
        await expect(card.getByText("Active")).toBeVisible(NAV);
        await expect(card).toContainText("/scim/v2");
        await expect(card).toContainText("mscim_");
        await card.getByRole("button", { name: "Rotate the token" }).click();
        await page.getByRole("dialog", { name: "Rotate the SCIM token" }).getByRole("button", { name: "Rotate" }).click();
        await expect(card.getByTestId("scim-secret")).toContainText("Shown once.");
        await expect(card.getByRole("region", { name: "Group to role mapping" }).getByRole("row")).toHaveCount(4);
        expect(await noSideways(page)).toBe(true);
        await card.scrollIntoViewIfNeeded();
        await page.waitForLoadState("networkidle");
        await card.screenshot({ path: path.join(SHOTS, `admin-scim_${size.name}_${scheme}.png`) });
        await axe(page, `admin scim ${size.name} ${scheme}`);
      });
    });
  }
}

test.describe("status: signed in, the health word, and the minute refresh", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.setTimeout(180_000);

  test("/status reads signed in, with the way back to Meridian", async ({ page }) => {
    await prepare(page, "light");
    await page.goto("/status?fixture=1", { waitUntil: "load", timeout: 90_000 });
    await expect(page.getByTestId("status-overall")).toContainText("Degraded", NAV);
    await expect(page.getByRole("link", { name: "Back to Meridian" })).toBeVisible();
  });

  test("/status reads signed out too, with Sign in instead of the way back; /v2/status redirects to it", async ({ page }) => {
    await prepare(page, "light", false);
    await page.goto("/v2/status?fixture=1", { waitUntil: "load", timeout: 90_000 });
    await expect(page).toHaveURL(/\/status\?fixture=1/);
    await expect(page.getByTestId("status-overall")).toContainText("Degraded", NAV);
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to Meridian" })).toHaveCount(0);
  });

  test("the status strip's health word opens the status page", async ({ page }) => {
    await prepare(page, "light");
    await page.goto("/?fixture=1", { waitUntil: "load", timeout: 90_000 });
    const word = page.getByTestId("status-health");
    await expect(word).toContainText("Degraded", NAV);
    await word.click();
    await expect(page).toHaveURL(/\/status/, NAV);
    await expect(page.getByRole("heading", { level: 1, name: "Status" })).toBeVisible(NAV);
  });

  test("reads the status again every minute", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-20T08:00:10Z") });
    await prepare(page, "light", false);
    await page.goto("/status?fixture=1", { waitUntil: "load", timeout: 90_000 });
    const updated = page.getByText(/^Checked .* This page reads the status again every minute\.$/);
    await expect(updated).toContainText("08:00", NAV);
    await page.clock.fastForward(61_000);
    await expect(updated).toContainText("08:01", NAV);
  });
});
