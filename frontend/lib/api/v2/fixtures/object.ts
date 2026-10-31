import landscapeJson from "./landscape.json";
import receiptsJson from "./receipts.json";
import rulesJson from "./rules.json";
import runsJson from "./runs.json";
import type { Landscape, Receipt, RuleRow, RunList } from "../types";
import type {
  Explain,
  ExplainRow,
  ImpactResult,
  LearnedProposal,
  Readiness,
  ReadinessCell,
  Reconcile,
  RuleDraft,
  RuleRun,
  RuleScope,
  ScopeContract,
  ScopeFeature,
  Steward,
  WorkGroupRow,
} from "../object";

/**
 * Fixture answers for the Object tabs and the rule screens, built from the approved prototype's numbers so they
 * reconcile with the step 0 fixtures: Material master on ECC production, run of 16 Oct 2026, measured 71.8 and shown
 * 70.0, MM003 and MM035 over tolerance, 3 S/4 features blocked and 5 degraded. Writes (accept all, approve, publish)
 * change the in-memory state below so a click in fixture mode has its visible effect; reload resets it.
 */

const landscape = landscapeJson as unknown as Landscape;
const receipts = receiptsJson as unknown as Record<string, Receipt>;
const baseRules = (rulesJson as unknown as { rules: RuleRow[] }).rules;
const runs = (runsJson as unknown as RunList).versions;

type Params = Record<string, string | number | boolean | undefined>;

const ECC = landscape.systems[0];
const CURRENT_RUN = runs[0].id;
const MM = "material_master";

class FixtureNotFound extends Error {
  status = 404;
  constructor(path: string) {
    super(`No fixture for ${path}`);
  }
}

/* ---- state the writes change ---- */

const state = {
  accepted: new Set<string>(),
  learnedDone: new Set<string>(),
  draftsPublished: new Set<string>(),
};

/** Puts the fixture back as a fresh page load finds it. */
export function resetObjectFixture(): void {
  state.accepted.clear();
  state.learnedDone.clear();
  state.draftsPublished.clear();
}

/* ---- the rules ---- */

interface RuleExtra {
  cls: string;
  expr: string;
  auth: string;
  authority: "sap_hard_constraint" | "s4hana_migration" | "best_practice" | "customer_configured";
  impact: string;
  proposed: number;
  prior: number;
  possible: string;
}

const EXTRA: Record<string, RuleExtra> = {
  MM142: { cls: "referential_check", expr: "MARA-MEINS in T006-MSEHI", auth: "SAP check table T006 and DAMA consistency", authority: "best_practice", impact: "UoM conversions fail; stock quantities cannot be resolved; costing and CO-PA calculations error.", proposed: 112, prior: 3736, possible: "EA, KG, M, ST, L and 14 more" },
  MM003: { cls: "null_check", expr: "MARA-MTART is not initial", auth: "SAP table T134 and DAMA completeness", authority: "sap_hard_constraint", impact: "Material cannot be created or used in MM, PP, SD, or FI without a valid material type.", proposed: 0, prior: 2904, possible: "ROH, HALB, FERT and 9 more" },
  MM007: { cls: "null_check", expr: "MARA-MATKL is not initial", auth: "SAP table T023 and DAMA completeness", authority: "sap_hard_constraint", impact: "Spend analysis and procurement reporting are incomplete.", proposed: 486, prior: 4322, possible: "0420, 0430, 0510 and 61 more" },
  MM015: { cls: "null_check", expr: "MARA-BRGEW is not initial", auth: "DAMA completeness", authority: "best_practice", impact: "Transportation planning and load building produce incorrect results.", proposed: 0, prior: 1878, possible: "Numeric, above 0" },
  MM302: { cls: "null_check", expr: "MARC-EKGRP is not initial", auth: "SAP table T024 and DAMA completeness", authority: "best_practice", impact: "Requisitions from MRP land without a purchasing group; they are not picked up by buyer worklists (ME57) and release strategies keyed on purchasing group do not apply.", proposed: 214, prior: 3122, possible: "P01, P02, P03 and 6 more" },
  MM023: { cls: "domain_value_check", expr: "MARC-DISMM in T438A-DISMM", auth: "SAP table T438A and DAMA validity", authority: "sap_hard_constraint", impact: "MRP run (MD01/MD01N) skips materials with invalid types.", proposed: 0, prior: 1894, possible: "PD, VB, ND and 5 more" },
  MM035: { cls: "null_check", expr: "MBEW-BKLAS is not initial", auth: "SAP table T025 and DAMA completeness", authority: "sap_hard_constraint", impact: "All goods movements (MIGO) fail with account determination errors.", proposed: 96, prior: 2060, possible: "3000, 3030 and 7 more" },
  MM028: { cls: "domain_value_check", expr: "MARC-BESKZ in (E, F, X)", auth: "SAP domain BESKZ and DAMA validity", authority: "sap_hard_constraint", impact: "MRP generates incorrect proposal types.", proposed: 0, prior: 1260, possible: "E, F, X" },
};

