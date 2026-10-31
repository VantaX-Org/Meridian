/**
 * Meridian 2, step 4: approvals, exceptions, write-backs, the batch and person inspectors, the People canvas, the inbox
 * panel and the triage settings, in fixture mode (`?fixture=1`) so the spec needs no API. At 1440 and 390, light and dark:
 * each view draws, axe finds no critical or serious violation, nothing scrolls the page sideways, and a screenshot of
 * each lands in e2e/__screenshots__/v2/people-*.png and work-approvals-*.png.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test e2e/v2-people.spec.ts
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

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const size of SIZES) {
  for (const scheme of SCHEMES) {
    test.describe(`v2 people and approvals at ${size.name}, ${scheme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme });
      test.setTimeout(120_000);
      const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}_${size.name}_${scheme}.png`) });
      const phone = size.width < 500;

      test("the People canvas: the table, the caller's row first and marked", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/people?fixture=1&persona=owner", { waitUntil: "load", timeout: 90_000 });
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        await expect(page.getByRole("heading", { level: 1 })).toContainText("People", NAV);
        await expect(page.getByTestId("people-sentence")).toContainText("2 batches wait for your approval", NAV);
        if (phone) {
          const list = page.getByRole("list", { name: "People" });
          await expect(list.getByRole("listitem").first()).toContainText("Demo user");
          await expect(list.getByRole("listitem").first()).toContainText("you");
          await expect(list.getByRole("listitem")).toHaveCount(7); // six people and the unassigned open records
        } else {
          const table = page.getByRole("table", { name: "People" });
          await expect(table).toBeVisible(NAV);
          await expect(table.getByRole("columnheader")).toHaveCount(8);
          const first = table.getByRole("row").nth(1);
          await expect(first).toContainText("Demo user");
          await expect(first).toContainText("you");
          await expect(table.getByRole("row").nth(2)).toContainText("A. Naidoo");
        }
        expect(await noSideScroll(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shot(page, "people-canvas");
        await axe(page, `people ${size.name} ${scheme}`);
      });

      test("a person opens in the inspector: facts, objects, work, waiting approvals, Reassign…", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/people?fixture=1&persona=owner&open=person%3Au-tm", { waitUntil: "load", timeout: 90_000 });
        const insp = page.getByTestId("inspector");
        await expect(insp.getByRole("heading", { level: 2, name: "T. Mokoena" })).toBeVisible(NAV);
        await expect(insp.getByTestId("person-approvals").getByRole("listitem")).toHaveCount(3, NAV);
        await expect(insp.getByRole("button", { name: "Reassign…" })).toBeVisible();
        await expect(insp.getByRole("button", { name: "Approve batch B-241" })).toBeVisible();
        expect(await noSideScroll(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shot(page, "people-person");
        await axe(page, `person ${size.name} ${scheme}`);
      });

      test("the owner lands with 'Approve batch B-241', which opens the batch inspector", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/?fixture=1&persona=owner", { waitUntil: "load", timeout: 90_000 });
        const next = page.getByRole("link", { name: "Approve batch B-241" });
        await expect(next).toBeVisible(NAV);
        await shot(page, "people-owner-landscape");
        await next.click();
        const insp = page.getByTestId("inspector");
        await expect(insp.getByRole("heading", { level: 2, name: "Batch B-241" })).toBeVisible(NAV);
        await expect(insp.getByTestId("batch-records")).toBeVisible();
        await expect(insp.getByTestId("batch-trail")).toBeVisible();
        expect(await noSideScroll(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shot(page, "people-batch");
        await axe(page, `batch ${size.name} ${scheme}`);
      });

      test("approving a batch from the ledger posts a notice with Undo and moves the count", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/work?fixture=1&persona=owner&filter=approvals", { waitUntil: "load", timeout: 90_000 });
        const chips = page.getByRole("group", { name: "Filter by state" });
        await expect(chips.getByRole("button", { name: /Waiting for approval/ })).toContainText("612", NAV);
        if (phone) {
          const list = page.getByRole("list", { name: "Work ledger" });
          await expect(list.getByRole("listitem").first()).toBeVisible(NAV);
          await expect(list.getByRole("button", { name: "Approve batch B-241" })).toBeVisible();
        } else {
          const grid = page.getByRole("grid", { name: "Work ledger" });
          await expect(grid.getByTestId("batch-row-B-241")).toBeVisible(NAV);
        }
        await page.waitForLoadState("networkidle");
        await shot(page, "work-approvals");
        await axe(page, `approvals ${size.name} ${scheme}`);
        await page.getByRole("button", { name: "Approve batch B-241" }).click();
        const notice = page.getByRole("region", { name: "Change notices" }).getByRole("status");
        await expect(notice).toContainText("Approved batch B-241");
        await expect(notice.getByRole("button", { name: "Undo" })).toBeVisible();
        await expect(chips.getByRole("button", { name: /Waiting for approval/ })).toContainText("284", NAV);
        await shot(page, "work-approvals-approved");
        await page.getByRole("button", { name: "Undo" }).click();
        await expect(chips.getByRole("button", { name: /Waiting for approval/ })).toContainText("612", NAV);
      });

      test("exceptions: the reason, who and when, and Reopen", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/work?fixture=1&persona=steward&filter=exceptions", { waitUntil: "load", timeout: 90_000 });
        if (phone) {
          const list = page.getByRole("list", { name: "Work ledger" });
          await expect(list.getByRole("listitem").first()).toBeVisible(NAV);
          await expect(list.getByRole("listitem").first()).toContainText(/Accept risk|Not an issue/);
        } else {
          const grid = page.getByRole("grid", { name: "Work ledger" });
          await expect(grid.getByRole("columnheader", { name: "Reason" })).toBeVisible(NAV);
          await expect(grid.getByRole("button", { name: /^Reopen / }).first()).toBeVisible();
        }
        await page.waitForLoadState("networkidle");
        await shot(page, "work-approvals-exceptions");
        await axe(page, `exceptions ${size.name} ${scheme}`);
      });

      test("an approved batch is sent to SAP: the result sits in the frame and the batch reads as sent", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/work?fixture=1&persona=steward&filter=open&batch=B-236", { waitUntil: "load", timeout: 90_000 });
        const send = page.getByRole("button", { name: "Send batch B-236 to SAP" });
        await expect(send).toBeVisible(NAV);
        await page.waitForLoadState("networkidle");
        await shot(page, "work-approvals-send");
        await send.click();
        const result = page.getByTestId("action-result");
        await expect(result).toContainText("Load file exported, 180 records", NAV);
        await expect(page.getByTestId("batch-row-B-236")).toContainText(/Sent to SAP, 180 records/, NAV);
        expect(await noSideScroll(page)).toBe(true);
        await shot(page, "work-approvals-sent");
        await axe(page, `sent ${size.name} ${scheme}`);
      });

      test("the inbox panel: Today and Earlier, mark read, the count follows", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/people?fixture=1&persona=owner", { waitUntil: "load", timeout: 90_000 });
        await page.getByRole("button", { name: "Inbox 7, unread" }).click();
        const panel = page.getByTestId("inbox-panel");
        await expect(panel.getByRole("heading", { name: "Today" })).toBeVisible(NAV);
        await expect(panel.getByRole("heading", { name: "Earlier" })).toBeVisible();
        expect(await noSideScroll(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shot(page, "people-inbox");
        await axe(page, `inbox ${size.name} ${scheme}`);
        await panel.getByRole("button", { name: /^Mark read: Batch B-241/ }).click();
        await expect(page.getByRole("button", { name: "Inbox 6, unread" })).toBeVisible(NAV);
      });

      test("triage and SLA from the account menu", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/people?fixture=1&persona=owner", { waitUntil: "load", timeout: 90_000 });
        await page.getByRole("button", { name: /^Account/ }).click();
        await page.getByRole("menuitem", { name: "Triage and SLA" }).click();
        const insp = page.getByTestId("inspector");
        await expect(insp.getByRole("heading", { level: 2, name: "Triage and SLA" })).toBeVisible(NAV);
        await expect(insp.getByLabel("Critical")).toHaveValue("1");
        expect(await noSideScroll(page)).toBe(true);
        await page.waitForLoadState("networkidle");
        await shot(page, "people-triage");
        await axe(page, `triage ${size.name} ${scheme}`);
      });
    });
  }
}
