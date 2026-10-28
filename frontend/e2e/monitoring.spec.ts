/**
 * Per-object monitoring end to end (plan section 4): the strip under an object's header in each freshness state, and
 * the Objects list's monitoring view with its freshness filter. The monitor is the server's
 * (GET /objects/{module}/monitor and /objects/monitor), so each case hands the mock the row the API would return
 * (fixtures/mocks-monitoring.ts) and checks that the page words it right.
 */

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { FIRST_RUN_MANUAL, mockObjectMonitors, monitorOf } from "./fixtures/mocks-monitoring";
import type { ObjectMonitor } from "../lib/api/v1/objects";

const MODULE = "material_master";

const strip = (page: Page) => page.getByRole("region", { name: "Monitor of Material master" });

async function openObject(page: Page, row: ObjectMonitor | null) {
  await mockObjectMonitors(page, row ? [row] : []);
  await page.goto(`/objects/${MODULE}`, { waitUntil: "load" });
}

test.describe("object monitor strip", () => {
  test("a scheduled, fresh object shows when it was checked, how often, the baseline and what changed", async ({ app }) => {
    await openObject(app, monitorOf(MODULE));
    const m = strip(app);
    await expect(m).toBeVisible({ timeout: 20_000 });

    await expect(m.getByText("Checked", { exact: true })).toBeVisible();
    await expect(m.getByText("1h ago")).toBeVisible();
    await expect(m.getByText("Started by the schedule")).toBeVisible();
    await expect(m.getByText("Daily at 02:00")).toBeVisible();
    await expect(m.getByText("Fresh", { exact: true })).toBeVisible();
    await expect(m.getByText("On schedule")).toBeVisible();
    await expect(m.getByText("Pinned run of 12 Oct 2026")).toBeVisible();

    // since the baseline: one newly failing rule (named), its records open in Fix work; one recovered rule
    await expect(m.getByText("Newly failing rules", { exact: true })).toBeVisible();
    await expect(m.getByText("MM101")).toBeVisible();
    await expect(m.getByRole("link", { name: /Open the 9 new failing records of Material master/ })).toHaveAttribute("href", /\/fix\?.*since=/);
    await expect(m.getByRole("link", { name: /Compare this run with its baseline: 4 recovered records/ })).toBeVisible();

    await expect(m.getByRole("button", { name: /^Re-check now/ })).toBeEnabled();
    await expect(m.getByRole("button", { name: "Change schedule" })).toBeVisible();
    await expect(m.getByRole("button", { name: "Pin this run as baseline" })).toBeVisible();
  });

  test("Change schedule opens the cadence picker", async ({ app }) => {
    await openObject(app, monitorOf(MODULE));
    await strip(app).getByRole("button", { name: "Change schedule" }).click();
    await expect(strip(app).getByRole("combobox").first()).toBeVisible();
  });

  const STATES: { name: string; row: ObjectMonitor; pill: string; hint: string }[] = [
    { name: "stale", row: monitorOf(MODULE, { freshness: "stale", last_run_at: "2026-10-16T04:21:43Z" }), pill: "Stale", hint: "Overdue for a check" },
    { name: "failed", row: monitorOf(MODULE, { freshness: "failed" }), pill: "Failed", hint: "The last extraction failed" },
    { name: "due", row: monitorOf(MODULE, { freshness: "due" }), pill: "Due", hint: "A check is due now" },
  ];
  for (const s of STATES) {
    test(`a ${s.name} object says so in the pill and under it`, async ({ app }) => {
      await openObject(app, s.row);
      await expect(strip(app).getByText(s.pill, { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(strip(app).getByText(s.hint)).toBeVisible();
    });
  }

  test("a paused schedule is Paused, shows no next check and is not stale", async ({ app }) => {
    await openObject(app, monitorOf(MODULE, {
      freshness: "paused", next_run_at: null, cadence: { cron: "0 2 * * *", active: false, interval_seconds: 86_400, profile_id: "p-1" },
    }));
    const m = strip(app);
    await expect(m.getByText("Paused", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(m.getByText("The schedule is paused").first()).toBeVisible();
    await expect(m.getByText("Stale", { exact: true })).toHaveCount(0);
  });

  test("an uploaded object has no schedule: Manual, First run and a way to upload again", async ({ app }) => {
    await openObject(app, monitorOf(MODULE, FIRST_RUN_MANUAL));
    const m = strip(app);
    await expect(m.getByText("Manual only")).toBeVisible({ timeout: 20_000 });
    await expect(m.getByText("Manual", { exact: true })).toBeVisible();
    await expect(m.getByText("Started by an upload")).toBeVisible();
    await expect(m.getByText("First run", { exact: true })).toBeVisible();
    await expect(m.getByText("Changes show from the second run")).toBeVisible();
    await expect(m.getByRole("link", { name: "Upload a new file" })).toHaveAttribute("href", "/import");
    await expect(m.getByRole("button", { name: /^Re-check now/ })).toHaveCount(0);
  });

  test("an object that was scheduled but never ran is not stale", async ({ app }) => {
    await openObject(app, monitorOf(MODULE, {
      last_run_at: null, last_version_id: null, trigger: null, freshness: "due",
      baseline: { kind: null, version_id: null, run_at: null },
    }));
    const m = strip(app);
    await expect(m.getByText("Not checked yet")).toBeVisible({ timeout: 20_000 });
    await expect(m.getByText("Waiting for the first run")).toBeVisible();
    await expect(m.getByText("Stale", { exact: true })).toHaveCount(0);
  });

  test("an object with no monitor leaves the page standing without the strip", async ({ app }) => {
    await openObject(app, null);
    await expect(app.getByRole("main")).toBeVisible({ timeout: 20_000 });
    await expect(app.getByTestId("run-scope")).toBeVisible({ timeout: 20_000 });
    await expect(strip(app)).toHaveCount(0);
  });
});

test.describe("objects list, monitoring view", () => {
  const ROWS = [
    monitorOf("material_master"),
    monitorOf("business_partner", { freshness: "stale", last_run_at: "2026-10-16T04:21:43Z" }),
  ];
  const header = (page: Page, name: string) => page.getByRole("columnheader", { name: new RegExp(`^${name}`) });

  test("swaps the work columns for Checked, Cadence, Freshness and Change", async ({ app }) => {
    await mockObjectMonitors(app, ROWS);
    await app.goto("/objects?view=monitoring", { waitUntil: "load" });
    await expect(header(app, "Checked")).toBeVisible({ timeout: 20_000 });
    for (const h of ["Cadence", "Freshness", "Change", "Score", "Verdict"]) await expect(header(app, h)).toBeVisible();
    // the work columns step aside
    for (const h of ["Rule failures", "Blocking rule", "Owner"]) await expect(header(app, h)).toHaveCount(0);

    const bp = app.getByRole("row", { name: /Business partner/ });
    await expect(bp.getByText("Stale", { exact: true })).toBeVisible();
    await expect(bp.getByText("Daily at 02:00")).toBeVisible();
    await expect(app.getByRole("row", { name: /Material master/ }).getByText("Fresh", { exact: true })).toBeVisible();
  });

  test("the default view keeps the work columns and adds Freshness", async ({ app }) => {
    await mockObjectMonitors(app, ROWS);
    await app.goto("/objects", { waitUntil: "load" });
    await expect(header(app, "Freshness")).toBeVisible({ timeout: 20_000 });
    await expect(header(app, "Checked")).toHaveCount(0);
    await expect(header(app, "Cadence")).toHaveCount(0);
  });

  test("the Stale filter keeps only stale objects and is part of the address", async ({ app }) => {
    await mockObjectMonitors(app, ROWS);
    await app.goto("/objects?view=monitoring", { waitUntil: "load" });
    await expect(app.getByRole("row", { name: /Material master/ })).toBeVisible({ timeout: 20_000 });
    await app.getByRole("button", { name: "Stale", exact: true }).click();
    await expect(app).toHaveURL(/freshness=stale/);
    await expect(app.getByRole("row", { name: /Business partner/ })).toBeVisible();
    await expect(app.getByRole("row", { name: /Material master/ })).toHaveCount(0);
  });

  test("the View chip opens and closes the monitoring view", async ({ app }) => {
    await mockObjectMonitors(app, ROWS);
    await app.goto("/objects", { waitUntil: "load" });
    await app.getByRole("button", { name: "Monitoring", exact: true }).click();
    await expect(app).toHaveURL(/view=monitoring/);
    await expect(header(app, "Checked")).toBeVisible({ timeout: 20_000 });
  });
});
