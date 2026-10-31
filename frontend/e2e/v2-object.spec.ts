/**
 * Meridian 2, step 2: the Object tabs (Rules, Runs, Readiness, Records), the rule inspector and the rule canvas in
 * fixture mode (`?fixture=1`), so the spec needs no API and no recording. At 1440 and 390, light and dark: each
 * surface draws, its numbers are the prototype's, axe finds no critical or serious violation, nothing scrolls the page
 * sideways, and a screenshot of each lands in e2e/__screenshots__/v2/object-*.png.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test e2e/v2-object.spec.ts
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
/** A route compiled on demand by `next dev` can take a while the first time; a production build answers at once. */
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
    test.describe(`v2 object at ${size.name}, ${scheme}`, () => {
      test.describe.configure({ timeout: 120_000 });
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme });
      const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}_${size.name}_${scheme}.png`) });
      const phone = size.width < 500;
      /** The tab is below the object's ruler and receipt: scroll the tab bar to the top, then shoot. */
      const shotTab = async (page: Page, name: string) => {
        await page.locator(".m2-tabs").first().evaluate((el) => el.scrollIntoView({ block: "start" }));
        await shot(page, name);
      };

      test("Rules: ranked by value at risk, with the pivot, the i popovers and the totals", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`${OBJECT}?fixture=1`, { waitUntil: "load", timeout: 90_000 });
        if (phone) {
          const list = page.getByRole("list", { name: "Rules for Material master" });
          await expect(list).toBeVisible(NAV);
          await expect(list.getByRole("listitem")).toHaveCount(9); // 8 rules and "and 72 more rules"
          await expect(list.getByRole("listitem").first()).toContainText("MM142");
          await expect(list.getByRole("listitem").first()).toContainText("1,184,000");
        } else {
          const grid = page.getByRole("grid", { name: "Rules for Material master" });
          await expect(grid).toBeVisible(NAV);
          const rows = grid.getByRole("row");
          await expect(rows).toHaveCount(11, NAV); // header, 8 rules, "and 72 more rules", "All 80 rules"
          await expect(rows.nth(1)).toContainText("MM142");
          await expect(rows.nth(1)).toContainText("Base unit of measure MEINS must reference a valid entry in T006");
          await expect(rows.nth(1)).toContainText("112 suggested values");
          await expect(rows.nth(1)).toContainText("Accept all");
          await expect(rows.nth(1).getByRole("gridcell").nth(5)).toHaveText("No", NAV); // MM142 is high: no tolerance, never caps
          await expect(rows.nth(2).getByRole("gridcell").nth(5)).toHaveText("Yes", NAV); // MM003, critical, over tolerance
          await expect(rows.nth(9)).toContainText("and 72 more rules");
          await expect(rows.nth(10)).toContainText("All 80 rules");
          await expect(rows.nth(10)).toContainText("4,200,000");
          for (const h of ["Tolerance", "Over tolerance", "Failing %", "Coverage", "Value at risk"]) await expect(grid.getByRole("button", { name: `About ${h}` })).toBeVisible();
        }
        expect(await noSideScroll(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shotTab(page, "object-rules");
        await axe(page, `rules ${size.name} ${scheme}`);

        // The i on Value at risk opens one 320 pixel popover from /explain.
        await page.getByRole("button", { name: "About Value at risk" }).first().click();
        const pop = page.getByRole("dialog", { name: /Value at risk/ });
        await expect(pop).toBeVisible();
        await expect(pop).toContainText("not part of the score");
        expect(Math.round((await pop.boundingBox())?.width ?? 0)).toBe(320);
        const box = await pop.boundingBox();
        expect((box?.x ?? 0) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= size.width).toBe(true);
        await shotTab(page, "object-explain");
        await axe(page, `explain ${size.name} ${scheme}`);
        await page.keyboard.press("Escape");
        await expect(pop).toBeHidden();
        await expect(page.getByRole("button", { name: "About Value at risk" }).first()).toBeFocused();

        // Pivot: by dimension.
        await page.getByRole("button", { name: "By dimension" }).click();
        const pivot = page.getByRole("table", { name: /by dimension/i });
        await expect(pivot).toBeVisible();
        await expect(pivot.getByRole("row")).toHaveCount(4);
        await pivot.getByRole("row").nth(1).getByRole("button").click();
        await expect(pivot.getByRole("link", { name: "MM003" })).toBeVisible();
        await shotTab(page, "object-rules-pivot");
        await axe(page, `pivot ${size.name} ${scheme}`);
        await page.getByRole("button", { name: "By S/4 feature" }).click();
        await expect(page.getByRole("table", { name: /by s\/4 feature/i }).getByText("Migration cockpit: material load")).toBeVisible();
      });

      test("Rules: Learned and Drafts, with their decisions", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`${OBJECT}?fixture=1`, { waitUntil: "load", timeout: 90_000 });
        await page.getByRole("button", { name: "Learned 4" }).click(NAV);
        const learned = page.getByRole("table", { name: "Learned rules waiting for a decision" });
        await expect(learned).toBeVisible();
        await expect(learned.getByRole("button", { name: "Approve" })).toHaveCount(4);
        await expect(learned.getByRole("button", { name: "Reject" })).toHaveCount(4);
        await page.waitForLoadState("networkidle");
        await shotTab(page, "object-rules-learned");
        await axe(page, `learned ${size.name} ${scheme}`);
        await learned.getByRole("button", { name: "Reject" }).first().click();
        await expect(page.getByText("Rejected. The miner will not propose it again.")).toBeVisible();
        await page.getByRole("button", { name: /^Drafts/ }).click();
        const drafts = page.getByRole("table", { name: "Rule drafts" });
        await expect(drafts).toContainText("ZR000412");
        await drafts.getByRole("button", { name: "Dry run ZR000412" }).click();
        await expect(drafts).toContainText("212 of 61,816 records would fail");
        await shotTab(page, "object-rules-drafts");
        await axe(page, `drafts ${size.name} ${scheme}`);
      });

      test("Rules: Accept all puts the suggested values in the draft batch", async ({ page }) => {
        test.skip(phone, "The phone list shows the same action; the wide table is the one asserted.");
        await prepare(page, scheme);
        await page.goto(`${OBJECT}?fixture=1`, { waitUntil: "load", timeout: 90_000 });
        const grid = page.getByRole("grid", { name: "Rules for Material master" });
        await grid.getByRole("button", { name: "Accept all 112 suggested values for MM142" }).click(NAV);
        await expect(page.getByTestId("rules-note")).toContainText("112 suggested values for MM142 are in your draft batch B-243");
        await expect(grid.getByRole("row").nth(1)).toContainText("Suggested values accepted");
      });

      test("the rule inspector opens from a rule and shows facts, definition, authority, scope, blocks, lineage, versions, contract, actions and history", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`${OBJECT}?fixture=1`, { waitUntil: "load", timeout: 90_000 });
        const link = phone ? page.getByRole("list", { name: "Rules for Material master" }).getByRole("link", { name: "MM142" }) : page.getByRole("grid", { name: "Rules for Material master" }).getByRole("link", { name: "MM142" });
        await link.click(NAV);
        const dialog = page.getByRole("dialog", { name: "MM142" });
        await expect(dialog).toBeVisible(NAV);
        await expect(page).toHaveURL(/open=rule%3AMM142/);
        await expect(dialog.getByTestId("rule-name")).toHaveText("Base unit of measure MEINS must reference a valid entry in T006");
        for (const h of ["Facts", "Definition", "Authority", "Scope: 2 objects, 1 system", "Blocks: 3 S/4 features", "Lineage", "Versions", "Contract", "Actions", "History"]) {
          await expect(dialog.getByRole("heading", { name: h, level: 3 })).toBeVisible();
        }
        const lineage = dialog.getByTestId("lineage");
        await expect(lineage).toBeVisible();
        await expect(lineage.locator("line")).toHaveCount(4);
        const stroke = await lineage.locator("line").first().evaluate((el) => getComputedStyle(el).strokeWidth);
        expect(stroke).toBe("1px");
        await expect(dialog.getByRole("link", { name: "MM purchasing" })).toBeVisible();
        await expect(dialog.getByRole("button", { name: "Hand to a steward" })).toBeVisible();
        await page.waitForLoadState("networkidle");
        await shot(page, "object-rule-inspector");
        await axe(page, `rule inspector ${size.name} ${scheme}`);
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
      });

      test("the rule canvas: header stat line, Definition, Failing records, Impact, History and Prove in SAP", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/r/MM142?fixture=1", { waitUntil: "load", timeout: 90_000 });
        await expect(page.getByRole("heading", { level: 1 })).toContainText("MM142", NAV);
        await expect(page.getByRole("heading", { level: 1 })).toContainText("Base unit of measure MEINS must reference a valid entry in T006", NAV);
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        const stat = page.getByTestId("rule-stat-line");
        await expect(stat).toContainText("High");
        await expect(stat).toContainText("4,212 failing across 2 objects");
        await expect(page.getByRole("navigation", { name: "Views of MM142" }).getByRole("link")).toHaveCount(6);
        await page.getByRole("navigation", { name: "Views of MM142" }).getByRole("link", { name: "Definition" }).click();
        await expect(page.getByRole("region", { name: "Definition" })).toBeVisible();
        expect(await noSideScroll(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shot(page, "object-rule-canvas");
        await axe(page, `rule canvas ${size.name} ${scheme}`);

        await page.getByRole("navigation", { name: "Views of MM142" }).getByRole("link", { name: "Failing records" }).click();
        await expect(page).toHaveURL(/tab=failing/);
        // The ledger when the build has it, the designed frame when it does not.
        await expect(page.locator("[data-testid='empty-frame'], [data-testid='grid']").first()).toBeVisible(NAV);
        await shot(page, "object-rule-canvas-failing");
        await axe(page, `rule canvas failing ${size.name} ${scheme}`);

        await page.getByRole("navigation", { name: "Views of MM142" }).getByRole("link", { name: "Impact" }).click();
        await expect(page.getByTestId("lineage")).toBeVisible(NAV);
        await expect(page.getByRole("region", { name: "Facts" })).toBeVisible();
        await shot(page, "object-rule-canvas-impact");
        await page.getByRole("navigation", { name: "Views of MM142" }).getByRole("link", { name: "History" }).click();
        await expect(page.getByRole("region", { name: "History" }).getByRole("listitem").first()).toContainText("Run 16 Oct 2026", NAV);
      });

      test("Runs: the measured score over 8 runs with the cap, the baseline and why the score moved", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`${OBJECT}/runs?fixture=1`, { waitUntil: "load", timeout: 90_000 });
        const chart = page.getByTestId("score-chart");
        await expect(chart).toBeVisible(NAV);
        await expect(chart.locator("line.m2-gl")).toHaveCount(4);
        await expect(chart.getByTestId("cap-line")).toHaveAttribute("data-level", "70");
        await expect(chart.getByTestId("baseline-rule")).toBeAttached(); // a vertical rule has no width, so it is attached rather than "visible"
        expect(await chart.getByTestId("baseline-rule").evaluate((el) => getComputedStyle(el).strokeWidth)).toBe("1px");
        await expect(chart.locator("circle.m2-end")).toHaveCount(1); // the last run, named in ink beside its end dot
        const dash = await chart.getByTestId("cap-line").evaluate((el) => getComputedStyle(el).strokeDasharray);
        expect(dash).not.toBe("none");
        const width = await chart.getByTestId("score-line").evaluate((el) => getComputedStyle(el).strokeWidth);
        expect(width).toBe("2px");
        const why = page.getByTestId("why-moved");
        await expect(why.getByRole("link", { name: /^MM\d{3}$/ }).first()).toBeVisible(NAV);
        await expect(why).toContainText("69.8 on 2 Oct 2026, 71.8 on 16 Oct 2026");
        await expect(page.getByRole("form", { name: "Compare two runs" }).getByRole("link", { name: "Compare" })).toHaveAttribute("href", /\/run\/.+\/vs\/.+/);
        expect(await noSideScroll(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shotTab(page, "object-runs");
        await axe(page, `runs ${size.name} ${scheme}`);
      });

      test("Readiness: waves, the cap rule and the blocked and degraded features with their rules", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`${OBJECT}/readiness?fixture=1`, { waitUntil: "load", timeout: 90_000 });
        const waves = page.getByRole("table", { name: "Waves that include Material master" });
        await expect(waves).toBeVisible(NAV);
        await expect(waves.getByRole("row")).toHaveCount(3);
        await expect(page.getByTestId("cap-statement")).toContainText("Held at 70 because two critical rules fail: MM003 and MM035");
        await expect(page.getByRole("heading", { name: /Blocked in S\/4HANA/ })).toBeVisible();
        await expect(page.getByLabel("S/4HANA features").getByRole("link", { name: "Migration cockpit: material load" })).toBeVisible(NAV);
        await expect(page.getByRole("heading", { name: /Degraded in S\/4HANA/ })).toBeVisible();
        expect(await noSideScroll(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shotTab(page, "object-readiness");
        await axe(page, `readiness ${size.name} ${scheme}`);
      });

      test("Records: the ledger scoped to the object, or its designed frame", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`${OBJECT}/records?fixture=1`, { waitUntil: "load", timeout: 90_000 });
        await expect(page.locator("[data-testid='empty-frame'], [data-testid='grid']").first()).toBeVisible(NAV);
        await expect(page.getByRole("navigation", { name: "Views of Material master" }).getByRole("link", { name: /^Records/ })).toHaveAttribute("aria-current", "page");
        expect(await noSideScroll(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shotTab(page, "object-records");
        await axe(page, `records ${size.name} ${scheme}`);
      });
    });
  }
}

test.describe("keyboard", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the i is reachable by Tab, opens with Enter and closes with Esc back onto itself", async ({ page }) => {
    await prepare(page, "light");
    await page.goto(`${OBJECT}?fixture=1`, { waitUntil: "load", timeout: 90_000 });
    const grid = page.getByRole("grid", { name: "Rules for Material master" });
    await expect(grid).toBeVisible(NAV);
    const i = grid.getByRole("button", { name: "About Tolerance" });
    await i.focus();
    await page.keyboard.press("Enter");
    const pop = page.getByRole("dialog", { name: "Tolerance" });
    await expect(pop).toBeVisible();
    await expect(pop).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(pop).toBeHidden();
    await expect(i).toBeFocused();
  });

  test("a rule opens from the keyboard with j, k and Enter", async ({ page }) => {
    await prepare(page, "light");
    await page.goto(`${OBJECT}?fixture=1`, { waitUntil: "load", timeout: 90_000 });
    const grid = page.getByRole("grid", { name: "Rules for Material master" });
    await expect(grid.getByRole("row")).toHaveCount(11, NAV);
    await grid.focus();
    await page.keyboard.press("j");
    await page.keyboard.press("j");
    await page.keyboard.press("k");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/open=rule%3AMM142/);
    await expect(page.getByRole("dialog", { name: "MM142" })).toBeVisible();
  });
});
