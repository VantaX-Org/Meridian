/**
 * Wave 18c endpoints that are not in the recording: config intelligence, custom (Z) object profiles,
 * config matches, write-back approvals, SAP monitor, remediation monitor, dedup candidates,
 * rule suppressions and rule feedback. Seeded-looking data, no customer names. GET only;
 * anything else falls through to the next handler.
 */
import type { Page } from "@playwright/test";

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const AT = "2026-10-01T08:00:00Z";
const RUN = "v1";

const alignment = (id: string, severity: string, title: string) => ({
  check_id: id, module: "material_master", category: "alignment", severity, title,
  description: `${title}: live configuration disagrees with the standard.`, affected_elements: ["MTART=ROH"],
  remediation: "Review the setting in SPRO.", estimated_impact_zar: 125000,
});

/** Run "v1": a complete run with one object, so the run page has a summary, findings and a config tab. */
const VERSION_V1 = {
  id: RUN, run_at: AT, label: "Seed run", status: "complete",
  dqs_summary: { material_master: { composite_score: 71, dimension_scores: { completeness: 80, validity: 62 }, total_checks: 12 } },
  metadata: { modules: ["material_master"], file_name: "seed.csv", row_count: 1200 },
};
const AGGREGATE = {
  version_ids: [RUN], total: 9, affected_records: 340, severity: { critical: 1, high: 3, medium: 3, low: 2 },
  by_module: [{ module: "material_master", findings: 9, affected: 340, critical: 1, high: 3, medium: 3, low: 2, avg_pass_rate: 0.8 }],
  by_dimension: [{ dimension: "completeness", findings: 5, avg_pass_rate: 0.8 }],
  avg_pass_rate: 0.8,
  dqs: { composite: 71, dimension_scores: { completeness: 80, validity: 62 }, modules: { material_master: 71 }, capped: false, tier: "warn" },
  previous_dqs: 68,
};

