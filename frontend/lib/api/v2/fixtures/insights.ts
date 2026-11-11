/**
 * Cost and causes fixture, shaped like api/routes/insights.py: priced SAP features at risk, money already lost in
 * posted documents, failing rules grouped by field, and twelve weekly runs of the score. Other /insights paths
 * (readiness, feedback) stay with the object fixture.
 */
export const NONE_INSIGHTS = Symbol("not a cost and causes path");

/** Meridian's own Aletheia engine (api/routes/aletheia_engine.py): live, running unlicensed, still learning. */
const engineStatus = {
  configured: true, live: true, token_set: true, tenant: "meridian", version: "1.8.0",
  licence: { valid: false, licensed: false, reason: "no license key", deployment: "meridian", expires: null, max_tenants: null },
  usage: { counters: { learn: 14, ingest: 0 }, events: 14, first_seen: "2026-10-26T08:00:00Z", last_seen: "2026-11-09T08:00:00Z" },
};
const engineDrivers = {
  lineage: "a1b2c3d4-0001-4000-8000-000000000001",
  labels: { composite: "Composite data quality score", failing_rules: "Failing rules", affected_records: "Records with a finding", critical: "Critical findings", high: "High-severity failing rules", blockers: "Migration blockers", auto_fixable_pct: "Records with a suggested fix (%)" },
  available: true,
  runs: 12,
  ranges: [
    { metric: "composite", mean: 84.1, low: 81.6, high: 86.6, n: 12, latest: 87.4, outside: true },
    { metric: "failing_rules", mean: 31.5, low: 27.2, high: 35.8, n: 12, latest: 29, outside: false },
    { metric: "dimension:completeness", mean: 88.2, low: 86.1, high: 90.3, n: 12, latest: 89.6, outside: false },
  ],
  links: [
    { source: "failing_rules", target: "composite", lag: 1, correlation: -0.82 },
    { source: "dimension:completeness", target: "composite", lag: 0, correlation: 0.71 },
  ],
};

/** Foresight (GET /aletheia/foresight): twelve weekly runs climbing toward the 90 target, one run the engine did not expect. */
const foresightRuns = Array.from({ length: 12 }, (_, i) => ({
  version_id: `v-${i + 1}`, label: `Run ${i + 1}`,
  run_at: new Date(Date.UTC(2026, 7, 24 + i * 7, 8)).toISOString(), composite: [78.2, 79.0, 79.6, 80.9, 81.4, 82.8, 83.1, 84.0, 85.2, 85.9, 86.7, 87.4][i],
}));
const foresight = {
  lineage: engineDrivers.lineage, labels: engineDrivers.labels, target: 90, target_source: "tenant", runs: foresightRuns,
  projection: {
    available: true, latest: 87.4, slope_per_30d: 3.89,
    next: { date: "2026-11-16", point: 88.4, low: 87.6, high: 89.2 },
    go_live: { status: "projected", projected: "2026-11-29", earliest: "2026-11-21", latest: "2026-12-10" },
    band: [
      { date: "2026-11-13", point: 88.1, low: 87.3, high: 88.9 }, { date: "2026-11-17", point: 88.6, low: 87.8, high: 89.4 },
      { date: "2026-11-21", point: 89.1, low: 88.2, high: 90.0 }, { date: "2026-11-25", point: 89.6, low: 88.6, high: 90.6 },
      { date: "2026-11-29", point: 90.1, low: 89.0, high: 91.2 }, { date: "2026-12-03", point: 90.6, low: 89.4, high: 91.8 },
      { date: "2026-12-07", point: 91.1, low: 89.8, high: 92.4 }, { date: "2026-12-11", point: 91.6, low: 90.1, high: 93.1 },
    ],
    evidence: { inputs: ["Composite score of 12 runs"], method: "Least-squares line through the composite score of each run against calendar days, with a 95% prediction interval from the fit residuals.", confidence: 82, runs: 12, first_run: foresightRuns[0].run_at, last_run: foresightRuns[11].run_at },
  },
  engine: {
    available: true, reason: null,
    normal: { mean: 84.1, low: 81.6, high: 86.6, n: 12, latest: 87.4, outside: true },
    surprises: [
      { metric: "failing_rules", version_id: "v-6", label: "Run 6", run_at: foresightRuns[5].run_at, expected: 34.0, observed: 22.0, z: 4.8, severity: "high" },
      { metric: "dimension:completeness", version_id: "v-9", label: "Run 9", run_at: foresightRuns[8].run_at, expected: 87.1, observed: 90.4, z: 2.9, severity: "medium" },
    ],
    methodology: ["Spiking encoder over the run-level measures", "JEPA latent dynamics predicts the next run", "Surprise is scored against the median with robust deviations"],
    evidence: { inputs: ["9 run-level measures over 12 runs (scores and counts only, no record values)"], method: "Aletheia world model: spiking encoder plus JEPA latent dynamics, surprise above 2.5 robust deviations.", confidence: null },
  },
};

