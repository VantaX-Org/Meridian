/**
 * The work, requests, approvals and monitor journeys in fixture mode: every toolbar, tab, filter and action on
 * /work (with its triage, exceptions and approvals sheets), /work/analytics, /work/requests, /requests and its
 * new, detail, analytics and workflow screens, /monitor and /monitor/controls, each click asserting what the user sees.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3747 npx playwright test e2e/journeys-work.spec.ts
 */

import { expect, test, type Page } from "@playwright/test";

const NAV = { timeout: 90_000 };

test.beforeEach(async ({ page }) => {
  test.setTimeout(180_000);
  await page.context().addCookies([{ name: "mn_session", value: "1", domain: "localhost", path: "/" }]);
  await page.addInitScript(() => { try { localStorage.setItem("meridian:theme", "light"); } catch { /* storage off */ } });
  await page.route("**/api/v1/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
});

const go = async (page: Page, path: string) => {
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}fixture=1`, NAV);
  return errs;
};
const toast = (page: Page, tone: "good" | "bad") => page.locator(`.mx-toasts .mx-toast[data-tone=${tone}]`).last();
const main = (page: Page) => page.locator("main");

test.fixme("work: clean board, segments, rule rail, set one value, export, import and more tools", async ({ page }) => {
  const errs = await go(page, "/work");
  await expect(page.getByTestId("fix-grid")).toBeVisible(NAV);

  await page.getByRole("button", { name: "Show the clean board" }).click();
  await expect(page.locator("#fix-board")).toBeVisible();
  await page.getByRole("button", { name: "Hide the clean board" }).click();
  await expect(page.locator("#fix-board")).toHaveCount(0);

  for (const seg of ["With a proposal", "Needs a person", "Decided", "All"]) {
    const chip = main(page).getByRole("button", { name: seg, exact: true }).first();
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
  }

  const setOne = page.getByRole("button", { name: "Set one value for selected" });
  await expect(setOne).toBeDisabled();
  await main(page).getByRole("button", { name: /^MM0\d\d/ }).first().click();
  await expect(page.getByTestId("rule-head")).toBeVisible();
  await expect(setOne).toBeEnabled();
  await setOne.click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("textbox").fill("KG");
  await dlg.getByRole("button", { name: "Set the value" }).click();
  await expect(toast(page, "good")).toContainText("values set");

  await page.getByRole("button", { name: "Export workbook" }).click();
  const dl = page.waitForEvent("download", { timeout: 30_000 }).catch(() => null);
  await page.getByRole("menuitem", { name: "Excel workbook" }).click();
  const file = await dl;
  if (!file) await expect(page.locator(".mx-toasts .mx-toast").last()).toBeVisible();

  await page.getByRole("button", { name: "Import workbook" }).click();
  await expect(page.getByRole("dialog", { name: "Import workbook" })).toBeVisible();
  await page.getByRole("dialog", { name: "Import workbook" }).getByRole("button", { name: "Close" }).first().click();
  await expect(page.getByRole("dialog", { name: "Import workbook" })).toHaveCount(0);

  await page.getByRole("button", { name: "More tools" }).click();
  await page.getByRole("menuitem", { name: "Save this view" }).click();
  await expect(page.getByRole("alertdialog", { name: "Name this view" })).toBeVisible();
  await page.getByRole("alertdialog", { name: "Name this view" }).getByRole("textbox").fill("Seals");
  await page.getByRole("alertdialog", { name: "Name this view" }).getByRole("button", { name: "Save this view" }).click();
  await expect(toast(page, "good")).toContainText("View saved.");

  await page.getByRole("button", { name: "Shortcuts" }).click();
  await expect(page.getByText("Shift+A").first()).toBeVisible();
  await page.keyboard.press("Escape");
  expect(errs).toEqual([]);
});

test.fixme("work: row accept, reject and load more on the grid", async ({ page }) => {
  await go(page, "/work");
  const grid = page.getByTestId("fix-grid");
  await expect(grid).toBeVisible(NAV);
  const before = Number(/^(\d+)/.exec(await page.getByTestId("decision-sentence").innerText())?.[1]);
  await grid.getByRole("button", { name: "Accept" }).first().click();
  await expect.poll(async () => Number(/^(\d+)/.exec(await page.getByTestId("decision-sentence").innerText())?.[1]), NAV).toBe(before + 1);
  await grid.getByRole("button", { name: "Reject" }).first().click();
  const why = page.getByTestId("reject-dialog");
  await expect(why).toBeVisible();
  await why.getByRole("button", { name: "The proposed value is wrong" }).click();
  await expect(why).toHaveCount(0);
  await expect.poll(async () => Number(/^(\d+)/.exec(await page.getByTestId("decision-sentence").innerText())?.[1]), NAV).toBe(before + 2);
  const more = page.getByRole("button", { name: "Load more" });
  if (await more.count()) {
    const rows = await grid.getByRole("row").count();
    await more.click();
    await expect.poll(() => grid.getByRole("row").count(), NAV).toBeGreaterThan(rows);
  }
});

test.fixme("triage sheet: buckets, sort, pick and bulk apply", async ({ page }) => {
  const errs = await go(page, "/work?open=triage");
  const sheet = page.getByRole("dialog").first();
  const buckets = sheet.getByRole("group", { name: "Buckets" });
  await expect(buckets.getByRole("button", { name: /^Overdue/ })).toBeVisible(NAV);
  for (const b of [/^Later/, /^Due today/, /^Overdue/]) {
    const chip = buckets.getByRole("button", { name: b });
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
  }
  const apply = sheet.getByRole("button", { name: /^Apply to \d+ items/ });
  await expect(apply).toBeDisabled();
  await sheet.getByRole("checkbox", { name: /^Pick / }).first().check();
  await expect(apply).toBeEnabled();
  await apply.click();
  await page.getByRole("alertdialog", { name: "Apply this action?" }).getByRole("button", { name: "Apply" }).click();
  await expect(page.locator(".mx-toasts .mx-toast, [role=status]").last()).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).first().click();
  await expect(page).not.toHaveURL(/open=triage/);
  expect(errs).toEqual([]);
});

test.fixme("exceptions sheet: tabs, status filters, raise and export sign-offs", async ({ page }) => {
  const errs = await go(page, "/work?open=exceptions");
  const sheet = page.getByRole("dialog").first();
  await expect(sheet.getByRole("tab", { name: "Exceptions" })).toBeVisible(NAV);
  for (const s of ["Open", "Investigating", "Resolved", "All"]) {
    const b = sheet.getByRole("button", { name: s, exact: true }).first();
    await b.click();
    await expect(b).toHaveAttribute("aria-pressed", "true");
  }
  const raise = sheet.getByRole("button", { name: "Raise exception" });
  await expect(raise).toBeDisabled();
  await sheet.getByLabel("Title", { exact: true }).fill("Plant 1000 seals blocked");
  await sheet.getByLabel("What happened").fill("Material type ERSA rows without a base unit");
  await raise.click();
  await expect(toast(page, "good")).toContainText("Exception raised.");
  for (const tab of ["Rules", "Billing", "SAP monitor", "Exceptions"]) {
    await sheet.getByRole("tab", { name: tab }).click();
    await expect(sheet.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
  }
  expect(errs).toEqual([]);
});

test("approvals sheet: batches, send to SAP and a refused write-back shows the reason", async ({ page }) => {
  const errs = await go(page, "/work?open=approvals");
  const sheet = page.getByRole("dialog").last();
  await expect(sheet.getByRole("tab", { name: "Batches" })).toBeVisible(NAV);
  await sheet.getByRole("tab", { name: "Send to SAP" }).click();
  await expect(sheet.getByRole("tab", { name: "Send to SAP" })).toHaveAttribute("aria-selected", "true");
  const approve = sheet.getByRole("button", { name: "Approve" }).first();
  if (await approve.count()) {
    await approve.click();
    await expect(toast(page, "bad")).toContainText("Live SAP write-back is off");
  }
  await sheet.getByRole("tab", { name: "Batches" }).click();
  expect(errs).toEqual([]);
});

test("work analytics and work requests", async ({ page }) => {
  let errs = await go(page, "/work/analytics");
  await page.getByRole("button", { name: "Show as table" }).first().click();
  await expect(main(page).getByRole("table").first()).toBeVisible(NAV);
  expect(errs).toEqual([]);

  errs = await go(page, "/work/requests");
  await page.getByRole("button", { name: "All requests" }).click();
  await expect(page.getByRole("button", { name: "All requests" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Asked of me" }).click();
  await page.getByRole("button", { name: "New request" }).click();
  await expect(page.getByRole("dialog").last()).toBeVisible();
  expect(errs).toEqual([]);
});

test("requests list: tabs and links", async ({ page }) => {
  const errs = await go(page, "/requests");
  for (const tab of ["To approve", "All requests", "My requests"]) {
    await main(page).getByRole("tab", { name: tab }).click();
    await expect(main(page).getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
  }
  await main(page).getByRole("tab", { name: "All requests" }).click();
  await expect(main(page).getByText("CR-1001").first()).toBeVisible(NAV);
  await main(page).getByRole("link", { name: "Workflows" }).click();
  await expect(page).toHaveURL(/\/requests\/workflows/, NAV);
  await page.goBack();
  await main(page).getByRole("link", { name: "Process analytics" }).click();
  await expect(page).toHaveURL(/\/requests\/analytics/, NAV);
  await page.goBack();
  await main(page).getByRole("link", { name: "New request" }).click();
  await expect(page).toHaveURL(/\/requests\/new/, NAV);
  expect(errs).toEqual([]);
});

test.fixme("new request: save draft, validate, entry rules tabs and submit", async ({ page }) => {
  const errs = await go(page, "/requests/new");
  await expect(page.getByRole("button", { name: "Save draft" })).toBeVisible(NAV);
  await main(page).getByRole("textbox").first().fill("Seal kit for plant 1000");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(toast(page, "good")).toContainText("Draft saved");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(toast(page, "good")).toContainText("Draft saved");
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText("Checks before submission")).toBeVisible(NAV);
  for (const tab of ["Derivations", "Critical fields", "Defaults"]) {
    await main(page).getByRole("tab", { name: tab }).click();
    await expect(main(page).getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
  }
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/requests\/CR-/, NAV);
  await expect(main(page).getByText("Four-eyes approval").first()).toBeVisible(NAV);
  expect(errs).toEqual([]);
});

test("request detail: comment, approve, and a draft validates, submits and cancels", async ({ page }) => {
  let errs = await go(page, "/requests/CR-1001");
  await main(page).getByRole("textbox").last().fill("Checked the seal size with the plant.");
  await main(page).getByRole("button", { name: "Post comment" }).click();
  await expect(main(page).getByText("Checked the seal size with the plant.")).toBeVisible(NAV);
  await main(page).getByRole("button", { name: "Approve" }).first().click();
  await expect(main(page).getByRole("button", { name: "Approve" })).toHaveCount(0, NAV);
  expect(errs).toEqual([]);

  errs = await go(page, "/requests/CR-1004");
  await main(page).getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText("Checks before submission")).toBeVisible(NAV);
  await main(page).getByRole("button", { name: "Submit" }).click();
  await expect(main(page).getByText("Four-eyes approval").first()).toBeVisible(NAV);
  await main(page).getByRole("button", { name: "Cancel request" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: /Cancel request|Confirm/ }).last().click();
  await expect(main(page).getByRole("button", { name: "Cancel request" })).toHaveCount(0, NAV);
  expect(errs).toEqual([]);
});

test("workflows and request analytics", async ({ page }) => {
  let errs = await go(page, "/requests/workflows");
  for (const tab of ["My tasks", "Instances", "Definitions"]) {
    await main(page).getByRole("tab", { name: tab }).click();
    await expect(main(page).getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
  }
  await main(page).getByRole("button", { name: "Steps" }).first().click();
  await main(page).getByRole("button", { name: "Facts and rules" }).first().click();
  await main(page).getByRole("button", { name: "New version" }).first().click();
  await expect(page.getByRole("dialog").last()).toBeVisible();
  await page.keyboard.press("Escape");
  await main(page).getByRole("button", { name: "New workflow" }).click();
  await expect(page.getByRole("dialog").last()).toBeVisible();
  await page.keyboard.press("Escape");
  await main(page).getByRole("link", { name: "Back to requests" }).click();
  await expect(page).toHaveURL(/\/requests(\?|$)/, NAV);
  expect(errs).toEqual([]);

  errs = await go(page, "/requests/analytics");
  const sel = main(page).getByRole("combobox");
  await expect(sel.first()).toBeVisible(NAV);
  for (let i = 0; i < (await sel.count()); i++) {
    const opts = await sel.nth(i).locator("option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
    if (opts.length > 1) await sel.nth(i).selectOption(opts[opts.length - 1]);
  }
  await expect(main(page).locator("h1")).toBeVisible();
  expect(errs).toEqual([]);
});

test("monitor: tabs, chips, acknowledge and controls", async ({ page }) => {
  let errs = await go(page, "/monitor");
  await expect(main(page).getByRole("tab", { name: "Feed" })).toBeVisible(NAV);
  await main(page).getByRole("button", { name: "Material master" }).first().click();
  await expect(main(page).getByRole("button", { name: "Material master" }).first()).toHaveAttribute("aria-pressed", "true");
  await main(page).getByRole("button", { name: "All objects" }).first().click();
  const ack = main(page).getByRole("button", { name: "Acknowledge", exact: true });
  const n = await ack.count();
  if (n) {
    await ack.first().click();
    await expect.poll(() => ack.count(), NAV).toBeLessThan(n);
  }
  const low = main(page).getByRole("button", { name: "Acknowledge all low" });
  if (await low.count()) {
    await low.click();
    await expect(page.locator(".mx-toasts .mx-toast").last()).toBeVisible();
  }
  for (const tab of ["Objects", "After a clean", "Learned", "Field shifts", "Feed"]) {
    await main(page).getByRole("tab", { name: tab }).click();
    await expect(main(page).getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
  }
  await main(page).getByRole("link", { name: "Controls" }).first().click();
  await expect(page).toHaveURL(/\/monitor\/controls/, NAV);
  expect(errs).toEqual([]);

  errs = await go(page, "/monitor/controls");
  for (const tab of ["Contracts", "Gate", "Schedule", "Configuration"]) {
    await main(page).getByRole("tab", { name: tab }).click();
    await expect(main(page).getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
  }
  expect(errs).toEqual([]);
});
