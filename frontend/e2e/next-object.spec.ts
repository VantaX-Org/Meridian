/**
 * The redesigned object page (`/next/o/{system}/{module}`) in fixture mode, so the spec needs no API: the object bar,
 * the Cycle tab and its steps, the Runs tab with paging and compare, at 1440 and 390, light and dark. Each screen has
 * no sideways scroll, axe finds no critical or serious violation, and a screenshot lands in
 * e2e/__screenshots__/next/object-*.png.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test e2e/next-object.spec.ts
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
const BASE = "/next/o/ecc-production/material-master";

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

const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const size of SIZES) {
  for (const scheme of SCHEMES) {
    test.describe(`next object at ${size.name}, ${scheme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme });
      test.beforeEach(async ({ page }) => prepare(page, scheme));

      test("cycle tab: object bar, five steps, compare sheet", async ({ page }) => {
        await page.goto(`${BASE}/cycle?fixture=1&step=compare`, NAV);
        await expect(page.getByTestId("object-bar")).toBeVisible(NAV);
        await expect(page.getByRole("list", { name: "Steps of the cleaning cycle" }).getByRole("listitem")).toHaveCount(5);
        await expect(page.getByTestId("compare-step")).toBeVisible();
        expect(await noSideways(page)).toBe(true);
        await axe(page, `cycle ${size.name} ${scheme}`);
        await page.screenshot({ path: path.join(SHOTS, `object-cycle-${size.name}-${scheme}.png`), fullPage: true });
      });

      test("runs tab: fifty a page, next page, compare two", async ({ page }) => {
        await page.goto(`${BASE}/runs?fixture=1`, NAV);
        await expect(page.getByTestId("runs-tab")).toBeVisible(NAV);
        await expect(page.getByTestId("runs-range")).toContainText("500");
        await page.getByTestId("runs-tab").getByRole("button", { name: "Next" }).click();
        await expect(page.getByTestId("runs-range")).toContainText("51");
        const boxes = page.getByTestId("runs-tab").getByRole("checkbox", { name: /^Select Run / });
        await boxes.nth(0).check();
        await boxes.nth(1).check();
        await page.getByRole("button", { name: "Compare these two" }).click();
        await expect(page).toHaveURL(/\/cycle\?.*step=compare/);
        await expect(page.getByTestId("compare-step")).toBeVisible();
        expect(await noSideways(page)).toBe(true);
      });

      test("runs tab screenshot and axe", async ({ page }) => {
        await page.goto(`${BASE}/runs?fixture=1`, NAV);
        await expect(page.getByTestId("runs-tab")).toBeVisible(NAV);
        expect(await noSideways(page)).toBe(true);
        await axe(page, `runs ${size.name} ${scheme}`);
        await page.screenshot({ path: path.join(SHOTS, `object-runs-${size.name}-${scheme}.png`), fullPage: true });
      });
    });
  }
}
