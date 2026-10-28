import apiClient from "../client";
import { downloadBlob } from "../download";
import type { ScoreBands } from "@/design/primitives/ScoreRing";
import type { Material360 } from "../materials";
import { optional } from "../optional";
import { formatModuleName } from "@/lib/format";
import type { Version } from "@/types/api";

export interface ObjectSummary {
  module: string;
  label: string;
  composite_score: number | null;
  /** The measured score before the critical cap (absent on older backends). */
  raw_score?: number | null;
  /** A critical failure holds `composite_score` at its cap (absent on older backends). */
  capped?: boolean;
  readiness: "pass" | "warn" | "fail" | null;
  failing_checks: number;
  affected_records: number;
  /** Failing checks by severity (list only; absent on older backends). */
  critical_checks?: number;
  high_checks?: number;
  /** Optional list-row enrichments; absent on older backends. */
  blocking_rule_id?: string | null;
  blocking_rule_name?: string | null;
  /** Composite score of the last <=8 runs of the same system, oldest first, including this run. */
  trend?: number[];
  worst_dimension?: string | null;
  owner?: string | null;
  /** Measured dimension scores for the run (unmeasured dimensions omitted). */
  dimension_scores?: Record<string, number>;
}

export interface ObjectRule {
  check_id: string;
  severity: string;
  dimension: string | null;
  affected_count: number;
  total_count: number;
  pass_rate: number | null;
}

export interface ObjectDetail extends ObjectSummary {
  /** Why the score is capped (dqs_summary[module].cap_reason). */
  cap_reason?: string | null;
  dimension_scores: Record<string, number>;
  rules: ObjectRule[];
}

const get = async <T>(path: string, params?: Record<string, string | undefined>) =>
  (await apiClient.get<T>(path, { params })).data;

/** A tenant with no completed run answers 200 with `run_id: null` and an
 *  empty list for run=latest — that is an empty state, not an error. */
export const getObjects = async (run: string) => {
  const body = await optional(() => get<{ run_id: string | null; objects: ObjectSummary[]; blocking_findings_total?: number; thresholds?: ScoreBands }>("/api/v1/objects", { run }));
  return body ? { ...body, objects: (body.objects ?? []).map(named) } : { run_id: null, objects: [] };
};

export const getObject = async (module: string, run: string) =>
  named(await get<ObjectDetail>(`/api/v1/objects/${encodeURIComponent(module)}`, { run }));

/**
 * The API's `label` title-cases the module id ("hcm" -> "Hcm", "fi_gl" -> "Fi Gl"); every object is shown by its
 * name from `formatModuleName` instead, the one module-name map (lib/format.ts `MODULE_LABELS`).
 */
function named<T extends { module: string; label: string }>(o: T): T {
  return typeof o?.module === "string" ? { ...o, label: formatModuleName(o.module) } : o;
}

export const getObjectRecord = (
  object: string,
  key: string,
  params: { version_id?: string; plant?: string } = {},
) =>
  get<Material360>(`/api/v1/objects/${encodeURIComponent(object)}/records/${encodeURIComponent(key)}`, params);

export interface RecordFinding { check_id: string; severity: string; message: string | null; field: string | null }

/** GET /api/v1/objects/{object}/records/{key}/findings — the rules this record fails in the run. */
export const getObjectRecordFindings = (object: string, key: string, params: { version_id?: string } = {}) =>
  get<{ version_id: string | null; failing: RecordFinding[] }>(
    `/api/v1/objects/${encodeURIComponent(object)}/records/${encodeURIComponent(key)}/findings`, params);

/** GET /api/v1/objects/export — every object's summary row for the run, as CSV or XLSX. */
export function exportObjects(run: string, format: "csv" | "xlsx" = "xlsx"): Promise<void> {
  return downloadBlob("/api/v1/objects/export", { run, format }, `objects.${format}`);
}

/** GET /api/v1/objects/{module}/export — the rules table behind one object, as CSV or XLSX. */
export function exportObject(module: string, run: string, format: "csv" | "xlsx" = "xlsx"): Promise<void> {
  return downloadBlob(`/api/v1/objects/${encodeURIComponent(module)}/export`, { run, format }, `${module}.${format}`);
}

/** How fresh an object's score is against its own cadence (api/services/cadence.py). */
export type Freshness = "fresh" | "due" | "stale" | "failed" | "paused" | "manual";
/** How a run started; null for runs from before it was stamped. */
export type MonitorTrigger = "scheduled" | "manual" | "recheck" | "upload";

export interface MonitorRule { check_id: string; severity?: string | null; new?: number }

/** GET /api/v1/objects/{module}/monitor and the rows of GET /api/v1/objects/monitor. */
export interface ObjectMonitor {
  module: string;
  system_id: string | null;
  last_run_at: string | null;
  last_version_id: string | null;
  trigger: MonitorTrigger | null;
  requested_by_label: string | null;
  cadence: { cron: string | null; active: boolean | null; interval_seconds: number | null; profile_id: string | null };
  next_run_at: string | null;
  freshness: Freshness;
  baseline: { kind: "pinned" | "previous" | null; version_id: string | null; run_at: string | null };
  drift: {
    new_failing: number;
    recovered: number;
    newly_failing_rules: MonitorRule[];
    recovered_rules: { check_id: string }[];
    newly_failing_rule_count: number;
    recovered_rule_count: number;
  };
}

/** Cadence, freshness, trigger, baseline and drift of every object of the current state, one row each. */
export const getObjectsMonitor = async (): Promise<ObjectMonitor[]> =>
  (await optional(() => get<{ objects: ObjectMonitor[] }>("/api/v1/objects/monitor")))?.objects ?? [];

/** One object's monitor at `run`, else at its own latest run; null when the API has no such object (never run, never scheduled). */
export const getObjectMonitor = (module: string, run?: string): Promise<ObjectMonitor | null> =>
  optional(() => get<ObjectMonitor>(`/api/v1/objects/${encodeURIComponent(module)}/monitor`, { run }));

/** POST /api/v1/sync-trigger/trigger with trigger "recheck": extracts and checks this object again now. */
export const recheckObject = async (module: string): Promise<{ queued: string[]; skipped: string[] }> =>
  (await apiClient.post<{ queued: string[]; skipped: string[] }>("/api/v1/sync-trigger/trigger", { module_ids: [module], trigger: "recheck" })).data;

/** Who or what started a run, for the Runs list: "Schedule", the person's name, "Upload" or "Re-check"; null when the run did not record it. */
export function startedBy(trigger: MonitorTrigger | null | undefined, requestedByLabel?: string | null): string | null {
  switch (trigger) {
    case "scheduled": return "Schedule";
    case "upload": return "Upload";
    case "recheck": return "Re-check";
    case "manual": return requestedByLabel || "Manual";
    default: return null;
  }
}

/**
 * Who or what started a run, for the Runs list and the run page: "Schedule", the person's name, "Upload" or
 * "Re-check". Runs from before the trigger was stamped fall back to what they record: a file someone imported,
 * or a download from a system.
 */
export function startedByRun(v: Pick<Version, "metadata">): string {
  const stamped = startedBy(v.metadata?.trigger, v.metadata?.requested_by_label);
  if (stamped) return stamped;
  if (v.metadata?.file_name) return "Upload";
  if (v.metadata?.source === "extraction") return "System download";
  return "—";
}