const impact = [
  { feature: "Automatic payment run", l1: "procure_to_pay", status: "blocked", record_count: 1_412, value_per_record: 850, value_at_risk: 1_200_200, causing_rules: ["MM035", { check_id: "MM142", severity: "critical" }] },
  { feature: "MRP planning run", l1: "plan_to_produce", status: "degraded", record_count: 2_904, value_per_record: 320, value_at_risk: 929_280, causing_rules: ["MM003"] },
  { feature: "Credit management", l1: "order_to_cash", status: "degraded", record_count: 428, value_per_record: 1_100, value_at_risk: 470_800, causing_rules: ["MM007"] },
];

const proven = [
  { metric: "late_po", label: "Late POs (lead-time / info-record defects)", amount: 2_840_000, currency: "ZAR", by_currency: { ZAR: 2_840_000 }, documents: 1_206, check_ids: ["MM003", "MM035"], l1: "procure_to_pay" },
  { metric: "duplicate_payment", label: "Duplicate vendor payments", amount: 412_500, currency: "ZAR", by_currency: { ZAR: 412_500 }, documents: 37, check_ids: ["MM142"], l1: "procure_to_pay" },
  { metric: "blocked_sales", label: "Sales orders blocked (customer master)", amount: 0, currency: null, by_currency: { ZAR: 610_000, USD: 18_400 }, documents: 92, check_ids: ["MM007"], l1: "order_to_cash" },
];

const clusters = [
  { key: "material_master:MARC.PLIFZ", kind: "field", module: "material_master", table: "MARC", field: "PLIFZ", rules: ["MM003", "MM035"], dimension: "completeness", severity: "critical", records: 2_904, records_estimated: false, impact: 41.2, auto_fix_pct: 62, origin: { status: "computed", top: "ZMM_MASS_UPLOAD", share: 0.71 } },
  { key: "business_partner:KNVV.KLIMK", kind: "field", module: "business_partner", table: "KNVV", field: "KLIMK", rules: ["MM007"], dimension: "validity", severity: "high", records: 428, records_estimated: true, impact: 12.6, auto_fix_pct: null, origin: { status: "not_computed", top: null, share: null } },
  { key: "fi_gl:unattributed", kind: "unattributed", module: "fi_gl", table: null, field: null, rules: ["MM142"], dimension: "uniqueness", severity: "medium", records: 37, records_estimated: false, impact: 3.1, auto_fix_pct: 0, origin: { status: "not_computed", top: null, share: null } },
];

const scores = [81.2, 81.9, 82.4, 82.1, 83.0, 83.8, 84.1, 84.9, 85.3, 85.0, 86.2, 87.4];
const runs = scores.map((composite, i) => {
  const day = new Date(Date.UTC(2026, 9, 30) - (scores.length - 1 - i) * 7 * 86_400_000);
  return {
    version_id: `v-${i + 1}`, label: `Week ${i + 1}`, run_at: day.toISOString(), baseline: i === 0, composite,
    failing_rules: 140 - i * 4, affected_records: 9_800 - i * 310, change: i ? Math.round((composite - scores[i - 1]) * 10) / 10 : null,
    rules_fixed: i ? 6 : null, rules_new: i ? 2 : null,
  };
});

