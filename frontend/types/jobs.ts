/** Shape of api/services/jobs.py — one record per long-running task. */

export type JobKind = "extraction" | "config_sync" | "config_load" | "analysis" | "upload" | "simulation" | "process_discovery";
export type JobStatus = "queued" | "running" | "completed" | "failed";
export type JobStageStatus = "queued" | "running" | "done" | "failed" | "skipped";

export interface JobStage {
  id: string;
  label: string;
  status: JobStageStatus;
}

/** Extraction: one row per SAP table in the read plan. */
export interface JobTable {
  table: string;
  /** queued, running, live, failed, not_in_system and others (coverage statuses) */
  status: string;
  rows: number;
  /** SAP's own row count when known, else null. */
  expected: number | null;
}

export interface Job {
  id: string;
  kind: JobKind;
  status: JobStatus;
  label: string;
  stage: string | null;
  stages: JobStage[];
  percent: number;
  rows_done: number;
  rows_total: number;
  message: string;
  tables: JobTable[];
  error: string | null;
  result: Record<string, unknown> | null;
  /** Unix seconds. */
  started_at: number;
  updated_at: number;
  finished_at: number | null;
  system_id?: string;
  version_id?: string;
  modules?: string[];
  /** Entity-prefix list this job changed, e.g. ["object", "rule", "run"]. Absent means unknown — do not invalidate. */
  touches?: string[];
  /** process_discovery: the queued process_discovery_runs ids this job drives. */
  run_ids?: string[];
  /** extraction: the start request its route recorded; present means POST /jobs/{id}/retry can run it again. */
  retry?: { via: string; body: Record<string, unknown> };
}

export interface JobListResponse {
  jobs: Job[];
}
