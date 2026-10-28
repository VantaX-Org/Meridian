/**
 * Signed-in Aurora page with the API replayed from a recording.
 *
 * `e2e/fixtures/api.har.gz` holds the API responses the routes in `routes.json`
 * made against the simulation stack (seeded tenant, no customer data): one ECC
 * system, 14 analysed objects across 31 runs, a 100k-row business partner run
 * and a 25k-row material master run among them. Replaying it means the specs
 * need no backend: the dev server serves the pages, the HAR answers `/api/v1/*`,
 * and the clock is pinned to the recording time so relative durations and
 * "last 24 h" figures are stable.
 *
 * The mocks below cover only what the recording cannot: data the seeded tenant
 * does not hold (a migration wave, a fix batch, a glossary term, a steward's
 * failing record), writes, and three backend defects that would otherwise put
 * a page in its error state (each named where it is shimmed).
 *
 * Re-record after changing which endpoints a route calls:
 *   npm run e2e:record   (see e2e/record.mjs)
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { test as base, expect, type Page } from "@playwright/test";
import routes from "./routes.json";
import depth from "./fixtures/depth.json";
import { mockRoutes18c } from "./fixtures/mocks-18c";
import { mockMonitoringDefaults } from "./fixtures/mocks-monitoring";
import { mockUnrecorded } from "./fixtures/mocks-unrecorded";
import { correctRecording } from "./fixtures/recording-corrections";

export const HAR = path.join(__dirname, "fixtures", "api.har.gz");
/** The instant the HAR was recorded; Date.now() in the page returns this. */
export const RECORDED_AT = new Date("2026-10-19T04:21:43.777Z");
/** `redirectsTo`: a retired route; it is asserted to land there (routes-b.spec.ts) and is not screenshotted again. */
export const ROUTES: ReadonlyArray<{ name: string; path: string; heading: string; mocked?: boolean; knownBad?: string[]; redirectsTo?: string }> = routes;

/** Ids as in the recording. */
export const RECORDED = {
  /** The one SAP system of the seeded tenant. */
  systemId: "c7a18906-1555-40ba-a1b2-caf83188238e",
  systemName: "ERP-SIM",
  /** The newest finished run: the default scope of every cross-object page without ?run=. */
  latestRunId: "d3229ded-0708-4967-9dfb-1b7f4fada953",
  /** The 100k-row business partner run (the run detail route). */
  businessPartnerRunId: "64afe257-80b0-48b9-8b9a-397e29a7dfe6",
  /** The 25k-row material master run (the object routes). */
  materialRunId: "c1f752b7-ab20-441e-9b13-f47754f0e910",
  /** Material master's critical failing rule and one of its failing records. */
  materialRuleId: "MM045",
  materialRecordKey: "MATNR=MAT00000010",
  /** The two accounts payable runs the compare route opens. */
  compareRunIds: ["ae5e43c7-e11d-4f1c-866d-6881cc3d50ce", "ff1ea64b-8968-4d18-ab04-fc15dadbe696"],
  /** The earliest accounts payable run, which still exists in the sim; the steward mocks hang off it. */
  vendorRunId: "65988d5a-0243-4f9b-bdff-52779e71c6ed",
} as const;

/**
 * The Executive summary now reads the current state (`GET /insights/exec?scope=current`), which the recording
 * predates. On this recording the current state is the latest run, so the recorded exec of that run answers it.
 */
async function mockCurrentStateExec(page: Page, har: string) {
  const entry = (JSON.parse(fs.readFileSync(har, "utf8")) as { log: { entries: { request: { url: string }; response: { content: { text?: string; encoding?: string } } }[] } })
    .log.entries.find((e) => e.request.url.includes(`/api/v1/insights/exec?version_id=${RECORDED.latestRunId}`));
  if (!entry?.response.content.text) return;
  const { text, encoding } = entry.response.content;
  const body = encoding === "base64" ? Buffer.from(text, "base64").toString("utf8") : text;
  await page.route(/\/api\/v1\/insights\/exec\?(.*&)?scope=current/, (r) =>
    r.request().method() === "GET" ? r.fulfill({ status: 200, contentType: "application/json", body }) : r.fallback());
}

