// frontend/lib/home-metrics.ts
import type { Version } from "@/types/api";
import type { ObjectSummary } from "@/lib/api/v1/objects";
import { round1, formatDate, formatModuleName } from "@/lib/format";
import { DEFAULT_SCORE_BANDS, type ScoreBands } from "@/design/primitives/ScoreRing";

export const DIMENSIONS = ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"] as const;
export type DimensionKey = (typeof DIMENSIONS)[number];

export type Readiness = "go" | "at-risk" | "no-go";

/** The same bands as `ScoreRing`: >= target go, >= warning at-risk, else no-go. */
export function readinessOf(score: number, bands: ScoreBands = DEFAULT_SCORE_BANDS): Readiness {
  return score >= bands.target ? "go" : score >= bands.warning ? "at-risk" : "no-go";
}

/** Mean `composite_score` across every module measured in this run, or null if none are. */
export function runDqs(v: Version): number | null {
  const scores = Object.values(v.dqs_summary ?? {}).flatMap((m) => (m.composite_score == null ? [] : [m.composite_score]));
  if (scores.length === 0) return null;
  return round1(scores.reduce((a, b) => a + b, 0) / scores.length);
}

/** Mean of each dimension across the measured modules (as `runDqs`) that measured it (null: not measured), or null with no measured modules. */
export function runDimensions(v: Version): Record<DimensionKey, number | null> | null {
  const modules = Object.values(v.dqs_summary ?? {}).filter((m) => m.composite_score != null);
  if (modules.length === 0) return null;
  const out = {} as Record<DimensionKey, number | null>;
  for (const dim of DIMENSIONS) {
    const scores = modules.filter((m) => m.dimension_coverage?.[dim] !== 0).map((m) => m.dimension_scores[dim]);
    out[dim] = scores.length ? round1(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  }
  return out;
}

/** The dimensions no module measured in this run, as display names. */
export function unmeasuredDimensions(v: Version): string[] {
  const dims = runDimensions(v);
  return dims ? DIMENSIONS.filter((d) => dims[d] == null).map(formatModuleName) : [];
}

export interface TrendPoint {
  x: string;
  y: number;
  runId: string;
}

/** Finished runs (those with at least one measured module), oldest first, as chart points. */
export function trend(versions: Version[]): TrendPoint[] {
  return versions
    .filter((v) => runDqs(v) != null)
    .slice()
    .sort((a, b) => new Date(a.run_at).getTime() - new Date(b.run_at).getTime())
    .map((v) => ({ x: formatDate(v.run_at, "date"), y: runDqs(v)!, runId: v.id }));
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

/** Backend defaults (api/services/scoring.py DEFAULT_WEIGHTS), used until the tenant's own weights load. */
export const DEFAULT_DIMENSION_WEIGHTS: Readonly<Record<DimensionKey, number>> = {
  completeness: 0.25, accuracy: 0.25, consistency: 0.2, timeliness: 0.1, uniqueness: 0.1, validity: 0.1,
};

/** The six-dimension bar chart's points for this run (spec 7.1 "Six dimensions"). */
export function dimensionBarPoints(v: Version, weights: Readonly<Record<DimensionKey, number>> = DEFAULT_DIMENSION_WEIGHTS): DimensionBarPoint[] {
  const dims = runDimensions(v);
  if (!dims) return [];
  const total = DIMENSIONS.reduce((n, d) => n + weights[d], 0);
  const label = (d: DimensionKey) => (total > 0 ? `${formatModuleName(d)} · ${Math.round((weights[d] / total) * 100)}%` : formatModuleName(d));
  return DIMENSIONS.flatMap((d) => {
    const y = dims[d];
    return y == null ? [] : [{ x: label(d), y, dimension: d }];
  });
}

export interface HeatmapCell {
  row: string;
  col: string;
  value: Readiness;
}

/** One cell per object x dimension, from this run's `dqs_summary` (spec 7.1 "Object readiness grid"). */
export function dimensionHeatmapCells(objects: ObjectSummary[], v: Version, bands?: ScoreBands): HeatmapCell[] {
  const cells: HeatmapCell[] = [];
  for (const obj of objects) {
    const summary = v.dqs_summary?.[obj.module];
    if (!summary) continue;
    for (const dim of DIMENSIONS) {
      if (summary.dimension_coverage?.[dim] === 0) continue; // not measured: the grid shows an empty cell
      cells.push({ row: obj.label, col: formatModuleName(dim), value: readinessOf(summary.dimension_scores[dim], bands) });
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
    .filter((v) => v.dqs_summary?.[module]?.composite_score != null)
    .slice()
    .sort((a, b) => new Date(a.run_at).getTime() - new Date(b.run_at).getTime())
    .map((v) => ({ x: formatDate(v.run_at, "date"), y: v.dqs_summary![module].composite_score! }));
}

/**
 * The cap on the run-wide DQS, or null. `runDqs` is a mean of per-module scores that are already capped, so a single
 * cap is only valid for the mean when EVERY scored module is capped, EVERY reason names its cap, and all caps are equal.
 * Anything else (mixed or unparsable caps) returns null and the cap_reason Pill alone signals the cap. `criticals` sums
 * the modules' critical counts (all of them are capped here). The number is read from the reason text
 * ("... capped at 70"); the API has no field for it.
 */
export function runCap(v: Version): { cap: number; criticals: number } | null {
  const mods = Object.values(v.dqs_summary ?? {}).filter((m) => m.composite_score != null); // as runDqs: measured modules only
  if (mods.length === 0 || !mods.every((m) => m.capped)) return null;
  const caps = mods.map((m) => Number(/capped at (\d+)/.exec(m.cap_reason ?? "")?.[1]));
  if (!caps.every((n) => Number.isFinite(n) && n === caps[0])) return null;
  return { cap: caps[0], criticals: mods.reduce((n, m) => n + m.critical_count, 0) };
}
