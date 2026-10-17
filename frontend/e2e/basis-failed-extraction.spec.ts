/**
 * Basis opens a failed extraction and reads the error line (spec section 13).
 *
 * The seeded tenant has no failed run, so this spec mocks its own system "s1" with one
 * failed run "r1" (ids match the system page's and the extraction page's Vitest fixtures).
 *
 * Deviation from the brief: in the real markup (app/(app)/systems/[systemId]/page.tsx),
 * the Runs tab's row — both the "Run" cell's <Link> and the table's onRowClick — navigates
 * to `/runs/${versionId}`, never to `/systems/:id/extractions/:runId`. Nothing in the app
 * links to the extractions page today (grepped for "extractions/" across app/ and design/ —
 * only the page itself and its own Vitest test reference that path). So this journey is
 * split into what the real UI supports (seeing the failed run on the system page) and a
 * direct navigation to the extraction page (the only way to reach it), rather than a
 * click-through the brief's example assumed.
 */

import { expect, json, test } from "./fixtures";

const SYSTEM_S1 = {
  id: "s1", name: "ECC Prod", system_type: "ecc", host: null, client: null, sysnr: null, username: null,
  base_url: null, company_id: null, auth_type: null, description: null, environment: "PRD", is_active: true,
  health_status: "healthy", health_message: null, last_health_check: null, config_last_synced_at: null,
  config_sync_status: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  last_sync_at: null, last_sync_status: null, discovery_status: null, discovered_at: null, sap_release: null,
};
const RUN_R1 = {
  id: "r1", run_at: "2026-10-02T10:00:00Z", label: null, status: "failed", objects: ["material_master"],
  scope: {}, records: {}, analysed_at: null, rule_set: null, baseline: false, analysable: false, dqs: {},
  field_status: [], extraction_complete: false, coverage: { read: 0, issues: [] }, outliers: {},
};

test("basis opens a failed extraction and reads the error line", async ({ app }) => {
  // the system page reads its system from the list, so the list is the mocked one here
  await app.route(/\/api\/v1\/systems(\?.*)?$/, (r) => r.fulfill(json([SYSTEM_S1])));
  await app.route("**/api/v1/connectivity/systems/s1/modules", (r) => r.fulfill(json([])));
  await app.route("**/api/v1/systems/s1/versions", (r) => r.fulfill(json({ versions: [RUN_R1], download: null })));
  await app.route("**/api/v1/runs/r1/steps", (r) => r.fulfill(json({
    version_id: "r1",
    steps: [
      { step_number: 1, step_name: "extract_BUT000", status: "ok", started_at: "2026-10-02T10:00:00Z", finished_at: "2026-10-02T10:00:01Z", duration_ms: 1200, error_detail: null },
      { step_number: 2, step_name: "extract_MARA", status: "failed", started_at: "2026-10-02T10:00:01Z", finished_at: "2026-10-02T10:00:01Z", duration_ms: 400, error_detail: "RFC_COMMUNICATION_FAILURE: connection reset" },
    ],
  })));
  await app.route("**/api/v1/jobs/dl-r1", (r) => r.fulfill({ status: 404, contentType: "application/json", body: '{"detail":"Job not found"}' }));

  await app.goto("/systems/s1", { waitUntil: "load" });

  // design/primitives/Tabs.tsx renders BaseTabs.Tab, which exposes role="tab".
  await app.getByRole("tab", { name: "Runs" }).click();

  // runColumns()'s Status cell renders <Pill>{labelOf(status)}</Pill> — "Failed" for status "failed".
  // Both tab panels stay mounted (Base UI Tabs), and the Overview tab also shows the latest
  // run's status, so scope to the Runs tabpanel to disambiguate.
  await expect(app.getByRole("tabpanel", { name: "Runs" }).getByText("Failed")).toBeVisible();

  // No in-app link reaches /systems/:id/extractions/:runId (see module doc above) — go there directly.
  await app.goto("/systems/s1/extractions/r1", { waitUntil: "load" });

  // app/(app)/systems/[systemId]/extractions/[runId]/page.tsx: the failed step's role="alert" line.
  // Next also renders its own (empty) route-announcer with role="alert", so filter by text.
  await expect(
    app.getByRole("alert").filter({ hasText: "RFC_COMMUNICATION_FAILURE" }),
  ).toContainText("RFC_COMMUNICATION_FAILURE: connection reset");
});