const sums = (key: "amount" | "value_at_risk", rows: { l1: string | null; amount?: number; value_at_risk?: number }[]) => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.l1 ?? "unassigned", (m.get(r.l1 ?? "unassigned") ?? 0) + (r[key] ?? 0));
  return [...m].map(([l1, v]) => ({ l1, [key]: v }));
};

/** What Aletheia found (GET /insights/findings): rule texts and fields from checks/rules/ecc/material_master.yaml and
 *  sd_customer_master.yaml. MM168 has match & merge pairs waiting (merge); SDCM001's object has no owner (assign). */
const mmFinding = (check_id: string, name: string, field: string, severity: string, dimension: string, affected: number, impact: number,
  delta: number | null, fix: number | null, spark: (number | null)[], origin: { status: string; top: string | null; share: number | null },
  cost: number | null, confidence: { basis: "precision" | "origin_share"; value: number } | null,
  kind: "tune" | "cleanse" | "open" | "merge" | "assign", { module = "material_master", pairs }: { module?: string; pairs?: number } = {}) => ({
  id: `${module}:${check_id}`, module, version_id: "v-12", check_id, name, field, severity, dimension,
  affected, total: 48_210, impact, delta_affected: delta, auto_fix_pct: fix, spark,
  why: { origin, delta_affected: delta },
  money: { cost_at_risk: cost, currency: "ZAR", features: impact_for(check_id) },
  confidence, action: pairs == null ? { kind } : { kind, pairs },
});
const impact_for = (cid: string) => impact
  .filter((r) => r.causing_rules.some((c) => (typeof c === "string" ? c : c.check_id) === cid))
  .map((r) => ({ feature: r.feature, l1: r.l1, value_at_risk: r.value_at_risk }));
const upload = { status: "computed", top: "ZMM_MASS_UPLOAD", share: 0.71 };
const none = { status: "not_computed", top: null, share: null };
const found = [
  mmFinding("MM003", "Material type is mandatory - determines procurement and storage behaviour", "MARA.MTART", "critical", "completeness",
    2_904, 41.2, 312, 62, [2_120, 2_240, 2_310, 2_402, 2_480, 2_530, 2_592, 2_904], upload, 929_280, { basis: "origin_share", value: 0.71 }, "cleanse"),
  mmFinding("MM035", "Valuation class is mandatory for FI account determination", "MBEW.BKLAS", "critical", "completeness",
    1_412, 28.4, -96, 0, [1_810, 1_760, 1_702, 1_650, 1_580, 1_530, 1_508, 1_412], none, 1_200_200, null, "open"),
  mmFinding("MM228", "Source list is mandatory for the material at the plant, but no source list exists", "MARC.KORDB", "high", "consistency",
    866, 12.9, 14, 0, [null, null, 790, 812, 830, 841, 852, 866], none, null, { basis: "precision", value: 0.6 }, "tune"),
  mmFinding("MM142", "Base unit of measure MEINS must reference a valid entry in T006", "MARA.MEINS", "high", "consistency",
    37, 3.1, null, 0, [37, 37, 37, 37, 37, 37, 37, 37], none, 1_200_200, null, "open"),
  mmFinding("MM168", "Two materials carry the same manufacturer and manufacturer part number (duplicate material)", "MARA.MFRPN", "medium",
    "uniqueness", 28, 2.4, 4, 0, [18, 20, 21, 22, 24, 24, 24, 28], none, null, null, "merge", { pairs: 14 }),
  mmFinding("SDCM001", "Customer number is mandatory - primary key for all SD customer transactions", "KNA1.KUNNR", "critical", "completeness",
    9, 1.8, null, 100, [9, 9, 9, 9, 9, 9, 9, 9], none, null, null, "assign", { module: "sd_customer_master" }),
];
/** Cross-system duplicates: the open pairs the cross-system match found between the connected ECC and S/4 systems
 *  for customers (counts are illustrative, no personal data). */
