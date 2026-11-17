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
  { id: "s2", name: "New S4", environment: "prod", system_type: "s4hana", role: "target" },
];
const PLAN = {
  id: "p1", source: { id: "s1", name: "Dev ECC" }, target: { id: "s2", name: "New S4" }, modules: ["employee_central", "material_master"], mode: "cleansed",
  waves: [
    { wave: 1, label: "Foundation", steps: [{ module: "employee_central", entity: "PerPerson", method: "odata_upsert", rows: 1000, history_rows: 400, purge_type: null, depends_on: [] }] },
    { wave: 2, label: "Dependent", steps: [{ module: "material_master", entity: "MARA", method: "file_load", rows: 500, history_rows: 0, purge_type: null, depends_on: ["PerPerson"] }] },
  ],
  unplaced: [{ module: "learning_management", entity: "LearningItem", reason: "No load method" }],
  cleansing: {
    cells_fixed_by_rule: [{ rule_id: "SF-EC-014", description: "Phone number format", cells: 320 }, { rule_id: "SF-EC-002", description: "Trim leading spaces", cells: 1200 }],
    records_still_failing: 7, dqs_before: 62, dqs_after: 91,
    needs_review: [{ entity: "PerPerson", key: "1001", field: "email", rule_id: "SF-EC-031", description: "Email must be valid", value: "a@x" }],
  },
};
const run = (id: string, dry: boolean) => ({
  id, status: "completed", dry_run: dry, checkpoint: null, started_at: "2026-11-17T08:00:00Z", finished_at: "2026-11-17T08:05:00Z",
  waves: [{ wave: 1, status: "completed", steps: [{ entity: "PerPerson", sent: 1400, ok: 1390, failed: 10, error_rate: 0.007 }] }],
});
const RECON = {
  entities: [
    { entity: "PerPerson", source_rows: 1400, target_rows: 1390, missing_in_target: 10, extra_in_target: 0, field_diffs: 2, sample: [{ key: "1001", field: "email", source: "a@x.test", target: "" }] },
    { entity: "MARA", source_rows: 500, target_rows: 500, missing_in_target: 0, extra_in_target: 0, field_diffs: 0, sample: [] },
  ],
  dqs: { source: 71, projected_target: 88, actual_target: 84, reasons: [{ label: "Rows rejected by the target", value: 10 }] },
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
    if (p === "/migration/move/plans/p1") return json(route, PLAN);
    if (p === "/migration/move/plans/p1/preflight") return json(route, { issues: [{ entity: "PerPerson", field: "country", records: 3, reason: "Country not in the target picklist", severity: "medium" }] });
    if (p === "/migration/move/plans/p1/runs") {
      last = run(last.id === "r1" ? "r2" : "r3", (route.request().postDataJSON() as { dry_run: boolean }).dry_run);
      return json(route, last);
    }
    if (p.startsWith("/migration/move/runs/")) return json(route, last);
    if (p === "/migration/move/plans/p1/reconcile") return json(route, { id: "c1" });
    if (p === "/migration/move/reconciliations/c1") return json(route, RECON);
    if (p === "/migration/move/plans/p1/delta") return json(route, run("d1", false));
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
  await expect(page.getByText("Phone number format", { exact: true }).first()).toBeVisible();
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
  await page.getByRole("button", { name: "Send the delta" }).click();
  await expect(page.getByLabel("Progress by wave")).toBeVisible();
  await shot(page, "7-delta");
});
