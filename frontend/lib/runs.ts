import type { Version } from "@/types/api";

/**
 * Statuses of a run that has finished scoring: the one set every "finished run" filter uses. Agents and AI
 * enrichment run after scoring, so a run whose agents failed, or that finished partially, still has scores.
 */
export const FINISHED: ReadonlySet<string> = new Set(["complete", "agents_complete", "ai_enriched", "agents_failed", "partial"]);

/** The API's cap on `scores/history` (`limit le=500`): every finished run, so an older lineage keeps its history. */
export const SCORE_HISTORY_LIMIT = 500;

export const isFinished =(v: Pick<Version, "status">): boolean => FINISHED.has(v.status);

/**
 * A run page link whose `?run=` names the same run, so anything on the page that reads `?run=` (the help
 * menu's tour links) agrees with the run in the path.
 */
export function runPageHref(id: string, params?: Record<string, string | undefined>): string {
  const q = new URLSearchParams({ run: id });
  for (const [k, v] of Object.entries(params ?? {})) if (v) q.set(k, v);
  return `/runs/${encodeURIComponent(id)}?${q.toString()}`;
}

/** Mean of the module composite scores, or null when the run carries no scores. */
export function overallDqs(version: Version): number | null {
  const scores = Object.values(version.dqs_summary ?? {}).flatMap((s) => (s.composite_score == null ? [] : [s.composite_score]));
  if (scores.length === 0) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/** A run's comparison scope: its system id, or "upload" for imported files. */
export function scopeOf(version: Version): string {
  return version.metadata?.system_id ?? "upload";
}

/** "business_partner_100k" -> "business_partner": an upload label without its size or count suffix. */
export function labelFamily(label: string | null | undefined): string {
  return (label ?? "").trim().toLowerCase().replace(/[\s_-]*\d+(?:[.,]\d+)?\s*[km]?\s*(?:records?|rows?)?$/i, "").trim();
}

/**
 * The lineage a run belongs to, so trends and deltas never mix objects: runs of one system share a lineage;
 * uploads share one when they carry the same objects, else when their labels differ only by a size suffix.
 */
export function lineageOf(version: Version): string {
  const system = version.metadata?.system_id;
  if (system) return `system:${system}`;
  const modules = version.metadata?.modules?.length ? version.metadata.modules : Object.keys(version.dqs_summary ?? {});
  if (modules.length) return `upload:${[...modules].sort().join("+")}`;
  const family = labelFamily(version.label);
  return family ? `upload:${family}` : "upload";
}

/** The runs of `current`'s lineage (itself included), newest first. */
export function sameLineage(current: Version, runs: Version[]): Version[] {
  const lineage = lineageOf(current);
  return runs.filter((r) => lineageOf(r) === lineage).sort((a, b) => (a.run_at < b.run_at ? 1 : -1));
}

/** The newest run in `current`'s lineage that ran before it, or null when `current` is the first of its lineage. */
export function previousInLineage(current: Version, runs: Version[]): Version | null {
  return sameLineage(current, runs).find((r) => r.id !== current.id && r.run_at < current.run_at) ?? null;
}

/** Finished runs in `current`'s lineage (same system, or uploads of the same objects), itself excluded. */
function sameLineageFinished(current: Version, runs: Version[]): Version[] {
  const lineage = lineageOf(current);
  return runs.filter((r) => r.id !== current.id && isFinished(r) && lineageOf(r) === lineage);
}

/** The latest finished run in the same lineage that started before `current`. */
export function previousRunId(current: Version, runs: Version[]): string | null {
  const earlier = sameLineageFinished(current, runs)
    .filter((r) => r.run_at < current.run_at)
    .sort((a, b) => (a.run_at < b.run_at ? 1 : -1));
  return earlier[0]?.id ?? null;
}

/** The pinned baseline of `current`'s lineage (the API pins one per lineage), if it is a different finished run. */
export function baselineRunId(current: Version, runs: Version[]): string | null {
  return sameLineageFinished(current, runs).find((r) => r.metadata?.baseline === true)?.id ?? null;
}

export interface RunSeries {
  scope: string;
  points: { x: string; y: number }[];
}

/** One ascending DQS series per scope from finished, scored runs; scopes ordered by their latest run. */
export function runSeries(runs: Version[], max = 6): RunSeries[] {
  const byScope = new Map<string, { x: string; y: number }[]>();
  for (const r of runs) {
    if (!isFinished(r)) continue;
    const y = overallDqs(r);
    if (y === null) continue;
    const scope = scopeOf(r);
    const points = byScope.get(scope) ?? [];
    points.push({ x: r.run_at, y });
    byScope.set(scope, points);
  }
  return [...byScope.entries()]
    .map(([scope, points]) => ({ scope, points: points.sort((a, b) => (a.x < b.x ? -1 : 1)) }))
    .sort((a, b) => (a.points[a.points.length - 1].x < b.points[b.points.length - 1].x ? 1 : -1))
    .slice(0, max);
}
