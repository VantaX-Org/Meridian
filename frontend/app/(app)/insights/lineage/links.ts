// Formatting and link helpers for the lineage page, kept out of page.tsx so they can be tested on their own.

/** `min_pass_rate` arrives on a 0 to 100 scale (api/services/lineage.py), so it is printed as is. */
export const pct = (v: number | null | undefined) => (v == null ? "" : `${v.toFixed(1)}%`);

const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "3 KPIs and 1 feature are at risk"; a zero side is left out, and none at all says so. */
export function atRiskSentence(kpis: number, features: number): string {
  if (!kpis && !features) return "No KPI or feature is at risk";
  const parts = [kpis ? count(kpis, "KPI", "KPIs") : null, features ? count(features, "feature", "features") : null].filter(Boolean);
  return `${parts.join(" and ")} ${kpis + features === 1 ? "is" : "are"} at risk`;
}

/**
 * Where a lineage row's findings link: one rule opens its failing records on the object page (the one route that
 * filters by check id), several rules or an unknown object open the run's rule list.
 */
export function findingsHref(checkIds: string[], run: string | undefined, moduleOf: (checkId: string) => string | undefined): string {
  const rules = `/insights/rules${run ? `?run=${encodeURIComponent(run)}` : ""}`;
  if (checkIds.length !== 1) return rules;
  const object = moduleOf(checkIds[0]);
  if (!object) return rules;
  const q = new URLSearchParams({ tab: "records", check: checkIds[0] });
  if (run) q.set("run", run);
  return `/objects/${encodeURIComponent(object)}?${q.toString()}`;
}
