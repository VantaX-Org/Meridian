/**
 * Signed-in Aurora page with the API replayed from a recording.
 *
 * `e2e/fixtures/api.har` holds the API responses the routes in `routes.json`
 * made against the simulation stack (seeded tenant, no customer data).
 * Replaying it means the specs need no backend: the dev server serves the
 * pages, the HAR answers `/api/v1/*`, and the clock is pinned to the
 * recording time so relative durations and "last 24 h" figures are stable.
 *
 * Re-record after changing which endpoints a route calls:
 *   npm run e2e:record   (see e2e/record.mjs)
 */

import fs from "node:fs";
import path from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import routes from "./routes.json";
import depth from "./fixtures/depth.json";

export const HAR = path.join(__dirname, "fixtures", "api.har");
/** The instant the HAR was recorded; Date.now() in the page returns this. */
export const RECORDED_AT = new Date("2026-10-02T14:13:00Z");
export const ROUTES: ReadonlyArray<{ name: string; path: string; heading: string }> = routes;

/** The recording is stored against http://localhost:3000; replay it on whatever origin the suite runs. */
function harFor(origin: string): string {
  const out = path.join(__dirname, "..", "test-results", `api.${origin.replace(/\W+/g, "_")}.har`);
  if (!fs.existsSync(out)) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, fs.readFileSync(HAR, "utf8").replaceAll("http://localhost:3000/", `${origin}/`));
  }
  return out;
}

