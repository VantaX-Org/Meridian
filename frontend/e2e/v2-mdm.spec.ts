/**
 * Meridian 2, step 5: the Golden records, Glossary, Lineage and Processes tabs of the Object canvas, and their
 * inspectors, in fixture mode (`?fixture=1`), so the spec needs no API. At 1440 and 390, light and dark: each surface
 * draws the prototype's Material master numbers, axe finds no critical or serious violation, nothing scrolls the page
 * sideways, and a screenshot of each lands in e2e/__screenshots__/v2/object-{golden,glossary,lineage,processes}*.png.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test e2e/v2-mdm.spec.ts
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
const OBJECT = "/o/ecc-production/material-master";

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

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const size of SIZES) {
  for (const scheme of SCHEMES) {
    test.describe(`v2 object, MDM tabs at ${size.name}, ${scheme}`, () => {
      test.describe.configure({ timeout: 120_000 });
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme });
      const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}_${size.name}_${scheme}.png`) });
      const phone = size.width < 500;
      const shotTab = async (page: Page, name: string) => {
        await page.locator(".m2-tabs").first().evaluate((el) => el.scrollIntoView({ block: "start" }));
        await shot(page, name);
      };

      test("Golden records: the grid, the pairs to review and the survivorship rules, then a pair side by side", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`${OBJECT}/golden?fixture=1`, { waitUntil: "load", timeout: 90_000 });
        await expect(page.getByText("148 pairs to review")).toBeVisible(NAV);
        if (phone) {
          const list = page.getByRole("list", { name: "Golden records of Material master" });
          await expect(list.getByRole("listitem")).toHaveCount(25, NAV);
          await expect(list.getByRole("listitem").first()).toContainText("MATNR=000000000000000101");
        } else {
          const grid = page.getByRole("grid", { name: "Golden records of Material master" });
          await expect(grid).toBeVisible(NAV);
          await expect(grid.getByRole("columnheader")).toHaveCount(7);
          await expect(grid.getByRole("row").nth(1)).toContainText("Hex bolt M8 zinc", NAV);
        }
        await expect(page.getByText("1,284 records")).toBeVisible();
        await expect(page.getByRole("region", { name: "Survivorship rules" }).getByRole("link", { name: "Edit the rules" })).toHaveAttribute("href", /open=survivorship/);
        expect(await noSideScroll(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shotTab(page, "object-golden");
        await axe(page, `golden ${size.name} ${scheme}`);

        await page.getByRole("link", { name: /^Review the pair/ }).first().click();
        const d = page.getByRole("dialog", { name: "Possible duplicate" });
        await expect(d).toBeVisible(NAV);
        await expect(d.getByRole("table", { name: /side by side/ })).toBeVisible(NAV);
        await expect(d.getByRole("table", { name: /side by side/ }).getByRole("radio")).toHaveCount(8);
        await expect(d.getByRole("button", { name: "Merge" })).toBeDisabled();
        expect(await noSideScroll(page)).toBe(true);
        await shot(page, "object-golden-pair");
        await axe(page, `golden pair ${size.name} ${scheme}`);
        await d.getByRole("button", { name: "Close inspector" }).click();
        await expect(d).toBeHidden();
      });

      test("Golden records: a golden record opens in the inspector with how each value was chosen", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`${OBJECT}/golden?open=golden:gr-3&fixture=1`, { waitUntil: "load", timeout: 90_000 });
        const d = page.getByRole("dialog", { name: "MATNR=000000000000000104" });
        await expect(d).toBeVisible(NAV);
        await expect(d.getByRole("table", { name: /Golden fields/ })).toBeVisible(NAV);
        await expect(d.getByRole("list", { name: "Source records" }).getByRole("listitem")).toHaveCount(3, NAV);
        expect(await noSideScroll(page)).toBe(true);
        await shot(page, "object-golden-record");
        await axe(page, `golden record ${size.name} ${scheme}`);
      });

      test("Glossary: the terms, a search, the fields without a term and a term in the inspector", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`${OBJECT}/glossary?fixture=1`, { waitUntil: "load", timeout: 90_000 });
        if (phone) {
          await expect(page.getByRole("list", { name: "Business terms of Material master" }).getByRole("listitem")).toHaveCount(6, NAV);
        } else {
          const grid = page.getByRole("grid", { name: "Business terms of Material master" });
          await expect(grid).toBeVisible(NAV);
          await expect(grid.getByRole("columnheader")).toHaveCount(6);
          await expect(grid.getByRole("row").nth(1)).toContainText("Base unit of measure", NAV);
          await expect(grid.getByRole("row").nth(1)).toContainText("T. van der Merwe");
        }
        const missing = page.getByRole("region", { name: "Fields without a term" });
        await expect(missing.getByRole("list", { name: "Fields without a term" }).getByRole("listitem")).toHaveCount(2, NAV);
        expect(await noSideScroll(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shotTab(page, "object-glossary");
        await axe(page, `glossary ${size.name} ${scheme}`);

        await page.getByRole("searchbox", { name: "Search terms" }).fill("weight");
        await expect(page.getByText("1 found of 6")).toBeVisible(NAV);
        await page.getByRole("searchbox", { name: "Search terms" }).fill("");
        await expect(page.getByText("6 terms")).toBeVisible(NAV);

        await page.goto(`${OBJECT}/glossary?open=term:gt-meins&fixture=1`, { waitUntil: "load", timeout: 90_000 });
        const d = page.getByRole("dialog", { name: "Base unit of measure" });
        await expect(d).toBeVisible(NAV);
        await expect(d.getByRole("link", { name: "MM014", exact: true })).toBeVisible(NAV);
        await expect(d.getByRole("button", { name: "Edit" })).toBeVisible();
        expect(await noSideScroll(page)).toBe(true);
        await shot(page, "object-glossary-term");
        await axe(page, `term ${size.name} ${scheme}`);
      });

      test("Lineage: tables to fields to rules to S/4 features as a 1 pixel graph with a facts list", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`${OBJECT}/lineage?fixture=1`, { waitUntil: "load", timeout: 90_000 });
        const svg = page.getByTestId("lineage-graph");
        await expect(svg).toBeVisible(NAV);
        await expect(svg.locator("[data-node]")).toHaveCount(27, NAV);
        await expect(svg.locator("line[data-edge]")).toHaveCount(26);
        const w = await svg.locator("line[data-edge]").first().evaluate((el) => getComputedStyle(el).strokeWidth);
        expect(w).toBe("1px");
        await svg.locator('[data-node="rule:MM014"] rect').hover();
        await expect(page.getByTestId("node-facts")).toContainText("Base unit of measure not valid");
        await page.mouse.move(0, 0);
        await svg.locator('[data-node="feature:MRP Live"]').focus();
        await expect(page.getByTestId("node-facts")).toContainText("Degraded");
        expect(await noSideScroll(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shotTab(page, "object-lineage");
        await axe(page, `lineage ${size.name} ${scheme}`);

        await svg.locator('a[data-node="feature:Migration cockpit: material load"]').click();
        const d = page.getByRole("dialog", { name: "Migration cockpit: material load" });
        await expect(d).toBeVisible(NAV);
        await expect(d).toContainText("Blocked");
        await expect(d.getByRole("link", { name: "MM014", exact: true })).toBeVisible(NAV);
        expect(await noSideScroll(page)).toBe(true);
        await shot(page, "object-lineage-feature");
        await axe(page, `feature ${size.name} ${scheme}`);
      });

      test("Processes: the tree of steps with blocked steps marked, and a step in the inspector", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`${OBJECT}/processes?fixture=1`, { waitUntil: "load", timeout: 90_000 });
        await expect(page.getByTestId("process-sentence")).toContainText("2 of 4 process steps are blocked by Material master: PTP step 3, PP step 1.", NAV);
        await expect(page.getByTestId("process-step")).toHaveCount(4);
        await expect(page.locator('[data-testid="process-step"][data-blocked="true"]')).toHaveCount(2);
        await expect(page.getByRole("region", { name: "Process designer" }).getByRole("link", { name: "Open the designer" })).toHaveAttribute("href", /^\/o\/ecc-production\/material-master\/processes\/design(\?|$)/);
        expect(await noSideScroll(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shotTab(page, "object-processes");
        await axe(page, `processes ${size.name} ${scheme}`);

        await page.getByRole("link", { name: "Open the step Post Goods Receipt" }).click();
        const d = page.getByRole("dialog", { name: "Post Goods Receipt" });
        await expect(d).toBeVisible(NAV);
        await expect(d.getByRole("link", { name: "Fix MM014 in Work" })).toHaveAttribute("href", /\/work\?rule=MM014&module=material_master/);
        expect(await noSideScroll(page)).toBe(true);
        await shot(page, "object-processes-step");
        await axe(page, `step ${size.name} ${scheme}`);
      });
    });
  }
}

test.describe("process analyst", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the landscape's next step opens the first blocked process step", async ({ page }) => {
    await prepare(page, "light");
    await page.goto("/?fixture=1&persona=process", { waitUntil: "load", timeout: 90_000 });
    const next = page.getByRole("link", { name: "Open PTP step 3" });
    await expect(next).toBeVisible(NAV);
    await next.click();
    await expect(page).toHaveURL(/\/processes\?.*open=step:material_master:PTP-GR-MIGO/);
    await expect(page.getByRole("dialog", { name: "Post Goods Receipt" })).toBeVisible(NAV);
  });
});
