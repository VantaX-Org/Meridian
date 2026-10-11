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
}
