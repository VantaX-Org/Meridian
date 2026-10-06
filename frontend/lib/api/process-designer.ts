import apiClient from "./client";
import type {
  ModelOverlay, ModelSummary, ModelVersionRow, ProcessModelDocument, ProcessVariant, ValidationError,
} from "@/types/process-model";

const BASE = "/api/v1/process-designer";

export interface ModelRecord extends ModelSummary { created_by?: string | null; created_at?: string | null }
export interface ModelWithDocument { model: ModelRecord; version_no: number; document: ProcessModelDocument }
export interface SaveResult { model: ModelRecord; version_no: number; warnings: string[] }

export async function getReference(): Promise<ProcessModelDocument> {
  return (await apiClient.get<ProcessModelDocument>(`${BASE}/reference`)).data;
}
export async function listModels(): Promise<ModelSummary[]> {
  return (await apiClient.get<ModelSummary[]>(`${BASE}/models`)).data;
}
export async function createModel(name: string, from: string): Promise<{ model: ModelRecord; version_no: number }> {
  return (await apiClient.post(`${BASE}/models`, { name, from })).data;
}
export async function getModel(id: string, version?: number): Promise<ModelWithDocument> {
  return (await apiClient.get<ModelWithDocument>(`${BASE}/models/${id}`, { params: version ? { version } : undefined })).data;
}
export async function saveModel(id: string, body: { document: ProcessModelDocument; note: string; base_version: number }): Promise<SaveResult> {
  return (await apiClient.put<SaveResult>(`${BASE}/models/${id}`, body)).data;
}
export async function patchModel(id: string, body: { name?: string; status?: string }): Promise<ModelRecord> {
  return (await apiClient.patch<ModelRecord>(`${BASE}/models/${id}`, body)).data;
}
export async function deleteModel(id: string): Promise<void> {
  await apiClient.delete(`${BASE}/models/${id}`);
}
export async function listModelVersions(id: string): Promise<ModelVersionRow[]> {
  return (await apiClient.get<ModelVersionRow[]>(`${BASE}/models/${id}/versions`)).data;
}
export async function getOverlay(id: string, versionId: string): Promise<ModelOverlay> {
  return (await apiClient.get<ModelOverlay>(`${BASE}/models/${id}/overlay/${versionId}`)).data;
}
export async function listVariants(versionId: string, processId?: string): Promise<ProcessVariant[]> {
  return (await apiClient.get<ProcessVariant[]>(`${BASE}/variants/${versionId}`, { params: processId ? { process_id: processId } : undefined })).data;
}
export async function adoptVariant(id: string, body: { variant_id: string; l4_id: string }): Promise<{ model: ModelRecord; version_no: number }> {
  return (await apiClient.post(`${BASE}/models/${id}/adopt-variant`, body)).data;
}

/** Signavio zip export (spec 4.1). `overlay` is a dataset version id, or omitted for none. */
export function signavioExportUrl(modelId: string, versionNo?: number, overlay?: string): string {
  const q = new URLSearchParams();
  if (versionNo) q.set("version", String(versionNo));
  q.set("overlay", overlay ?? "none");
  return modelId === "reference"
    ? `${BASE}/reference/export/signavio`
    : `${BASE}/models/${modelId}/export/signavio?${q.toString()}`;
}

/** What a failed save says: a stale base (409), a rejected document (422), or anything else. */
export type SaveFailure =
  | { kind: "stale"; message: string; current: number | null }
  | { kind: "invalid"; errors: ValidationError[] }
  | { kind: "other"; message: string };

export function saveFailure(err: unknown): SaveFailure {
  const r = (err as { response?: { status?: number; data?: { detail?: unknown } } }).response;
  const d = r?.data?.detail;
  if (r?.status === 409 && d && typeof d === "object") {
    const o = d as { message?: string; current_version?: number };
    return { kind: "stale", message: o.message ?? "", current: o.current_version ?? null };
  }
  if (r?.status === 422) {
    const raw = (r.data as { errors?: ValidationError[]; detail?: unknown } | undefined);
    if (raw?.errors?.length) return { kind: "invalid", errors: raw.errors };
    if (Array.isArray(d)) return { kind: "invalid", errors: (d as Array<{ loc?: unknown[]; msg?: string }>).map((e) => ({ path: (e.loc ?? []).join("."), message: e.msg ?? "" })) };
    if (typeof d === "string") return { kind: "invalid", errors: [{ path: "", message: d }] };
  }
  return { kind: "other", message: typeof d === "string" ? d : (err as Error).message };
}
