/**
 * Aurora Workbench view-model composer.
 *
 * Transforms `/api/v1/findings` responses into the exact WorkbenchRow
 * shape the Aurora Workbench surface expects. Pulls the new backend
 * signals off finding.details and maps them onto WorkbenchRow.origin
 * via findingOriginForWorkbench.
 */

import type { Finding, FindingList, Severity } from "@/types/api";
import { findingOriginForWorkbench } from "@/lib/aurora";
import type {
  WorkbenchRow,
  WorkbenchSeverity,
  WorkbenchStatus,
} from "@/components/aurora";

function severityToWorkbench(s: Severity): WorkbenchSeverity {
  switch (s) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
      return "low";
    default:
      return "medium";
  }
}

/** Human-readable age from an ISO timestamp — "3h", "2d", "42m". */
function formatAge(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.max(0, (now - then) / 1000);
  if (seconds < 90) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function firstLineFromDetails(finding: Finding): string {
  const d = (finding.details ?? {}) as Record<string, unknown>;
  if (typeof d.message === "string" && d.message.trim()) return d.message;
  return finding.check_id;
}

function moduleLabel(module: string): string {
  // Cheap camel-ish prettification. Host can swap in a richer mapping
  // (formatModuleName in lib/format) once the barrel export is stable.
  return module
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Build the Aurora Workbench row list from a findings API response.
 *
 * Every backend signal (root_cause, cross_module, namespace, applies_when)
 * that affects at-a-glance triage is threaded through via
 * findingOriginForWorkbench → row.origin. The drawer uses
 * findingToRecordReport to surface the full detail.
 */
export function composeWorkbenchRows(
  list: FindingList | undefined,
): WorkbenchRow[] {
  if (!list?.findings) return [];
  return list.findings.map<WorkbenchRow>((f) => {
    const origin = findingOriginForWorkbench(f);
    return {
      id: f.id,
      recordId: f.check_id,
      headline: firstLineFromDetails(f),
      module: moduleLabel(f.module),
      severity: severityToWorkbench(f.severity),
      status: "open" as WorkbenchStatus,
      age: formatAge(f.created_at),
      assignee: null,
      blocking: f.affected_count,
      ...(origin ? { origin } : {}),
    };
  });
}
