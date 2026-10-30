/**
 * Meridian 2, step 6b: the rules library (/rules), the survivorship editor and the process designer, in fixture mode
 * (`/?fixture=1`), so the spec needs no API. At 1440 and 390, light and dark: each screen is there, the verbs answer
 * in their frames, no page scrolls sideways, axe finds no critical or serious violation, and a screenshot of each lands
 * in e2e/__screenshots__/v2/rules-library-*.png, designer-*.png and system-survivorship-*.png.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test e2e/v2-rules.spec.ts
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
  console.log(`[a11y] ${label}: ${result.violations.filter((v) => v.impact === "moderate").length} moderate, ${result.violations.filter((v) => v.impact === "minor").length} minor (non-blocking)`);
  expect(blockers, summary).toEqual([]);
}

const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const size of SIZES) {
  for (const scheme of SCHEMES) {
    test.describe(`v2 rules at ${size.name}, ${scheme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme });
      const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}_${size.name}_${scheme}.png`) });

      test("the rules library lists, filters and opens a rule", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/rules?fixture=1", { waitUntil: "load", timeout: 90_000 });
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("Rules", NAV);
        const grid = page.getByRole("grid", { name: "Rules library" });
        await expect(grid).toHaveAttribute("aria-rowcount", "39", NAV);
        await page.getByLabel("Object").selectOption("business_partner");
        await expect(grid).toHaveAttribute("aria-rowcount", "7");
        await page.getByLabel("Object").selectOption("");
        await page.getByRole("searchbox", { name: "Search" }).fill("MM142");
        await expect(grid).toHaveAttribute("aria-rowcount", "2");
        await grid.getByRole("row").nth(1).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.waitForLoadState("networkidle");
        expect(await noSideways(page)).toBe(true);
        await shot(page, "rules-library");
        await axe(page, `rules library ${size.name} ${scheme}`);
      });

      test("drafts: create, edit and dry run", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/rules?fixture=1&view=drafts", { waitUntil: "load", timeout: 90_000 });
        await expect(page.getByTestId("drafts-table")).toBeVisible(NAV);
        await page.getByRole("button", { name: "Edit draft ZR000412" }).click();
        const form = page.getByRole("form", { name: "Edit draft" });
        await form.getByRole("button", { name: "Dry run" }).click();
        await expect(form.getByTestId("dry-run-result")).toContainText("212 of 61,816");
        await page.waitForLoadState("networkidle");
        expect(await noSideways(page)).toBe(true);
        await shot(page, "rules-library-drafts");
        await axe(page, `rules drafts ${size.name} ${scheme}`);
      });

      test("the survivorship editor adds a rule and saves", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/o/ecc-production/material-master/golden?fixture=1&open=survivorship:material_master", { waitUntil: "load", timeout: 90_000 });
        const dialog = page.getByRole("dialog", { name: "Survivorship rules" });
        await expect(dialog.getByRole("list", { name: "Survivorship rules" })).toBeVisible(NAV);
        await dialog.getByRole("button", { name: "Add a rule" }).click();
        await dialog.getByLabel("Field").last().fill("MARA-SPART");
        await dialog.getByRole("button", { name: "Save rules" }).click();
        await expect(dialog.getByText("Survivorship rules saved")).toBeVisible();
        await page.waitForLoadState("networkidle");
        expect(await noSideways(page)).toBe(true);
        await shot(page, "system-survivorship");
        await axe(page, `survivorship ${size.name} ${scheme}`);
      });

      test("the process designer edits the tree, maps a field and saves", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/o/ecc-production/material-master/processes/design?fixture=1", { waitUntil: "load", timeout: 90_000 });
        await expect(page.getByRole("heading", { level: 2, name: "Process designer" })).toBeVisible(NAV);
        await page.getByRole("button", { name: /^Post goods receipt/ }).click();
        const form = page.getByRole("form", { name: "Map a field to Check the material" });
        await form.getByLabel("Map a field").fill("MARA.BRGEW");
        await form.getByRole("button", { name: "Map field" }).click();
        await expect(page.getByRole("list", { name: "Fields of Check the material" })).toContainText("MARA.BRGEW");
        await page.getByRole("button", { name: "Save as a new version" }).click();
        await expect(page.getByText("Saved as version 2")).toBeVisible();
        await page.waitForLoadState("networkidle");
        expect(await noSideways(page)).toBe(true);
        await shot(page, "designer");
        await axe(page, `designer ${size.name} ${scheme}`);
      });
    });
  }
}