/**
 * The recording is stored gzipped against http://localhost:3000; replay it on whatever origin the suite runs, with
 * the responses whose counting rule the API has since changed corrected from the recording's own figures
 * (fixtures/recording-corrections.ts). `CORRECTIONS` is in the file name so a copy unpacked before a correction is
 * never reused.
 */
const CORRECTIONS = 1;
function harFor(origin: string): string {
  const out = path.join(__dirname, "..", "test-results", `api.c${CORRECTIONS}.${origin.replace(/\W+/g, "_")}.har`);
  if (!fs.existsSync(out)) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    // write then rename: a parallel worker must never read a half-written copy
    const tmp = `${out}.${process.pid}`;
    const har = JSON.parse(zlib.gunzipSync(fs.readFileSync(HAR)).toString("utf8").replaceAll("http://localhost:3000/", `${origin}/`));
    correctRecording(har);
    fs.writeFileSync(tmp, JSON.stringify(har));
    fs.renameSync(tmp, out);
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
    await mockDefects(page);
    await mockSteward(page);
    await mockDepth(page);
    await mockFixBatch(page);
    await mockWave(page);
    await mockGlossaryTerm(page);
    await mockWrites(page);
    await mockRoutes18c(page);
    await mockMonitoringDefaults(page);
    await mockUnrecorded(page, harFor(origin));
    await mockCurrentStateExec(page, harFor(origin));
    await provide(page);
  },
});

export const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

/**
 * Backend defects on the seeded stack (release 0.0.401), each recorded as a 500 or 404 and
 * reported with the recording. Shimmed here so the specs test the page, not the defect:
 *  - GET /mdm-metrics/history?days=56 (the /mdm trend) is newer than the recording, which
 *    holds the /analytics/mdm-health call it replaced (a 500 then); answered empty here.
 *  - GET /stewardship?item_type=merge_decision… answered 500 on the /mdm page in two of six
 *    recording passes (intermittent; the recording holds its 200 and no shim is needed).
 *  - /migration/dry-run, opened with a data quality run's `?run=`, passes it to
 *    GET /migration/runs/{id}, which knows only migration runs → 404 → error state.
 *  - GET /business-process/{run}/controlling → 500: the SPRO registry has no entry for
 *    controlling and spro_reader.read_config raises instead of answering empty
 *    (api/routes/business_process.py); the same for every module outside the registry.
 */
async function mockDefects(page: Page) {
  await page.route(/\/api\/v1\/mdm-metrics\/history(\?.*)?$/, (r) => r.fulfill(json({ history: [] })));
  const RUN = RECORDED.latestRunId;
  await page.route(new RegExp(`/api/v1/business-process/${RUN}/controlling$`), (r) => r.fulfill(json({
    version_id: RUN, module: "controlling",
    processes: [{
      l1_id: "R2R", l1_name: "Record to Report", l1_description: "Cost centre and cost element accounting", system: "ECC", readiness: "red",
      l2_groups: [{
        l2_id: "R2R-CC", l2_name: "Cost centre accounting", readiness: "red",
        l3_processes: [{
          l3_id: "R2R-CC-P1", l3_name: "Cost centre master", description: "Cost centre creation and maintenance", overall_readiness: "red",
          l4_subprocesses: [{
            l4_id: "R2R-CC-KS01", l4_name: "Create cost centre", tcode: "KS01", description: "Create a cost centre in a controlling area", config_dependency: null, step_status: "red",
            activities: [{
              l5_id: "R2R-CC-KS01-01", l5_name: "Enter person responsible", tcode: "KS01", description: "Name the person responsible for the cost centre",
              check_ids: ["CO003"], activity_status: "red",
              fields: [{
                field: "CSKS.VERAK", check_id: "CO003", description: "Person responsible", mandatory: true, config_source: null, dq_status: "red",
                pass_rate: 93.7, affected_count: 63, finding_message: "Person responsible is missing", config_dependency: null,
              }],
            }],
          }],
        }],
      }],
    }],
  })));
  const AT = "2026-10-16T05:17:46Z";
  await page.route(new RegExp(`/api/v1/migration/runs/${RUN}$`), (r) => r.fulfill(json({
    run: {
      id: RUN, mode: "s4_dry_run", source_system_id: RECORDED.systemId, dest_system_id: null, source_version_id: RUN, target_release: "2023", target_connected: false,
      modules: ["controlling"], status: "analysed", readiness_verdict: "conditional", readiness_score: 91.2, critical_count: 2,
      records_total: 1240, records_blocked: 6, error_detail: null, created_at: AT, completed_at: AT,
      gap_summary: { controlling: { records: 1240, blocked_records: 6, score: 91.2, verdict: "conditional", gaps: { target_mandatory: 4, length_truncation: 2 }, source_tables: ["CSKS", "CSKB"] } },
    },
    gap_breakdown: [{ module: "controlling", gap_type: "target_mandatory", severity: "high", grounded: false, n: 4, records: 4, fields: 1 }],
    structural_critical: 0,
  })));
  await page.route(new RegExp(`/api/v1/migration/runs/${RUN}/records(\\?.*)?$`), (r) => r.fulfill(json({
    total: 2,
    rows: [
      { module: "controlling", source_table: "CSKS", record_key: "KOSTL=1000|KOKRS=1000", status: "load_fail", reasons: ["Person responsible is mandatory in the target"] },
      { module: "controlling", source_table: "CSKB", record_key: "KSTAR=400000|KOKRS=1000", status: "load_fail", reasons: ["Description is longer than the target field"] },
    ],
  })));
}

