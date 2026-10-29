// Shared helpers for the systems list and the system detail page.
import type { Verdict } from "@/design";
import type { SystemVersion } from "@/lib/api/system-objects";
import type { HealthStatus, SyncProfile } from "@/types/api";
import { labelOf } from "@/lib/format";
import { explainJobError } from "@/lib/job-error";

export const HEALTH_LABEL: Record<HealthStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  unreachable: "Unreachable",
  auth_failed: "Sign-in refused",
  unknown: "Not tested",
};

/** A connection's health as the verdict vocabulary; an untested system has no verdict. */
export const HEALTH_VERDICT: Record<HealthStatus, Verdict | null> = {
  healthy: "go",
  degraded: "at-risk",
  unreachable: "no-go",
  auth_failed: "no-go",
  unknown: null,
};

/** Reason codes a health check stores (sap/rfc.py, api/services/connectivity_manager.py), as plain sentences. */
const HEALTH_REASONS: Record<string, string> = {
  pyrfc_not_installed: "SAP RFC library not installed on the server",
  "ping failed": "The system did not answer the connection test",
  "connection successful": "Connection successful",
};

/** The host-side step that installs the SAP RFC library, and the user guide chapter that explains it. */
export const RFC_FIX_SCRIPT = "scripts/build-rfc-overlay.sh";
export const RFC_FIX_HREF = "/docs?page=data-in";
export const RFC_MISSING_REASON = "The SAP RFC library is not installed on the server, so Meridian cannot read this system yet";

/** True when the stored health reason says the SAP RFC library is missing on the server (the connection cannot work until it is built in). */
export function rfcLibraryMissing(s: { health_status: HealthStatus; health_message: string | null | undefined }): boolean {
  if (s.health_status === "healthy" || s.health_status === "unknown") return false;
  return (s.health_message ?? "").trim().toLowerCase().startsWith("pyrfc_not_installed");
}

/**
 * Why a connection is in its state, in words, with the raw text the check stored for a tooltip: a known reason code
 * ("pyrfc_not_installed: build the API image ...") reads as its sentence; a recognisable SAP or network error as the
 * job-error summary; anything else keeps its own text. Null when the check stored no reason.
 */
export function healthReason(raw: string | null | undefined): { text: string; raw: string } | null {
  const detail = raw?.trim();
  if (!detail) return null;
  const code = detail.split(":")[0].trim().toLowerCase();
  if (Object.hasOwn(HEALTH_REASONS, code)) return { text: HEALTH_REASONS[code], raw: detail };
  const job = explainJobError(detail);
  if (job && job.kind !== "other") return { text: job.summary, raw: detail };
  // An unknown snake_case code reads as words; the raw text stays in the tooltip.
  return { text: /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(code) ? labelOf(code) : detail, raw: detail };
}

const meanDqs =(v: SystemVersion): number | null => {
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

/** Mean DQS of the last `limit` analysed runs, oldest first, for a sparkline. */
export function dqsSeries(versions: SystemVersion[], limit = 8): number[] {
  return analysedNewestFirst(versions).slice(0, limit).reverse().flatMap((v) => { const m = meanDqs(v); return m == null ? [] : [m]; });
}

/** Earliest upcoming run among a system's active schedules, or null when it runs manually only. */
export function nextRun(profiles: SyncProfile[]): string | null {
  const due = profiles.flatMap((p) => (p.active && p.next_run_at ? [p.next_run_at] : []));
  return due.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
}