/** The S/4 features the impact model maps Material master's failing rules to; step 9 prices them. */
export const FEATURES: { feature: string; status: "blocked" | "degraded"; rules: string[] }[] = [
  { feature: "Migration cockpit: material load", status: "blocked", rules: ["MM142", "MM003"] },
  { feature: "Material ledger actual costing", status: "blocked", rules: ["MM142"] },
  { feature: "Embedded EWM product master", status: "blocked", rules: ["MM142", "MM003"] },
  { feature: "MRP Live", status: "degraded", rules: ["MM023"] },
  { feature: "Advanced available-to-promise", status: "degraded", rules: ["MM015"] },
  { feature: "Source of supply determination", status: "degraded", rules: ["MM302"] },
  { feature: "Product compliance", status: "degraded", rules: ["MM007"] },
  { feature: "Inventory valuation by plant", status: "degraded", rules: ["MM035"] },
];

function ruleRow(id: string): RuleRow | undefined {
  return baseRules.find((r) => r.check_id === id);
}


function scope(id: string): RuleScope {
  const r = ruleRow(id);
  const x = EXTRA[id];
  if (!r || !x) throw new FixtureNotFound(`/rules/${id}/scope`);
  const table = (r.field ?? "").split(".")[0] || null;
  const objects: RuleScope["objects"] = [
    { system_id: ECC.id, system_name: ECC.name, module: MM, label: "Material master", run_id: CURRENT_RUN, run_at: "2026-10-16T05:17:00Z", severity: r.severity, failing: r.affected_count, checked: r.total_count, pass_rate: r.pass_rate },
  ];
  if (id === "MM142") objects.push({ system_id: ECC.id, system_name: ECC.name, module: "mm_purchasing", label: "MM purchasing", run_id: CURRENT_RUN, run_at: "2026-10-16T05:17:00Z", severity: "high", failing: 572, checked: 22640, pass_rate: 97.47 });
  const failing = objects.reduce((s, o) => s + o.failing, 0);
  const features: ScopeFeature[] = FEATURES.filter((f) => f.rules.includes(id)).map((f) => ({ feature: f.feature, status: f.status, system_id: ECC.id }));
  const contracts: ScopeContract[] = [];
  if (id === "MM142") contracts.push({ id: "c-md-material", name: "MD-MATERIAL, version 3", status: "active", via: "names_rule", threshold: null });
  if (r.dimension === "validity" || r.dimension === "completeness") contracts.push({ id: "c-md-material", name: "MD-MATERIAL, version 3", status: "active", via: "dimension_threshold", threshold: 90 });
  const versions: RuleScope["versions"] =
    id === "MM142"
      ? [
          { version: 4, state: "active", created_at: "2026-09-09T08:12:00Z", author: "K. Mokoena", approved_by: "T. van der Merwe", note: "Domain list refreshed from the SAP check table" },
          { version: 3, state: "retired", created_at: "2026-06-02T09:40:00Z", author: "K. Mokoena", approved_by: "T. van der Merwe", note: "Tolerance set to 25 rows" },
          { version: 1, state: "retired", created_at: "2026-03-03T07:30:00Z", author: "House-rule miner", approved_by: "T. van der Merwe", note: "Generated from the SAP data dictionary" },
        ]
      : [];
  return {
    check_id: id,
    name: r.name,
    module: MM,
    definition: {
      source: "shipped",
      check_class: x.cls,
      field: r.field,
      table,
      dimension: r.dimension ?? null,
      severity: r.severity,
      message: r.name,
      expression: x.expr,
      params: id === "MM142" ? { check_table: "T006", check_field: "MSEHI" } : {},
    },
    authority: { rule_authority: x.authority, why_it_matters: r.why ?? null, sap_impact: x.impact },
    objects,
    systems: [{ id: ECC.id, name: ECC.name, failing, objects: objects.length }],
    failing_records: failing,
    failing_by_object: objects.map((o) => ({ module: o.module, label: o.label, failing: o.failing })),
    features,
    versions,
    shipped: { source: `sap/rules/${MM}.yaml`, hash: "9f3c2a7b41d0", app_version: "2.14.0" },
    contracts,
  };
}

