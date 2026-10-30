/**
 * Meridian 2, step 1: the Work ledger, the record inspector and undo, in fixture mode (`/work?fixture=1`), so the
 * spec needs no API. At 1440 and 390, light and dark: the ledger draws, a row opens in the inspector, a change
 * shows a notice with Undo and Ctrl+Z takes it back, axe finds no critical or serious violation, and a screenshot of
 * each lands in e2e/__screenshots__/v2/work*.png.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test e2e/v2-work.spec.ts
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
const KEY = "000000000000000100";

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
    test.describe(`v2 work at ${size.name}, ${scheme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme });
      test.setTimeout(120_000);
      const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}_${size.name}_${scheme}.png`) });
      const phone = size.width < 500;

      test("the ledger: title, sentence, chips with counts, the rows", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/work?fixture=1&persona=steward", { waitUntil: "load", timeout: 90_000 });
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        await expect(page.getByRole("heading", { level: 1 })).toContainText("Work", NAV);
        await expect(page.getByRole("heading", { level: 1 })).toContainText("All objects");
        await expect(page.getByTestId("work-sentence")).toHaveText("25,712 records to fix, 3,418 with a suggested value.", NAV);
        const chips = page.getByRole("group", { name: "Filter by state" });
        await expect(chips.getByRole("button", { name: /To fix/ })).toContainText("25,712");
        await expect(chips.getByRole("button", { name: /Fix proposed/ })).toContainText("3,418");
        await expect(chips.getByRole("button", { name: /Waiting for approval/ })).toContainText("612");
        await expect(chips.getByRole("button", { name: /Exceptions/ })).toContainText("48");
        await expect(page.getByRole("button", { name: "Accept the 112 suggested values" })).toBeVisible();
        if (phone) {
          const list = page.getByRole("list", { name: "Work ledger" });
          await expect(list.getByRole("listitem").first()).toBeVisible(NAV);
          await expect(list.getByRole("button").first()).toContainText("MM003");
          await expect(list.locator("input")).toHaveCount(0);
        } else {
          const grid = page.getByRole("grid", { name: "Work ledger" });
          await expect(grid).toBeVisible(NAV);
          await expect(grid.getByRole("columnheader", { name: "Material number" })).toBeVisible();
          await expect(grid.getByTitle("000000000000000232")).toBeVisible();
          await expect(grid.getByLabel("New value for 000000000000000232")).toBeVisible();
        }
        // No page scroll sideways, at any width.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shot(page, "work");
        await axe(page, `work ${size.name} ${scheme}`);
      });

      test("a change shows a notice with Undo, and Ctrl+Z takes it back", async ({ page }) => {
        test.skip(phone, "Editing happens in the inspector on a phone; the inspector test covers it");
        await prepare(page, scheme);
        await page.goto("/work?fixture=1&persona=steward", { waitUntil: "load", timeout: 90_000 });
        const grid = page.getByRole("grid", { name: "Work ledger" });
        await expect(grid.getByTitle(KEY)).toBeVisible(NAV);
        const chips = page.getByRole("group", { name: "Filter by state" });
        await expect(chips.getByRole("button", { name: /To fix/ })).toContainText("25,712");
        await grid.getByLabel(`Decision for ${KEY}`).selectOption("fix");
        const notice = page.getByRole("region", { name: "Change notices" }).getByRole("status");
        await expect(notice).toContainText("Accepted 1 suggested value");
        await expect(notice.getByRole("button", { name: "Undo" })).toBeVisible();
        // The notice sits at the bottom of the screen, on the inverse ground, never over the top bar.
        const at = await notice.boundingBox();
        expect(at?.y ?? 0).toBeGreaterThan(size.height - 160);
        expect((at?.y ?? 0) + (at?.height ?? 0)).toBeLessThanOrEqual(size.height);
        await expect(chips.getByRole("button", { name: /To fix/ })).toContainText("25,711");
        await expect(chips.getByRole("button", { name: /Waiting for approval/ })).toContainText("613");
        await expect(grid.getByTitle(KEY)).toHaveCount(0);
        await shot(page, "work-undo");
        await axe(page, `work notice ${size.name} ${scheme}`);
        // Focus is on the page, not in a field, so Ctrl+Z is the app's Undo.
        await page.locator("#m2-canvas").focus();
        await page.keyboard.press("Control+z");
        await expect(page.getByRole("region", { name: "Change notices" })).toContainText("Undone: accepted 1 suggested value");
        await expect(chips.getByRole("button", { name: /To fix/ })).toContainText("25,712");
        await expect(grid.getByTitle(KEY)).toBeVisible();
      });

      test("selecting rows shows the bulk bar; By rule groups the rows under their rule", async ({ page }) => {
        test.skip(phone, "Selection and grouping are the grid's; a phone lists rows");
        await prepare(page, scheme);
        await page.goto("/work?fixture=1&persona=steward", { waitUntil: "load", timeout: 90_000 });
        const grid = page.getByRole("grid", { name: "Work ledger" });
        await expect(grid.getByTitle("000000000000000232")).toBeVisible(NAV);
        const boxes = grid.getByRole("checkbox", { name: /^Select row/ });
        await boxes.nth(0).check();
        await boxes.nth(1).check();
        await boxes.nth(2).check();
        const bar = page.getByRole("region", { name: "Bulk actions" });
        await expect(bar).toContainText("3 records");
        for (const name of [/Accept suggested/, /Set value for all/, /Not an issue/, /Accept risk/, /Assign/]) await expect(bar.getByRole("button", { name })).toBeVisible();
        await page.waitForLoadState("networkidle");
        await shot(page, "work-bulk");
        await axe(page, `work bulk ${size.name} ${scheme}`);
        await bar.getByRole("button", { name: "Clear selection" }).click();
        await page.getByRole("button", { name: "By rule" }).click();
        await expect(page).toHaveURL(/group=rule/);
        await expect(grid.getByRole("button", { name: /^MM142/ })).toHaveAttribute("aria-expanded", "true", NAV);
        await expect(grid.getByRole("button", { name: "Accept all 112 suggested" })).toBeVisible();
        await page.waitForLoadState("networkidle");
        await shot(page, "work-grouped");
        await axe(page, `work grouped ${size.name} ${scheme}`);
      });

      test("a row opens the record in the inspector: facts, fix, links, actions, and Esc returns", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/work?fixture=1&persona=steward", { waitUntil: "load", timeout: 90_000 });
        if (phone) {
          await page.getByRole("list", { name: "Work ledger" }).getByTitle(KEY).click(NAV);
        } else {
          const grid = page.getByRole("grid", { name: "Work ledger" });
          await expect(grid.getByTitle(KEY)).toBeVisible(NAV);
          await grid.getByText("Hex bolt M8 zinc").first().click();
        }
        const dialog = page.getByRole("dialog", { name: KEY });
        await expect(dialog).toBeVisible(NAV);
        await expect(page).toHaveURL(/open=record%3Amaterial_master%3AMATNR%3D/);
        await expect(dialog.getByTestId("record-facts")).toBeVisible(NAV);
        await expect(dialog.getByTestId("record-facts").getByText("MARA-MEINS")).toBeVisible();
        await expect(dialog.getByTestId("fix-block").first()).toContainText("MM142");
        await expect(dialog.getByTestId("feature-impact")).toContainText("Migration cockpit: material load");
        await expect(dialog.getByRole("button", { name: /Accept suggested/ })).toBeEnabled();
        if (phone) {
          const box = await dialog.boundingBox();
          expect(box?.width).toBeGreaterThanOrEqual(size.width - 1);
        } else {
          // The inspector's landmark is the 400 px panel; the dialog sits inside its 1 px rule.
          const box = await page.locator("#m2-inspector").boundingBox();
          expect(Math.round(box?.width ?? 0)).toBe(400);
        }
        await page.waitForLoadState("networkidle");
        await shot(page, "work-record");
        await axe(page, `work record ${size.name} ${scheme}`);
        // Accept from the inspector: the notice names it, the status line follows.
        await dialog.getByRole("button", { name: /Accept suggested/ }).click();
        await expect(page.getByRole("region", { name: "Change notices" })).toContainText("Accepted 1 suggested value");
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(page).not.toHaveURL(/open=/);
      });

      test("the command line's approve and export reach the ledger", async ({ page }) => {
        test.skip(phone, "The command line is a desktop shortcut; the phone has the search button");
        await prepare(page, scheme);
        await page.goto("/?fixture=1", { waitUntil: "load", timeout: 90_000 });
        await expect(page.getByTestId("landscape-sentence")).toBeVisible(NAV);
        await page.keyboard.press("Control+k");
        const palette = page.getByRole("dialog", { name: "Search or type a command" });
        await palette.getByRole("combobox").fill("approve");
        await expect(palette.getByText("Approvals waiting 612")).toBeVisible();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/\/work\?filter=approvals/, NAV);
        await expect(page.getByRole("button", { name: /Waiting for approval/ })).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByTestId("work-sentence")).toContainText("612 records wait for approval");
        await page.waitForLoadState("networkidle");
        await shot(page, "work-approvals");
        await axe(page, `work approvals ${size.name} ${scheme}`);
      });
    });
  }
}
