/**
 * Clients for the run-side screens: the runs export, a run's step timings, cancelling a job, the record-level compare
 * and the objects monitor. Reads go through v2Get, writes through v2Send, files through v2Download (path relative to
 * /api/v1). Endpoints: GET /runs/export, GET /runs/{id}/steps, GET /runs/{id}/steps/export, POST /jobs/{id}/cancel,
 * GET /versions/compare/records, GET /versions/compare/records/{check_id}, GET /objects/monitor,
 * GET /objects/{module}/monitor, PATCH /versions/{id}, POST /versions/{id}/run-agents,
 * GET /versions/{id}/findings/{check_id}/records, GET /events/{id} (server-sent events).
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

// ── Rename, re-run agents, finding records, run events ───────────────────────────────────────

/** PATCH /versions/{id}: sets the run's label (the route takes a label and nothing else). Needs the analyse permission. */
export const renameRun = (id: string, label: string): Promise<{ id: string; label: string | null }> =>
  fixtureActive() ? Promise.resolve().then(() => fixtureAction("rename", { id, label }) as { id: string; label: string }) : v2Send("PATCH", `/versions/${encodeURIComponent(id)}`, { label });

export interface AgentsEnqueued {
  version_id: string;
  job_id: string;
  status: string;
}

/** POST /versions/{id}/run-agents: runs the agents again on a finished run. 409 until the run is complete. Needs the analyse permission. */
export const rerunAgents = (id: string): Promise<AgentsEnqueued> =>
  fixtureActive() ? Promise.resolve().then(() => fixtureAction("rerun_agents", { id }) as AgentsEnqueued) : v2Send<AgentsEnqueued>("POST", `/versions/${encodeURIComponent(id)}/run-agents`);

export interface FindingRecord {
  record_key: string;
  grain: string;
  module: string;
  /** Masked for sensitive fields; null on runs made before values were kept. */
  field_values: Record<string, unknown> | null;
}

export interface FindingRecords {
  version_id: string;
  check_id: string;
  total: number;
  records: FindingRecord[];
}

/** GET /versions/{id}/findings/{check_id}/records: one page of the records that fail a check at a run. limit 1 to 1000. */
export const getFindingRecords = (versionId: string, checkId: string, page: { limit: number; offset: number; grain?: string }): Promise<FindingRecords> =>
  fixtureActive()
    ? Promise.resolve().then(() => fixtureAction("finding_records", { versionId, checkId, ...page }) as FindingRecords)
    : v2Get<FindingRecords>(`/versions/${encodeURIComponent(versionId)}/findings/${encodeURIComponent(checkId)}/records`, page);

export interface RunEvent {
  /** The frame's `event:` name. */
  type: string;
  /** The frame's `data:` payload, parsed when it is JSON. */
  data: unknown;
}

/** One SSE frame to an event, or null for a heartbeat or connection comment (lines that start with a colon). */
export function parseEventFrame(frame: string): RunEvent | null {
  let type = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  const raw = data.join("\n");
  try {
    return { type, data: JSON.parse(raw) };
  } catch {
    return { type, data: raw };
  }
}

/**
 * GET /events/{id}: live progress events of one run. The stream has no history, it carries only what happens while it
 * is open, and it closes itself when the run completes, fails or is cancelled. Returns the function that stops it.
 * No network in fixture mode.
 */
export function streamRunEvents(id: string, onEvent: (e: RunEvent) => void, onEnd: (error?: unknown) => void): () => void {
  if (fixtureActive()) {
    const timer = setTimeout(() => onEnd(), 0);
    return () => clearTimeout(timer);
  }
  const controller = new AbortController();
  (async () => {
    try {
      const res = await fetch(`/api/v1/events/${encodeURIComponent(id)}`, { headers: { Accept: "text/event-stream" }, signal: controller.signal });
      if (!res.ok || !res.body) throw new Error(`events stream: HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const e = parseEventFrame(buffer.slice(0, idx));
          buffer = buffer.slice(idx + 2);
          if (e) onEvent(e);
        }
      }
      onEnd();
    } catch (err) {
      if (!controller.signal.aborted) onEnd(err);
    }
  })();
  return () => controller.abort();
}
