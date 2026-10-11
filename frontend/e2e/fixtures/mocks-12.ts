/**
 * Wave 12 (QA) endpoints that are not in the recording, so every route in routes.json renders
 * content rather than an empty or error state: the shell's unparameterised run list and counts,
 * the landscape configuration status, MDM, glossary, roles, audit, learned rules and run detail.
 * Where the recording already holds an equivalent response it is reused verbatim. Seeded-looking
 * data, no customer names. GET only; anything else falls through to the next handler.
 */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const AT = "2026-10-01T08:00:00Z";
const RUN = "65988d5a-0243-4f9b-bdff-52779e71c6ed";
const PREV = "6d1fefcc-cc7f-49ad-bd7b-3631fd3f4e03";
const GOLDEN = "4e620a34-6601-43b1-9ed4-5cf8b8a7e999";

type HarEntry = { request: { url: string }; response: { content: { text?: string } } };
let entries: HarEntry[] | null = null;
/** Body of the first recorded response whose path and query end with `suffix`. */
function recorded(suffix: string): string {
  entries ??= (JSON.parse(fs.readFileSync(path.join(__dirname, "api.har"), "utf8")) as { log: { entries: HarEntry[] } }).log.entries;
  const hit = entries.find((e) => e.request.url.endsWith(suffix) && e.response.content.text);
  if (!hit?.response.content.text) throw new Error(`not in the recording: ${suffix}`);
  return hit.response.content.text;
}

const tally = (applicable: number, passes: number) => ({
  applicable, not_applicable: 4, passes, by_default: 2, score: Math.round((passes / applicable) * 1000) / 10,
  not_applicable_reasons: [{ reason: "Company code does not use the field", count: 4 }],
  not_applicable_rules: [], top_failing: [
    { check_id: "XREC001", module: "accounts_payable", severity: "critical", title: "Reconciliation account is not a vendor reconciliation account", affected_count: 6 },
  ],
});

const metric = (date: string, score: number) => ({
  snapshot_date: date, domain: null, golden_record_count: 412, golden_record_coverage_pct: 78.4, avg_match_confidence: 0.91,
  steward_sla_compliance_pct: 94.2, source_consistency_pct: 88.1, mdm_health_score: score, backlog_count: 17,
  sync_coverage_pct: 72.5, ai_narrative: null, ai_projected_score: null, ai_risk_flags: null,
});

const TERMS = [
  { id: "g1", sap_table: "LFB1", sap_field: "AKONT", technical_name: "LFB1.AKONT", business_name: "Reconciliation account", domain: "accounts_payable", mandatory_for_s4hana: true, status: "active", ai_drafted: false, last_reviewed_at: AT, review_cycle_days: 180, linked_rules_count: 2 },
  { id: "g2", sap_table: "LFA1", sap_field: "STCD1", technical_name: "LFA1.STCD1", business_name: "Tax number", domain: "accounts_payable", mandatory_for_s4hana: false, status: "under_review", ai_drafted: true, last_reviewed_at: null, review_cycle_days: 90, linked_rules_count: 1 },
];

