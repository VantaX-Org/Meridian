/**
 * Process discovery client: the as-is flows mined from a system's event tables, per L1 process.
 *
 * Endpoints (api/routes/process_discovery.py, prefix /process-discovery):
 *   GET    /systems/{id}/catalogue                  (every L1: the latest completed run, a run in progress or failed, DQ defects)
 *   POST   /systems/{id}/runs                        (start runs for some L1s; needs run_process_discovery)
 *   GET    /systems/{id}/runs?l1=&limit=             (run history, newest first)
 *   GET    /systems/{id}/health                      (per L1: fitness drift since the run before, schedule, freshness)
 *   GET    /systems/{id}/schedules, POST, PATCH /{sid}, DELETE /{sid}   (needs run_process_discovery to change)
 *   GET    /runs/{run_id}                            (one run)
 *   GET    /runs/{run_id}/dfg?node_id=               (the children of a node, L2 to L5, and the as-is edges between them)
 *   GET    /runs/{run_id}/variants                   (the case paths, most frequent first)
 *   GET    /runs/{run_id}/conformance                (fitness against the reference, step by step)
 *   GET    /runs/{run_id}/cases, /cases/{case_id}    (the cases and one case's events)
 *   GET    /runs/{run_id}/export/signavio, /export/bpmn/{node_id}   (files; need export_process)
 */
import { v2Get, v2Send } from "./client";
import { v2Download } from "./download";

const base = "/process-discovery";
const sys = (id: string) => `${base}/systems/${encodeURIComponent(id)}`;
const run = (id: string) => `${base}/runs/${encodeURIComponent(id)}`;

export type RunStatus = "queued" | "waiting" | "extracting" | "building" | "mining" | "completed" | "failed";
export type Freshness = "fresh" | "due" | "stale" | "failed" | "paused" | "manual";

export interface RunRef {
  id: string;
  status: RunStatus;
  job_id: string | null;
  error: string | null;
}

export interface CatalogueEntry {
  l1: string;
  name: string;
  coverage: string;
  /** Why this system cannot mine the L1; null when it can. */
  reason: string | null;
  last_run: {
    id: string;
    status: RunStatus;
    finished_at: string | null;
    cases: number | null;
    variants: number | null;
    median_seconds: number | null;
    automation_rate: number | null;
    fitness: number | null;
  } | null;
  in_progress: RunRef | null;
  failed: RunRef | null;
  dq_defects: number | null;
  dq_version_id: string | null;
  licence_blocked: boolean;
  sources: { table: string; rows: number | null; partial: boolean }[];
}

export interface RunSummary {
  id: string;
  l1: string;
  mode: "full" | "incremental";
  status: RunStatus;
  coverage: string;
  window_from: string | null;
  window_to: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface L1Health {
  l1: string;
  last_run: { id: string; status: string; finished_at: string | null; fitness: number | null } | null;
  previous_fitness: number | null;
  fitness_drift: number | null;
  schedule: { id: string; cron: string; active: boolean; next_run_at: string | null } | null;
  freshness: Freshness;
}

export interface Schedule {
  id: string;
  system_id: string;
  l1: string;
  mode: "full" | "incremental";
  created_at: string | null;
  schedule_cron: string;
  active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
}

export interface NodeStats {
  id: string;
  name: string;
  source: string;
  observed: boolean;
  case_count: number;
  share: number;
  median_seconds: number | null;
  fitness: number | null;
  dq_defects: number | null;
}

export interface Dfg {
  level: number;
  node: NodeStats;
  nodes: NodeStats[];
  edges: { source: string; target: string; count: number; median_seconds: number | null }[];
}

export interface Variant {
  hash: string;
  activities: string[];
  case_count: number;
  share: number;
  median_seconds: number | null;
  p90_seconds: number | null;
  fitness: number | null;
}

export interface Conformance {
  case_type: string;
  fitness: number | null;
  missing: Record<string, number>;
  steps: { activity: string; step_fitness: number; out_of_order: number }[];
  extra: { activity: string; cases: number; share: number }[];
  happy_path: { activities: string[]; case_count: number; share: number; fitness: number | null } | null;
}

export interface CaseRow {
  case_id: string;
  first_ts: string | null;
  last_ts: string | null;
  events: number;
  variant: string | null;
}

export interface CaseEvent {
  activity: string;
  ts: string | null;
  seq: number;
  resource: string | null;
  automated: boolean | null;
  doc_type: string | null;
  source_table: string | null;
}

export const getCatalogue = (systemId: string) => v2Get<CatalogueEntry[]>(`${sys(systemId)}/catalogue`);
export const getDiscoveryHealth = (systemId: string) => v2Get<L1Health[]>(`${sys(systemId)}/health`);
export const getDiscoveryRuns = (systemId: string, l1?: string) => v2Get<RunSummary[]>(`${sys(systemId)}/runs`, { l1, limit: 20 });
export const startDiscovery = (systemId: string, l1s: string[], mode: "full" | "incremental") =>
  v2Send<{ job_id: string; run_ids: string[] }>("POST", `${sys(systemId)}/runs`, { l1s, mode });

export const getSchedules = (systemId: string) => v2Get<Schedule[]>(`${sys(systemId)}/schedules`);
export const addSchedule = (systemId: string, l1: string, schedule_cron: string) =>
  v2Send<Schedule>("POST", `${sys(systemId)}/schedules`, { l1, schedule_cron, active: true });
export const patchSchedule = (systemId: string, id: string, body: { schedule_cron?: string; active?: boolean }) =>
  v2Send<Schedule>("PATCH", `${sys(systemId)}/schedules/${encodeURIComponent(id)}`, body);
export const deleteSchedule = (systemId: string, id: string) => v2Send<void>("DELETE", `${sys(systemId)}/schedules/${encodeURIComponent(id)}`);

export const getDfg = (runId: string, nodeId: string | null) => v2Get<Dfg>(`${run(runId)}/dfg`, { node_id: nodeId ?? undefined });
export const getVariants = (runId: string) => v2Get<{ case_type: string; total: number; items: Variant[] }>(`${run(runId)}/variants`, { limit: 25 });
export const getConformance = (runId: string) => v2Get<Conformance>(`${run(runId)}/conformance`);
export const getCases = (runId: string, variant?: string) => v2Get<{ case_type: string; total: number; items: CaseRow[] }>(`${run(runId)}/cases`, { variant, limit: 50 });
export const getCase = (runId: string, caseId: string) => v2Get<{ case_type: string; case_id: string; events: CaseEvent[] }>(`${run(runId)}/cases/${encodeURIComponent(caseId)}`);

export const exportSignavio = (runId: string) => v2Download(`${run(runId)}/export/signavio`, undefined, `process-${runId}.json`);
export const exportBpmn = (runId: string, nodeId: string) => v2Download(`${run(runId)}/export/bpmn/${encodeURIComponent(nodeId)}`, undefined, `process-${nodeId}.bpmn`);
