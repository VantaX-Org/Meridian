// frontend/lib/home-metrics.ts
import type { Version } from "@/types/api";

/** What the per-run metrics read: a run, or the merged summary of several (lib/current-state.ts). */
export type Scored = Pick<Version, "dqs_summary">;
import type { ObjectSummary } from "@/lib/api/v1/objects";
import { capRuleIds, round1, formatDate, formatModuleName } from "@/lib/format";
import { runAxisTicks } from "@/lib/run-axis";
import { lineageOf } from "@/lib/runs";
import { DEFAULT_SCORE_BANDS, type ScoreBands } from "@/design/primitives/ScoreRing";

export const DIMENSIONS = ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"] as const;
export type DimensionKey = (typeof DIMENSIONS)[number];

export type Readiness = "go" | "at-risk" | "no-go";

/** The same bands as `ScoreRing`: >= target go, >= warning at-risk, else no-go. */
export function readinessOf(score: number, bands: ScoreBands = DEFAULT_SCORE_BANDS): Readiness {
  return score >= bands.target ? "go" : score >= bands.warning ? "at-risk" : "no-go";
}

/**
 * Below target: at risk or no-go (`readinessOf` is "go" only at the target). Objects not scored yet are neither.
 * `BELOW_TARGET` is the `/objects?readiness=` value that lists the same objects.
 */
export const isBelowTarget = (o: { readiness?: string | null }): boolean => o.readiness === "warn" || o.readiness === "fail";
export const BELOW_TARGET = "warn,fail";

/** Mean `composite_score` across every module measured in this run, or null if none are. */
export function runDqs(v: Scored): number | null {
  const scores = Object.values(v.dqs_summary ?? {}).flatMap((m) => (m.composite_score == null ? [] : [m.composite_score]));
  if (scores.length === 0) return null;
  return round1(scores.reduce((a, b) => a + b, 0) / scores.length);
}

/**
 * Mean of each dimension across the modules that measured it (null: not measured), or null with no such module.
 * A module can have measured dimensions yet no composite (a tenant weighting every measured dimension at 0), so
 * it counts when it has a composite or any dimension coverage.
 */