export async function mockRoutes12(page: Page) {
  const get = (re: RegExp, body: unknown | (() => string)) =>
    page.route(re, (r) => {
      if (r.request().method() !== "GET") return r.fallback();
      return r.fulfill(typeof body === "function" ? { status: 200, contentType: "application/json", body: (body as () => string)() } : json(body));
    });

  // Shell: the run list without a limit backs every route's briefing; counts back the rail badges.
  await get(/\/api\/v1\/versions(\?limit=25|\?system_id=[^&]+&limit=100)?$/, () => recorded("/api/v1/versions?limit=100"));
  await get(new RegExp(`/api/v1/versions/${RUN}$`), () => JSON.stringify(JSON.parse(recorded("/api/v1/versions?limit=100")).versions[0]));
  await get(/\/api\/v1\/shell\/counts$/, { fix: 3, inbox: 3 });
  await get(/\/api\/v1\/connectivity\/config-load$/, {
    systems: [{ system_id: "s1", name: "ECC development", system_type: "ecc", status: "loaded", load_id: "l1", job_id: null, loaded_at: AT, areas_loaded: 6, areas_total: 6, current_area: null, error: null }],
    counts: { loaded: 1 }, loaded: 1, total: 1,
  });

  // Run detail and findings for the recorded run.
  await get(/\/api\/v1\/findings\?version_id=[^&]+&sort=impact/, () => recorded("/api/v1/findings?limit=200&offset=0"));
  await get(/\/api\/v1\/findings\/aggregate\?version_id=/, () => recorded("/api/v1/findings/aggregate"));
  await get(/\/api\/v1\/analytics\/prescriptive\?limit=5$/, () => recorded("/api/v1/analytics/prescriptive?limit=20"));
  await get(new RegExp(`/api/v1/runs/${RUN}/steps$`), {
    version_id: RUN,
    steps: ["Extract", "Profile", "Run checks", "Score", "Enrich"].map((step_name, i) => ({
      step_number: i + 1, step_name, status: "completed", started_at: AT, finished_at: AT, duration_ms: 1200 * (i + 1), error_detail: null,
    })),
  });
  await get(/\/api\/v1\/findings\/config-aware-score(\?.*)?$/, {
    version_id: RUN, system_type: "ecc", config_load: { load_id: "l1", system_type: "ecc", loaded_at: AT },
    existing_dqs: { composite: 82.4 }, config_aware: tally(118, 104), processes: [], unmapped: null,
    modules: [{ module: "accounts_payable", ...tally(118, 104) }], rules: [],
  });

  await get(/\/api\/v1\/scores\/history(\?.*)?$/, {
    history: [PREV, RUN].map((version_id, i) => ({
      version_id, run_at: i ? "2026-10-02T05:09:17Z" : "2026-09-25T05:09:17Z", system_id: null, scoring_recorded: true,
      at_the_time: { composite: 70, tier: "warn", scoring: null }, under_current: { composite: 70, tier: "warn", modules: { accounts_payable: 70 } },
    })),
    modules: { accounts_payable: [{ version_id: PREV, composite: 70 }, { version_id: RUN, composite: 70 }] },
  });
  await get(/\/api\/v1\/versions\/[^/]+\/findings\/[^/]+\/root-cause$/, {
    version_id: RUN, check_id: "MM551", status: "computed", field: "MARC.NFMAT", analysed: 1, total: 1,
    origins: [{ origin: "migration", username: "LOADER", tcode: "LSMW", records: 1, share: 100 }],
    summary: "Every failing record came in through the legacy migration load.", detail: "",
  });

  // Ownership and configuration context: none assigned, nothing paired.
  await get(/\/api\/v1\/owners(\?.*)?$/, { owners: [] });
  await get(/\/api\/v1\/config-pairing\/finding-context(\?.*)?$/, null);
  await get(/\/api\/v1\/systems\/s1\/profiles$/, []);
  await get(/\/api\/v1\/findings\/rules\/XREC001\/applicability(\?.*)?$/, {
    check_id: "XREC001", module: "accounts_payable", object: "LFB1",
    systems: [{ system_id: "s1", name: "ECC development", system_type: "ecc", applicability: "applies", reason: null, object: "LFB1", configured_in: [] }],
  });
  await get(/\/api\/v1\/lineage\/rule\/XREC001$/, {
    check_id: "XREC001", module: "accounts_payable", fields: ["LFB1.AKONT"], targets: ["SKB1.MITKZ"], tables: ["LFB1", "SKB1"],
    joins: [{ parent: "LFB1", child: "SKB1", on: [["BUKRS", "BUKRS"], ["AKONT", "SAKNR"]], cardinality: "n:1" }],
    glossary_terms: [{ id: "g1", business_name: "Reconciliation account", sap_table: "LFB1", sap_field: "AKONT" }], owners: [],
  });

  // Rules.
  await get(/\/api\/v1\/rules\/XREC001$/, () =>
    JSON.stringify((JSON.parse(recorded("/api/v1/rules?limit=200")) as { rules: { name: string }[] }).rules.find((r) => r.name.startsWith("XREC001"))));
  await get(/\/api\/v1\/rules\/XREC001\/history(\?.*)?$/, {
    rule_id: "XREC001",
    runs: [RUN, PREV].map((version_id, i) => ({
      version_id, run_at: i ? "2026-09-25T05:09:17Z" : "2026-10-02T05:09:17Z", module: "accounts_payable", severity: "critical",
      affected_count: 1 + i, total_count: 6, pass_rate: i ? 66.67 : 83.33, suppressed: false, hit_rate: null,
    })),
  });
  await get(/\/api\/v1\/learned-rules(\?.*)?$/, {
    items: [{
      id: "lr1", version_id: RUN, module: "accounts_payable", kind: "value_set", table_name: "LFB1", determinant: null, field: "ZTERM",
      body: { values: ["0001", "0002", "NT30"] }, confidence: 0.97, support_rows: 1840, violations: 12, sample_keys: ["LIFNR=100004"],
      status: "pending", rule_id: null, decided_by: null, decided_at: null, updated_at: AT,
    }],
  });

  // MDM.
  await get(/\/api\/v1\/mdm-metrics$/, { latest: metric("2026-10-01", 81.5), trend: [metric("2026-09-24", 78.2), metric("2026-10-01", 81.5)], active_systems_count: 2 });
  await get(/\/api\/v1\/master-records\?per_page=100&page=1$/, () => recorded("/api/v1/master-records?per_page=100"));
  await get(new RegExp(`/api/v1/master-records/${GOLDEN}$`), {
    id: GOLDEN, domain: "accounts_payable", sap_object_key: "V7",
    golden_fields: { NAME1: "Northwind Supplies", STCD1: "4012345678", AKONT: "160000" },
    source_contributions: {
      NAME1: { value: "Northwind Supplies", source_system: "ECC", extracted_at: AT, confidence: 0.98 },
      AKONT: { value: "160000", source_system: "ECC", extracted_at: AT, confidence: 1 },
    },
    overall_confidence: 1, status: "candidate", promoted_at: null, promoted_by: null, created_at: AT, updated_at: AT,
  });
  await get(new RegExp(`/api/v1/master-records/${GOLDEN}/history$`), [
    { id: "h1", changed_at: AT, changed_by: "admin@meridian.local", change_type: "created", previous_fields: null, new_fields: { NAME1: "Northwind Supplies" }, ai_was_involved: false, ai_recommendation_accepted: null },
  ]);
  await get(/\/api\/v1\/match-rules(\?.*)?$/, {
    rules: [
      { id: "m1", tenant_id: "e2e", domain: "accounts_payable", field: "NAME1", match_type: "fuzzy", weight: 0.4, threshold: 0.85, active: true },
      { id: "m2", tenant_id: "e2e", domain: "accounts_payable", field: "STCD1", match_type: "exact", weight: 0.6, threshold: 1, active: true },
    ],
    total: 2,
  });
  await get(/\/api\/v1\/glossary\?per_page=100$/, { terms: TERMS, total: TERMS.length, page: 1, per_page: 100 });
  await get(/\/api\/v1\/glossary\/g1$/, {
    ...TERMS[0], business_definition: "General ledger account that mirrors every posting to the vendor.",
    why_it_matters: "A wrong account breaks the sub-ledger reconciliation.", sap_impact: "Postings land on the wrong balance sheet line.",
    approved_values: ["160000", "160100"], rule_authority: "Finance", data_steward_id: null, created_at: AT, updated_at: AT,
    linked_rules: [{ rule_id: "XREC001", domain: "accounts_payable", pass_rate: 83.33, severity: "critical", affected_count: 1, total_count: 6 }],
    change_history: [],
  });

  // Admin.
  await get(/\/api\/v1\/roles$/, [
    { key: "admin", name: "Administrator", description: "Full access", built_in: true, legacy: false, cloned_from: null, updated_at: null, users: 1 },
    { key: "steward", name: "Data steward", description: "Works the inbox and fix batches", built_in: true, legacy: false, cloned_from: null, updated_at: null, users: 3 },
    { key: "viewer", name: "Viewer", description: "Read only", built_in: true, legacy: false, cloned_from: null, updated_at: null, users: 5 },
  ]);
  await get(/\/api\/v1\/audit\?limit=100$/, {
    entries: [
      { id: "au1", actor_user_id: null, actor_email: "admin@meridian.local", action: "update", entity_type: "rule", entity_id: "XREC001", method: "PUT", path: "/api/v1/rules/XREC001", status_code: 200, ip: null, user_agent: null, before_json: null, after_json: null, created_at: AT },
      { id: "au2", actor_user_id: null, actor_email: "admin@meridian.local", action: "create", entity_type: "version", entity_id: RUN, method: "POST", path: "/api/v1/versions", status_code: 201, ip: null, user_agent: null, before_json: null, after_json: null, created_at: AT },
    ],
    total: 2, limit: 100, offset: 0,
  });
  await get(/\/api\/v1\/exceptions\/billing(\?.*)?$/, {
    period: "2026-10", tier1_count: 412, tier2_count: 96, tier3_count: 18, tier4_count: 3,
    tier1_amount: 412, tier2_amount: 480, tier3_amount: 360, tier4_amount: 150, base_fee: 2500, total_amount: 3902, stripe_invoice_id: null,
  });
  await get(/\/api\/v1\/field-mappings(\?.*)?$/, {
    mappings: [
      { id: "fm1", module: "accounts_payable", standard_field: "LFA1.STCD1", standard_label: "Tax number 1", customer_field: "LFA1.STCD1", customer_label: "VAT number", data_type: "CHAR16", is_mapped: true, notes: null, updated_at: AT },
      { id: "fm2", module: "accounts_payable", standard_field: "LFB1.ZTERM", standard_label: "Payment terms", customer_field: null, customer_label: null, data_type: "CHAR4", is_mapped: false, notes: "Confirm with the finance lead", updated_at: AT },
    ],
    total: 2, self_service_enabled: true,
  });
  await get(/\/api\/v1\/systems\/s1\/reference$/, [
    { kind: "postal_codes", records: 18240, countries: ["DE", "GB", "ZA"] },
    { kind: "bic", records: 0, countries: [] },
  ]);
  await get(/\/api\/v1\/triage\/settings$/, {
    timezone: "Europe/Berlin", work_days: [1, 2, 3, 4, 5], work_start: "08:00:00", work_end: "17:00:00", holidays: ["2026-12-25"], fallback_user_id: null,
  });

  // Insights.
  await get(/\/api\/v1\/insights\/proven-cost(\?.*)?$/, {
    version_id: RUN, currency: "EUR", total: 48250, value_at_risk_total: 126400,
    rows: [
      {
        metric: "duplicate_payment", label: "Duplicate payments", amount: 31800, currency: "EUR", by_currency: { EUR: 31800 }, documents: 4, check_ids: ["AP017"],
        items: [{ doc_key: "BELNR=5100000321|GJAHR=2026", master_key: "LIFNR=100004", amount: 12400, detail: "Same amount and reference paid twice", check_ids: ["AP017"] }],
      },
      { metric: "late_po", label: "Late purchase orders", amount: 16450, currency: "EUR", by_currency: { EUR: 16450 }, documents: 11, check_ids: ["MM551"], items: [] },
    ],
  });
  const ref = (id: string, label: string) => ({ id, label });
  await get(/\/api\/v1\/lineage\/model$/, {
    model_version: 3, node_counts: { field: 84, check: 212, step: 31, process: 9, kpi: 6 }, edge_count: 640,
    kpis: [ref("kpi:dpo", "Days payable outstanding")], processes: [ref("process:p2p", "Procure to pay")], features: [ref("feature:payrun", "Automatic payment run")], warnings: [],
  });
  await get(/\/api\/v1\/lineage\/graph(\?.*)?$/, {
    start: "LFB1.ZTERM", model_version: 3,
    nodes: [
      { id: "LFB1.ZTERM", type: "field", label: "Payment terms", depth: 0, definition: "Terms of payment key for the vendor in a company code." },
      { id: "AP017", type: "check", label: "Payment terms are set", depth: -1 },
      { id: "step:F110", type: "step", label: "Payment run", depth: 1, tcode: "F110" },
      { id: "kpi:dpo", type: "kpi", label: "Days payable outstanding", depth: 2 },
    ],
    edges: [
      { source: "AP017", target: "LFB1.ZTERM", rel: "checks", origin: "rule" },
      { source: "LFB1.ZTERM", target: "step:F110", rel: "feeds", origin: "model", impact_type: "degraded" },
      { source: "step:F110", target: "kpi:dpo", rel: "drives", origin: "model" },
    ],
    paths_to_kpis: [["LFB1.ZTERM", "step:F110", "kpi:dpo"]],
  });
  const impact = (id: string, type: "kpi" | "process" | "feature", label: string, hops: number) => ({
    id, type, label, findings: 3, check_ids: ["AP017", "XREC001"], records_affected: 42, max_records: 30, worst_severity: "critical", worst_impact: "degraded", min_hops: hops, cost_at_risk: null,
  });
  await get(new RegExp(`/api/v1/lineage/impact/${RUN}$`), {
    version_id: RUN, model_version: 3, cost_available: false,
    kpis: [impact("kpi:dpo", "kpi", "Days payable outstanding", 2)], processes: [impact("process:p2p", "process", "Procure to pay", 1)],
    features: [impact("feature:payrun", "feature", "Automatic payment run", 1)], unmapped_checks: [],
  });
  const rel = (id: string, from_key: string, to_key: string, active: boolean) => ({
    id, from_domain: "accounts_payable", from_key, to_domain: "accounts_receivable", to_key, relationship_type: "vendor_is_customer",
    sap_link_table: "LFA1.KUNNR", discovered_at: AT, active, ai_inferred: false, ai_confidence: null, impact_score: 0.6,
  });
  await get(/\/api\/v1\/relationships(\?.*)?$/, { relationships: [rel("rl1", "V7", "C7", true), rel("rl2", "V9", "C12", false)], total: 2 });
  await get(/\/api\/v1\/mining\/summary(\?.*)?$/, {
    window_days: 30, total_patterns: 14, new_anomalies: 3, stable_patterns: 11, coverage_pct: 62.5, runs_total: 8, cost_usd: 4.2,
  });

  // Migration dry run and system trends.
  await get(new RegExp(`/api/v1/migration/runs/${RUN}$`), {
    run: {
      id: RUN, mode: "s4_dry_run", source_system_id: "s1", dest_system_id: null, source_version_id: RUN, target_release: "2023", target_connected: false,
      modules: ["accounts_payable"], status: "analysed", readiness_verdict: "conditional", readiness_score: 91.2, critical_count: 2,
      records_total: 1240, records_blocked: 6, error_detail: null, created_at: AT, completed_at: AT,
      gap_summary: { accounts_payable: { records: 1240, blocked_records: 6, score: 91.2, verdict: "conditional", gaps: { target_mandatory: 4, length_truncation: 2 }, source_tables: ["LFA1", "LFB1"] } },
    },
    gap_breakdown: [{ module: "accounts_payable", gap_type: "target_mandatory", severity: "high", grounded: false, n: 4, records: 4, fields: 1 }],
    structural_critical: 0,
  });
  await get(new RegExp(`/api/v1/migration/runs/${RUN}/records(\\?.*)?$`), {
    total: 2,
    rows: [
      { module: "accounts_payable", source_table: "LFB1", record_key: "LIFNR=100004|BUKRS=1000", status: "load_fail", reasons: ["Payment terms are mandatory in the target"] },
      { module: "accounts_payable", source_table: "LFA1", record_key: "LIFNR=100009", status: "load_fail", reasons: ["Name is longer than the target field"] },
    ],
  });
  const point = (version_id: string, run_at: string, dqs: number, failing: number) => ({
    version_id, run_at, label: null, baseline: false, dqs, dimensions: { completeness: dqs }, records: 1240, failing_records: failing,
    failing_checks: 4, issues_opened: 1, issues_resolved: 2, scope: {}, rule_set: null, comparable: true, flags: [],
  });
  await get(/\/api\/v1\/systems\/s1\/trends(\?.*)?$/, {
    summary: [{ object: "LFA1", points: 2, dqs: 82.4, dqs_delta: 3.1, failing_records: 6, failing_records_delta: -2, comparable: true, flags: [], vs_baseline: null }],
    series: { LFA1: [point(PREV, "2026-09-25T05:09:17Z", 79.3, 8), point(RUN, "2026-10-02T05:09:17Z", 82.4, 6)] },
  });
}
