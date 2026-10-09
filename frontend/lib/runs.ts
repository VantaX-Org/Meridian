import type { Version } from "@/types/api";

/** Mean of the module composite scores, or null when the run carries no scores. */
export function overallDqs(version: Version): number | null {
  const scores = Object.values(version.dqs_summary ?? {}).map((s) => s.composite_score);
  if (scores.length === 0) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/** A run's comparison scope: its system id, or "upload" for imported files. */
export function scopeOf(version: Version): string {
  return version.metadata?.system_id ?? "upload";
}

function sameScopeComplete(current: Version, runs: Version[]): Version[] {
  const scope = scopeOf(current);
  return runs.filter((r) => r.id !== current.id && r.status === "complete" && scopeOf(r) === scope);
}

/** The latest complete run in the same scope that started before `current`. */
export function previousRunId(current: Version, runs: Version[]): string | null {
  const earlier = sameScopeComplete(current, runs)
    .filter((r) => r.run_at < current.run_at)
    .sort((a, b) => (a.run_at < b.run_at ? 1 : -1));
  return earlier[0]?.id ?? null;
}

/** The pinned baseline of `current`'s scope, if it is a different complete run. */
export function baselineRunId(current: Version, runs: Version[]): string | null {
  return sameScopeComplete(current, runs).find((r) => r.metadata?.baseline === true)?.id ?? null;
}

export interface RunSeries {
  scope: string;
  points: { x: string; y: number }[];
}

/** One ascending DQS series per scope from complete, scored runs; scopes ordered by their latest run. */
export function runSeries(runs: Version[], max = 6): RunSeries[] {
  const byScope = new Map<string, { x: string; y: number }[]>();
  for (const r of runs) {
    if (r.status !== "complete") continue;
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
