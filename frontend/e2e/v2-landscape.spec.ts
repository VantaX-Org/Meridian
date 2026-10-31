/**
 * Meridian 2, step 0: the landscape, the object canvas and the inspector in fixture mode (`/?fixture=1`), so the
 * spec needs no API and no recording. At 1440 and 390, light and dark: the coverage matrix is there, an object
 * opens, the inspector opens and closes by keyboard, axe finds no critical or serious violation, and a screenshot of
 * each lands in e2e/__screenshots__/v2/. A last test gives the Rules tab 100,000 rules.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test e2e/v2-landscape.spec.ts
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

/** The fixture needs no API: every /api/v1 read is answered empty so the root providers settle quietly. */
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

for (const size of SIZES) {
  for (const scheme of SCHEMES) {
    test.describe(`v2 at ${size.name}, ${scheme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme });
      const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}_${size.name}_${scheme}.png`) });
      const phone = size.width < 500;

      test("landscape for SAP Basis: connections, extractions, failed jobs, authorisation errors and schedules", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/?fixture=1&persona=basis", { waitUntil: "load" });
        const home = page.getByTestId("basis-home");
        await expect(home).toBeVisible(NAV);
        await expect(home.getByTestId("basis-connections")).toContainText("Refused the credentials");
        await expect(home.getByTestId("basis-extractions")).toContainText("400,662");
        await expect(home.getByTestId("basis-failures")).toContainText("OData refused credentials");
        await expect(home.getByTestId("basis-schedules")).toContainText("Changes only");
        await axe(page, `basis home ${size.name} ${scheme}`);
        await home.scrollIntoViewIfNeeded();
        await shot(page, "basis-home");
      });

      test("landscape: the sentence, the next step and the coverage matrix", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/?fixture=1", { waitUntil: "load" });
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Landscape/);
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        await expect(page.getByTestId("landscape-sentence")).toContainText("11 of 15 objects are held under 85 by 30 critical rules over tolerance");
        // With migration waves in the fixture the lead's next step clears the no-go objects of the next wave.
        await expect(page.getByRole("link", { name: "Clear the 3 no-go objects in Wave 1: finance foundations" })).toBeVisible();

        if (phone) {
          // The matrix becomes a list of two-line rows below 760px.
          const rows = page.locator(".m2-mlist .m2-lrow");
          await expect(rows).toHaveCount(15);
          await expect(rows.first()).toContainText("Material master");
          await expect(rows.first()).toContainText("No-go");
        } else {
          const matrix = page.getByTestId("coverage-matrix");
          await expect(matrix).toBeVisible();
          await expect(matrix.getByTestId("matrix-cell")).toHaveCount(15);
          await expect(matrix.getByRole("columnheader")).toHaveCount(4);
          await expect(matrix.getByText("Extracted 16 Oct 2026, 04:41, 400,662 records")).toBeVisible();
          await expect(matrix.getByText("Not extracted yet.")).toBeVisible();
        }
        await expect(page.getByRole("grid", { name: "Your next work" })).toBeVisible();
        await expect(page.getByTestId("status-strip")).toContainText("794 rules measured");

        // No page scroll sideways, at any width.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shot(page, "landscape");
        await axe(page, `landscape ${size.name} ${scheme}`);
      });

      test("an object opens from the landscape, with its ruler, receipt and tabs", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/?fixture=1", { waitUntil: "load" });
        if (phone) await page.locator(".m2-mlist .m2-lrow").first().click();
        else await page.getByTestId("matrix-cell").first().click();
        await expect(page).toHaveURL(/\/o\/ecc-production\/material-master/, NAV);
        await expect(page.getByRole("heading", { level: 1 })).toContainText("Material master", NAV);
        await expect(page.getByTestId("cap-sentence")).toContainText("Held at 70 because");
        await expect(page.locator('svg[data-size="240"]')).toBeVisible();
        await expect(page.getByTestId("receipt")).toBeVisible();
        await expect(page.getByTestId("receipt-footer")).toContainText("tolerance 10% of rows or 25 rows");
        await expect(page.getByRole("navigation", { name: "Views of Material master" }).getByRole("link")).toHaveCount(9);
        await expect(page.getByRole(phone ? "list" : "grid", { name: "Rules for Material master" })).toBeVisible(); // two-line rows on a phone
        await page.waitForLoadState("networkidle");
        await shot(page, "object");
        await axe(page, `object ${size.name} ${scheme}`);

        // The tab is a route segment; since step 6b it draws the lineage of the failing rules.
        await page.getByRole("navigation", { name: "Views of Material master" }).getByRole("link", { name: "Lineage" }).click();
        await expect(page).toHaveURL(/\/material-master\/lineage/, NAV);
        await expect(page.locator('[aria-label^="Lineage of Material master:"]')).toBeVisible(NAV);
      });

      test("the inspector opens from a link, traps focus, closes with Esc and returns focus", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/o/ecc-production/material-master?fixture=1", { waitUntil: "load", timeout: 90_000 });
        const rule = page.getByTestId("cap-sentence").getByRole("link", { name: "MM035" });
        await expect(rule).toBeVisible(NAV);
        await rule.focus();
        await rule.click();
        const dialog = page.getByRole("dialog", { name: /MM035/ });
        await expect(dialog).toBeVisible();
        await expect(page).toHaveURL(/open=rule%3AMM035/);
        await expect(dialog.getByRole("button", { name: "Close inspector" })).toBeFocused();
        await expect(dialog.getByRole("heading", { name: /^Scope/ })).toBeVisible(NAV);
        if (phone) {
          const box = await dialog.boundingBox();
          expect(box?.width).toBeGreaterThanOrEqual(size.width - 1); // full screen on a phone
        } else {
          // The inspector's landmark is the 400 px panel; the dialog sits inside its 1 px rule.
          const box = await page.locator("#m2-inspector").boundingBox();
          expect(Math.round(box?.width ?? 0)).toBe(400);
        }
        // Tab stays inside the dialog.
        for (let i = 0; i < 6; i++) {
          await page.keyboard.press("Tab");
          expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
        }
        await page.waitForLoadState("networkidle");
        await shot(page, "inspector");
        await axe(page, `inspector ${size.name} ${scheme}`);
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(page).not.toHaveURL(/open=/);
        await expect(rule).toBeFocused();
      });

      test("the command line opens with the shortcut and finds a rule", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/?fixture=1", { waitUntil: "load" });
        await expect(page.getByTestId("landscape-sentence")).toBeVisible();
        await page.keyboard.press("Control+k");
        const palette = page.getByRole("dialog", { name: "Search, ask, or type a command" });
        await expect(palette).toBeVisible();
        await palette.getByRole("combobox").fill("MM0");
        await expect(palette.getByText("MM003: Material type is mandatory - determines procurement and storage behaviour")).toBeVisible();
        await page.waitForLoadState("networkidle");
        await shot(page, "command");
        await axe(page, `command ${size.name} ${scheme}`);
        await page.keyboard.press("Escape");
        await expect(palette).toBeHidden();
      });

      if (phone) {
        test("the map is a bottom sheet behind the Map button", async ({ page }) => {
          await prepare(page, scheme);
          await page.goto("/?fixture=1", { waitUntil: "load" });
          await expect(page.getByTestId("landscape-sentence")).toBeVisible();
          const map = page.getByTestId("map");
          await expect(map).toBeHidden();
          await page.getByRole("button", { name: "Map" }).click();
          await expect(map).toBeVisible();
          await expect(map.getByRole("link", { name: /Material master/ })).toBeVisible();
          await page.waitForTimeout(350);
          await shot(page, "map-sheet");
          await axe(page, `map sheet ${size.name} ${scheme}`);
          await page.keyboard.press("Escape");
          await expect(map).toBeHidden();
        });
      }
    });
  }
}

