/**
 * One run, end to end through the screens that link to each other.
 *
 * These are the seams where the product used to show a different run than the one the user was
 * looking at, and nothing caught it: the scope tests only asserted which paths were *declared*
 * run-scoped, never that a run actually survives a click. Each case below failed before the fix.
 */

import type { Page } from "@playwright/test";
import { RECORDED, expect, json, test } from "./fixtures";

const SYSTEM_S1 = {
  id: "s1", name: "ECC Prod", system_type: "ecc", host: null, client: null, sysnr: null, username: null,
  base_url: null, company_id: null, auth_type: null, description: null, environment: "PRD", is_active: true,
  health_status: "healthy", health_message: null, last_health_check: null, config_last_synced_at: null,
  config_sync_status: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  last_sync_at: null, last_sync_status: null, discovery_status: null, discovered_at: null, sap_release: null,
};
/** The run the system page scores - and therefore the run its Objects tab must open. */
const RUN_R1 = {
  id: "r1", run_at: "2026-10-02T10:00:00Z", label: "Material master", status: "complete",
  objects: ["material_master"], scope: {}, records: { material_master: 1200 }, analysed_at: "2026-10-02T10:20:00Z",
  rule_set: "ecc", baseline: false, analysable: true, dqs: { material_master: { composite_score: 71, tier: "pass" } },
  field_status: [], extraction_complete: true, coverage: { read: 1200, issues: [] }, outliers: {},
};
const MODULES = [{ module: "material_master", enabled: true, row_count: 1200, last_synced_at: "2026-10-02T09:00:00Z" }];

async function systemPage(app: Page) {
  await app.route(/\/api\/v1\/systems(\?.*)?$/, (r) => r.fulfill(json([SYSTEM_S1])));
  await app.route("**/api/v1/connectivity/systems/s1/modules", (r) => r.fulfill(json(MODULES)));
  await app.route("**/api/v1/systems/s1/versions", (r) => r.fulfill(json({ versions: [RUN_R1], download: null })));
  await app.route("**/api/v1/systems/s1/objects", (r) => r.fulfill(json({
    system_type: "ecc", objects: [{ object: "material_master", tables: ["MARA"], config_tables: [], scope_filters: [], date_window: [] }],
  })));
}

test("the system page's Objects tab opens the run the page is scoring", async ({ app }) => {
  await systemPage(app);
  await app.goto("/systems/s1?tab=objects");
  const link = app.getByRole("link", { name: /Material master/i }).first();
  await expect(link).toHaveAttribute("href", /\/objects\/material_master\?run=r1/);
});

test("the object page opened from that link shows that run, not its own latest", async ({ app }) => {
  await systemPage(app);
  await app.route("**/api/v1/objects/material_master**", (r) => r.fulfill(json({
    version_id: "r1", module: "material_master", score: { composite_score: 71, tier: "pass" }, rules: [], fields: [],
  })));
  await app.goto("/objects/material_master?run=r1");
  await expect(app).toHaveURL(/\/objects\/material_master\?run=r1/);
});

test("the run picker is offered where a run is read, and not where it would do nothing", async ({ app }) => {
  await systemPage(app);
  // "Records to fix" reads ?run=, so the picker belongs there.
  await app.route("**/api/v1/work/summary**", (r) => r.fulfill(json({ version_id: "r1", objects: [], totals: {}, built: true })));
  await app.goto("/fix?tab=work");
  await expect(app.getByTestId("global-run")).toBeVisible();
  // Approvals, Monitor and Duplicates work across every run, so a picker there changed nothing.
  await app.goto("/fix?tab=batches");
  await expect(app.getByTestId("global-run")).toHaveCount(0);
});

test("a run and object opened on an object page are never carried onto the cross-object pages", async ({ app }) => {
  // The steward opens material master's 25k run, then follows plain links: Fix work, the retired Inbox › Issues
  // and an insight view open on the current state, not on that run and object ("No records match").
  await app.goto(`/objects/material_master?run=${RECORDED.materialRunId}`);
  await expect(app).toHaveURL(new RegExp(`run=${RECORDED.materialRunId}`));
  for (const [href, landed] of [["/fix", /\/fix$/], ["/inbox?kind=issues", /\/fix\?mine=1$/], ["/insights/progress", /\/insights\/progress$/]] as const) {
    await app.goto(href);
    await expect(app).toHaveURL(landed);
    await app.waitForTimeout(500);
    expect(new URL(app.url()).searchParams.get("run"), href).toBeNull();
    expect(new URL(app.url()).searchParams.get("module"), href).toBeNull();
  }
});
