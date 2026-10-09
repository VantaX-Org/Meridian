// Shared helpers for the systems list and the system detail page.
import type { SystemVersion } from "@/lib/api/system-objects";
import type { HealthStatus } from "@/types/api";

export const HEALTH_LABEL: Record<HealthStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  unreachable: "Unreachable",
  auth_failed: "Sign-in refused",
  unknown: "Not tested",
};

/** Mean DQS of the objects in the newest analysed run, or null before any analysis. */
export function latestDqs(versions: SystemVersion[]): { dqs: number | null; version: SystemVersion | null } {
  const v = [...versions].filter((x) => x.analysed_at).sort((a, b) => b.run_at.localeCompare(a.run_at))[0] ?? null;
  const vals = Object.values(v?.dqs ?? {}).filter((x): x is number => typeof x === "number");
  return { dqs: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, version: v };
}
