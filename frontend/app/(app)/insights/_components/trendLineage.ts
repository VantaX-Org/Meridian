// Scopes a trend series to the current run's lineage so a chart never mixes objects.
import type { TrendRun } from "@/lib/api/insights";
import { runAxisLabels } from "@/lib/format";
import type { ChartPoint } from "@/design";
import type { Version } from "@/types/api";

const objectKey = (r: TrendRun) => Object.keys(r.modules ?? {}).sort().join("+");

/**
 * The trends endpoint already follows one system's lineage. Uploads all share the "upload" lineage, so for an
 * upload the series is narrowed to runs that carry the same objects as the current run. The key comes from the
 * current run's own metadata, so an upload that fell outside the endpoint's window still scopes correctly; an
 * upload whose objects are unknown gets an empty series, never the mixed one.
 */
export function scopeTrendRuns(runs: TrendRun[], current: Version | undefined, runId: string | undefined): TrendRun[] {
  if (!current) return runs;
  if (current.metadata?.system_id) return runs;
  const here = runs.find((r) => r.version_id === runId);
  if (here) {
    const key = objectKey(here);
    return key ? runs.filter((r) => objectKey(r) === key) : runs; // no object info anywhere: nothing to scope on
  }
  const key = [...(current.metadata?.modules ?? [])].sort().join("+");
  return key ? runs.filter((r) => objectKey(r) === key) : [];
}

/**
 * The per-run comparisons (change, rules fixed, rules newly failing) come from the API against each run's
 * immediate predecessor in the lineage. When scoping hides that predecessor, the next shown run would read
 * against a run the reader cannot see: its change is recomputed against the run shown before it, and the rule
 * counts, which need both runs' findings, become unknown (null) rather than wrong.
 */
export function scopedComparisons(all: TrendRun[], scoped: TrendRun[]): TrendRun[] {
  const index = new Map(all.map((r, i) => [r.version_id, i]));
  return scoped.map((r, i) => {
    const at = index.get(r.version_id);
    const predecessor = at != null && at > 0 ? all[at - 1] : undefined;
    const shownBefore = i > 0 ? scoped[i - 1] : undefined;
    if (!predecessor || predecessor === shownBefore) return r;
    const change = shownBefore && typeof r.composite === "number" && typeof shownBefore.composite === "number"
      ? Math.round((r.composite - shownBefore.composite) * 10) / 10 : null;
    return { ...r, change, rules_fixed: null, rules_new: null };
  });
}

/** Points keyed by run id with the date (or date and time) as the display label; run labels are never ticks. */
export function trendPoints(runs: TrendRun[], value: (r: TrendRun) => number | null | undefined): ChartPoint[] {
  const labels = runAxisLabels(runs.map((r) => ({ id: r.version_id, run_at: r.run_at })));
  return runs.flatMap((r) => {
    const y = value(r);
    return typeof y === "number" ? [{ x: r.version_id, label: labels.get(r.version_id), y, runId: r.version_id }] : [];
  });
}

/** The full x domain of a run series, for sibling charts that must line up. */
export function trendDomain(runs: TrendRun[]): { x: string; label?: string }[] {
  const labels = runAxisLabels(runs.map((r) => ({ id: r.version_id, run_at: r.run_at })));
  return runs.map((r) => ({ x: r.version_id, label: labels.get(r.version_id) }));
}