/** The failing check and record the finding-detail and record routes open (ids as in the recording). */
const FINDING_ID = "6d7b0459-08ca-4b11-90aa-c0524ae19064";
const ISSUE_ID = "c6718ce8-8d5b-4432-933a-4df2b07ee9f0";
const VERSION_ID = RECORDED.vendorRunId;
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
  // only XREC001: the material master records (MM045) are in the recording
  await page.route(/\/api\/v1\/versions\/[^/]+\/findings\/XREC001\/records/, (r) =>
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
  // the records tab's root cause panel; not in the recording
  await page.route(/\/api\/v1\/versions\/[^/]+\/findings\/[^/]+\/root-cause$/, (r) => r.fulfill(json({
    version_id: RECORDED.materialRunId, check_id: RECORDED.materialRuleId, status: "computed", field: "MAKT.MAKTX", analysed: 1, total: 1,
    origins: [{ origin: "migration", username: "LOADER", tcode: "LSMW", records: 1, share: 100 }],
    summary: "Every failing record came in through the legacy migration load.", detail: "",
  })));
  await page.route(/\/api\/v1\/config-pairing\/finding-context(\?.*)?$/, (r) => r.fulfill(json(null)));
}

/**
 * Fix batch "B1" (matching the fix page's and this batch's existing Vitest fixture id) with one
 * item. The seeded queue carries no batches, so only the batch's own query is answered here;
 * steward-accept-proposal.spec overrides the queue list to reach it.
 */
export const CLEANING_ITEM = {
  id: "cq1", object_type: "business_partner", status: "recommended", confidence: 0.92,
  record_key: "LIFNR=V9|BUKRS=2000", priority: 1, detected_at: "2026-10-01T09:00:00Z", applied_at: null,
  rollback_deadline: null, rule_id: null, batch_id: null, version_id: "B1", merge_preview: null,
  record_data_before: { "LFA1.NAME1": "acme" }, record_data_after: { "LFA1.NAME1": "ACME" }, golden_record_id: null, golden_field_value: null,
  golden_record_exists: false,
};

/** The cleaning queue's one group: the fixture item's run "B1" and the field it fixes. */
export const CLEANING_GROUP = {
  version_id: "B1", object_type: "business_partner", kind: "LFA1.NAME1", rule_name: null, records: 1,
  avg_confidence: 0.92, confident: 1, run_label: "business_partner_100k", run_at: "2026-10-01T09:00:00Z",
};