function ruleHistory(id: string): { rule_id: string; runs: RuleRun[] } {
  const r = ruleRow(id);
  const x = EXTRA[id];
  if (!r || !x) throw new FixtureNotFound(`/rules/${id}/history`);
  const rows: RuleRun[] = [
    { version_id: CURRENT_RUN, run_at: "2026-10-16T05:17:00Z", module: MM, severity: r.severity, affected_count: r.affected_count, total_count: r.total_count, pass_rate: r.pass_rate, hit_rate: Math.round((r.affected_count / r.total_count) * 10000) / 100, suppressed: false },
    { version_id: runs[2].id, run_at: runs[2].run_at, module: MM, severity: r.severity, affected_count: x.prior, total_count: r.total_count, pass_rate: Math.round((1 - x.prior / r.total_count) * 10000) / 100, hit_rate: Math.round((x.prior / r.total_count) * 10000) / 100, suppressed: false },
  ];
  return { rule_id: id, runs: rows };
}

/* ---- explain ---- */

const n0 = (n: number) => Math.round(n).toLocaleString("en-US");

function explain(metric: string, p: Params): Explain {
  const mod = typeof p.module === "string" ? p.module : null;
  const rc = mod ? receipts[mod] : undefined;
  const label = rc?.label ?? "This object";
  const base = { metric, module: mod, run_id: rc?.run_id ?? null, run_at: rc?.run_at ?? null };
  const rows = (...r: ExplainRow[]): ExplainRow[] => r;
  switch (metric) {
    case "dqs": {
      if (!rc) throw new FixtureNotFound("/explain/dqs");
      return { ...base, title: `Why ${label} scores ${rc.score?.toFixed(1)}`, text: `Six dimensions at their DAMA weights give a measured score of ${rc.measured?.toFixed(1)}. ${rc.capped ? `${rc.breaches.length} critical rules over tolerance cap it at ${rc.cap_level}, so ${rc.score?.toFixed(1)} is shown.` : "No cap applies."}`, computation: rows(...rc.dimensions.map((d) => ({ label: `${d.label} at ${Math.round(d.weight * 100)}%`, value: d.points, unit: "points" })), { label: "Measured", value: rc.measured, unit: "points" }, { label: "Shown", value: rc.score, unit: "points" }) };
    }
    case "dimension": {
      const d = rc?.dimensions.find((x) => x.key === p.dimension);
      if (!rc || !d) throw new FixtureNotFound("/explain/dimension");
      return { ...base, title: `${d.label} ${d.score?.toFixed(1)}`, text: `${d.label} is the record-level pass rate averaged over ${n0(d.rules_measured ?? 0)} rules and ${n0(d.records_checked ?? 0)} records. It carries ${Math.round(d.weight * 100)}% of the score, which is ${d.points?.toFixed(1)} points.`, computation: rows({ label: "Score", value: d.score, unit: "points" }, { label: "Weight", value: Math.round(d.weight * 100), unit: "%" }, { label: "Points", value: d.points, unit: "points" }, { label: "Rules", value: d.rules_measured, unit: "rules" }) };
    }
    case "cap": {
      if (!rc) throw new FixtureNotFound("/explain/cap");
      return { ...base, title: `What caps ${label}`, text: `A critical rule over tolerance holds the score at ${rc.cap_level ?? 85}: one critical rule caps it at 85, two or more at 70. ${rc.breaches.map((b) => `${b.check_id} fails ${n0(b.failing ?? 0)} rows`).join(", ")}.`, computation: rows({ label: "Critical rules over tolerance", value: rc.breaches.length, unit: "rules" }, { label: "Cap", value: rc.cap_level, unit: "points" }, { label: "Measured", value: rc.measured, unit: "points" }) };
    }
    case "coverage": {
      if (!rc) throw new FixtureNotFound("/explain/coverage");
      return { ...base, title: `Coverage of ${label}`, text: `Coverage is the share of extracted records that at least one rule could evaluate. ${n0(rc.rules_measured ?? 0)} rules ran on ${n0(rc.records_checked ?? 0)} records. Below 70% the score is flagged as low confidence.`, computation: rows({ label: "Rules measured", value: rc.rules_measured, unit: "rules" }, { label: "Records checked", value: rc.records_checked, unit: "records" }, { label: "Coverage", value: rc.coverage == null ? null : Math.round(rc.coverage * 1000) / 10, unit: "%" }) };
    }
    case "value_at_risk": {
      if (!rc) throw new FixtureNotFound("/explain/value_at_risk");
      return { ...base, title: `Value at risk in ${label}`, text: `The estimated cost of the failing rows, from the tenant's cost model. It is not part of the score. The largest rules carry most of it.`, computation: rows({ label: "Value at risk", value: rc.value_at_risk, unit: rc.currency }, ...baseRules.slice(0, 3).map((r) => ({ label: r.check_id, value: r.value_at_risk, unit: rc.currency }))) };
    }
    case "failing_pct": {
      const r = ruleRow(String(p.check_id ?? ""));
      if (!r) throw new FixtureNotFound("/explain/failing_pct");
      return { ...base, title: `Failing share of ${r.check_id}`, text: `${n0(r.affected_count)} of ${n0(r.total_count)} records checked fail ${r.check_id}, which is ${((r.affected_count / r.total_count) * 100).toFixed(2)}%.`, computation: rows({ label: "Failing", value: r.affected_count, unit: "records" }, { label: "Checked", value: r.total_count, unit: "records" }, { label: "Share", value: Math.round((r.affected_count / r.total_count) * 10000) / 100, unit: "%" }) };
    }
    case "tolerance": {
      const t = rc?.tolerance ?? { pct: 0.1, rows: 25 };
      return { ...base, title: "Tolerance", text: `A critical rule is over tolerance when its failing records reach ${t.rows} rows or ${t.pct}% of the records checked. Only critical rules over tolerance cap the score; other rules do not carry a tolerance.`, computation: rows({ label: "Rows", value: t.rows, unit: "records" }, { label: "Share", value: t.pct, unit: "%" }) };
    }
    case "open_work": {
      if (!rc) throw new FixtureNotFound("/explain/open_work");
      return { ...base, title: `What is left to do in ${label}`, text: "A record stays open until a later run shows it passing, so approved and sent records count until SAP is fixed and the data re-extracted.", computation: rows({ label: "To fix", value: 21294, unit: "records" }, { label: "With a proposed fix", value: 3418, unit: "records" }, { label: "Approved", value: 612, unit: "records" }, { label: "Sent to SAP", value: 388, unit: "records" }, { label: "Open work", value: rc.open_work, unit: "records" }) };
    }
    default:
      throw new FixtureNotFound(`/explain/${metric}`);
  }
}

