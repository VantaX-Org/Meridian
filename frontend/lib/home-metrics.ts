// frontend/lib/home-metrics.ts
import type { Version } from "@/types/api";
import type { ObjectSummary } from "@/lib/api/v1/objects";
import { round1, formatDate, formatModuleName } from "@/lib/format";

export const DIMENSIONS = ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"] as const;
export type DimensionKey = (typeof DIMENSIONS)[number];

export type Readiness = "go" | "at-risk" | "no-go";

/** The same thresholds as `ScoreRing`: >=85 go, >=60 at-risk, else no-go. */
export function readinessOf(score: number): Readiness {
  return score >= 85 ? "go" : score >= 60 ? "at-risk" : "no-go";
}

/** Mean `composite_score` across every module scored in this run, or null if none are. */
export function runDqs(v: Version): number | null {
  const scores = Object.values(v.dqs_summary ?? {}).map((m) => m.composite_score);
  if (scores.length === 0) return null;
  return round1(scores.reduce((a, b) => a + b, 0) / scores.length);
}

/** Mean of each of the six dimensions across every module scored in this run, or null if none are. */
export function runDimensions(v: Version): Record<DimensionKey, number> | null {
  const modules = Object.values(v.dqs_summary ?? {});
  if (modules.length === 0) return null;
  const out = {} as Record<DimensionKey, number>;
  for (const dim of DIMENSIONS) {
    out[dim] = round1(modules.reduce((sum, m) => sum + m.dimension_scores[dim], 0) / modules.length);
  }
  return out;
}

export interface TrendPoint {
  x: string;
  y: number;
  runId: string;
}

/** Finished runs (those with at least one scored module), oldest first, as chart points. */
export function trend(versions: Version[]): TrendPoint[] {
  return versions
    .filter((v) => v.dqs_summary && Object.keys(v.dqs_summary).length > 0)
    .slice()
    .sort((a, b) => new Date(a.run_at).getTime() - new Date(b.run_at).getTime())
    .map((v) => ({ x: formatDate(v.run_at, "date"), y: runDqs(v) ?? 0, runId: v.id }));
}

/** Change from the previous finished run to the latest one, or null with fewer than two finished runs. */
export function delta(points: TrendPoint[]): number | null {
  if (points.length < 2) return null;
  return round1(points[points.length - 1].y - points[points.length - 2].y);
}

export interface SeverityTotals {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

/** Severity counts summed across every module scored in this run. */
export function severityTotals(v: Version): SeverityTotals {
  return Object.values(v.dqs_summary ?? {}).reduce<SeverityTotals>(
    (acc, m) => ({
      critical: acc.critical + m.critical_count,
      high: acc.high + m.high_count,
      medium: acc.medium + m.medium_count,
      low: acc.low + m.low_count,
    }),
    { critical: 0, high: 0, medium: 0, low: 0 },
  );
}

/** The reason the first capped module in this run gives, or null if none is capped. */
export function cappedReason(v: Version): string | null {
  for (const m of Object.values(v.dqs_summary ?? {})) {
    if (m.capped) return m.cap_reason ?? "A severity cap applied.";
  }
  return null;
}

export interface DimensionBarPoint {
  x: string;
  y: number;
  dimension: DimensionKey;
}

/** The six-dimension bar chart's points for this run (spec 7.1 "Six dimensions"). */
export function dimensionBarPoints(v: Version): DimensionBarPoint[] {
  const dims = runDimensions(v);
  if (!dims) return [];
  return DIMENSIONS.map((d) => ({ x: formatModuleName(d), y: dims[d], dimension: d }));
}

export interface HeatmapCell {
  row: string;
  col: string;
  value: Readiness;
}

/** One cell per object x dimension, from this run's `dqs_summary` (spec 7.1 "Object readiness grid"). */
export function dimensionHeatmapCells(objects: ObjectSummary[], v: Version): HeatmapCell[] {
  const cells: HeatmapCell[] = [];
  for (const obj of objects) {
    const summary = v.dqs_summary?.[obj.module];
    if (!summary) continue;
    for (const dim of DIMENSIONS) {
      cells.push({ row: obj.label, col: formatModuleName(dim), value: readinessOf(summary.dimension_scores[dim]) });
    }
  }
  return cells;
}

/** The objects with a scored run, worst (lowest `composite_score`) first. */
export function worstObjectsFirst(objects: ObjectSummary[]): ObjectSummary[] {
  return objects
    .filter((o) => o.composite_score !== null)
    .slice()
    .sort((a, b) => (a.composite_score ?? 0) - (b.composite_score ?? 0));
}

/** One object's `composite_score` across every finished run it appears in, oldest first. */
export function objectTrend(versions: Version[], module: string): { x: string; y: number }[] {
  return versions
    .filter((v) => v.dqs_summary?.[module])
    .slice()
    .sort((a, b) => new Date(a.run_at).getTime() - new Date(b.run_at).getTime())
    .map((v) => ({ x: formatDate(v.run_at, "date"), y: v.dqs_summary![module].composite_score }));
}
