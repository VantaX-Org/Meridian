/**
 * Meridian 2, step 6b: the System canvas with its Configuration, Schedules and Custom objects views, the connection
 * form, the extraction scope editor and the inspectors behind them, in fixture mode (`/?fixture=1`), so the spec needs
 * no API. At 1440 and 390, light and dark: each view is there, the verbs answer in their frames, no page scrolls
 * sideways, axe finds no critical or serious violation, and a screenshot of each lands in
 * e2e/__screenshots__/v2/system-*.png.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test e2e/v2-systems.spec.ts
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
const ECC = "a1b2c3d4-0001-4000-8000-000000000001";

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
  console.log(`[a11y] ${label}: ${result.violations.filter((v) => v.impact === "moderate").length} moderate, ${result.violations.filter((v) => v.impact === "minor").length} minor (non-blocking)`);
  expect(blockers, summary).toEqual([]);
}

const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const size of SIZES) {
  for (const scheme of SCHEMES) {
    test.describe(`v2 systems at ${size.name}, ${scheme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme });
      const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `system-${name}_${size.name}_${scheme}.png`) });

      test("Configuration lists the areas, and an area opens its objects", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`/s/${ECC}?fixture=1&tab=configuration`, { waitUntil: "load", timeout: 90_000 });
        const areas = page.getByTestId("config-areas");
        await expect(areas.getByRole("link")).toHaveCount(12, NAV);
        await expect(areas).toContainText("No authorisation to read this table");
        await areas.getByRole("link", { name: "Human resources" }).click();
        const dialog = page.getByRole("dialog", { name: "Human resources" });
        await expect(dialog.getByTestId("area-objects")).toContainText("SAP standard baseline");
        await page.waitForLoadState("networkidle");
        expect(await noSideways(page)).toBe(true);
        await shot(page, "config");
        await axe(page, `config ${size.name} ${scheme}`);
      });

      test("Configuration: source, drift log and comparison with the target", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`/s/${ECC}?fixture=1&tab=configuration&part=compare`, { waitUntil: "load", timeout: 90_000 });
        await expect(page.getByTestId("compare-target")).toContainText("Compared with S/4HANA sandbox", NAV);
        await page.getByRole("button", { name: "Propose matches" }).click();
        await expect(page.getByText("2 matches sent to the steward queue")).toBeVisible();
        await page.getByRole("link", { name: "Drift log" }).click();
        await expect(page.getByTestId("config-drift")).toBeVisible();
        expect(await noSideways(page)).toBe(true);
        await shot(page, "config-drift");
        await axe(page, `config drift ${size.name} ${scheme}`);
      });

      test("Schedules: add, pause and delete a schedule", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`/s/${ECC}?fixture=1&tab=schedules`, { waitUntil: "load", timeout: 90_000 });
        const table = page.getByTestId("system-schedules");
        await expect(table.getByRole("row")).toHaveCount(3, NAV);
        const form = page.getByRole("form", { name: "Add a schedule" });
        const object = form.getByRole("combobox", { name: "Object" });
        await expect(object.locator("option")).not.toHaveCount(1);
        await object.selectOption({ index: 1 });
        await form.getByRole("button", { name: "Add schedule" }).click();
        await expect(page.getByText("Schedule added")).toBeVisible();
        await expect(table.getByRole("row")).toHaveCount(4);
        await page.getByRole("button", { name: "Pause the Material master schedule" }).click();
        await expect(page.getByText("Schedule paused")).toBeVisible();
        await page.getByRole("button", { name: "Delete the Business partner schedule" }).click();
        await shot(page, "schedules");
        await page.getByTestId("confirm-bar").getByRole("button", { name: "Delete schedule" }).click();
        await expect(page.getByText("Schedule deleted")).toBeVisible();
        expect(await noSideways(page)).toBe(true);
        await axe(page, `schedules ${size.name} ${scheme}`);
      });

      test("Custom objects: the registry, an object inspector and the anomaly decision", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`/s/${ECC}?fixture=1&tab=custom-objects`, { waitUntil: "load", timeout: 90_000 });
        await expect(page.getByTestId("z-registry").getByRole("row")).toHaveCount(6, NAV);
        await page.getByTestId("z-registry").getByRole("link", { name: "ZZPACKVAR" }).click();
        const dialog = page.getByRole("dialog", { name: "ZZPACKVAR" });
        await expect(dialog.getByTestId("z-profile")).toContainText("31.0%");
        await page.waitForLoadState("networkidle");
        expect(await noSideways(page)).toBe(true);
        await shot(page, "custom");
        await axe(page, `custom ${size.name} ${scheme}`);
        await dialog.getByRole("button", { name: "Close inspector" }).click();
        await page.getByRole("link", { name: "Anomalies" }).click();
        await page.getByRole("button", { name: "Mark ZZPACKVAR null_rate_spike as expected" }).click();
        await expect(page.getByText("Marked as expected")).toBeVisible();
      });

      test("Connection: edit settings, test, and the new-system canvas", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`/s/${ECC}?fixture=1&open=connection:${ECC}`, { waitUntil: "load", timeout: 90_000 });
        const form = page.getByRole("form", { name: "Connection settings of ECC production" });
        await expect(form).toBeVisible(NAV);
        await form.getByRole("button", { name: "Test connection" }).click();
        await expect(page.getByTestId("test-outcome")).toContainText("Connected");
        await page.waitForLoadState("networkidle");
        expect(await noSideways(page)).toBe(true);
        await shot(page, "connection");
        await axe(page, `connection ${size.name} ${scheme}`);

        await page.goto("/s/new?fixture=1", { waitUntil: "load", timeout: 90_000 });
        await page.getByRole("button", { name: "Connect system" }).click();
        await expect(page.getByText("Enter a system name")).toBeVisible(NAV);
        expect(await noSideways(page)).toBe(true);
        await shot(page, "connect-new");
        await axe(page, `connect new ${size.name} ${scheme}`);
      });

      test("Scope: set inline when extracting", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`/s/${ECC}?fixture=1&open=system:${ECC}`, { waitUntil: "load", timeout: 90_000 });
        const dialog = page.getByRole("dialog", { name: "ECC production" });
        await dialog.getByRole("button", { name: "Extract", exact: true }).click();
        await dialog.getByRole("checkbox", { name: /Material master/ }).check();
        const scope = dialog.getByTestId("scope-editor");
        await scope.getByLabel("Plants").fill("1000, 1100");
        await expect(dialog.getByTestId("scope-sentence")).toContainText("plants 1000, 1100");
        await page.waitForLoadState("networkidle");
        expect(await noSideways(page)).toBe(true);
        await shot(page, "scope");
        await axe(page, `scope ${size.name} ${scheme}`);
        await dialog.getByRole("button", { name: "Extract 1 object" }).click();
        await expect(dialog.getByText("Extraction started")).toBeVisible();
      });
    });
  }
}
