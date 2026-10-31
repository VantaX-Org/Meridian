/**
 * Meridian 2, step 10: policy packs, digests, sandbox mode, record history and time travel, run prediction and the
 * natural language mode of the command line, in fixture mode (`/?fixture=1`), so the spec needs no API. At 1440 and
 * 390, light and dark: each screen is there, the actions answer in place, no page scrolls sideways, axe finds no
 * critical or serious violation, and a screenshot of each lands in e2e/__screenshots__/v2/step10-*.png.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test e2e/v2-step10.spec.ts
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
const RECORD = encodeURIComponent("record:material_master:MATNR=000000000000000100");
const R3 = "b0300000-0000-4000-8000-000000000003";

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

// At phone width the filter tags sit under the Filters button (F28).
async function filtersInForce(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) < 500) await page.getByTestId("work-filters").click(NAV);
  return page.getByRole("list", { name: "Filters in force" });
}

const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const size of SIZES) {
  for (const scheme of SCHEMES) {
    test.describe(`v2 step 10 at ${size.name}, ${scheme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme });
      test.setTimeout(180_000);
      const shot = async (page: Page, name: string) => {
        await page.waitForLoadState("networkidle");
        await axe(page, `${name} ${size.name} ${scheme}`);
        await page.screenshot({ path: path.join(SHOTS, `step10-${name}_${size.name}_${scheme}.png`) });
      };

      test("policy packs: the Admin section, the pack inspector, the mark and the receipt", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/admin/policypacks?fixture=1", { waitUntil: "load" });
        await expect(page.getByTestId("pack-sox")).toContainText("Applied 5 Oct 2026 by R. Govender", NAV);
        expect(await noSideways(page)).toBe(true);
        await shot(page, "policy-packs");
        await page.goto("/admin/policypacks?fixture=1&open=policypack:sox", { waitUntil: "load" });
        await expect(page.getByTestId("class-vendor_bank")).toContainText("Breached", NAV);
        await shot(page, "policy-pack");
        await page.goto(`${OBJECT}?fixture=1`, { waitUntil: "load" });
        await expect(page.getByTestId("receipt-policy")).toContainText("Inventory valuation", NAV);
        await page.getByTestId("receipt-policy").scrollIntoViewIfNeeded();
        expect(await noSideways(page)).toBe(true);
        await shot(page, "receipt-policy");
        if (size.width >= 500) {
          await page.goto("/?fixture=1", { waitUntil: "load" });
          await expect(page.getByTestId("coverage-matrix").getByTestId("policy-mark").first()).toBeVisible(NAV);
          await shot(page, "matrix-policy");
        }
      });

      test("the Policy chip on the Work ledger", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/work?fixture=1&policy=sox:inventory_valuation&filter=open", { waitUntil: "load" });
        await expect(await filtersInForce(page)).toContainText("Policy: Inventory valuation (SOX financial controls)", NAV);
        expect(await noSideways(page)).toBe(true);
        await shot(page, "work-policy");
      });

      test("digests: the Admin section, a new digest, Send now and the preview", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/admin/digests?fixture=1", { waitUntil: "load" });
        await expect(page.getByRole("grid", { name: "Digests" })).toContainText("Monday leadership digest", NAV);
        expect(await noSideways(page)).toBe(true);
        await shot(page, "digests");
        await page.goto("/admin/digests?fixture=1&open=digest:new", { waitUntil: "load" });
        await page.getByTestId("digest-form").getByRole("button", { name: "A migration wave" }).click(NAV);
        await shot(page, "digest-new");
        await page.goto("/admin/digests?fixture=1&open=digest:dg-1", { waitUntil: "load" });
        await page.getByRole("button", { name: "Send now" }).click(NAV);
        await expect(page.getByTestId("action-result")).toContainText("Digest sent", NAV);
        await shot(page, "digest");
        await page.getByRole("button", { name: "Preview" }).click();
        const dlg = page.getByRole("dialog", { name: "Preview of Monday leadership digest" });
        await expect(dlg.getByTestId("digest-iframe")).toBeVisible(NAV);
        await dlg.getByRole("button", { name: "The numbers" }).click();
        await expect(dlg.getByTestId("digest-numbers")).toContainText("Approvals waiting", NAV);
        await shot(page, "digest-preview");
      });

      test("sandbox mode: the banner across the shell, the Settings block and the refused decision", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/work?fixture=1&sandbox=1", { waitUntil: "load" });
        await expect(page.getByTestId("sandbox-banner")).toContainText("Sandbox: nothing leaves this deployment.", NAV);
        expect(await noSideways(page)).toBe(true);
        await shot(page, "sandbox-banner");
        await page.goto("/admin/settings?fixture=1#sandbox", { waitUntil: "load" });
        const block = page.getByRole("region", { name: "Sandbox mode" });
        await block.getByRole("button", { name: "Enter sandbox mode" }).click(NAV);
        await page.getByRole("dialog", { name: "Enter sandbox mode" }).getByRole("button", { name: "Copy the latest run and enter" }).click();
        await expect(block).toContainText("Sandbox mode is on", NAV);
        await expect(page.getByTestId("sandbox-banner")).toBeVisible(NAV);
        await block.scrollIntoViewIfNeeded();
        await shot(page, "sandbox-settings");
        await page.goto(`/work?fixture=1&sandbox=1&persona=steward&open=${RECORD}`, { waitUntil: "load" });
        await page.getByTestId("inspector").getByRole("button", { name: /^Accept suggested/ }).click(NAV);
        await expect(page.getByText("Sandbox mode is on: decisions apply to the sandbox run only.", { exact: false }).first()).toBeVisible(NAV);
        await shot(page, "sandbox-refused");
      });

      test("history and time travel: the History tab, the ledger as of a run, the object as of a run", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`/work?fixture=1&open=${RECORD}`, { waitUntil: "load" });
        await page.getByRole("tab", { name: "History" }).click(NAV);
        await expect(page.getByTestId("history-runs")).toContainText("MARA-MEINS", NAV);
        await expect(page.getByTestId("history-events")).toContainText("started failing");
        await shot(page, "record-history");
        await page.goto(`/work?fixture=1&as_of_run=${R3}&filter=open`, { waitUntil: "load" });
        await expect(page.getByTestId("ledger-as-of")).toContainText("statuses are today's", NAV);
        expect(await noSideways(page)).toBe(true);
        await shot(page, "work-as-of");
        await page.goto(`${OBJECT}?fixture=1&as_of=${R3}`, { waitUntil: "load" });
        await expect(page.getByTestId("as-of-band")).toContainText("As it stood at the run of 18 Sept 2026", NAV);
        await expect(page.getByTestId("as-of-rules")).toContainText("MM142");
        expect(await noSideways(page)).toBe(true);
        await shot(page, "object-as-of");
      });

      test("prediction: the start forms and a queued job", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/admin/runs?fixture=1", { waitUntil: "load" });
        const ext = page.getByRole("region", { name: "Start an extraction" });
        // The form can draw again once the systems list lands; tick until the prediction shows.
        await expect(async () => {
          await ext.getByRole("checkbox").first().check();
          await expect(ext.getByTestId("run-prediction")).toBeVisible({ timeout: 5_000 });
        }).toPass(NAV);
        const p = ext.getByTestId("run-prediction");
        await expect(p.getByTestId("prediction-queue")).toContainText("Starts next", NAV);
        await expect(p.getByTestId("prediction-cost")).toContainText("ZAR");
        await p.scrollIntoViewIfNeeded();
        expect(await noSideways(page)).toBe(true);
        await shot(page, "prediction-admin");
        await page.goto("/runs?fixture=1&queue=busy", { waitUntil: "load" });
        await page.getByRole("button", { name: "Start a run" }).click(NAV);
        await expect(page.getByTestId("start-run").getByTestId("prediction-queue")).toContainText("Position 3 in the queue", NAV);
        await shot(page, "prediction-runs");
        await page.goto("/runs?fixture=1&job=queued&open=job:an-q0000000-0000-4000-8000-0000000000q1", { waitUntil: "load" });
        await expect(page.getByTestId("inspector")).toContainText("Position 2 in the queue", NAV);
        await expect(page.getByTestId("job-line")).toContainText("queued, position 2");
        await shot(page, "job-queued");
      });

      test("natural language: ? in the command line shows the filter that will run", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/?fixture=1", { waitUntil: "load" });
        await expect(page.getByRole("button", { name: "Search or type a command" })).toBeVisible(NAV);
        await page.getByRole("button", { name: "Search or type a command" }).click();
        const dialog = page.getByRole("dialog", { name: "Search or type a command" });
        await dialog.getByRole("combobox").fill("?critical materials assigned to me due this week zebra");
        await expect(dialog.getByTestId("nl-chips")).toContainText("Severity", NAV);
        await expect(dialog.getByTestId("nl-unmatched")).toContainText("zebra");
        await shot(page, "command-nl");
        await dialog.getByRole("button", { name: "Open in Work" }).click();
        await expect(page).toHaveURL(/\/work\?.*severity=critical.*filter=open/, NAV);
        await expect(await filtersInForce(page)).toContainText("Severity critical", NAV);
      });
    });
  }
}
