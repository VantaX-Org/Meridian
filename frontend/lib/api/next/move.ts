"use client";

/**
 * The "Move to new instance" client: plan the move of every licensed object with its full history, check it, load it
 * (dry run first), reconcile and send a cut-over delta. Typed wrappers over /api/v1/migration/move.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import apiClient, { uploadApiClient } from "@/lib/api/client";

const BASE = "/api/v1/migration/move";

export type MoveMode = "cleansed" | "as_is";
export type MoveMethod = "upsert" | "config_create" | "bapi" | "file_load" | "archive_only";
export type Severity = "error" | "warning";

export interface MoveStep { module: string; entity: string; method: MoveMethod; rows: number; history_rows: number; purge_type: string | null; depends_on: string[] }
export interface MoveWave { wave: number; label: string; steps: MoveStep[] }
export interface ConfigListCounts { present: number; create: number; conflict: number }
export interface MoveIssue { entity: string | null; field: string | null; records: string[]; severity: Severity; reason: string }
export interface DqsOverall { before: number; after: number; delta: number; capped_before?: boolean; capped_after?: boolean }
/** What cleansed mode fixes by itself before loading. Records still failing load with their current value. */
export interface CleansingSummary {
  cells_fixed_per_rule: Record<string, number>;
  records_still_failing: number;
  dqs?: { overall?: DqsOverall; modules?: { module: string; before: number; after: number; delta: number }[] };
}
export interface Unfixable { rule: string; field: string; record_key: string; current_value: string | null; reason: string }
export interface RunCleansing { summary?: CleansingSummary; unfixable?: Unfixable[]; passes?: number }
export type PlanStatus = "building" | "ready" | "failed";
export interface MovePlan {
  id: string;
  source: string;
  target: string;
  modules: string[];
  mode: MoveMode;
  waves: MoveWave[];
  unplaced: ({ module?: string; entity?: string; reason?: string } | string)[];
  status: PlanStatus;
  reason?: string;
  config?: Record<string, ConfigListCounts>;
  cleansing?: CleansingSummary;
  preflight?: { status: string | null; issues: MoveIssue[] };
}
export interface MoveStepRun { entity: string; sent: number; ok: number; failed: number; error_rate: number }
export interface MoveWaveRun { wave: number; status: string; steps: MoveStepRun[] }
export interface MoveRun {
  id: string;
  plan_id?: string;
  kind?: "load" | "delta";
  status: string;
  reason?: string | null;
  dry_run: boolean;
  waves: MoveWaveRun[];
  progress?: MoveStepRun[];
  checkpoint: unknown;
  started_at: string | null;
  finished_at: string | null;
  cleansing?: RunCleansing | null;
}
export interface ReconEntity {
  entity: string;
  source_rows: number;
  target_rows: number;
  missing_in_target: string[];
  extra_in_target: string[];
  field_diffs: Record<string, number>;
  sample: { key: string; field: string; source: unknown; target: unknown }[];
}
export interface Reconciliation {
  id?: string;
  status: string;
  entities: ReconEntity[];
  dqs: { source: number | null; projected_target: number | null; actual_target: number | null; reasons: string[] } | null;
  reason?: string | null;
}
export interface PreflightStart { issues: MoveIssue[]; status: string; previous?: string | null }
/** Pilot: person data for ``per_cell`` users per (country, Paterson band, status) cell plus their managers. Server defaults the rest. */
export interface SampleBody { per_cell?: number; closure_cap?: number; active_status?: string[] }
export interface CreatePlanBody {
  source_system_id: string;
  target_system_id: string;
  modules: string[];
  mode: MoveMode;
  /** Omitted: full move. */
  sample?: SampleBody;
  /** Countries whose person records never load. Server default ["ZMB"]. */
  exclude_countries?: string[];
}

export const moveKeys = {
  systems: ["next", "move", "systems"] as const,
  plan: (id: string | null) => ["next", "move", "plan", id] as const,
  run: (id: string | null) => ["next", "move", "run", id] as const,
  recon: (id: string | null) => ["next", "move", "recon", id] as const,
};

