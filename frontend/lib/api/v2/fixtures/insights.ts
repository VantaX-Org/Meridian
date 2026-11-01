/**
 * Cost and causes fixture, shaped like api/routes/insights.py: priced SAP features at risk, money already lost in
 * posted documents, failing rules grouped by field, and twelve weekly runs of the score. Other /insights paths
 * (readiness, feedback) stay with the object fixture.
 */
export const NONE_INSIGHTS = Symbol("not a cost and causes path");

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

export function insightsRead(path: string): unknown {
  if (path === "/insights/impact") return { version_id: null, scope: "current", version_ids: ["v-12"], rows: impact };
  if (path === "/insights/proven-cost") return {
    version_id: null, scope: "current", version_ids: ["v-12"], currency: "ZAR", rows: proven,
    cost_by_l1: sums("amount", proven.filter((r) => r.currency)), value_at_risk_by_l1: sums("value_at_risk", impact),
  };
  if (path === "/insights/root-causes") return { version_id: "v-12", clusters };
  if (path === "/insights/trends") return { lineage: [], runs, annotations: [] };
  return NONE_INSIGHTS;
}
