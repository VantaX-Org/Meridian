/**
 * Work analytics fixture, shaped like api/services/work_analytics.py: a burn-down over 60 days ending on 30 Oct 2026,
 * the change at the latest run per object, the time to fix, the decisions per person, recurrence, root causes by
 * organisational unit and proposal quality by source. The rule ids are those of the rules fixture.
 */
export const NONE_WORK_ANALYTICS = Symbol("not a work analytics path");

const END = Date.UTC(2026, 9, 30);
const iso = (i: number, n: number) => new Date(END - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10);

function burndown() {
  const n = 60;
  let open = 4_210;
  const days = Array.from({ length: n }, (_, i) => {
    const opened = Math.round(40 + 25 * Math.abs(Math.sin(i * 1.3)) + (i === 31 ? 380 : 0));
    const closed = Math.round(62 + 30 * Math.abs(Math.cos(i * 0.8)) + i * 0.6);
    open = open + opened - closed;
    return { day: iso(i, n), open, opened, closed };
  });
  return {
    version_id: null, scope: "current", version_ids: ["v-mm", "v-bp", "v-gl"], today: iso(n - 1, n), days,
    open_now: open, open_records: 2_964, fixed_7d: days.slice(-7).reduce((s, d) => s + d.closed, 0),
    pace_per_day: 41.3, pace_window_days: 14, projected_finish: "2027-01-12", runs: [],
  };
}

const runChange = {
  version_id: null, scope: "current", previous: null, compared: [],
  objects: [
    { module: "material_master", new: 214, fixed: 691, still_failing: 1_802, not_comparable_checks: 2,
      rules: { newly_failing: [{ check_id: "MM302", severity: "high", new: 128 }, { check_id: "MM015", severity: "low", new: 86 }],
        recovered: [{ check_id: "MM023" }, { check_id: "MM028" }], newly_failing_total: 2, recovered_total: 2 } },
    { module: "business_partner", new: 37, fixed: 140, still_failing: 612, not_comparable_checks: 0,
      rules: { newly_failing: [], recovered: [], newly_failing_total: 0, recovered_total: 0 } },
    { module: "fi_gl", new: 0, fixed: 18, still_failing: 77, not_comparable_checks: 0,
      rules: { newly_failing: [], recovered: [], newly_failing_total: 0, recovered_total: 0 } },
  ],
  totals: { new: 251, fixed: 849, still_failing: 2_491 }, not_comparable_checks: 2,
};

const stat = (fixed: number, median: number, p90: number) => ({ fixed, median_days: median, p90_days: p90 });
const timeToFix = {
  window_days: 180, overall: stat(5_812, 6.5, 31),
  by_object: [{ module: "material_master", ...stat(4_120, 8, 38.5) }, { module: "business_partner", ...stat(1_410, 4, 19) }, { module: "fi_gl", ...stat(282, 2.5, 9) }],
  by_check: [
    { check_id: "MM035", module: "material_master", ...stat(612, 21, 64) },
    { check_id: "MM142", module: "material_master", ...stat(1_204, 11.5, 40) },
    { check_id: "MM003", module: "material_master", ...stat(880, 5, 17) },
    { check_id: "MM007", module: "material_master", ...stat(1_424, 3, 12) },
  ],
  by_severity: [{ severity: "critical", ...stat(904, 3, 11) }, { severity: "high", ...stat(2_110, 6, 25) }, { severity: "medium", ...stat(2_318, 9.5, 42) }, { severity: "low", ...stat(480, 17, 70) }],
};

