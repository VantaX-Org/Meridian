/**
 * Finding → RecordReportFinding transformer.
 *
 * The host layer between the API (`/api/v1/findings`) and the Aurora
 * Record drawer. Pulls the new backend signals off Finding.details and
 * hands them to <RecordReport /> in the exact shape its props expect.
 *
 * Signals mapped:
 *   - details.root_cause         → RecordReportFinding.rootCause
 *   - details.cross_module +
 *     details.sources            → RecordReportFinding.sourceModules
 *   - details.namespace          → RecordReportFinding.namespace
 *   - details.applies_when       → RecordReportFinding.appliesWhen
 *
 * Missing/unknown fields are silently dropped so the drawer renders
 * cleanly on older analyses that pre-date the backend changes.
 */

import type { Finding, Severity } from "@/types/api";
import type {
  RecordReportFinding,
  RecordReportRootCause,
  RecordReportRootCauseType,
  RecordReportSeverity,
} from "@/components/aurora/report/record-report";
import type { WorkbenchRowOrigin } from "@/components/aurora/surfaces/workbench";

const ROOT_CAUSE_TYPES: ReadonlyArray<RecordReportRootCauseType> = [
  "bad_data",
  "bad_config",
  "bad_data_and_config",
  "unknown",
];

function isRootCauseType(v: unknown): v is RecordReportRootCauseType {
  return typeof v === "string" &&
    (ROOT_CAUSE_TYPES as ReadonlyArray<string>).includes(v);
}

function toStringArray(v: unknown): ReadonlyArray<string> | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length > 0 ? out : undefined;
}

function extractRootCause(details: unknown): RecordReportRootCause | undefined {
  if (!details || typeof details !== "object") return undefined;
  const rc = (details as Record<string, unknown>).root_cause;
  if (!rc || typeof rc !== "object") return undefined;
  const rcRec = rc as Record<string, unknown>;
  const type = rcRec.root_cause_type;
  if (!isRootCauseType(type)) return undefined;
  const reasoning =
    typeof rcRec.reasoning === "string" ? rcRec.reasoning : "";
  const elementType =
    typeof rcRec.element_type === "string" ? rcRec.element_type : undefined;
  return {
    type,
    reasoning,
    elementType,
    flaggedValuesInConfig: toStringArray(rcRec.flagged_values_in_config),
    flaggedValuesNotInConfig: toStringArray(rcRec.flagged_values_not_in_config),
  };
}

function extractSourceModules(
  details: unknown,
): ReadonlyArray<string> | undefined {
  if (!details || typeof details !== "object") return undefined;
  const d = details as Record<string, unknown>;
  if (d.cross_module !== true) return undefined;
  return toStringArray(d.sources);
}

function extractNamespace(
  details: unknown,
): "standard" | "customer" | undefined {
  if (!details || typeof details !== "object") return undefined;
  const ns = (details as Record<string, unknown>).namespace;
  if (ns === "customer" || ns === "standard") return ns;
  return undefined;
}

function extractAppliesWhen(
  details: unknown,
): Record<string, ReadonlyArray<string>> | undefined {
  if (!details || typeof details !== "object") return undefined;
  const aw = (details as Record<string, unknown>).applies_when;
  if (!aw || typeof aw !== "object") return undefined;
  const out: Record<string, ReadonlyArray<string>> = {};
  for (const [field, values] of Object.entries(aw as Record<string, unknown>)) {
    const arr = toStringArray(values);
    if (arr) out[field] = arr;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function severityToRecord(s: Severity): RecordReportSeverity {
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

function firstEvidence(details: unknown): string | undefined {
  if (!details || typeof details !== "object") return undefined;
  const d = details as Record<string, unknown>;
  // Prefer the common message field already normalised by the worker
  if (typeof d.message === "string" && d.message.trim()) return d.message;
  // Fall back to a distinct invalid value summary
  if (d.distinct_invalid_values && typeof d.distinct_invalid_values === "object") {
    const entries = Object.entries(d.distinct_invalid_values as Record<string, unknown>);
    if (entries.length > 0) {
      const top = entries.slice(0, 3).map(([k, v]) => `${k} (${v})`).join(", ");
      return `Invalid values: ${top}`;
    }
  }
  // Referential / null check summaries
  if (typeof d.failing_record_count === "number" && d.failing_record_count > 0) {
    return `${d.failing_record_count} failing record(s).`;
  }
  return undefined;
}

/**
 * Convert an API Finding into the shape the RecordReport drawer expects.
 * Pure function — no network, no side effects. Safe to call in a render
 * pass for the few findings shown in the drawer at a time.
 */
export function findingToRecordReport(finding: Finding): RecordReportFinding {
  const details = finding.details as unknown;
  return {
    id: finding.id,
    checkId: finding.check_id,
    title:
      (typeof details === "object" && details &&
        typeof (details as Record<string, unknown>).message === "string" &&
        (details as Record<string, string>).message) ||
      finding.check_id,
    severity: severityToRecord(finding.severity),
    passRate: finding.pass_rate == null ? 0 : finding.pass_rate / 100,
    evidence: firstEvidence(details),
    rootCause: extractRootCause(details),
    sourceModules: extractSourceModules(details),
    namespace: extractNamespace(details),
    appliesWhen: extractAppliesWhen(details),
  };
}

/** Batch convert an array of findings — common for drawer hydration. */
export function findingsToRecordReport(
  findings: ReadonlyArray<Finding>,
): ReadonlyArray<RecordReportFinding> {
  return findings.map(findingToRecordReport);
}

/**
 * Extract the compact origin markers for the Workbench triage table row.
 * Uses the same details keys as findingToRecordReport but returns the
 * WorkbenchRowOrigin shape so the table cell can show at-a-glance signal
 * (XM / Z / CFG tags) without the full RecordReport context.
 */
export function findingOriginForWorkbench(
  finding: Finding,
): WorkbenchRowOrigin | undefined {
  const details = finding.details as unknown;
  if (!details || typeof details !== "object") return undefined;
  const d = details as Record<string, unknown>;

  const origin: WorkbenchRowOrigin = {};
  if (d.cross_module === true) origin.crossModule = true;
  if (d.namespace === "customer") origin.customerNamespace = true;
  const rc = d.root_cause;
  if (rc && typeof rc === "object") {
    const t = (rc as Record<string, unknown>).root_cause_type;
    if (isRootCauseType(t)) origin.rootCauseType = t;
  }

  // Return undefined when empty so host code can skip the marker column
  // entirely for standard findings — keeps the table quiet.
  return Object.keys(origin).length === 0 ? undefined : origin;
}
