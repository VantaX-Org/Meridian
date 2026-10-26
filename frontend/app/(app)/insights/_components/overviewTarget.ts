import { CRITICAL_AND_HIGH_WORK } from "@/lib/current-state";

/**
 * Where an old /insights (the retired overview) link goes: a run's page for `?run=`, Fix work's critical and high
 * records for `?severity=`, else null (the viewer's home).
 */
export function insightsOverviewTarget(params: URLSearchParams): string | null {
  const run = params.get("run");
  if (run) return `/runs/${encodeURIComponent(run)}`;
  const severity = params.get("severity");
  if (!severity) return null;
  const wanted = severity.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return wanted.length === 1 ? `/fix?sev=${encodeURIComponent(wanted[0]!)}` : CRITICAL_AND_HIGH_WORK;
}