function throughput() {
  const n = 28;
  const people = ["Thandi Mokoena", "Pieter van Wyk", "Aiko Tanaka"];
  const days = Array.from({ length: n }, (_, i) => {
    const weekend = new Date(END - (n - 1 - i) * 86_400_000).getUTCDay() % 6 === 0;
    const by = weekend ? {} : Object.fromEntries(people.map((p, k) => [p, Math.round(18 + 12 * Math.abs(Math.sin(i + k)))]));
    return { day: iso(i, n), total: Object.values(by).reduce((s, v) => s + v, 0), by_person: by };
  });
  const totalOf = (p: string) => days.reduce((s, d) => s + ((d.by_person as Record<string, number>)[p] ?? 0), 0);
  return {
    window_days: n, days, totals: {},
    people: people.map((p, k) => {
      const total = totalOf(p);
      const approve = Math.round(total * 0.1);
      const accept = Math.round(total * 0.55);
      const edit = Math.round(total * 0.2);
      const not_an_issue = Math.round(total * 0.1);
      return { person: p, user_id: `u-${k + 1}`, total, accept, edit, not_an_issue, accept_risk: total - accept - edit - not_an_issue - approve, approve };
    }).sort((a, b) => b.total - a.total),
    workload: [
      { assignee_id: "u-1", name: "Thandi Mokoena", email: "thandi@example.com", open: 412, critical: 38, overdue: 21 },
      { assignee_id: "u-2", name: "Pieter van Wyk", email: "pieter@example.com", open: 287, critical: 12, overdue: 64 },
      { assignee_id: "u-3", name: "Aiko Tanaka", email: "aiko@example.com", open: 140, critical: 3, overdue: 0 },
    ],
  };
}

const recurrence = {
  totals: { issues: 9_420, reopened: 518, reopens: 611, rate_pct: 5.5 },
  by_check: [
    { check_id: "MM142", module: "material_master", issues: 1_640, reopened: 212, reopens: 260, rate_pct: 12.9 },
    { check_id: "MM302", module: "material_master", issues: 980, reopened: 101, reopens: 118, rate_pct: 10.3 },
    { check_id: "MM007", module: "material_master", issues: 1_502, reopened: 48, reopens: 49, rate_pct: 3.2 },
  ],
  by_system: [
    { scope: "system", name: "ECC production", issues: 8_710, reopened: 501, reopens: 592, rate_pct: 5.8 },
    { scope: "upload", name: "Uploads", issues: 710, reopened: 17, reopens: 19, rate_pct: 2.4 },
  ],
};

const top = (value: string, records: number, issues: number, open: number, critical: number, total: number) =>
  ({ value, records, issues, open, critical, share_pct: Math.round((1_000 * records) / total) / 10 });
const rootCauses = {
  version_id: null, scope: "current", version_ids: ["v-mm", "v-bp", "v-gl"], source: "work_records", total_records: 2_964,
  dimensions: [
    { field: "WERKS", label: "Plant", records: 2_410, values: 14, top: [top("1000", 1_120, 2_040, 1_610, 140, 2_964), top("1200", 610, 902, 744, 22, 2_964), top("2100", 330, 418, 390, 9, 2_964)] },
    { field: "BUKRS", label: "Company code", records: 2_964, values: 3, top: [top("1000", 2_380, 3_710, 3_020, 170, 2_964), top("2000", 584, 702, 611, 18, 2_964)] },
  ],
};

const src = (source: string, proposed: number, approved: number, exported: number, fixed: number, still_failing: number) => ({
  source, proposed, approved, exported, fixed, still_failing,
  approval_rate_pct: proposed ? Math.round((1_000 * approved) / proposed) / 10 : null,
  fix_rate_pct: fixed + still_failing ? Math.round((1_000 * fixed) / (fixed + still_failing)) / 10 : null,
});
const proposalSources = [src("rule", 3_120, 2_870, 2_640, 2_402, 118), src("cleaning", 1_460, 1_102, 980, 851, 96), src("steward", 412, 398, 377, 360, 9), src("simulation", 0, 0, 0, 0, 0)];

export function workAnalyticsRead(path: string): unknown {
  switch (path) {
    case "/work/analytics/burndown": return burndown();
    case "/work/analytics/run-change": return runChange;
    case "/work/analytics/time-to-fix": return timeToFix;
    case "/work/analytics/throughput": return throughput();
    case "/work/analytics/recurrence": return recurrence;
    case "/work/analytics/root-causes": return rootCauses;
    case "/work/analytics/proposal-quality": return { sources: proposalSources, totals: {} };
    default: return NONE_WORK_ANALYTICS;
  }
}
