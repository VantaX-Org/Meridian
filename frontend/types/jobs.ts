/** Shape of api/services/jobs.py — one record per long-running task. */

export type JobKind = "extraction" | "config_sync" | "config_load" | "analysis" | "upload" | "simulation" | "process_discovery" | "export";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
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
  /** How the table is read (api/services/connectivity_manager.py): the table reader, ODP or OData. */
  path?: "table_reader" | "odp" | "odata";
  /** The ODP provider, when path is odp. */
  provider?: string;
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
  /** extraction: the target chosen at start and each template's auto-fill status (GET /versions/{id}/extract-target is the durable copy). */
  extract_target?: { target_system_id: string | null; templates: { module: string; template_id: string; template_name?: string | null; status: "pending" | "filled" | "failed"; error?: string | null; download_url?: string | null }[] } | null;
  /** A queued job's place in the tenant's queue (1: next), from GET /jobs and /jobs/{id}. */
  queue_position?: number | null;
}

export interface JobListResponse {
  jobs: Job[];
}