export const test = base.extend<{ app: Page }>({
  app: async ({ page, context, baseURL }, provide) => {
    const origin = new URL(baseURL ?? "http://localhost:3000").origin;
    await context.addCookies([{ name: "mn_session", value: "1", domain: new URL(origin).hostname, path: "/" }]);
    await page.addInitScript(() => {
      localStorage.setItem("mn_auth_token", "e2e-recorded-session");
      sessionStorage.setItem("mn_landed", "1");
    });
    await page.clock.install({ time: RECORDED_AT });
    await page.routeFromHAR(harFor(origin), { url: /\/api\/v1\//, notFound: "abort" });
    // registered last so it wins: the job stream never ends and is not in the
    // recording; the 15 s poll covers the rail
    await page.route("**/api/v1/jobs/events", (r) => r.fulfill({ status: 204 }));
    await mockInbox(page);
    await mockSteward(page);
    await mockDepth(page);
    await mockMaterial(page);
    await mockObjects(page);
    await mockInsightsReadiness(page);
    await mockFix(page);
    await mockExtraction(page);
    await provide(page);
  },
});

/** Inbox endpoints that are not in the recording: three open tasks and matching metrics. */
const INBOX_ITEMS = [
  { id: "a1f0c2d4-0000-4000-8000-000000000001", item_type: "merge_decision", domain: "business_partner", priority: 1, status: "open", sla_state: "at_risk", source_id: "BP-0001" },
  { id: "a1f0c2d4-0000-4000-8000-000000000002", item_type: "exception", domain: "material_master", priority: 2, status: "open", sla_state: "on_track", source_id: "MAT-0042" },
  { id: "a1f0c2d4-0000-4000-8000-000000000003", item_type: "golden_record_review", domain: "accounts_payable", priority: 3, status: "open", sla_state: "on_track", source_id: "VND-0107" },
].map((t) => ({
  ...t, tenant_id: "e2e", due_at: null, assigned_to: null, sla_hours: 48, ai_recommendation: null, ai_confidence: null,
  created_at: "2026-10-01T08:00:00Z", updated_at: "2026-10-01T08:00:00Z",
}));
const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function mockInbox(page: Page) {
  await page.route(/\/api\/v1\/stewardship\?/, (r) =>
    r.fulfill(json(new URL(r.request().url()).searchParams.get("status") === "open" ? { items: INBOX_ITEMS, total: INBOX_ITEMS.length } : { items: [], total: 0 })));
  await page.route("**/api/v1/stewardship/metrics", (r) => r.fulfill(json({
    items_by_type: { merge_decision: 1, exception: 1, golden_record_review: 1 }, items_by_status: { open: 3 },
    avg_resolution_hours_by_type: { merge_decision: 6, exception: 12 }, backlog_total: 3, sla_compliance_rate: 0.92,
    ai_acceptance_rate: null, steward_breakdown: [],
  })));
  await page.route(/\/api\/v1\/triage\/metrics/, (r) => r.fulfill(json({
    weeks: 8, backlog_by_owner: [], backlog_by_team: [], unassigned: 3, resolved_in_sla: 9, resolved_total: 10, sla_attainment_pct: 90,
    mtta_hours: 2, mttr_hours: 9, breach_count: 1,
    weekly: [{ week: "2026-09-28", opened: 5, resolved: 4, resolved_in_sla: 4, breached: 0 }],
  })));
}

/** The failing check and record the finding-detail and record routes open (ids as in the recording). */
const FINDING_ID = "6d7b0459-08ca-4b11-90aa-c0524ae19064";
const ISSUE_ID = "c6718ce8-8d5b-4432-933a-4df2b07ee9f0";
const VERSION_ID = "65988d5a-0243-4f9b-bdff-52779e71c6ed";
const MESSAGE = "Reconciliation account is not a vendor reconciliation account in this company code";
const FINDING = {
  id: FINDING_ID, version_id: VERSION_ID, module: "accounts_payable", check_id: "XREC001", severity: "critical", dimension: "consistency",
  affected_count: 1, total_count: 6, pass_rate: 83.33,
  details: {
    message: MESSAGE, field_checked: "LFB1.AKONT",
    sample_failing_records: [{ "LFB1.AKONT": "0000113100", "LFB1.BUKRS": "1000", "LFB1.LIFNR": "V3", record_key: "LIFNR=V3|BUKRS=1000" }],
  },
  remediation_text: null,
  rule_context: { sap_impact: "Postings fail or land on the wrong G/L account.", rule_authority: "sap_hard_constraint", why_it_matters: "Every posting to the vendor is mirrored to the reconciliation account in the general ledger." },
  value_fix_map: {}, record_fixes: [], created_at: "2026-10-02T05:09:21.146324+00:00", business_name: null, glossary_term_id: null, business_definition: null,
};
const ISSUE = {
  id: ISSUE_ID, scope: "e2e", module: "accounts_payable", check_id: "XREC001", record_key: "LIFNR=V3|BUKRS=1000", grain: "LFB1", severity: "critical",
  status: "open", resolution: null, assigned_to: null, assignee_email: null, first_seen_version: VERSION_ID, last_seen_version: VERSION_ID,
  resolved_version: null, first_seen_at: "2026-10-02T05:08:57Z", last_seen_at: "2026-10-02T11:54:16Z", resolved_at: null, reopened_count: 0,
  message: MESSAGE, field: "LFB1.AKONT",
};
const pair = (a: string, b: string) => ({ a, b, survivor: a });

/** Steward endpoints that are not in the recording: one failing check with its record, one duplicate pair preview. */
async function mockSteward(page: Page) {
  await page.route(`**/api/v1/findings/${FINDING_ID}/report-context`, (r) =>
    r.fulfill(json({ finding_id: FINDING_ID, check_id: FINDING.check_id, module: FINDING.module, report_context: null })));
  await page.route(/\/api\/v1\/findings\?/, (r) => {
    const check = new URL(r.request().url()).searchParams.get("check_id");
    return check ? r.fulfill(json({ findings: check === FINDING.check_id ? [FINDING] : [], total: check === FINDING.check_id ? 1 : 0, filters_applied: {} })) : r.fallback();
  });
  await page.route(/\/api\/v1\/versions\/[^/]+\/findings\/[^/]+\/records/, (r) =>
    r.fulfill(json({ version_id: VERSION_ID, check_id: FINDING.check_id, total: 1, records: [{ record_key: ISSUE.record_key, grain: "LFB1", module: FINDING.module, field_values: { "LFB1.AKONT": "0000113100", "LFB1.LIFNR": "V3" } }] })));
  await page.route(`**/api/v1/issues/${ISSUE_ID}`, (r) =>
    r.fulfill(json({ issue: ISSUE, events: [], runs: [{ version_id: VERSION_ID, run_at: "2026-10-02T11:54:16Z", failing: true }] })));
  await page.route(/\/api\/v1\/issues\?/, (r) => {
    const q = new URL(r.request().url()).searchParams;
    if (q.get("search")) return r.fulfill(json({ items: [ISSUE], total: 1 }));
    if (q.get("check_id")) {
      const mine = q.get("check_id") === ISSUE.check_id ? [ISSUE] : [];
      return r.fulfill(json({ items: mine, total: mine.length, counts: { open: mine.length } }));
    }
    return r.fallback();
  });
  await page.route("**/api/v1/dedup/preview", (r) => r.fulfill(json({
    merge_preview: { "LFA1.LIFNR": pair("V4", "V5"), "LFA1.NAME1": pair("Delta Supplies", "Epsilon Parts"), "LFA1.ORT01": pair("Cape Town", "Pretoria") },
  })));
}

/** Material 360 endpoints are not in the recording: two fictional materials, one with a supersession loop and one plain. */
const MATERIAL = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "material-360.json"), "utf8")) as
  Record<string, Record<string, unknown>>;

