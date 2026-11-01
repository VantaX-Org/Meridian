/**
 * Clients for the run-side screens: the runs export, a run's step timings, cancelling a job, the record-level compare
 * and the objects monitor. Reads go through v2Get, writes through v2Send, files through v2Download (path relative to
 * /api/v1). Endpoints: GET /runs/export, GET /runs/{id}/steps, GET /runs/{id}/steps/export, POST /jobs/{id}/cancel,
 * GET /versions/compare/records, GET /versions/compare/records/{check_id}, GET /objects/monitor,
 * GET /objects/{module}/monitor.
 */
import { v2Get, v2Send } from "./client";
import { fixtureActive } from "./fixture";
import { fixtureAction } from "./fixtures/runs";
import { v2Download } from "./download";

export type ExportFormat = "csv" | "xlsx";

// ── Runs export and steps ─────────────────────────────────────────────────────

/** GET /runs/export: the runs list as CSV or Excel, up to 100 runs, following the list's filters. Needs the export permission. */
export function exportRuns(format: ExportFormat, filters: { system_id?: string; include_archived?: boolean } = {}): Promise<string> {
  return v2Download("/runs/export", { format, ...filters }, `runs.${format}`);
}

export interface RunStep {
  step_number: number;
  step_name: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error_detail: string | null;
}

/** GET /runs/{id}/steps: what each step of the run did and how long it took, in step order. */
export interface RunSteps {
  version_id: string;
  steps: RunStep[];
}

export const getRunSteps = (id: string): Promise<RunSteps> => v2Get<RunSteps>(`/runs/${encodeURIComponent(id)}/steps`);

/** GET /runs/{id}/steps/export. Needs the export permission. */
export function exportRunSteps(id: string, format: ExportFormat): Promise<string> {
  return v2Download(`/runs/${encodeURIComponent(id)}/steps/export`, { format }, `run-steps.${format}`);
}

// ── Cancel a job ──────────────────────────────────────────────────────────────

/** POST /jobs/{id}/cancel: stops a queued or running job. Needs manage_settings. 409 once it has finished. */
export interface CancelledJob {
  id: string;
  status: string;
  cancelled_by_label?: string | null;
  cancelled_at?: number | string | null;
  /** False when the broker could not be told: the job still counts as cancelled. null when it had no tasks. */
  tasks_revoked: boolean | null;
}

export const cancelJob = (id: string): Promise<CancelledJob> =>
  fixtureActive() ? Promise.resolve().then(() => fixtureAction("cancel", { id }) as CancelledJob) : v2Send<CancelledJob>("POST", `/jobs/${encodeURIComponent(id)}/cancel`);

// ── Record-level compare ──────────────────────────────────────────────────────

export type RecordChange = "new" | "resolved" | "persisting";

export interface CompareRecordsCheck {
  check_id: string;
  module: string;
  severity: string | null;
  new: number;
  resolved: number;
  persisting: number;
  /** False when the check was skipped or errored in either run, or its key list was cut short: the counts conclude nothing. */
  comparable: boolean;
}

/** GET /versions/compare/records: per check, records newly failing, fixed and still failing between two runs. */
export interface CompareRecords {
  v1: string;
  v2: string;
  totals: Record<RecordChange, number>;
  checks: CompareRecordsCheck[];
}

export const getCompareRecords = (v2: string, v1?: string | null): Promise<CompareRecords> =>
  v2Get<CompareRecords>("/versions/compare/records", { v2, v1: v1 ?? undefined });

/** GET /versions/compare/records/{check_id}: the record keys of one change for one check. */
export interface CompareRecordKeys {
  v1: string;
  v2: string;
  change: RecordChange;
  record_keys: string[];
}

export interface CompareKeysQuery {
  v2: string;
  v1?: string | null;
  change: RecordChange;
  search?: string;
  limit: number;
  offset: number;
}

export const getCompareRecordKeys = (checkId: string, q: CompareKeysQuery): Promise<CompareRecordKeys> =>
  v2Get<CompareRecordKeys>(`/versions/compare/records/${encodeURIComponent(checkId)}`, { ...q, v1: q.v1 ?? undefined, search: q.search || undefined });

// ── Objects monitor ───────────────────────────────────────────────────────────

export type Freshness = "fresh" | "due" | "stale" | "failed" | "paused" | "manual";

export interface ObjectMonitor {
  module: string;
  system_id: string | null;
  last_run_at: string | null;
  last_version_id: string | null;
  /** scheduled | manual | recheck | upload */
  trigger: string | null;
  requested_by_label: string | null;
  cadence: { cron: string | null; active: boolean | null; interval_seconds: number | null; profile_id: string | null };
  next_run_at: string | null;
  freshness: Freshness;
  baseline: { kind: "pinned" | "previous" | null; version_id: string | null; run_at: string | null };
  drift: {
    new_failing: number;
    recovered: number;
    newly_failing_rules: { check_id: string; severity: string | null; new: number }[];
    recovered_rules: { check_id: string }[];
    newly_failing_rule_count: number;
    recovered_rule_count: number;
  };
}

/** GET /objects/monitor: cadence, freshness, trigger, baseline and drift for every measured object. */
export const getObjectsMonitor = (): Promise<{ objects: ObjectMonitor[] }> => v2Get<{ objects: ObjectMonitor[] }>("/objects/monitor");

/** GET /objects/{module}/monitor: the same for one object. 404 when it has not been measured yet. */
export const getObjectMonitor = (module: string): Promise<ObjectMonitor> => v2Get<ObjectMonitor>(`/objects/${encodeURIComponent(module)}/monitor`);