export async function mockRoutes18c(page: Page) {
  const get = (re: RegExp, body: unknown) =>
    page.route(re, (r) => (r.request().method() === "GET" ? r.fulfill(json(body)) : r.fallback()));

  // Configuration (tenant-wide)
  await get(/\/api\/v1\/config\/inventory(\?.*)?$/, { run_id: RUN, elements: [
    { module: "material_master", element_type: "material_type", element_value: "ROH", transaction_count: 420, first_seen: AT, last_seen: AT, status: "active", sap_reference_table: "T134" },
    { module: "material_master", element_type: "material_type", element_value: "ZHLB", transaction_count: 0, first_seen: AT, last_seen: AT, status: "ghost", sap_reference_table: "T134" },
  ] });
  await get(/\/api\/v1\/config\/processes(\?.*)?$/, { run_id: RUN, processes: [{
    process_id: "ptp", process_name: "Procure to pay", status: "active", completeness_score: 0.9, exception_rate: 0.04, bottleneck_step: "Goods receipt",
    total_volume: 980, avg_cycle_days: 6.5,
    steps: [{ step_number: 1, step_name: "Purchase order", sap_table: "EKKO", detected: true, volume: 980, exception_count: 12, avg_days_to_next_step: 3 }],
  }] });
  await get(/\/api\/v1\/config\/alignment(\?.*)?$/, { run_id: RUN, findings: [alignment("CFG001", "high", "Material type not mapped")] });
  await get(/\/api\/v1\/config\/ghost(\?.*)?$/, { run_id: RUN, findings: [alignment("CFG010", "medium", "Configured but unused material type")] });
  await get(/\/api\/v1\/config\/shadow(\?.*)?$/, { run_id: RUN, findings: [alignment("CFG020", "low", "Used but not configured plant")] });
  await get(/\/api\/v1\/config\/drift(\?.*)?$/, { current_run_id: RUN, previous_run_id: "v0", drift_entries: [
    { module: "material_master", element_type: "material_type", element_value: "ZHLB", change_type: "added", previous_value: null, current_value: "ZHLB" },
  ] });
  await get(/\/api\/v1\/config\/licence-utilisation(\?.*)?$/, { run_id: RUN, modules: [
    { module: "material_master", total_config_elements: 14, total_transactions: 4200, utilisation_pct: 72, status: "partial" },
  ] });

  // Custom (Z) objects: the registry itself is in the recording (63 entries)
  await get(/\/api\/v1\/z-objects\/profile\/z1(\?.*)?$/, {
    object_name: "ZMM_GRADE", data_type: "CHAR", cardinality: 12, null_rate: 0.03, transaction_count: 310, user_count: 4,
    first_seen: AT, last_seen: AT, trend_direction: "up", related_standard_field: "MARA.MATKL",
  });
  await get(/\/api\/v1\/z-objects\/anomalies(\?.*)?$/, { run_id: RUN, total: 1, anomalies: [{
    id: "za1", object_name: "ZMM_GRADE", anomaly_type: "null_spike", severity: "medium", description: "Null rate rose sharply",
    baseline_value: "0.01", current_value: "0.03", deviation_pct: 200, status: "open",
  }] });
  await get(/\/api\/v1\/z-objects\/ghost(\?.*)?$/, [{ object_name: "ZMM_OLD", category: "field", module: "material_master", source_field: "MARA.ZZOLD", last_active_date: null, status: "ghost" }]);
  await get(/\/api\/v1\/z-objects\/dormant(\?.*)?$/, [{ object_name: "ZMM_TMP", category: "table", module: "material_master", last_active_date: AT, months_inactive: 14 }]);
  await get(/\/api\/v1\/z-objects\/drift(\?.*)?$/, [{ object_name: "ZMM_GRADE", module: "material_master", source_field: "MARA.ZZGRADE", change_type: "added", first_detected: AT }]);

  // Run "v1" and its config matches
  await get(/\/api\/v1\/versions\/v1(\?.*)?$/, VERSION_V1);
  await get(/\/api\/v1\/versions\/v1\/config-matches(\?.*)?$/, { total: 3, items: [
    { module: "material_master", check_id: "MM101", record_key: "MATNR=100", field: "MTART", actual_value: "ZHLB", std_rule_expectation: "ROH or FERT", classification: "config_driven", config_evidence: "ZHLB is configured in T134", recommended_action: "Accept as configured", sap_tcode: "OMS2", fix_priority: 3 },
    { module: "material_master", check_id: "MM102", record_key: "MATNR=101", field: "MATKL", actual_value: "", std_rule_expectation: "Not empty", classification: "data_error", config_evidence: null, recommended_action: "Fill the material group", sap_tcode: "MM02", fix_priority: 1 },
    { module: "material_master", check_id: "MM103", record_key: "MATNR=102", field: "BASME", actual_value: "KG", std_rule_expectation: "ST", classification: "mismatch", config_evidence: null, recommended_action: "Review the unit", sap_tcode: "MM02", fix_priority: 2 },
  ] });
  await get(/\/api\/v1\/findings\/aggregate\?(?=.*version_id=v1)/, AGGREGATE);

  // Inbox: approvals and SAP monitor
  await get(/\/api\/v1\/writeback\/approvals(\?.*)?$/, { live_enabled: false, approvals: [
    { id: "wb1", finding_id: "f1f1f1f1-0000-4000-8000-000000000001", version_id: RUN, requested_by: "u-requester", records_updated: 14, sap_host: "sap-dev", created_at: AT },
  ] });
  const signal = { id: "ex1", tenant_id: "e2e", type: "sap_monitor", category: "failed_job", severity: "high", status: "open", title: "Nightly extract job failed",
    description: "Job ended with a dump.", source_system: "ECC Prod", source_reference: "JOB1", affected_records: null, estimated_impact_zar: null, assigned_to: null,
    escalation_tier: 0, sla_deadline: null, root_cause_category: null, resolution_type: null, resolution_notes: null, linked_finding_id: null,
    linked_cleaning_id: null, created_at: AT, updated_at: AT };
  await get(/\/api\/v1\/exceptions\/sap-monitor(\?.*)?$/, { exceptions: [signal], by_category: { failed_job: [signal] } });

  await get(/\/api\/v1\/issues(\?.*)?$/, { total: 1, counts: { open: 1 }, items: [{
    id: "is1", scope: "s1", module: "material_master", check_id: "MM101", title: null, record_key: "MATNR=100", grain: null, severity: "high", status: "open",
    resolution: null, assigned_to: null, assignee_email: null, first_seen_version: RUN, last_seen_version: RUN, resolved_version: null,
    first_seen_at: AT, last_seen_at: AT, resolved_at: null, reopened_count: 0, message: "Material type not allowed", field: "MTART", priority: null,
    assigned_team_id: null, acknowledged_at: null, due_at: null, ack_due_at: null, risk_at: null, sla_state: null, sla_paused_at: null, snoozed_until: null, snooze_reason: null,
  }] });

  // Fix: monitor and dedup
  await get(/\/api\/v1\/remediation\/monitor(\?.*)?$/, { items: [{
    scope: "s1", system_name: "ECC Prod", baseline: { id: "v0", run_at: AT, dqs: 68 }, latest: { id: RUN, run_at: AT, dqs: 71 },
    monitor: { baseline_id: "v0", baseline_run_at: AT, new_records: 12, regressed_checks: [{ check_id: "MM101", module: "material_master", severity: "high", new: 5 }],
      regressed_check_count: 1, resolved_records: 30, batch_id: null, batch_items: 0 },
  }] });
  await get(/\/api\/v1\/dedup\/candidates(\?.*)?$/, { total: 1, items: [{
    id: "dc1", object_type: "business_partner", record_key_a: "LIFNR=V1", record_key_b: "LIFNR=V2", match_score: 93, match_method: "fuzzy",
    match_fields: { name: 0.95 }, status: "pending", survivor_key: null, merged_at: null, created_at: AT,
  }] });

  // Rules: suppressions and feedback
  await get(/\/api\/v1\/rule-suppressions(\?.*)?$/, { suppressions: [
    { id: "sp1", check_id: "MM101", record_key: "MATNR=100", reason: "Accepted by the data owner", expires_at: "2027-01-01T00:00:00Z", created_by: null, created_at: AT, active: true },
  ] });
  await get(/\/api\/v1\/rule-feedback(\?.*)?$/, { rules: [
    { check_id: "MM101", flagged: 10, false_positive: 3, real: 7, false_positive_rate: 0.3 },
  ] });
}