async function mockMaterial(page: Page) {
  await page.route(/\/api\/v1\/materials\/(\d+)(?:\/(findings|supersession|duplicates))?(?:\?|$)/, (r) => {
    const [, id, sub] = /\/materials\/(\d+)(?:\/(\w+))?/.exec(new URL(r.request().url()).pathname) ?? [];
    const body = MATERIAL[id]?.[sub ?? "material"];
    return body ? r.fulfill(json(body)) : r.fulfill({ status: 404, contentType: "application/json", body: '{"detail":"Not found"}' });
  });
}

/**
 * Object endpoints are not in the recording: one object (material_master) with a
 * critical failing rule (MM551, reusing the material-360.json fixture's own failing
 * rule and record so the record fix sheet below renders real findings/supersession
 * data for free via mockMaterial) whose record leads to material 101.
 */
const OBJECT_MATNR = "000000000000000101";
const OBJECT_RECORD_KEY = `MATNR=${OBJECT_MATNR}|WERKS=3000`;
const OBJECT_SUMMARY = {
  module: "material_master", label: "Material master", composite_score: 72,
  readiness: "fail" as const, failing_checks: 3, affected_records: 2,
};

async function mockObjects(page: Page) {
  await page.route(/\/api\/v1\/objects\?/, (r) =>
    r.fulfill(json({ run_id: VERSION_ID, objects: [OBJECT_SUMMARY] })));
  await page.route(/\/api\/v1\/objects\/material_master(\?.*)?$/, (r) =>
    r.fulfill(json({
      ...OBJECT_SUMMARY,
      dimension_scores: { consistency: 70, completeness: 80 },
      rules: [
        { check_id: "MM551", severity: "critical", dimension: "consistency", affected_count: 1, total_count: 418, pass_rate: 0.9976 },
        { check_id: "MM132", severity: "medium", dimension: "completeness", affected_count: 1, total_count: 418, pass_rate: 0.9976 },
      ],
    })));
  await page.route(/\/api\/v1\/versions\/[^/]+\/findings\/MM551\/records/, (r) =>
    r.fulfill(json({
      version_id: VERSION_ID, check_id: "MM551", total: 1,
      records: [{ record_key: OBJECT_RECORD_KEY, grain: "MARC", module: "material_master", field_values: { "MARC.NFMAT": "000000000000000102" } }],
    })));
  // The fix sheet parses the composite record_key and asks for the bare MATNR with WERKS as ?plant=.
  await page.route(new RegExp(`/api/v1/objects/material_master/records/${OBJECT_MATNR}(\\?|$)`), (r) =>
    r.fulfill(json(MATERIAL[String(Number(OBJECT_MATNR))].material)));
}

