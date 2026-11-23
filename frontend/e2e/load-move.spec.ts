/**
 * Move to new instance at /load/move: seven steps against a mocked API, from choosing systems to the cut-over delta.
 * SHOTS=<dir> also saves a screenshot of each step.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3700 npx playwright test e2e/n-load-move.spec.ts
 */

import { expect, test, type Page, type Route } from "@playwright/test";

const NAV = { timeout: 90_000 };
const SHOTS = process.env.SHOTS;
const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const SYSTEMS = [
  { id: "s1", name: "Dev ECC", environment: "dev", system_type: "ecc", role: "source" },
  { id: "s2", name: "New S4", environment: "prod", system_type: "s4hana", role: "target", migration_target: true },
];
const PLAN = {
  id: "p1", source: "Dev ECC", target: "New S4", modules: ["employee_central", "material_master"], mode: "cleansed",
  waves: [
    { wave: 1, label: "Foundation", steps: [{ module: "employee_central", entity: "PerPerson", method: "odata_upsert", rows: 1000, history_rows: 400, purge_type: null, depends_on: [] }] },
    { wave: 2, label: "Dependent", steps: [{ module: "material_master", entity: "MARA", method: "file_load", rows: 500, history_rows: 0, purge_type: null, depends_on: ["PerPerson"] }] },
  ],
  unplaced: [{ module: "learning_management", entity: "LearningItem", reason: "No load method" }],
  cleansing: { cells_fixed_per_rule: { "SF-EC-014": 320, "SF-EC-002": 1200 }, records_still_failing: 7, dqs: { overall: { before: 62, after: 91, delta: 29 } } },
};
const run = (id: string, dry: boolean) => ({
  id, status: "completed", dry_run: dry, checkpoint: null, started_at: "2026-11-17T08:00:00Z", finished_at: "2026-11-17T08:05:00Z",
  waves: [{ wave: 1, status: "completed", steps: [{ entity: "PerPerson", sent: 1400, ok: 1390, failed: 10, error_rate: 0.007 }] }],
});
const RECON = {
  status: "completed",
  entities: [
    { entity: "PerPerson", source_rows: 1400, target_rows: 1390, missing_in_target: ["1001", "1002"], extra_in_target: [], field_diffs: { email: 2 }, sample: [{ key: "1001", field: "email", source: "a@x.test", target: "" }] },
    { entity: "MARA", source_rows: 500, target_rows: 500, missing_in_target: [], extra_in_target: [], field_diffs: {}, sample: [] },
  ],
  dqs: { source: 71, projected_target: 88, actual_target: 84, reasons: ["Rows rejected by the target"] },
};

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([{ name: "mn_session", value: "1", domain: "localhost", path: "/" }]);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("meridian:theme", "light");
    } catch {
      /* blocked storage: the page falls back to the system scheme */
    }
  });
  let last = run("r1", true);
  await page.route("**/api/v1/**", (route) => {
    const p = new URL(route.request().url()).pathname.replace("/api/v1", "");
    const m = route.request().method();
    if (p === "/auth/me") return json(route, { user: { id: "u1", email: "a@x.test", name: "Test Admin", role: "admin", permissions: ["*"] }, must_change_password: false });
    if (p === "/systems") return json(route, SYSTEMS);
    if (p.startsWith("/systems/")) return json(route, { ...SYSTEMS[1], role: "target" });
    if (p === "/licence") return json(route, { enabled_modules: ["employee_central", "material_master"], modules: ["employee_central", "material_master"] });
    if (p === "/migration/move/plans" && m === "POST") return json(route, PLAN);
    if (p === "/migration/move/plans/p1") return json(route, { ...PLAN, preflight: { status: "completed", issues: [{ entity: "PerPerson", field: "country", records: ["1001", "1002", "1003"], reason: "Country not in the target picklist", severity: "warning" }] } });
    if (p === "/migration/move/plans/p1/preflight") return json(route, { issues: [], status: "queued" });
    if (p === "/migration/move/plans/p1/runs") {
      last = run(last.id === "r1" ? "r2" : "r3", (route.request().postDataJSON() as { dry_run: boolean }).dry_run);
      return json(route, last);
    }
    if (p.startsWith("/migration/move/runs/")) return json(route, last);
    if (p === "/migration/move/plans/p1/reconcile") return json(route, { id: "c1" });
    if (p === "/migration/move/reconciliations/c1") return json(route, RECON);
    if (p === "/migration/move/plans/p1/delta") {
      last = run("d1", (route.request().postDataJSON() as { dry_run: boolean }).dry_run);
      return json(route, last);
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
});

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

test("seven steps from systems to delta", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/load/move", NAV);
  await expect(page.getByRole("heading", { name: "Move to new instance" })).toBeVisible(NAV);

  // 1 systems
  await page.getByLabel("Move from (source)").selectOption("s1");
  await page.getByLabel("Move to (new instance)").selectOption("s2");
  await shot(page, "1-systems");
  await page.getByRole("button", { name: "Continue to scope" }).click();

  // 2 scope: the defaults
  await expect(page.getByText("Cleaned values", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Keep the same IDs", { exact: true })).toBeVisible();
  await expect(page.getByText("Full history", { exact: true }).first()).toBeVisible();
  await shot(page, "2-scope");
  await page.getByRole("button", { name: "Make the plan" }).click();

  // 3 plan
  await expect(page.getByText("Cleaned automatically", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("SF-EC-014", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("LearningItem: No load method")).toBeVisible();
  await shot(page, "3-plan");
  await page.getByRole("button", { name: "Check before loading" }).click();

  // 4 pre-flight: a medium issue does not block
  await expect(page.getByText("Country not in the target picklist").first()).toBeVisible();
  await shot(page, "4-preflight");
  await page.getByRole("button", { name: "Continue to load" }).click();

  // 5 load: dry run, then the real load behind a confirm
  await page.getByRole("button", { name: "Run a dry run" }).click();
  await expect(page.getByText("Dry run passed").first()).toBeVisible();
  await shot(page, "5-load");
  await page.getByRole("button", { name: "Load into New S4" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Load into New S4" }).click();
  await expect(page.getByRole("button", { name: "Reconcile" })).toBeVisible();
  await page.getByRole("button", { name: "Reconcile" }).click();

  // 6 reconcile
  await page.getByRole("button", { name: "Reconcile now" }).click();
  await expect(page.getByText("Projected target").first()).toBeVisible();
  await page.locator("#mx-row-PerPerson").click();
  await expect(page.getByText("Sample rows for PerPerson").first()).toBeVisible();
  await shot(page, "6-reconcile");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Plan the cut-over delta" }).click();

  // 7 delta
  await page.locator("input[type=date]").fill("2026-11-01");
  await page.getByRole("button", { name: "Dry run the delta" }).click();
  await expect(page.getByText("Dry run, nothing written")).toBeVisible();
  await page.getByRole("button", { name: "Send the delta" }).click();
  await expect(page.getByLabel("Progress by wave")).toBeVisible();
  await shot(page, "7-delta");
});
