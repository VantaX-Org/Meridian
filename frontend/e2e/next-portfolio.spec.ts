/**
 * Redesign Batch C: the portfolio (/portfolio) and the objects list (/next/objects) in fixture mode, so the spec needs
 * no API. At 1440 and 390, light and dark: 100 objects page 50 at a time, five objects go to a pull confirm, the upload
 * panel opens, the objects list groups by system, axe finds no critical or serious violation, and a screenshot of each
 * lands in e2e/__screenshots__/next/.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test e2e/next-portfolio.spec.ts
 */

import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SHOTS = path.join(__dirname, "__screenshots__", "next");
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
  expect(blockers, `${label}\n${summary}`).toEqual([]);
}

for (const size of SIZES) {
  for (const scheme of SCHEMES) {
    test.describe(`next portfolio at ${size.name}, ${scheme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme });
      const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}_${size.name}_${scheme}.png`), fullPage: false });

      test("portfolio: pages, bulk pull of five, upload panel", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/portfolio?fixture=1", { waitUntil: "load" });
        const home = page.getByTestId("portfolio");
        await expect(home).toBeVisible(NAV);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("Portfolio");
        await expect(page.getByTestId("pf-card")).toHaveCount(50);
        await expect(home).toContainText("Showing 1–50 of 100");
        // No sideways scroll at phone width.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        await axe(page, `portfolio ${size.name} ${scheme}`);
        await shot(page, "portfolio");

        const cards = page.getByTestId("pf-card");
        for (let i = 0; i < 5; i++) await cards.nth(i).getByRole("checkbox").check();
        const bar = page.getByTestId("pf-bulk");
        await expect(bar).toContainText("5 objects selected");
        await bar.getByRole("button", { name: /^Pull now/ }).click();
        await expect(page.getByRole("alertdialog")).toContainText(/Pull \d objects now\?/);
        await shot(page, "portfolio-pull-confirm");
        await page.getByRole("alertdialog").getByRole("button", { name: /^Cancel/ }).click();

        await bar.getByRole("button", { name: /^Upload cleaned workbooks/ }).click();
        await expect(page.getByRole("complementary", { name: "Upload cleaned workbooks" })).toBeVisible();
        await axe(page, `upload panel ${size.name} ${scheme}`);
        await shot(page, "portfolio-upload");
      });

      test("objects list grouped by system", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/next/objects?fixture=1", { waitUntil: "load" });
        await expect(page.getByTestId("objects-list")).toBeVisible(NAV);
        await expect(page.getByTestId("ol-system").first()).toBeVisible();
        await axe(page, `objects list ${size.name} ${scheme}`);
        await shot(page, "objects-list");
      });
    });
  }
}
