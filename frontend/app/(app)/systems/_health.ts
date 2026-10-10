// Shared helpers for the systems list and the system detail page.
import type { SystemVersion } from "@/lib/api/system-objects";
import type { HealthStatus, SyncProfile } from "@/types/api";

export const HEALTH_LABEL: Record<HealthStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  unreachable: "Unreachable",
  auth_failed: "Sign-in refused",
  unknown: "Not tested",
};

const meanDqs = (v: SystemVersion): number | null => {
  const vals = Object.values(v.dqs ?? {}).filter((x): x is number => typeof x === "number");
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
};
const analysedNewestFirst = (versions: SystemVersion[]) =>
  versions.filter((x) => x.analysed_at).sort((a, b) => b.run_at.localeCompare(a.run_at));

/** Mean DQS of the objects in the newest analysed run, or null before any analysis. */
export function latestDqs(versions: SystemVersion[]): { dqs: number | null; version: SystemVersion | null } {
  const v = analysedNewestFirst(versions)[0] ?? null;
  return { dqs: v ? meanDqs(v) : null, version: v };
}

/** Change in mean DQS from the previous analysed run to the newest; null until two runs are scored. */
export function dqsTrend(versions: SystemVersion[]): number | null {
  const [cur, prev] = analysedNewestFirst(versions).slice(0, 2).map(meanDqs);
  return cur == null || prev == null ? null : cur - prev;
}

/** Earliest upcoming run among a system's active schedules, or null when it runs manually only. */
export function nextRun(profiles: SyncProfile[]): string | null {
  const due = profiles.flatMap((p) => (p.active && p.next_run_at ? [p.next_run_at] : []));
  return due.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
}
