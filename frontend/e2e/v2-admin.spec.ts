/**
 * Meridian 2, step 6: the Admin area, preferences, help, reports and schedules, and migration waves, in fixture mode
 * (`?fixture=1`), so the spec needs no API. At 1440 and 390, light and dark: each canvas draws, an inspector opens, axe
 * finds no critical or serious violation, nothing scrolls the page sideways, and a screenshot of each lands in
 * e2e/__screenshots__/v2/admin-*.png, reports-*.png and waves-*.png.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test e2e/v2-admin.spec.ts
 */

import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SHOTS = path.join(__dirname, "__screenshots__", "v2");
const SIZES = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const;
const SCHEMES = ["light", "dark"] as const;
const NAV = { timeout: 90_000 };

async function prepare(page: Page, scheme: "light" | "dark") {
  await page.context().addCookies([{ name: "mn_session", value: "1", domain: "localhost", path: "/" }]);
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
  console.log(`[a11y] ${label}: ${result.violations.filter((v) => v.impact === "moderate").length} moderate (non-blocking)`);
  expect(blockers, summary).toEqual([]);
}

const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const size of SIZES) {
  for (const scheme of SCHEMES) {
    test.describe(`v2 admin at ${size.name}, ${scheme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme });
      test.setTimeout(150_000);
      const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}_${size.name}_${scheme}.png`) });
      const phone = size.width < 500;
      const go = async (page: Page, url: string) => {
        await prepare(page, scheme);
        await page.goto(url, { waitUntil: "load", timeout: 90_000 });
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1, NAV);
      };

      test("users: the people, their status, and a person's inspector", async ({ page }) => {
        await go(page, "/v2/admin/users?fixture=1");
        await expect(page.getByRole("heading", { level: 1 })).toContainText("Users", NAV);
        if (!phone) {
          const grid = page.getByRole("grid", { name: "Users" });
          await expect(grid.getByText("Nomsa Dlamini")).toBeVisible(NAV);
          await expect(page.getByTestId("admin-index").getByRole("link", { name: "Roles and permissions" })).toBeVisible();
          await grid.getByText("Aisha Khan").click();
        } else {
          await expect(page.getByRole("button", { name: "Invite a user" })).toBeVisible(NAV);
        }
        expect(await noSideways(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shot(page, "admin-users");
        await axe(page, `admin users ${size.name} ${scheme}`);
        if (!phone) {
          const dialog = page.getByRole("dialog", { name: "Aisha Khan" });
          await expect(dialog.getByRole("button", { name: "Suspend" })).toBeVisible(NAV);
          await shot(page, "admin-user-inspector");
          await axe(page, `admin user inspector ${size.name} ${scheme}`);
        }
      });

      test("settings: weights, bands, cost model and retention", async ({ page }) => {
        await go(page, "/v2/admin/settings?fixture=1");
        await expect(page.getByText("Demo Corp")).toBeVisible(NAV);
        await expect(page.getByRole("button", { name: "Save weights" })).toBeVisible(NAV);
        expect(await noSideways(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shot(page, "admin-settings");
        await axe(page, `admin settings ${size.name} ${scheme}`);
      });

      test("audit log and runs and jobs", async ({ page }) => {
        await go(page, "/v2/admin/audit?fixture=1");
        await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible(NAV);
        if (!phone) await expect(page.getByRole("grid", { name: "Audit log" }).getByText("Nomsa Dlamini").first()).toBeVisible(NAV);
        expect(await noSideways(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shot(page, "admin-audit");
        await axe(page, `admin audit ${size.name} ${scheme}`);
        await page.goto("/v2/admin/runs?fixture=1", { waitUntil: "load", timeout: 90_000 });
        await expect(page.getByRole("button", { name: "Schedule a run" })).toBeVisible(NAV);
        expect(await noSideways(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shot(page, "admin-runs");
        await axe(page, `admin runs ${size.name} ${scheme}`);
      });

      test("preferences and help open from the top bar and the account menu", async ({ page }) => {
        await go(page, "/v2?fixture=1");
        await page.getByRole("button", { name: "Help" }).click();
        const help = page.getByRole("dialog", { name: "Help" });
        await expect(help.getByRole("heading", { name: "On this screen" })).toBeVisible(NAV);
        await page.waitForLoadState("networkidle");
        await shot(page, "admin-help");
        await axe(page, `help ${size.name} ${scheme}`);
        await page.goto("/v2?fixture=1&open=preferences", { waitUntil: "load", timeout: 90_000 });
        const prefs = page.getByRole("dialog", { name: "Preferences" });
        await expect(prefs.getByRole("group", { name: "Theme" })).toBeVisible(NAV);
        await page.waitForLoadState("networkidle");
        await shot(page, "admin-preferences");
        await axe(page, `preferences ${size.name} ${scheme}`);
      });
    });

    test.describe(`v2 reports at ${size.name}, ${scheme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme });
      test.setTimeout(150_000);
      const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}_${size.name}_${scheme}.png`) });
      const phone = size.width < 500;

      test("reports and schedules, a schedule's inspector", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/v2/reports?fixture=1", { waitUntil: "load", timeout: 90_000 });
        await expect(page.getByRole("heading", { level: 1 })).toContainText("Reports", NAV);
        await expect(page.getByRole("button", { name: "Create a report" })).toBeVisible(NAV);
        if (!phone) {
          await expect(page.getByRole("grid", { name: "Reports" }).getByText("Board pack").first()).toBeVisible(NAV);
          await expect(page.getByRole("grid", { name: "Schedules" }).getByText("Every Monday at 07:00").first()).toBeVisible(NAV);
        }
        expect(await noSideways(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shot(page, "reports");
        await axe(page, `reports ${size.name} ${scheme}`);
        await page.goto("/v2/reports?fixture=1&open=schedule:sch-1", { waitUntil: "load", timeout: 90_000 });
        const dialog = page.getByRole("dialog", { name: "Board pack for the steering committee" });
        await expect(dialog.getByRole("button", { name: "Pause" })).toBeVisible(NAV);
        await page.waitForLoadState("networkidle");
        await shot(page, "reports-schedule");
        await axe(page, `reports schedule ${size.name} ${scheme}`);
      });
    });

    test.describe(`v2 waves at ${size.name}, ${scheme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme });
      test.setTimeout(150_000);
      const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}_${size.name}_${scheme}.png`) });
      const phone = size.width < 500;

      test("the landscape grouped by wave, and the waves editor", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/v2?fixture=1&view=waves", { waitUntil: "load", timeout: 90_000 });
        await expect(page.getByTestId("wave-next-step")).toContainText("Clear the 3 no-go objects in Wave 1", NAV);
        if (!phone) await expect(page.getByTestId("wave-head")).toHaveCount(4, NAV);
        expect(await noSideways(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shot(page, "waves");
        await axe(page, `waves ${size.name} ${scheme}`);
        await page.goto("/v2?fixture=1&view=waves&open=waves", { waitUntil: "load", timeout: 90_000 });
        const dialog = page.getByRole("dialog", { name: "Migration waves" });
        await expect(dialog.getByRole("table", { name: "Objects by wave" })).toBeVisible(NAV);
        await page.waitForLoadState("networkidle");
        await shot(page, "waves-editor");
        await axe(page, `waves editor ${size.name} ${scheme}`);
      });
    });
  }
}
