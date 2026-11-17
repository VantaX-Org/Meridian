"use client";

/**
 * The "Move to new instance" client: plan the move of every licensed object with its history, check it, load it
 * (dry run first), reconcile and send a cut-over delta. Typed wrappers over /api/v1/migration/move.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import apiClient, { uploadApiClient } from "@/lib/api/client";
import { updateSystem } from "@/lib/api/v2/sys";

const BASE = "/api/v1/migration/move";

export type MoveMode = "cleansed" | "as_is";
export type MoveMethod = "odata_upsert" | "bapi" | "file_load" | "archive_only";
export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface MoveStep { module: string; entity: string; method: MoveMethod; rows: number; history_rows: number; purge_type: string | null; depends_on: string[] }
export interface MoveWave { wave: number; label: string; steps: MoveStep[] }
export interface MoveRef { id: string; name?: string }
export interface MovePlan {
  id: string;
  source: MoveRef | string;
  target: MoveRef | string;
  modules: string[];
  mode: MoveMode;
  waves: MoveWave[];
  unplaced: ({ module?: string; entity?: string; reason?: string } | string)[];
  cleansing?: Cleansing;
}
export interface RuleFixes { rule_id: string; description: string; cells: number }
export interface ReviewItem { entity: string; key: string; field: string; rule_id: string; description: string; value: string }
/** What cleansed mode fixes by itself before loading. Records still failing load with their current value. */
export interface Cleansing {
  cells_fixed_by_rule: RuleFixes[];
  records_still_failing: number;
  dqs_before: number;
  dqs_after: number;
  needs_review: ReviewItem[];
}
export interface MoveIssue { entity: string; field: string | null; records: number; reason: string; severity: Severity }
export interface MoveStepRun { entity: string; sent: number; ok: number; failed: number; error_rate: number }
export interface MoveWaveRun { wave: number; status: string; steps: MoveStepRun[] }
export interface MoveRun { id: string; status: string; dry_run: boolean; waves: MoveWaveRun[]; checkpoint: unknown; started_at: string | null; finished_at: string | null }
export interface ReconEntity { entity: string; source_rows: number; target_rows: number; missing_in_target: number; extra_in_target: number; field_diffs: number; sample: Record<string, unknown>[] }
export interface Reconciliation {
  entities: ReconEntity[];
  dqs: { source: number | null; projected_target: number | null; actual_target: number | null; reasons: ({ label?: string; reason?: string; value?: string | number } | string)[] };
}
export interface CreatePlanBody { source_system_id: string; target_system_id: string; modules: string[]; mode: MoveMode; id_map_upload_id?: string }

export const moveKeys = {
  systems: ["next", "move", "systems"] as const,
  plan: (id: string | null) => ["next", "move", "plan", id] as const,
  run: (id: string | null) => ["next", "move", "run", id] as const,
  recon: (id: string | null) => ["next", "move", "recon", id] as const,
};

/** A run is over when it is in one of these states; polling stops there. */
export const RUN_DONE = ["completed", "failed", "stopped", "cancelled", "partial"];

export const createPlan = (b: CreatePlanBody) => apiClient.post<MovePlan>(`${BASE}/plans`, b).then((r) => r.data);
export const listPlans = () => apiClient.get<MovePlan[]>(`${BASE}/plans`).then((r) => r.data);
export const getPlan = (id: string) => apiClient.get<MovePlan>(`${BASE}/plans/${id}`).then((r) => r.data);
export const runPreflight = (id: string) => apiClient.post<{ issues: MoveIssue[] }>(`${BASE}/plans/${id}/preflight`).then((r) => r.data.issues);
export const startRun = (id: string, dry_run: boolean, waves?: number[]) => apiClient.post<MoveRun>(`${BASE}/plans/${id}/runs`, { dry_run, ...(waves ? { waves } : {}) }).then((r) => r.data);
export const getRun = (id: string) => apiClient.get<MoveRun>(`${BASE}/runs/${id}`).then((r) => r.data);
export const runAction = (id: string, a: "stop" | "resume" | "retry-failed") => apiClient.post<MoveRun>(`${BASE}/runs/${id}/${a}`).then((r) => r.data);
export const startReconcile = (id: string) => apiClient.post<{ id: string }>(`${BASE}/plans/${id}/reconcile`).then((r) => r.data);
export const getReconciliation = (id: string) => apiClient.get<Reconciliation>(`${BASE}/reconciliations/${id}`).then((r) => r.data);
export const startDelta = (id: string, since: string) => apiClient.post<MoveRun>(`${BASE}/plans/${id}/delta`, { since }).then((r) => r.data);

/** The ID map the plan reuses. The contract names the field, not the upload route; this is POST /uploads, multipart. */
export const uploadIdMap = (file: File) => {
  const f = new FormData();
  f.append("file", file);
  return uploadApiClient.post<{ id: string }>(`${BASE}/uploads`, f).then((r) => r.data.id);
};

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

export const usePlan = (id: string | null) => useQuery({ queryKey: moveKeys.plan(id), queryFn: () => getPlan(id as string), enabled: !!id });
/** The run, read every 2 seconds until it is over. */
export const useRun = (id: string | null) =>
  useQuery({ queryKey: moveKeys.run(id), queryFn: () => getRun(id as string), enabled: !!id, refetchInterval: (q) => (q.state.data && RUN_DONE.includes(q.state.data.status) ? false : 2000) });
export const useReconciliation = (id: string | null) => useQuery({ queryKey: moveKeys.recon(id), queryFn: () => getReconciliation(id as string), enabled: !!id });

/** Mark a system as a migration target (role "target") or back to a source. */
export function useSetTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, target }: { id: string; target: boolean }) => updateSystem(id, { role: target ? "target" : "source" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: moveKeys.systems }),
  });
}