/* ---- readiness and impact ---- */

function readiness(): Readiness {
  const cells: ReadinessCell[] = [];
  const wave1 = ["material_master", "business_partner", "accounts_payable", "accounts_receivable", "fi_gl", "asset_accounting"];
  for (const mod of wave1) {
    const c = landscape.cells.find((x) => x.module === mod);
    cells.push({ module: mod, wave: "Wave 1", verdict: c?.verdict === "go" ? "go" : c?.verdict === "at-risk" ? "at_risk" : "no_go", blocker_count: c?.breaches.length ?? 0, dqs: c?.score ?? null, score: mod === MM ? 62.4 : null, records_blocked: mod === MM ? 6544 : 0 });
  }
  cells.push({ module: MM, wave: "Wave 2", verdict: "no_go", blocker_count: 5, dqs: 70, score: 62.4, records_blocked: 6544 });
  for (const mod of ["mm_purchasing", "sd_sales_orders", "controlling"]) {
    const c = landscape.cells.find((x) => x.module === mod);
    cells.push({ module: mod, wave: "Wave 2", verdict: c?.verdict === "go" ? "go" : c?.verdict === "at-risk" ? "at_risk" : "no_go", blocker_count: c?.breaches.length ?? 0, dqs: c?.score ?? null, score: null, records_blocked: 0 });
  }
  return { threshold: 75, cells, configured: true };
}