/** A run is over when it is in one of these states; polling stops there. "stopping" keeps polling. */
export const RUN_DONE = ["completed", "failed", "stopped", "cancelled", "partial"];
const RECON_DONE = ["completed", "failed"];

/** A move never loses history: the plan always reads a full-history download of the source. */
export const createPlan = (b: CreatePlanBody) => apiClient.post<MovePlan>(`${BASE}/plans`, { ...b, history: "full" }).then((r) => r.data);
export const listPlans = () => apiClient.get<MovePlan[]>(`${BASE}/plans`).then((r) => r.data);
export const getPlan = (id: string) => apiClient.get<MovePlan>(`${BASE}/plans/${id}`).then((r) => r.data);
export const runPreflight = (id: string) => apiClient.post<PreflightStart>(`${BASE}/plans/${id}/preflight`).then((r) => r.data);
export const startRun = (id: string, dry_run: boolean, waves?: number[]) => apiClient.post<MoveRun>(`${BASE}/plans/${id}/runs`, { dry_run, ...(waves ? { waves } : {}) }).then((r) => r.data);
export const getRun = (id: string) => apiClient.get<MoveRun>(`${BASE}/runs/${id}`).then((r) => r.data);
export const runAction = (id: string, a: "stop" | "resume" | "retry-failed") => apiClient.post<MoveRun>(`${BASE}/runs/${id}/${a}`).then((r) => r.data);
export const startReconcile = (id: string) => apiClient.post<{ id: string }>(`${BASE}/plans/${id}/reconcile`).then((r) => r.data);
export const getReconciliation = (id: string) => apiClient.get<Reconciliation>(`${BASE}/reconciliations/${id}`).then((r) => r.data);
export const startDelta = (id: string, since: string, dry_run: boolean) => apiClient.post<MoveRun>(`${BASE}/plans/${id}/delta`, { since, dry_run }).then((r) => r.data);

/** The server's own words for a refused call (422 same system, 409 safety check), else null. */
export function apiDetail(e: unknown): string | null {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof d === "string" && d ? d : null;
}

async function saveCsv(url: string, params: Record<string, string>, name: string) {
  const { data } = await uploadApiClient.get<Blob | string>(url, { params: { format: "csv", ...params }, responseType: "blob" });
  const href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

/** The failed rows as a CSV, saved through the browser. */
export const downloadErrors = (runId: string, entity?: string) =>
  saveCsv(`${BASE}/runs/${runId}/errors`, entity ? { entity } : {}, `move-errors-${runId}${entity ? `-${entity}` : ""}.csv`);

/** Every value the cleansing changed, as a CSV. */
export const downloadCleansingLog = (runId: string) => saveCsv(`${BASE}/runs/${runId}/cleansing-log`, {}, `move-cleansing-log-${runId}.csv`);

/** The plan, read every 2 seconds while it is being built or its pre-flight check is queued. */
export const usePlan = (id: string | null) =>
  useQuery({
    queryKey: moveKeys.plan(id),
    queryFn: () => getPlan(id as string),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && (q.state.data.status === "building" || q.state.data.preflight?.status === "queued") ? 2000 : false),
  });
/** The run, read every 2 seconds until it is over. */
export const useRun = (id: string | null) =>
  useQuery({ queryKey: moveKeys.run(id), queryFn: () => getRun(id as string), enabled: !!id, refetchInterval: (q) => (q.state.data && RUN_DONE.includes(q.state.data.status) ? false : 2000) });
/** The reconciliation, read every 2 seconds until it has completed or failed. */
export const useReconciliation = (id: string | null) =>
  useQuery({ queryKey: moveKeys.recon(id), queryFn: () => getReconciliation(id as string), enabled: !!id, refetchInterval: (q) => (q.state.data && RECON_DONE.includes(q.state.data.status) ? false : 2000) });

/** Mark a system as a migration target, or clear the mark. */
export function useSetTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, target }: { id: string; target: boolean }) =>
      apiClient.patch<{ id: string; migration_target: boolean }>(`/api/v1/systems/${id}/migration-target`, { enabled: target }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: moveKeys.systems }),
  });
}
