/** Score lens fixture: five runs, the oldest scored before the config was recorded, and a config-aware score. */
export const NONE_SCORE = Symbol("not a score lens path");

const runs = [
  { id: "v-12", at: "2026-10-30T02:00:00Z", then: 71.8, now: 72.4, mods: { material_master: 68.2, business_partner: 74.9, fi_gl: 81.3 } },
  { id: "v-11", at: "2026-10-23T02:00:00Z", then: 70.1, now: 70.9, mods: { material_master: 66.0, business_partner: 74.1, fi_gl: 80.2 } },
  { id: "v-10", at: "2026-10-16T02:00:00Z", then: 68.4, now: 69.6, mods: { material_master: 64.3, business_partner: 73.2, fi_gl: 79.8 } },
  { id: "v-9", at: "2026-10-09T02:00:00Z", then: 66.0, now: 68.1, mods: { material_master: 62.1, business_partner: 72.4, fi_gl: 79.1 } },
  { id: "v-8", at: "2026-10-02T02:00:00Z", then: 64.9, now: 66.7, mods: { material_master: 60.8, business_partner: 71.0, fi_gl: 78.6 } },
];

const tier = (n: number) => (n >= 85 ? "pass" : n >= 70 ? "warn" : "fail");

function history() {
  const out = runs.map((r, i) => ({
    version_id: r.id, run_at: r.at, system_id: "s-ecc", scoring_recorded: i < runs.length - 1,
    at_the_time: { composite: r.then, tier: tier(r.then), scoring: null },
    under_current: { composite: r.now, tier: tier(r.now), modules: r.mods },
  }));
  const modules: Record<string, { version_id: string; composite: number; at_the_time: number }[]> = {};
  for (const r of runs) {
    for (const [m, c] of Object.entries(r.mods)) (modules[m] ??= []).push({ version_id: r.id, composite: c, at_the_time: Math.round((c - 0.6) * 10) / 10 });
  }
  return { history: out, modules };
}

const tally = (applicable: number, not_applicable: number, passes: number, by_default = 0, reasons: { reason: string; count: number }[] = []) => ({
  applicable, not_applicable, passes, by_default, score: applicable ? Math.round((passes / applicable) * 1000) / 10 : null,
  not_applicable_reasons: reasons, not_applicable_rules: [], top_failing: [],
});

const configAware = {
  version_id: "v-12", system_type: "ecc", config_load: { load_id: "cl-1", system_type: "ecc", loaded_at: "2026-10-29T18:00:00Z" },
  existing_dqs: { composite: 71.8 },
  config_aware: tally(412, 58, 331, 6, [{ reason: "Batch management is not active in any plant", count: 31 }, { reason: "No foreign currency is posted", count: 19 }, { reason: "Serial numbers are not used", count: 8 }]),
  processes: [
    { l1: "PTP", name: "Procure to pay", ...tally(160, 21, 121), l2: [] },
    { l1: "OTC", name: "Order to cash", ...tally(122, 30, 104), l2: [] },
    { l1: "RTR", name: "Record to report", ...tally(130, 7, 106), l2: [] },
  ],
  unmapped: null,
  modules: [
    { module: "material_master", ...tally(180, 31, 132) },
    { module: "business_partner", ...tally(140, 19, 117) },
    { module: "fi_gl", ...tally(92, 8, 82, 6) },
  ],
  rules: [],
};

const DIMS = ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"];
const heat = (module: string, group: string, vals: (number | null)[], critical = 0, cap_reason: string | null = null) => {
  const scores: Record<string, number | null> = {};
  const tiers: Record<string, string | null> = {};
  DIMS.forEach((d, i) => { scores[d] = vals[i]; tiers[d] = vals[i] == null ? null : tier(vals[i] as number); });
  const c = vals[6] ?? null;
  scores.composite = c;
  tiers.composite = c == null ? null : tier(c);
  return { module, group, scores, tier: tiers, coverage: {}, critical, cap_reason };
};

const heatmap = {
  version_id: "v-12",
  dimensions: [...DIMS, "composite"],
  rows: [
    heat("material_master", "ecc", [61.4, 72.8, 66.0, 88.1, 94.2, 70.3, 68.2], 2, "Two critical rules fail, so the score is capped at 70"),
    heat("business_partner", "ecc", [78.0, 71.5, 69.9, 90.4, 81.7, 77.2, 74.9], 1, "One critical rule fails, so the score is capped at 85"),
    heat("fi_gl", "ecc", [86.2, 83.0, 79.4, 72.1, 99.1, 80.5, 81.3]),
    heat("employee_central", "successfactors", [91.0, 88.4, 86.7, null, 97.9, 89.2, 89.6]),
  ],
};

export function scoreRead(path: string): unknown {
  if (path === "/insights/heatmap") return heatmap;
  if (path === "/scores/history") return history();
  if (path === "/findings/config-aware-score") return configAware;
  return NONE_SCORE;
}