function impact(): ImpactResult[] {
  return FEATURES.map((f) => ({
    feature: f.feature,
    system: "S/4HANA",
    status: f.status,
    blocking_findings: f.rules.map((id) => ({ check_id: id, affected_count: ruleRow(id)?.affected_count ?? 0, module: MM, severity: ruleRow(id)?.severity ?? "high" })),
    total_affected_records: f.rules.reduce((s, id) => s + (ruleRow(id)?.affected_count ?? 0), 0),
    blocked_transactions: [],
    opportunity_cost_summary: f.status === "blocked" ? `${f.feature} cannot go live while ${f.rules.join(" and ")} fail: the load stops at the first record that does not pass.` : `${f.feature} runs with reduced coverage until ${f.rules.join(" and ")} are fixed.`,
  }));
}

/* ---- groups, learned rules, drafts ---- */

function groups(): { version_id: string; built: boolean; total: number; groups: WorkGroupRow[] } {
  const list: WorkGroupRow[] = baseRules.map((r) => ({
    check_id: r.check_id,
    module: MM,
    severity: r.severity,
    records: r.affected_count,
    proposed: state.accepted.has(r.check_id) ? 0 : (EXTRA[r.check_id]?.proposed ?? 0),
    open: r.affected_count,
  }));
  return { version_id: CURRENT_RUN, built: true, total: list.length, groups: list };
}

const LEARNED: LearnedProposal[] = [
  { id: "lp-001", module: MM, kind: "dependency", table_name: "MARC", determinant: "MARA.MTART", field: "MARC.DISMM", confidence: 0.97, support_rows: 48212, violations: 1894, sample_keys: ["MATNR=000000000000000211"], status: "pending" },
  { id: "lp-002", module: MM, kind: "value_set", table_name: "MARA", determinant: null, field: "MARA.SPART", confidence: 0.99, support_rows: 60410, violations: 188, sample_keys: ["MATNR=000000000000000342"], status: "pending" },
  { id: "lp-003", module: MM, kind: "null", source: "fixes", table_name: "MARA", determinant: null, field: "MARA.MEINS", confidence: 1, support_rows: 30, violations: 0, sample_keys: ["MATNR=000000000000000100", "MATNR=000000000000000117", "MATNR=000000000000000125", "MATNR=000000000000000131", "MATNR=000000000000000148"], status: "pending", evidence: { count: 30, sample_keys: ["MATNR=000000000000000100", "MATNR=000000000000000117", "MATNR=000000000000000125", "MATNR=000000000000000131", "MATNR=000000000000000148"], first_at: "2026-10-12T09:14:00Z", last_at: "2026-10-16T15:02:00Z", who: ["a.naidoo@example.com"], fix_value: "EA", pattern: "blank", invalid_value: null } },
  { id: "lp-004", module: MM, kind: "invalid_value", source: "fixes", table_name: "MARA", determinant: null, field: "MARA.GEWEI", confidence: 1, support_rows: 26, violations: 0, sample_keys: ["MATNR=000000000000000203", "MATNR=000000000000000211", "MATNR=000000000000000232", "MATNR=000000000000000240", "MATNR=000000000000000257"], status: "pending", evidence: { count: 26, sample_keys: ["MATNR=000000000000000203", "MATNR=000000000000000211", "MATNR=000000000000000232", "MATNR=000000000000000240", "MATNR=000000000000000257"], first_at: "2026-10-09T08:40:00Z", last_at: "2026-10-15T11:20:00Z", who: ["a.naidoo@example.com", "demo.user@example.com"], fix_value: "KG", pattern: "same invalid value", invalid_value: "K.G" } },
];

export const DRAFTS: RuleDraft[] = [
  {
    id: "dr-001",
    domain: `dq_rule:${MM}`,
    proposed_rule: { id: "ZR000412", message: "Net weight above gross weight", severity: "high", dimension: "consistency", field: "MARA.NTGEW", check_class: "cross_field_check", fail_when: "NTGEW > BRGEW" },
    rationale: "AI-assisted draft by A. Naidoo",
    status: "draft",
    created_at: "2026-10-14T09:12:00Z",
  },
];