test.describe("a long list of rules", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("100,000 rules draw only the first page, say how many more there are, and cause no layout shift", async ({ page }) => {
    await prepare(page, "light");
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as { hadRecentInput: boolean; value: number }[]) if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto("/o/ecc-production/material-master?fixture=1&rows=100000", { waitUntil: "load", timeout: 90_000 });
    const grid = page.getByRole("grid", { name: "Rules for Material master" });
    await expect(grid).toBeVisible(NAV);
    await expect(grid).toContainText("and 99,975 more rules");
    // 25 rules, the header and the two closing rows: the other 99,975 are not in the DOM.
    expect(await grid.getByRole("row").count()).toBe(28);
    await page.waitForLoadState("networkidle");
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    console.log(`[rules] layout shift while the page loaded: ${cls.toFixed(3)}`);
    await page.getByRole("button", { name: "Show 25 more" }).click();
    expect(await grid.getByRole("row").count()).toBe(53);
    expect((await page.evaluate(() => (window as unknown as { __cls: number }).__cls)) - cls).toBeLessThan(0.1);
  });

  test("j and k move through the rules and Enter opens one in the inspector", async ({ page }) => {
    await prepare(page, "light");
    await page.goto("/o/ecc-production/material-master?fixture=1", { waitUntil: "load", timeout: 90_000 });
    const grid = page.getByRole("grid", { name: "Rules for Material master" });
    await expect(grid.getByRole("row")).toHaveCount(11, NAV);
    await grid.focus();
    await page.keyboard.press("j");
    await page.keyboard.press("j");
    await page.keyboard.press("k");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/open=rule%3AMM\d+/);
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});