/** Insights readiness endpoint is not in the recording: one no_go cell on material_master, for the drill-through journey. */
async function mockInsightsReadiness(page: Page) {
  await page.route(/\/api\/v1\/insights\/readiness(\?.*)?$/, (r) => r.fulfill(json({
    version_id: VERSION_ID,
    threshold: 90,
    cells: [{ module: OBJECT_SUMMARY.module, wave: "wave_1", verdict: "no_go", blocker_count: 1, dqs: OBJECT_SUMMARY.composite_score }],
  })));
}

/**
 * Fix queue endpoints are not in the recording: one batch ("B1", matching the
 * fix page's and this batch's existing Vitest fixture id) with one item.
 */
const CLEANING_ITEM = {
  id: "cq1", object_type: "business_partner", status: "recommended", confidence: 0.92,
  record_key: "LIFNR=V9|BUKRS=2000", priority: 1, detected_at: "2026-10-01T09:00:00Z", applied_at: null,
  rollback_deadline: null, rule_id: "DUP001", batch_id: "B1", version_id: null, merge_preview: null,
  record_data_before: null, record_data_after: null, golden_record_id: null, golden_field_value: null,
  golden_record_exists: false,
};

async function mockFix(page: Page) {
  await page.route(/\/api\/v1\/cleaning\/queue(\?.*)?$/, (r) =>
    r.fulfill(json({ items: [CLEANING_ITEM], total: 1, page: 1, per_page: 500 })));
  await page.route(/\/api\/v1\/cleaning\/approve\//, (r) =>
    r.fulfill(json({ id: CLEANING_ITEM.id, status: "approved" })));
}

/**
 * System "s1" and its one failed run "r1" are not in the recording — ids
 * match this page's and the extraction page's existing Vitest fixtures.
 */
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

async function mockExtraction(page: Page) {
  await page.route(/\/api\/v1\/systems(\?.*)?$/, (r) => r.fulfill(json([SYSTEM_S1])));
  await page.route("**/api/v1/connectivity/systems/s1/modules", (r) => r.fulfill(json([])));
  await page.route("**/api/v1/systems/s1/versions", (r) => r.fulfill(json({ versions: [RUN_R1], download: null })));
  await page.route("**/api/v1/runs/r1/steps", (r) => r.fulfill(json({
    version_id: "r1",
    steps: [
      { step_number: 1, step_name: "extract_BUT000", status: "ok", started_at: "2026-10-02T10:00:00Z", finished_at: "2026-10-02T10:00:01Z", duration_ms: 1200, error_detail: null },
      { step_number: 2, step_name: "extract_MARA", status: "failed", started_at: "2026-10-02T10:00:01Z", finished_at: "2026-10-02T10:00:01Z", duration_ms: 400, error_detail: "RFC_COMMUNICATION_FAILURE: connection reset" },
    ],
  })));
}

export { expect };

/** Rule depth endpoints, answered from the shipped catalogue (e2e/fixtures/depth.json, built with api/services/rule_coverage.py). */
async function mockDepth(page: Page) {
  await page.route(/\/api\/v1\/rules\/coverage\/material_master/, (r) => r.fulfill(json(depth.mm)));
  await page.route(/\/api\/v1\/rules\/coverage(\?|$)/, (r) => r.fulfill(json(depth.matrix)));
  await page.route(/\/api\/v1\/rules\/by-code\/XREC001/, (r) => r.fulfill(json({ ...depth.XREC001, latest_finding_id: FINDING_ID, latest_version_id: VERSION_ID })));
  await page.route(/\/api\/v1\/rules\/by-code\/MM551/, (r) => r.fulfill(json(depth.MM551)));
  await page.route(/\/api\/v1\/ddic\/fields/, (r) => r.fulfill(json({ fields: [
    { table: "LFB1", field: "AKONT", description: "Reconciliation account in general ledger", data_element: "AKONT", domain: "SAKNR", type: "CHAR", length: 10,
      check_table: "SKB1", check_field: "SAKNR", check_table_description: "G/L account master (company code)", missing: false }] })));
}
