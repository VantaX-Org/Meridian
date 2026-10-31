/**
 * Forecast and plan fixture, shaped like api/routes/analytics.py: three objects' forecasts and warnings, open work
 * ranked into two sprints, one aging queue stage, and a capacity read with recorded inflow.
 */
export const NONE_ANALYTICS = Symbol("not a forecast and plan path");

const fc = (module_id: string, now: number, slope: number, trend: string) => {
  const at = (d: number) => Math.round((now + slope * d) * 10) / 10;
  const band = (d: number, w: number) => ({ [`forecast_${d}d`]: at(d), [`forecast_${d}d_low`]: Math.round((at(d) - w) * 10) / 10, [`forecast_${d}d_high`]: Math.round((at(d) + w) * 10) / 10 });
  return {
    module_id, current_score: now, ...band(7, 1.2), ...band(30, 3.4), ...band(90, 7.9), trend, confidence: 97.6,
    points: 21, span_days: 28, history: [-27, -20, -13, -6, 0].map((day) => ({ day, score: at(day) })), contributing_factors: [],
  };
};

const forecasts = [fc("material_master", 82.4, -0.12, "declining"), fc("business_partner", 91.6, 0.05, "stable"), fc("fi_gl", 68.2, -0.02, "stable")];

const act = (id: string, title: string, severity: string, affected: number, hours: number, vph: number, module: string | null, type = "finding") => ({
  type, id, title, severity, affected_count: affected, total_count: affected * 4, effort_hours: hours, impact_points: 0, value_per_hour: vph,
  priority_score: vph, estimated_cost: affected * 3.5, currency: "USD", recommended_steward: null, module, check_id: type === "finding" ? id : null,
});

const actions = [
  act("MM142", "Duplicate vendor bank details", "critical", 37, 2.6, 56.9, "material_master"),
  act("MM035", "Planned delivery time missing on purchased parts", "critical", 1_412, 24.5, 230.5, "material_master"),
  act("MM003", "Purchasing group missing", "high", 2_904, 49.4, 117.6, "material_master"),
  act("cq-88", "Merge suggested for vendors 100234 and 100871", "medium", 1, 0.25, 8, null, "cleaning"),
];

const sprint = (n: number, a: typeof actions, now: number | null, proj: number | null) => ({
  sprint_number: n, name: `Sprint ${n}`, actions: a, total_effort_hours: a.reduce((s, x) => s + x.effort_hours, 0),
  records_fixed: a.reduce((s, x) => s + x.affected_count, 0), critical_cleared: a.filter((x) => x.severity === "critical").length,
  estimated_cost: a.reduce((s, x) => s + (x.estimated_cost ?? 0), 0), currency: "USD", dqs_now: now, dqs_projected: proj,
});

const impact = (category: string, risk: number, share: number, n: number, method: string) => ({
  category, annual_risk: risk, mitigated: Math.round(risk * share), annual_risk_zar: risk, mitigated_zar: Math.round(risk * share),
  finding_count: n, calculation_method: method, currency: "USD",
});

const impacts = [
  impact("duplicate_payment", 1_850_000, 0.6, 4, "affected_count × 5,000 USD"),
  impact("inventory_write_off", 920_000, 0.4, 11, "affected_count × 200 USD"),
  impact("compliance_penalty", 300_000, 0.5, 2, "affected_count × 10,000 USD"),
  impact("blocked_invoice", 48_000, 0.8, 16, "count × 3,000 USD"),
  impact("warranty_miss", 0, 0.5, 0, "affected_count × 1,500 USD"),
];
const mitigated = impacts.reduce((s, i) => s + i.mitigated, 0);
const months = [61_200, 70_400, 79_900, 88_350, 95_200, 101_300];

const roi = {
  roi: { subscription_annual: 240_000, risk_mitigated: mitigated, roi_multiple: Math.round((mitigated / 240_000) * 10) / 10, payback_months: Math.round((240_000 / mitigated) * 120) / 10, currency: "USD" },
  impacts, version_id: "v-12",
  cost_avoidance_history: months.map((m, i) => ({
    period: `2026-${String(i + 4).padStart(2, "0")}`, subscription_cost_zar: 20_000, risk_mitigated_zar: m, cumulative_roi_multiple: Math.round((m / 20_000) * 10) / 10,
  })).reverse(),
};

export function analyticsRead(path: string): unknown {
  if (path === "/analytics/predictive") return {
    forecasts, runs_seen: 21, days_seen: 28,
    early_warnings: [
      { module_id: "fi_gl", signal: "red", reason: "below_threshold", threshold: 70 },
      { module_id: "material_master", signal: "amber", reason: "projected_below_threshold", threshold: 80 },
      { module_id: "business_partner", signal: "green", reason: "healthy", threshold: 80 },
    ],
  };
  if (path === "/analytics/prescriptive") return {
    actions: [...actions].sort((a, b) => b.value_per_hour - a.value_per_hour),
    sprints: [sprint(1, actions.slice(0, 2), 82.4, 85.1), sprint(2, actions.slice(2), 85.1, 86.9)],
    assumptions: { minutes_per_record: 1, investigation_hours: 2, cleaning_item_hours: 0.25, exception_hours: 1, sprint_hours: 40, cost_per_record: 3.5, currency: "USD" },
    basis: { version_id: "v-12", findings: 3, cleaning_items: 1, exceptions: 0 },
  };
  if (path === "/analytics/bottlenecks") return { bottlenecks: [{ stage: "recommended", count: 61_906, avg_age_hours: 96.4 }], total_queue_size: 62_015 };
  if (path === "/analytics/capacity") return { needed: 4, current: 2, surplus_deficit: -2, daily_inflow: 412.5, per_steward: 118.2 };
  if (path === "/analytics/roi") return roi;
  return NONE_ANALYTICS;
}
