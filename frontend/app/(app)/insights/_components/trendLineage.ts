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