export function runDimensions(v: Scored): Record<DimensionKey, number | null> | null {
  const modules = Object.values(v.dqs_summary ?? {}).filter((m) => m.composite_score != null || Object.values(m.dimension_coverage ?? {}).some((c) => c > 0));
  if (modules.length === 0) return null;
  const out = {} as Record<DimensionKey, number | null>;
  for (const dim of DIMENSIONS) {
    const scores = modules.filter((m) => m.dimension_coverage?.[dim] !== 0).map((m) => m.dimension_scores[dim]);
    out[dim] = scores.length ? round1(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  }
  return out;
}

/** The dimensions no module measured in this run, as display names. */
export function unmeasuredDimensions(v: Scored): string[] {
  const dims = runDimensions(v);
  return dims ? DIMENSIONS.filter((d) => dims[d] == null).map(formatModuleName) : [];
}

export interface TrendPoint {
  /** The run id: the chart's key, never a tick. */
  x: string;
  /** The tick: the run's date, or date and time when two runs share a day. */
  label: string;
  y: number;
  runId: string;
}

/**
 * Finished runs (those with at least one measured module), oldest first, as chart points. With `current`, only
 * the runs of its lineage (same system, or uploads of the same objects) are kept, so the line never mixes objects.
 */
export function trend(versions: Version[], current?: Version): TrendPoint[] {
  const lineage = current ? lineageOf(current) : null;
  const runs = versions
    .filter((v) => runDqs(v) != null && (lineage === null || lineageOf(v) === lineage))
    .slice()
    .sort((a, b) => new Date(a.run_at).getTime() - new Date(b.run_at).getTime());
  const ticks = runAxisTicks(runs);
  return runs.map((v) => ({ x: v.id, label: ticks.get(v.id) ?? formatDate(v.run_at, "date"), y: runDqs(v)!, runId: v.id }));
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
export function severityTotals(v: Scored): SeverityTotals {
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
/** The critical rules a run's cap reasons name, each with the object whose score they capped, in reason order. */
export function capRules(v: Scored): { check_id: string; module: string }[] {
  const out = new Map<string, { check_id: string; module: string }>();
  for (const [module, m] of Object.entries(v.dqs_summary ?? {})) {
    if (!m.capped) continue;
    for (const id of capRuleIds(m.cap_reason)) if (!out.has(id)) out.set(id, { check_id: id, module });
  }
  return [...out.values()];
}

/**
 * How many critical rules capped this run: per capped object, the rules its reason names, or its critical count
 * when the reason names none (an older or unparsable reason). Rules named by several objects count once.
 */
export function capRuleCount(v: Scored): number {
  const named = new Set<string>();
  let unnamed = 0;
  for (const m of Object.values(v.dqs_summary ?? {})) {
    if (!m.capped) continue;
    const ids = capRuleIds(m.cap_reason);
    if (ids.length) ids.forEach((id) => named.add(id));
    else unnamed += m.critical_count ?? 0;
  }
  return named.size + unnamed;
}

export function cappedReason(v: Scored): string | null {
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
export function dimensionBarPoints(v: Scored, weights: Readonly<Record<DimensionKey, number>> = DEFAULT_DIMENSION_WEIGHTS): DimensionBarPoint[] {
  const dims = runDimensions(v);
  if (!dims) return [];
  const total = DIMENSIONS.reduce((n, d) => n + weights[d], 0);
  const label = (d: DimensionKey) => (total > 0 ? `${formatModuleName(d)} (${Math.round((weights[d] / total) * 100)}%)` : formatModuleName(d));
  return DIMENSIONS.flatMap((d) => {
    const y = dims[d];
    return y == null ? [] : [{ x: label(d), y, dimension: d }];
  });
}

export interface HeatmapCell {
  row: string;
  col: string;
  /** The dimension score, printed in the cell so colour is never the only signal. */
  value: number;
  tone: Readiness;
}

/** One cell per object x dimension, from this run's `dqs_summary` (spec 7.1 "Object readiness grid"). */
export function dimensionHeatmapCells<T extends Pick<ObjectSummary, "module" | "label">>(objects: T[], v: Scored, bands?: ScoreBands): HeatmapCell[] {
  const cells: HeatmapCell[] = [];
  for (const obj of objects) {
    const summary = v.dqs_summary?.[obj.module];
    if (!summary) continue;
    for (const dim of DIMENSIONS) {
      if (summary.dimension_coverage?.[dim] === 0) continue; // not measured: the grid shows an empty cell
      const score = summary.dimension_scores[dim];
      cells.push({ row: obj.label, col: formatModuleName(dim), value: round1(score), tone: readinessOf(score, bands) });
    }
  }
  return cells;
}

/** The objects with a scored run, worst (lowest `composite_score`) first. */
export function worstObjectsFirst<T extends Pick<ObjectSummary, "composite_score">>(objects: T[]): T[] {
  return objects
    .filter((o) => o.composite_score !== null)
    .slice()
    .sort((a, b) => (a.composite_score ?? 0) - (b.composite_score ?? 0));
}

/**
 * How many records an object holds, the area of its tile on the object map: what the run downloaded for it
 * (`object_rows`), else the upload's row count when the run holds only that object, else the records its findings
 * affect. 0 when none of these is known (the map still gives the tile one cell).
 */
export function objectRecords(run: Pick<Version, "metadata"> | undefined, module: string, affected?: number | null): number {
  const meta = run?.metadata;
  const downloaded = meta?.object_rows?.[module];
  if (downloaded != null && downloaded > 0) return downloaded;
  if (meta?.row_count != null && meta.row_count > 0 && (meta.modules ?? []).length <= 1) return meta.row_count;
  return affected ?? 0;
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
export function runCap(v: Scored): { cap: number; criticals: number } | null {
  const mods = Object.values(v.dqs_summary ?? {}).filter((m) => m.composite_score != null); // as runDqs: measured modules only
  if (mods.length === 0 || !mods.every((m) => m.capped)) return null;
  const caps = mods.map((m) => Number(/capped at (\d+)/.exec(m.cap_reason ?? "")?.[1]));
  if (!caps.every((n) => Number.isFinite(n) && n === caps[0])) return null;
  return { cap: caps[0], criticals: mods.reduce((n, m) => n + m.critical_count, 0) };
}
