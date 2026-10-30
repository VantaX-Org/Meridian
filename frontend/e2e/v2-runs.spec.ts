/**
 * Meridian 2, step 3: the run timeline, the Run, Compare and Runs canvases, the job line and job inspector, and the
 * System inspector and canvas, in fixture mode (`/v2?fixture=1`), so the spec needs no API. At 1440 and 390, light
 * and dark: each screen is there, the actions answer in their frames, no page scrolls sideways, axe finds no critical
 * or serious violation, and a screenshot of each lands in e2e/__screenshots__/v2/runs-*.png.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test e2e/v2-runs.spec.ts
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
const R8 = "d3229ded-0708-4967-9dfb-1b7f4fada953"; // 16 Oct
const R6 = "b0500000-0000-4000-8000-000000000005"; // 2 Oct, the baseline

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
    test.describe(`v2 runs at ${size.name}, ${scheme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme });
      const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `runs-${name}_${size.name}_${scheme}.png`) });
      const phone = size.width < 500;

      test("the run timeline opens from the top bar, marks the baseline, and picking a run re-scopes the canvas", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/v2?fixture=1", { waitUntil: "load" });
        await expect(page.getByTestId("landscape-sentence")).toBeVisible(NAV);
        if (phone) {
          await page.getByRole("button", { name: "Map" }).click();
          await page.getByTestId("map").getByRole("button", { name: /^Run 16 Oct/ }).click();
        } else {
          await page.getByRole("button", { name: /^Run 16 Oct/ }).click();
        }
        const dialog = page.getByRole("dialog", { name: /^Runs, 28 Aug 2026 to 16 Oct 2026/ });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByTestId("run-timeline").getByRole("button")).toHaveCount(8);
        await expect(dialog.getByTestId("tl-baseline")).toContainText("baseline");
        await expect(dialog.getByRole("button", { name: /^Run 16 Oct 2026, 05:17, selected/ })).toBeVisible();
        await expect(dialog.getByRole("combobox", { name: "Compare with" })).toHaveValue(R6);
        await page.waitForLoadState("networkidle");
        await shot(page, "timeline");
        await axe(page, `timeline ${size.name} ${scheme}`);

        // Picking a run puts it in the URL; the landscape says which run its scores come from.
        await dialog.getByRole("button", { name: /^Run 2 Oct 2026/ }).click();
        await expect(page).toHaveURL(new RegExp(`run=${R6}`));
        await expect(page.getByRole("status").filter({ hasText: "Viewing one run" })).toBeVisible();
      });

      test("the Run canvas: status line, per-object table, actions and jobs", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`/v2/run/${R8}?fixture=1`, { waitUntil: "load", timeout: 90_000 });
        await expect(page.getByRole("heading", { level: 1 })).toContainText("Run 16 Oct 2026, 05:17", NAV);
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        await expect(page.getByTestId("run-status-line")).toContainText("400,662 records checked");
        await expect(page.getByTestId("run-status-line")).toContainText("scored in 11 m 42 s");
        await expect(page.getByTestId("run-objects").getByRole("row")).toHaveCount(16);
        await expect(page.getByTestId("run-jobs").getByRole("row")).toHaveCount(3);
        for (const name of ["Show scores from this run", "Pin as baseline", "Download report"]) await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
        await page.getByRole("button", { name: "Pin as baseline" }).click();
        await expect(page.getByTestId("action-result")).toContainText("Pinned as the baseline");
        expect(await noSideways(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shot(page, "run");
        await axe(page, `run ${size.name} ${scheme}`);
      });

      test("the Compare canvas: sentence, rows, totals that add up, method and what changed", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`/v2/run/${R6}/vs/${R8}?fixture=1`, { waitUntil: "load", timeout: 90_000 });
        await expect(page.getByRole("heading", { level: 1 })).toContainText("Run 16 Oct 2026, 05:17 vs baseline 2 Oct 2026", NAV);
        await expect(page.getByTestId("compare-sentence")).toContainText("12 of 15 objects scored higher and 3 lower. 14 rules started failing and 37 stopped.");
        await expect(page.getByTestId("compare-method")).toContainText("11 rules added since the baseline of 2 Oct 2026 are excluded");
        if (phone) {
          await expect(page.getByTestId("compare-list").getByRole("link")).toHaveCount(15);
          await expect(page.getByTestId("compare-list-totals")).toContainText("14 new, 37 fixed, 23 worse, 61 better");
        } else {
          await expect(page.getByTestId("compare-row")).toHaveCount(15);
          const totals = page.getByTestId("compare-totals").getByRole("cell");
          await expect(totals.nth(6)).toHaveText("14");
          await expect(totals.nth(7)).toHaveText("37");
          await expect(totals.nth(8)).toHaveText("23");
          await expect(totals.nth(9)).toHaveText("61");
        }
        await expect(page.getByTestId("what-changed").getByRole("heading", { level: 3 })).toHaveCount(4);
        expect(await noSideways(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shot(page, "compare");
        await axe(page, `compare ${size.name} ${scheme}`);
        // A rule in the lists opens the rule inspector.
        await page.getByTestId("what-changed").getByRole("link").first().click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await expect(page).toHaveURL(/open=rule%3A/);
      });

      test("the Runs canvas: the timeline at full width, the table with filters, Start a run", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/v2/runs?fixture=1", { waitUntil: "load", timeout: 90_000 });
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("Runs", NAV);
        await expect(page.getByTestId("run-timeline").getByRole("button")).toHaveCount(8, NAV);
        await expect(page.getByTestId("run-row")).toHaveCount(9, NAV);
        await page.getByRole("combobox", { name: "Status" }).selectOption("failed");
        await expect(page.getByTestId("run-row")).toHaveCount(1);
        await page.getByRole("combobox", { name: "Status" }).selectOption("all");
        await page.getByRole("button", { name: "Start a run" }).click();
        await expect(page.getByTestId("start-run")).toBeVisible();
        expect(await noSideways(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shot(page, "list");
        await axe(page, `runs ${size.name} ${scheme}`);
      });

      test("the Jobs view lists every job; a row opens the job inspector with stages, tables, the error and Retry", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/v2/runs?fixture=1&view=jobs", { waitUntil: "load", timeout: 90_000 });
        await expect(page.getByTestId("job-row")).toHaveCount(4, NAV);
        await page.waitForLoadState("networkidle");
        await shot(page, "jobs");
        await axe(page, `jobs ${size.name} ${scheme}`);
        await page.getByTestId("job-row").first().getByRole("link").click();
        const dialog = page.getByRole("dialog", { name: "Extraction, Employee central" });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByTestId("job-error")).toContainText("OData refused credentials");
        await expect(dialog.getByTestId("job-stages").getByRole("listitem")).toHaveCount(5);
        await expect(dialog.getByRole("button", { name: "Retry" })).toBeEnabled();
        await page.waitForLoadState("networkidle");
        await shot(page, "job-inspector");
        await axe(page, `job inspector ${size.name} ${scheme}`);
        await dialog.getByRole("button", { name: "Retry" }).click();
        await expect(dialog.getByTestId("action-result")).toContainText("Started again");
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
      });

      test("a running job fills the job line, which opens its inspector; a failed job is one line in the status strip", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/v2?fixture=1&job=running", { waitUntil: "load" });
        const line = page.getByTestId("job-line");
        await expect(line).toContainText("Extracting Material master 42%", NAV);
        await expect(page.getByTestId("status-failure")).toContainText("Extraction of Employee central failed");
        await page.waitForLoadState("networkidle");
        await shot(page, "jobline");
        await axe(page, `job line ${size.name} ${scheme}`);
        await line.getByRole("link").click();
        const dialog = page.getByRole("dialog", { name: /^Extraction, Material master/ });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
        await expect(page).toHaveURL(/open=job%3Adl-e0000000/);
      });

      test("the system inspector answers Test connection and Extract in its own frame", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`/v2?fixture=1&open=system:${ECC}`, { waitUntil: "load" });
        const dialog = page.getByRole("dialog", { name: "ECC production" });
        await expect(dialog).toBeVisible(NAV);
        await expect(dialog.getByText("RFC connection succeeded (client 100, 41 ms)")).toBeVisible();
        await dialog.getByRole("button", { name: "Test connection" }).click();
        await expect(dialog.getByTestId("action-result")).toContainText("RFC connection works");
        await dialog.getByRole("button", { name: "Extract" }).click();
        await expect(dialog.getByTestId("extract-picker").getByRole("checkbox")).toHaveCount(17); // 15 objects, the analyse switch and changes only
        await page.waitForLoadState("networkidle");
        await shot(page, "system-inspector");
        await axe(page, `system inspector ${size.name} ${scheme}`);
      });

      test("the Basis next step opens the system inspector on the system that was never extracted", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/v2?fixture=1&persona=basis", { waitUntil: "load" });
        await page.getByRole("link", { name: "Extract SuccessFactors" }).click();
        const dialog = page.getByRole("dialog", { name: "SuccessFactors" });
        await expect(dialog).toBeVisible(NAV);
        await expect(dialog.getByText("Sign-in refused")).toBeVisible();
        await dialog.getByRole("button", { name: "Test connection" }).click();
        await expect(dialog.getByTestId("action-result")).toContainText("OData connection failed");
      });

      test("the System canvas: health, its views, and the Configuration view", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`/v2/s/${ECC}?fixture=1`, { waitUntil: "load", timeout: 90_000 });
        await expect(page.getByRole("heading", { level: 1 })).toContainText("ECC production", NAV);
        await expect(page.getByTestId("system-status-line")).toContainText("Connected");
        await expect(page.getByRole("navigation", { name: "Views of ECC production" }).getByRole("link")).toHaveCount(6);
        await expect(page.getByTestId("system-objects")).toBeVisible();
        expect(await noSideways(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shot(page, "system");
        await axe(page, `system ${size.name} ${scheme}`);
        await page.getByRole("navigation", { name: "Views of ECC production" }).getByRole("link", { name: "Configuration", exact: true }).click();
        await expect(page.getByTestId("config-areas").getByRole("link").first()).toBeVisible(NAV); // the hand-over frame is gone: Configuration is a v2 view of its own
        await shot(page, "system-configuration");
        await axe(page, `system configuration ${size.name} ${scheme}`);
      });
    });
  }
}