const STEWARDS: Steward[] = [
  { id: "u-naidoo", name: "A. Naidoo", email: "a.naidoo@example.test", role: "data_steward" },
  { id: "u-mokoena", name: "K. Mokoena", email: "k.mokoena@example.test", role: "data_steward" },
];

/** Material numbers of the demo extract, stored as SAP holds them (MATN1, 18 digits). */
const DEMO_MATERIALS = ["000000000000000232", "000000000000000233", "000000000000001017", "000000000000004410", "000000000000020051"];

/** The reconciliation pack of a fixture rule in the current run, as api/services/reconcile.py builds it. */
function reconcile(id: string, run: string | undefined): Reconcile {
  const r = ruleRow(id);
  const x = EXTRA[id];
  if (!r || !x || !run) throw new FixtureNotFound(`/rules/${id}/reconcile`);
  const [table, field] = (r.field ?? ".").split(".");
  const lookup = x.cls === "referential_check" || x.cls === "domain_value_check";
  const check = /in (T[0-9A-Z]+)-([A-Z]+)/.exec(x.expr);
  const deletion = table === "MARA"
    ? [{ table: "MARA", field: "LVORM", operator: "initial", values: [], part: "population", words: "MARA.LVORM is initial (not flagged for deletion)" }]
    : [{ table, field: "LVORM", operator: "initial", values: [], part: "population", words: `${table}.LVORM is initial (not flagged for deletion)` },
       { table: "MARA", field: "LVORM", operator: "initial", values: [], part: "population", words: "MARA.LVORM is initial (not flagged for deletion)" }];
  const joins = table === "MARA" ? [] : [{ from_table: table, to_table: "MARA", on: [[`${table}.MATNR`, "MARA.MATNR"]], words: `${table} to MARA on ${table}.MATNR = MARA.MATNR` }];
  const keyFields = table === "MARA" ? ["MATNR"] : table === "MBEW" ? ["MATNR", "BWKEY", "BWTAR"] : ["MATNR", "WERKS"];
  const conditions: Reconcile["conditions"] = [];
  if (lookup) conditions.push({ kind: "not_in_check_table", fields: [r.field ?? ""], params: { table: check?.[1] ?? null, field: check?.[2] ?? null }, words: `${r.field} has no entry in ${check?.[1] ?? "its check table"} (${check?.[2] ?? field}): list ${check?.[1] ?? "the check table"} in SE16 and compare` });
  for (const j of joins) conditions.push({ kind: "join", fields: j.on.flat(), params: { from_table: j.from_table, to_table: j.to_table }, words: `Join ${j.words}: SE16 reads one table at a time (use SE16H or SQVI)` });
  return {
    check_id: id,
    module: MM,
    label: "Material master",
    run_id: run,
    run_at: "2026-10-16T05:17:00Z",
    run_label: "Run of 16 Oct 2026",
    check_class: x.cls,
    message: r.name,
    field: r.field,
    system: "abap",
    transaction: conditions.length === 0 ? "SE16N" : "SE16H",
    tables: table === "MARA" ? ["MARA"] : [table, "MARA"],
    grain: { table, key_fields: keyFields },
    population_selection: [...(lookup ? [{ table, field, operator: "not_initial", values: [], part: "population", words: `${r.field} is not initial` }] : []), ...deletion],
    failing_selection: lookup ? [] : [{ table, field, operator: "initial", values: [], part: "failing", words: `${r.field} is initial (blank, 0 or 00000000)` }],
    conditions,
    joins,
    se16: conditions.length === 0,
    population: r.total_count,
    failing: r.affected_count,
    excluded: { deleted: 118 },
    sample_keys: DEMO_MATERIALS.map((m) => {
      const extra = keyFields.length > 1 ? [{ field: keyFields[1], raw: "3000", display: "3000" }] : [];
      const fields = [{ field: "MATNR", raw: m, display: m.replace(/^0+/, "") }, ...extra];
      return { raw: fields.map((p) => `${p.field}=${p.raw}`).join("|"), display: fields.map((p) => `${p.field} ${p.display}`).join(", "), fields };
    }),
  };
}

