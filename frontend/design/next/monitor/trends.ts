import type { RunGroup } from "@/lib/api/next/monitor";

export interface ObjectTrend {
  module: string;
  label: string;
  /** New plus regressed records per run, oldest run first. */
  points: number[];
  runs: number;
  latest: number;
  /** Latest run against the one before it; null with a single run. */
  delta: number | null;
}

/** One line per object across the runs the feed holds: are its new and regressed records going down? */
export function objectTrends(groups: RunGroup[]): ObjectTrend[] {
  const by = new Map<string, RunGroup[]>();
  for (const g of groups) by.set(g.module, [...(by.get(g.module) ?? []), g]);
  return [...by.values()]
    .map((gs) => {
      const sorted = [...gs].sort((a, b) => (a.detected_at ?? "").localeCompare(b.detected_at ?? ""));
      const points = sorted.map((g) => g.newCount + g.regressedCount);
      const latest = points[points.length - 1];
      return { module: sorted[0].module, label: sorted[0].label, points, runs: points.length, latest, delta: points.length > 1 ? latest - points[points.length - 2] : null };
    })
    .sort((a, b) => b.latest - a.latest || a.label.localeCompare(b.label));
}