/** Proposals carry a run, not a batch: the queue is grouped by run and kind, and a review page is one run. */
async function mockFixBatch(page: Page) {
  await page.route(/\/api\/v1\/cleaning\/queue\/groups/, (r) =>
    r.fulfill(json({ groups: [CLEANING_GROUP], records: 1, confident: 1, runs: 1 })));
  await page.route(/\/api\/v1\/cleaning\/queue\?(?=.*version_id=B1)/, (r) =>
    r.fulfill(json({ items: [CLEANING_ITEM], total: 1, page: 1, per_page: 100 })));
  await page.route(/\/api\/v1\/versions\/B1$/, (r) =>
    r.fulfill(json({ id: "B1", label: "business_partner_100k", run_at: "2026-10-01T09:00:00Z", status: "complete" })));
  await page.route(/\/api\/v1\/cleaning\/approve\//, (r) =>
    r.fulfill(json({ id: CLEANING_ITEM.id, status: "approved" })));
}

/**
 * Migration wave "w1": the seeded tenant has no waves, so the wave list and its cockpit are mocked.
 * The wave is on the latest run (controlling), whose S/4 readiness the recording holds.
 */
const WAVE_W1 = {
  id: "w1", name: "Wave 1", source_system_id: RECORDED.systemId, target_system_id: null, target_release: "S/4HANA 2023",
  modules: ["controlling"], target_date: null, stage: "mock1" as const, min_readiness: 90, min_dqs: null,
  signed_off_by: null, signed_off_at: null, created_at: "2026-10-01T08:00:00Z", updated_at: "2026-10-01T08:00:00Z",
};
async function mockWave(page: Page) {
  // The seeded tenant has no S/4 load dry runs; the recording holds no list of them.
  await page.route(/\/api\/v1\/migration\/runs(\?.*)?$/, (r) => r.fulfill(json({ runs: [] })));
  await page.route(/\/api\/v1\/migration\/waves(\?.*)?$/, (r) => (r.request().method() === "GET" ? r.fulfill(json({ waves: [WAVE_W1] })) : r.fallback()));
  await page.route("**/api/v1/migration/waves/w1/cockpit", (r) => r.fulfill(json({
    wave: WAVE_W1, run_id: RECORDED.latestRunId, source_version_id: RECORDED.latestRunId, dest_system_type: "s4hana", verdict: "no_go",
    score: 70, records_total: 1000, records_blocked: 63,
    objects: [{ module: "controlling", label: "Controlling", verdict: "no_go", score: 70, records: 1000, records_blocked: 63, blocker_count: 1, dqs: 70 }],
    trend: [],
    blockers: [{ module: "controlling", label: "Controlling", gap_type: "target_mandatory", field: "CSKS.VERAK", severity: "critical", records: 63, gaps: 1 }],
  })));
}

/** Glossary term "g1": the seeded glossary is empty, so the term detail route is mocked. */
const AT = "2026-10-01T08:00:00Z";
const TERM_G1 = {
  id: "g1", sap_table: "LFB1", sap_field: "AKONT", technical_name: "LFB1.AKONT", business_name: "Reconciliation account", domain: "accounts_payable",
  mandatory_for_s4hana: true, status: "active", ai_drafted: false, last_reviewed_at: AT, review_cycle_days: 180, linked_rules_count: 2,
};
async function mockGlossaryTerm(page: Page) {
  await page.route(/\/api\/v1\/glossary\/g1$/, (r) => r.fulfill(json({
    ...TERM_G1, business_definition: "General ledger account that mirrors every posting to the vendor.",
    why_it_matters: "A wrong account breaks the sub-ledger reconciliation.", sap_impact: "Postings land on the wrong balance sheet line.",
    approved_values: ["160000", "160100"], rule_authority: "Finance", data_steward_id: null, created_at: AT, updated_at: AT,
    linked_rules: [{ rule_id: "XREC001", domain: "accounts_payable", pass_rate: 83.33, severity: "critical", affected_count: 1, total_count: 6 }],
    change_history: [],
  })));
}

/** Writes the recording cannot hold. */
async function mockWrites(page: Page) {
  await page.route("**/api/v1/me/preferences", (r) =>
    r.request().method() === "PATCH" ? r.fulfill(json(r.request().postDataJSON() ?? {})) : r.fallback());
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
