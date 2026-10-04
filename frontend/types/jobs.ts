/** Shape of api/services/jobs.py — one record per long-running task. */

export type JobKind = "extraction" | "config_sync" | "analysis" | "upload" | "simulation";
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
  /** queued · running · live · failed · not_in_system · … (coverage statuses) */
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
}

export interface JobListResponse {
  jobs: Job[];
}
