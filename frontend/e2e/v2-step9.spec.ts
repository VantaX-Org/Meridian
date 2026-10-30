/**
 * Meridian 2, step 9: fix simulation, readiness certificates, impact in money, webhooks, config drift alerts, rule
 * mining from fixes, contract enforcement and delta extraction, in fixture mode (`/v2?fixture=1`), so the spec needs
 * no API. At 1440 and 390, light and dark: each screen is there, the actions answer in place, no page scrolls
 * sideways, axe finds no critical or serious violation, and a screenshot of each lands in
 * e2e/__screenshots__/v2/step9-*.png.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test e2e/v2-step9.spec.ts
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
const R8 = "d3229ded-0708-4967-9dfb-1b7f4fada953";
const OBJECT = "/v2/o/ecc-production/material-master";

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
    test.describe(`v2 step 9 at ${size.name}, ${scheme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme });
      test.setTimeout(180_000);
      const shot = async (page: Page, name: string) => {
        await page.waitForLoadState("networkidle");
        await axe(page, `${name} ${size.name} ${scheme}`);
        await page.screenshot({ path: path.join(SHOTS, `step9-${name}_${size.name}_${scheme}.png`) });
      };

      test("fix simulation: Simulate fixing and Top fixes on the Rules tab, and from the Work bulk bar", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`${OBJECT}?fixture=1`, { waitUntil: "load" });
        await page.getByTestId("simulate-rules").click(NAV);
        const dialog = page.getByRole("dialog", { name: "Simulate fixing, Material master" });
        await dialog.getByRole("button", { name: "Simulate fixing 2 rules" }).click(NAV);
        await expect(dialog.getByTestId("simulation")).toContainText("Simulation: nothing is changed in SAP or in Meridian.", NAV);
        await expect(dialog.getByTestId("sim-after")).toContainText("No cap");
        await expect(dialog.getByTestId("simulation-landscape")).toContainText("Landscape after, simulated");
        await shot(page, "simulate");
        await dialog.getByRole("button", { name: "Close" }).click();
        await page.getByRole("button", { name: "Top fixes" }).click();
        await expect(page.getByRole("table", { name: /^Top fixes for Material master/ }).getByRole("row")).toHaveCount(6, NAV);
        expect(await noSideways(page)).toBe(true);
        await shot(page, "top-fixes");
      });

      test("fix simulation from the Work bulk bar", async ({ page }) => {
        test.skip(size.width < 500, "The ledger is a list on a phone; the bulk bar belongs to the wide grid");
        await prepare(page, scheme);
        await page.goto("/v2/work?fixture=1", { waitUntil: "load" });
        const grid = page.getByRole("grid", { name: "Work ledger" });
        await expect(grid).toBeVisible(NAV);
        await grid.getByRole("checkbox").nth(1).check();
        await grid.getByRole("checkbox").nth(2).check();
        await page.getByRole("button", { name: "Simulate fixing" }).click();
        await expect(page.getByRole("dialog").getByTestId("simulation")).toBeVisible(NAV);
        await shot(page, "simulate-work");
      });

      test("readiness certificate and money on the Waves view and in the certificate inspector", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/v2?fixture=1&view=waves", { waitUntil: "load" });
        await expect(page.getByTestId("waves-by-value").getByRole("listitem").first()).toContainText("Wave 2: master data", NAV);
        expect(await noSideways(page)).toBe(true);
        await shot(page, "waves-value");
        await page.goto("/v2?fixture=1&view=waves&open=certificate:w-2", { waitUntil: "load" });
        const block = page.getByTestId("certificate-block");
        await expect(block).toContainText("Required signers", NAV);
        await block.getByRole("button", { name: "Sign version 1" }).click();
        await expect(block).toContainText("Signed. Waiting for 1 more owner.");
        await block.getByTestId("issue-certificate").click();
        await expect(page.getByTestId("certificate-refusal")).toContainText("The wave is not ready to certify.");
        await shot(page, "certificate");
      });

      test("impact in money on the Readiness tab", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`${OBJECT}/readiness?fixture=1`, { waitUntil: "load" });
        await expect(page.getByTestId("money-line")).toContainText("a month in opportunity cost", NAV);
        await page.getByTestId("object-money").scrollIntoViewIfNeeded();
        expect(await noSideways(page)).toBe(true);
        await shot(page, "money");
      });

      test("webhooks: the Admin section, a preset, the webhook and a delivery", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/v2/admin/webhooks?fixture=1", { waitUntil: "load" });
        await expect(page.getByRole("grid", { name: "Webhooks" })).toContainText("hooks.slack.com", NAV);
        expect(await noSideways(page)).toBe(true);
        await shot(page, "webhooks");
        await page.goto("/v2/admin/webhooks?fixture=1&open=webhook:new", { waitUntil: "load" });
        await page.getByRole("button", { name: "Teams workflow" }).click(NAV);
        await shot(page, "webhook-new");
        await page.goto("/v2/admin/webhooks?fixture=1&open=webhook:wh-1", { waitUntil: "load" });
        await page.getByRole("button", { name: "Send a test event" }).click(NAV);
        await expect(page.getByTestId("action-result")).toContainText("Test event delivered");
        await expect(page.getByTestId("delivery-log")).toContainText("Retrying");
        await shot(page, "webhook");
        await page.goto("/v2/admin/webhooks?fixture=1&open=delivery:wh-1:dlv-104", { waitUntil: "load" });
        await expect(page.getByTestId("inspector")).toContainText("2 of 5", NAV);
        await shot(page, "delivery");
      });

      test("config drift: the System canvas view and the inbox panel", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`/v2/s/${ECC}?fixture=1&tab=changes`, { waitUntil: "load" });
        await expect(page.getByTestId("drift-alert").first()).toContainText("3 changes in T006 and T134", NAV);
        expect(await noSideways(page)).toBe(true);
        await shot(page, "config-changes");
        await page.goto("/v2?fixture=1&open=inbox", { waitUntil: "load" });
        await expect(page.getByTestId("inbox-drift")).toContainText("re-score queued", NAV);
        await shot(page, "inbox-drift");
      });

      test("rule mining: the Learned view with the evidence of mined rules", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`${OBJECT}?fixture=1`, { waitUntil: "load" });
        await page.getByRole("button", { name: "Learned 4" }).click(NAV);
        await expect(page.getByTestId("learned-evidence").first()).toContainText("From fixes: 30 records", NAV);
        await shot(page, "learned");
      });

      test("contracts: the mark on the matrix and the ruler, the editor, and the refused baseline", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`${OBJECT}?fixture=1`, { waitUntil: "load" });
        await expect(page.getByTestId("contract-mark").first()).toBeVisible(NAV);
        await page.getByTestId("object-contracts").locator("summary").click();
        const one = page.getByTestId("object-contract");
        await one.getByRole("checkbox", { name: /Enforce/ }).check();
        await one.getByRole("button", { name: "Save thresholds" }).click();
        await expect(page.getByTestId("object-contracts")).toContainText("1 enforced", NAV);
        await expect(page.getByTestId("contract-mark").first()).toHaveAttribute("data-enforced", "true", NAV);
        expect(await noSideways(page)).toBe(true);
        await shot(page, "contract-editor");
        // `contracts=enforced` starts the fixture with the contract enforced: the pin is refused with the backend's reason.
        await page.goto(`/v2/run/${R8}?fixture=1&contracts=enforced`, { waitUntil: "load" });
        const pin = page.getByRole("button", { name: "Pin as baseline" });
        await expect(pin).toBeEnabled(NAV);
        await pin.click();
        await expect(page.getByTestId("pin-refusal")).toContainText("This run breaches an enforced data contract", NAV);
        await shot(page, "pin-refused");
        if (size.width >= 500) {
          await page.goto("/v2?fixture=1", { waitUntil: "load" });
          await expect(page.getByTestId("coverage-matrix").getByTestId("contract-mark").first()).toBeVisible(NAV);
          await shot(page, "matrix-mark");
        }
      });

      test("delta extraction: the option in the extraction dialog and the change log", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto(`/v2/s/${ECC}?fixture=1&tab=extractions`, { waitUntil: "load" });
        await expect(page.getByTestId("change-log-line")).toContainText("Changes only since 9 Oct 2026", NAV);
        expect(await noSideways(page)).toBe(true);
        await shot(page, "change-log");
        await page.goto(`/v2/s/${ECC}?fixture=1&open=system:${ECC}`, { waitUntil: "load" });
        await page.getByRole("button", { name: "Extract", exact: true }).click(NAV);
        const picker = page.getByTestId("extract-picker");
        await picker.getByRole("checkbox").first().check(NAV);
        await picker.getByTestId("extract-delta").check();
        await expect(picker).toContainText("tables without change dates are read in full");
        await shot(page, "extract-delta");
      });
    });
  }
}