/** A GET the object screens make, or undefined for any other path. */
export function objectFixture(path: string, params: Params): unknown {
  const scopeM = /^\/rules\/([^/]+)\/scope$/.exec(path);
  if (scopeM) return scope(decodeURIComponent(scopeM[1]));
  const rec = /^\/rules\/([^/]+)\/reconcile$/.exec(path);
  if (rec) return reconcile(decodeURIComponent(rec[1]), typeof params.run === "string" ? params.run : undefined);
  const hist = /^\/rules\/([^/]+)\/history$/.exec(path);
  if (hist) return ruleHistory(decodeURIComponent(hist[1]));
  const fb = /^\/rules\/([^/]+)\/failures-by$/.exec(path);
  if (fb) {
    const r = ruleRow(decodeURIComponent(fb[1]));
    const n = r?.affected_count ?? 0;
    return { total: n, groups: n ? [{ field: "WERKS", values: [["1000", 0.6], ["2000", 0.3], ["3000", 0.1]].map(([v, k]) => ({ value: String(v), records: Math.round(n * Number(k)), part: `WERKS=${v}` })) }] : [] };
  }
  const ex = /^\/explain\/([^/]+)$/.exec(path);
  if (ex) return explain(ex[1], params);
  if (path === "/insights/readiness") return readiness();
  if (/^\/config-impact\/[^/]+$/.test(path)) return { results: impact() };
  if (path === "/work/groups") return params.module === MM || params.module === undefined ? groups() : { version_id: CURRENT_RUN, built: true, total: 0, groups: [] };
  if (path === "/learned-rules") return { items: params.module === MM ? LEARNED.filter((l) => !state.learnedDone.has(l.id)) : [] };
  if (path === "/rule-authoring/drafts") return { items: params.module === MM ? DRAFTS.filter((d) => !state.draftsPublished.has(d.id)) : [] };
  if (path === "/stewardship/handoff/stewards") return STEWARDS;
  return undefined;
}

/** A write in fixture mode: changes the state above and answers as the API does. */
export function fixturePost<T>(path: string, body: unknown, params: Record<string, string | undefined>): T {
  const accept = /^\/work\/groups\/([^/]+)\/accept-all$/.exec(path);
  if (accept) {
    const id = decodeURIComponent(accept[1]);
    const n = EXTRA[id]?.proposed ?? 0;
    state.accepted.add(id);
    return { accepted: n, draft_batch_id: "B-243" } as T;
  }
  if (path === "/learned-rules/mine") return { source: "fixes", min_records: 25, edits: 56, proposed: 0, refreshed: LEARNED.filter((l) => l.source === "fixes" && !state.learnedDone.has(l.id)).length, proposal_ids: [] } as T;
  const lr = /^\/learned-rules\/([^/]+)\/(approve|reject)$/.exec(path);
  if (lr) {
    state.learnedDone.add(decodeURIComponent(lr[1]));
    return (lr[2] === "approve" ? { id: lr[1], status: "approved", rule_id: "LR-000001" } : { id: lr[1], status: "rejected" }) as T;
  }
  if (path === "/rule-authoring/dry-run") return { version_id: CURRENT_RUN, evaluated: true, hits: 212, population: 61816, pass_rate: 99.66 } as T;
  const pub = /^\/rule-authoring\/drafts\/([^/]+)\/publish$/.exec(path);
  if (pub) {
    state.draftsPublished.add(decodeURIComponent(pub[1]));
    return { id: "r-new", name: "ZR000412: Net weight above gross weight", module: MM, severity: "high", enabled: true, draft_id: pub[1] } as T;
  }
  if (path === "/rule-suppressions") return { id: "s-001", check_id: (body as { check_id: string }).check_id, expires_at: (body as { expires_at: string }).expires_at } as T;
  if (path === "/stewardship/handoff") return { task_id: "t-001", exception_id: "e-001", assigned_to: (body as { assignee_id: string }).assignee_id, due_at: (body as { due_date: string }).due_date } as T;
  if (path === "/assistant/ask") {
    const question = (body as { question: string }).question;
    return {
      answer: `Held objects are limited by critical rules over tolerance (question: ${question}).`,
      intent: "summary",
      data: null,
      chart: null,
      links: [{ label: "Open the landscape", href: "/" }],
      ai: false,
      phrased: false,
      version_id: CURRENT_RUN,
      facts: [{ statement: "Current run", value: null, source: "Landscape status strip", href: "/", checks: [] }],
      coverage: 1,
      grounded: true,
      citations: [],
    } as T;
  }
  void params;
  throw new FixtureNotFound(path);
}

