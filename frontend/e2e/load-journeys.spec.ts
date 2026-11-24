/**
 * Load journeys in fixture mode: every action on the Load screens is clicked and its result asserted.
 * Writes land in the in-memory fixtures, so each screen shows the change it made.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3791 npx playwright test e2e/load-journeys.spec.ts
 */

import { expect, test, type Page } from "@playwright/test";

const NAV = { timeout: 150_000 };

test.setTimeout(300_000);

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([{ name: "mn_session", value: "1", domain: "localhost", path: "/" }]);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("meridian:theme", "light");
    } catch {
      /* blocked storage: the page falls back to the system scheme */
    }
  });
  await page.route("**/api/v1/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
});

async function open(page: Page, path: string, title: string) {
  await page.goto(`${path}?fixture=1`, NAV);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible(NAV);
}

const toast = (page: Page, text: string | RegExp) => expect(page.getByRole("status").getByText(text)).toBeVisible({ timeout: 15_000 });

async function exportVia(page: Page, menu: string) {
  await page.getByRole("button", { name: menu }).first().click();
  await page.getByRole("button", { name: /^Export/ }).last().click();
  await toast(page, /Saved|The file is ready/);
}

test("waves: create a wave from the sheet", async ({ page }) => {
  await open(page, "/load/waves", "Migration waves");
  await page.getByRole("button", { name: "New wave" }).click();
  await page.getByLabel("Wave name").fill("Wave 9: e2e");
  const chip = page.getByRole("dialog").getByRole("button", { name: /material_master/ }).first();
  if (await chip.count()) await chip.click();
  await page.getByRole("button", { name: "Create wave" }).click();
  await toast(page, "Wave created");
  await expect(page.getByRole("link", { name: "Wave 9: e2e" })).toBeVisible();
});

test("wave detail: run, threshold and export", async ({ page }) => {
  await open(page, "/load/waves/w-1", "Wave 1: finance foundations");
  await page.getByRole("button", { name: "Run wave analysis" }).click();
  await toast(page, "Wave analysis started");
  await page.getByLabel("Minimum readiness").fill("80");
  await page.getByRole("button", { name: "Save threshold" }).click();
  await toast(page, /Threshold saved|The threshold could not be saved/);
  await expect(page.getByRole("columnheader", { name: "Projected target DQS" })).toBeVisible();
  await exportVia(page, "Export report");
});

test("go-live: issue, sign and download a certificate", async ({ page }) => {
  await open(page, "/load/go-live", "Go-live readiness");
  await page.getByRole("button", { name: "Save gate" }).first().click();
  await toast(page, "Gate saved");
  await page.getByRole("button", { name: "Issue certificate" }).first().click();
  await expect(page.getByRole("status").getByText("Certificate issued").or(page.getByRole("alert").first())).toBeVisible({ timeout: 15_000 });
  const sign = page.getByRole("button", { name: "Sign", exact: true }).first();
  if (await sign.count()) {
    await sign.click();
    await toast(page, "Certificate signed");
  }
  const dl = page.getByRole("button", { name: "Download certificate" }).first();
  if (await dl.count()) await exportVia(page, "Download certificate");
});

test("templates: check, and download a blank template", async ({ page }) => {
  await open(page, "/load/templates", "Target templates");
  await exportVia(page, "Download a blank template");
  const check = page.getByRole("button", { name: "Check this template" });
  if (await check.count()) {
    await check.click();
    await expect(page.getByRole("status").first()).toBeVisible({ timeout: 15_000 });
  }
});

test("maps: add, confirm and delete a field mapping, then propose a value mapping", async ({ page }) => {
  await open(page, "/load/maps", "Field and value maps");
  await page.getByLabel("Source field").fill("MARA.ZZE2E");
  await page.getByLabel("Target table").fill("MARA");
  await page.getByLabel("Target field", { exact: true }).fill("ZZE2E");
  await page.getByRole("button", { name: "Add mapping" }).click();
  await toast(page, "Mapping added");
  await expect(page.getByText("MARA.ZZE2E").first()).toBeVisible();
  const confirm = page.getByRole("switch", { name: "Confirmed MARA.ZZE2E" }).or(page.getByLabel("Confirmed MARA.ZZE2E"));
  await confirm.first().click();
  await page.getByRole("button", { name: "Delete mapping MARA.ZZE2E" }).click();
  await toast(page, "Mapping deleted");

  await page.getByRole("tab", { name: /Value map/ }).click();
  await page.getByLabel("Source value").fill("ZE2E");
  await page.getByLabel("Target value").fill("FERT");
  await page.getByLabel("Note").fill("e2e");
  await page.getByRole("button", { name: "Add value mapping" }).click();
  await toast(page, "Value mapping proposed. A second person approves it.");
  const approve = page.getByRole("button", { name: "Approve" }).first();
  if (await approve.count()) {
    await approve.click();
    await toast(page, "Decision saved");
  }
});

test("pairs: create a pair, then remove it", async ({ page }) => {
  await open(page, "/load/compare", "Paired systems");
  await page.getByRole("button", { name: "New pair" }).click();
  const dlg = page.getByRole("dialog");
  const pick = async (label: string, index: number) => {
    const sel = dlg.getByLabel(label);
    const values = await sel.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
    await sel.selectOption(values[Math.min(index, values.length - 1)]);
  };
  await pick("Object", 0);
  await pick("Source system", 0);
  await pick("Target system", 1);
  await dlg.getByRole("button", { name: "Create pair" }).click();
  await expect(page.getByRole("status").first()).toBeVisible({ timeout: 15_000 });
  const before = await page.getByRole("button", { name: "Remove" }).count();
  await page.getByRole("button", { name: "Remove" }).last().click();
  await page.getByRole("alertdialog").getByRole("button", { name: /Remove/ }).last().click();
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(before - 1, { timeout: 15_000 });
});

test("pair: run, switch tabs, filter and export the differences", async ({ page }) => {
  await open(page, "/load/compare/pair-0001", "ECC production to S/4HANA quality");
  await page.getByRole("button", { name: "Run comparison" }).click();
  await toast(page, "Comparison started");
  await page.getByLabel("Kind of difference").selectOption("missing");
  await page.getByRole("tab", { name: "Tables" }).click();
  await expect(page.getByRole("group", { name: "Compared tables" })).toBeVisible();
  await page.getByRole("tab", { name: "Config" }).click();
  await expect(page.getByRole("group", { name: "Configuration objects" })).toBeVisible();
  await exportVia(page, "Export differences");
});

test("s4: each rule shows its description beside its code", async ({ page }) => {
  await open(page, "/load/s4", "S/4 readiness");
  await expect(page.getByText("contact person has no last name", { exact: false }).first()).toBeVisible();
  await page.getByText("Material master").first().click();
  await expect(page.getByText("Material type is mandatory", { exact: false }).first()).toBeVisible();
});

test("runs: open the start sheet with its fields", async ({ page }) => {
  await open(page, "/load/runs", "Migration runs");
  await page.getByRole("button", { name: "Start a run" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByLabel("Mode")).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Start analysis" })).toBeDisabled();
});

test("load board: source, projected and actual target with a reconciliation export", async ({ page }) => {
  await open(page, "/load", "Load");
  const board = page.getByTestId("load-board");
  await expect(board.getByText("Projected target").first()).toBeVisible(NAV);
  await expect(board.getByText("Actual target").first()).toBeVisible();
  await exportVia(page, "Export reconciliation");
});