const across = {
  id: "sd_customer_master:XSYS", module: "sd_customer_master", version_id: "v-12", check_id: "XSYS", name: "", field: null, severity: null,
  dimension: "uniqueness", affected: 37, total: null, impact: 0, delta_affected: null, auto_fix_pct: null, spark: [],
  why: { origin: { status: "not_computed", top: null, share: null }, delta_affected: null },
  money: { cost_at_risk: null, currency: "ZAR", features: [] }, confidence: null,
  action: { kind: "across", pairs: 37, systems: [{ a: "ECC", b: "S/4", pairs: 37 }] },
};
const changes = [{
  module: "material_master", version_id: "v-12", previous_version_id: "v-11", score: 87.4, previous: 86.2, delta: 1.2,
  movers: [{ check_id: "MM003", name: found[0].name, delta_affected: 312 }, { check_id: "MM035", name: found[1].name, delta_affected: -96 },
    { check_id: "MM228", name: found[2].name, delta_affected: 14 }],
}];
const acted: Record<string, unknown>[] = [{
  module: "material_master", check_id: "MM142", name: found[3].name, action: "cleanse", version_id: "v-11", affected_before: 212, score_before: 86.2,
  created_at: "2026-10-23T08:00:00Z", waiting: false, affected_now: 37, score_now: 87.4, reduction: 175, gain: 1.2,
  proven_cost: [{ metric: "duplicate_payment", label: "Duplicate vendor payments", before: 590_000, after: 412_500 }], currency: "ZAR",
}];

export const NONE_INSIGHTS_WRITE = Symbol("not an Aletheia write");

/** Acting on a finding in fixture mode: the baseline is the current run, so the proof waits for the next run. */
export function insightsWrite(method: string, path: string, body: unknown): unknown {
  if (method === "PUT" && path === "/owners") {
    const b = body as { kind: string; ref: string; owner_user_id: string | null; steward_user_id: string | null };
    return { ...b, owner_name: null, steward_name: null, updated_at: "2026-11-01T08:00:00Z" };
  }
  if (method !== "POST") return NONE_INSIGHTS_WRITE;
  if (path === "/remediation/batches") {
    const b = body as { name: string };
    return { id: "batch-aletheia-1", name: b.name, status: "draft", item_count: 0 };
  }
  if (path !== "/insights/findings/acted") return NONE_INSIGHTS_WRITE;
  const b = body as { module: string; check_id: string; action: string };
  const f = [across, ...found].find((x) => x.module === b.module && x.check_id === b.check_id);
  const base = { module: b.module, check_id: b.check_id, action: b.action, version_id: "v-12", score_before: 87.4, affected_before: f?.affected ?? null };
  if (!acted.some((a) => a.module === b.module && a.check_id === b.check_id && a.action === b.action && a.version_id === "v-12")) {
    acted.unshift({ ...base, name: f?.name ?? null, created_at: "2026-11-01T08:00:00Z", waiting: true, affected_now: null, score_now: null, reduction: null, gain: null, proven_cost: null, currency: "ZAR" });
  }
  return base;
}

export function insightsRead(path: string, params: Record<string, unknown> = {}): unknown {
  if (path === "/insights/findings") {
    const m = params.module;
    // A fresh array each read: acting unshifts into `acted`, and a reused reference would hide the new row from the cache.
    const mine = <T extends { module: string }>(rows: T[]) => rows.filter((r) => !m || r.module === m);
    return { currency: "ZAR", findings: mine([across, ...found]), changes: mine(changes), acted: mine(acted as { module: string }[]) };
  }
  if (path === "/insights/impact") return { version_id: null, scope: "current", version_ids: ["v-12"], rows: impact };
  if (path === "/insights/proven-cost") return {
    version_id: null, scope: "current", version_ids: ["v-12"], currency: "ZAR", rows: proven,
    cost_by_l1: sums("amount", proven.filter((r) => r.currency)), value_at_risk_by_l1: sums("value_at_risk", impact),
  };
  if (path === "/insights/root-causes") return { version_id: "v-12", clusters };
  if (path === "/insights/trends") return { lineage: [], runs, annotations: [] };
  if (path === "/insights/engine-drivers") return structuredClone(engineDrivers);
  if (path === "/aletheia/engine") return structuredClone(engineStatus);
  if (path === "/aletheia/foresight") return structuredClone(foresight);
  return NONE_INSIGHTS;
}
