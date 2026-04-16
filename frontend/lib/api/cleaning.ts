import type { AxiosResponse } from "axios";
import apiClient from "./client";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CleaningQueueItem {
  id: string;
  object_type: string;
  status: string;
  confidence: number;
  record_key: string;
  priority: number;
  detected_at: string;
  applied_at: string | null;
  rollback_deadline: string | null;
  rule_id: string | null;
  batch_id: string | null;
  version_id: string | null;
  merge_preview: Record<string, { a: string; b: string; survivor: string }> | null;
  record_data_before: Record<string, unknown> | null;
  record_data_after: Record<string, unknown> | null;
  golden_record_id: string | null;
  golden_field_value: string | null;
  golden_record_exists: boolean;
  audit?: AuditEntry[];
}

export interface AuditEntry {
  id: string;
  action: string;
  actor_name: string;
  record_key: string;
  data_before: Record<string, unknown> | null;
  data_after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface DedupCandidate {
  id: string;
  object_type: string;
  record_key_a: string;
  record_key_b: string;
  match_score: number;
  match_method: string;
  match_fields: Record<string, unknown> | null;
  status: string;
  survivor_key: string | null;
  merged_at: string | null;
  created_at: string;
}

export interface CleaningMetrics {
  metrics: Array<Record<string, unknown>>;
  totals: {
    detected: number;
    recommended: number;
    approved: number;
    rejected: number;
    applied: number;
    verified: number;
    rolled_back: number;
    auto_approved: number;
  };
}

// ── Cleaning Queue ───────────────────────────────────────────────────────────

export async function getCleaningQueue(params: {
  object_type?: string;
  status?: string;
  page?: number;
  per_page?: number;
}): Promise<{ items: CleaningQueueItem[]; total: number; page: number; per_page: number }> {
  const { data } = await apiClient.get("/api/v1/cleaning/queue", { params });
  return data;
}

export async function getCleaningItem(id: string): Promise<CleaningQueueItem> {
  const { data } = await apiClient.get(`/api/v1/cleaning/queue/${id}`);
  return data;
}

export async function approveCleaning(id: string, notes?: string): Promise<{ id: string; status: string }> {
  const { data } = await apiClient.post(`/api/v1/cleaning/approve/${id}`, { notes });
  return data;
}

export async function rejectCleaning(id: string, reason: string): Promise<{ id: string; status: string }> {
  const { data } = await apiClient.post(`/api/v1/cleaning/reject/${id}`, { reason });
  return data;
}

export async function bulkApprove(params: {
  rule_id?: string;
  severity?: string;
  max_count?: number;
}): Promise<{ approved_count: number; skipped_count: number }> {
  const { data } = await apiClient.post("/api/v1/cleaning/bulk-approve", params);
  return data;
}

export async function applyCleaning(id: string, override_data?: Record<string, unknown>): Promise<{ id: string; status: string; rollback_deadline: string }> {
  const { data } = await apiClient.post(`/api/v1/cleaning/apply/${id}`, { override_data });
  return data;
}

export async function rollbackCleaning(id: string): Promise<{ id: string; status: string }> {
  const { data } = await apiClient.post(`/api/v1/cleaning/rollback/${id}`);
  return data;
}

export async function getCleaningMetrics(period_type?: string): Promise<CleaningMetrics> {
  const { data } = await apiClient.get("/api/v1/cleaning/metrics", { params: { period_type } });
  return data;
}

export async function getCleaningAudit(params: {
  queue_id?: string;
  action?: string;
  page?: number;
  per_page?: number;
}): Promise<{ items: AuditEntry[]; total: number }> {
  const { data } = await apiClient.get("/api/v1/cleaning/audit", { params });
  return data;
}

// ── Dedup ────────────────────────────────────────────────────────────────────

export async function getDedupCandidates(params: {
  object_type: string;
  min_score?: number;
  status?: string;
}): Promise<{ items: DedupCandidate[]; total: number }> {
  const { data } = await apiClient.get(`/api/v1/dedup/candidates/${params.object_type}`, {
    params: { min_score: params.min_score, status: params.status },
  });
  return data;
}

export async function getDedupPreview(params: {
  record_key_a: string;
  record_key_b: string;
  object_type: string;
}): Promise<{ merge_preview: Record<string, { a: string; b: string; survivor: string }> }> {
  const { data } = await apiClient.post("/api/v1/dedup/preview", params);
  return data;
}

export async function mergeDedupCandidate(params: {
  candidate_id: string;
  survivor_key: string;
  field_overrides?: Record<string, unknown>;
}): Promise<{ id: string; status: string; survivor_key: string; merged_at: string }> {
  const { data } = await apiClient.post("/api/v1/dedup/merge", params);
  return data;
}

// ── Export ───────────────────────────────────────────────────────────────────

export type ExportFormat = "csv" | "lsmw" | "bapi" | "idoc" | "sf_csv" | "xlsx";

export interface CleaningExportOption {
  value: string;
  count: number;
}

export interface CleaningExportOptions {
  object_types: CleaningExportOption[];
  statuses: CleaningExportOption[];
}

/** Fetch the distinct object_types and statuses actually present in the
 * tenant's cleaning queue, so the export modal can build its dropdowns
 * from real data instead of a hardcoded list. */
export async function getCleaningExportOptions(): Promise<CleaningExportOptions> {
  const { data } = await apiClient.get<CleaningExportOptions>(
    "/api/v1/cleaning/export-options",
  );
  return data;
}

function defaultExtensionFor(format: ExportFormat): string {
  switch (format) {
    case "xlsx":
      return "xlsx";
    case "bapi":
    case "idoc":
      return "json";
    case "lsmw":
      return "txt";
    case "csv":
    case "sf_csv":
      return "csv";
  }
}

async function readBlobErrorDetail(blob: Blob): Promise<string | null> {
  // Error responses come back as a Blob because the axios request uses
  // responseType: "blob". Read the body and try to surface the JSON detail
  // so the caller can show a meaningful error toast instead of a generic
  // "Export failed" message.
  try {
    const text = await blob.text();
    const parsed = JSON.parse(text) as { detail?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
  } catch {
    // Not JSON — fall through.
  }
  return null;
}

export async function downloadCleaningExport(
  format: ExportFormat,
  status: string,
  objectType?: string,
): Promise<void> {
  if (!status) {
    throw new Error("status is required for cleaning export");
  }

  const params = new URLSearchParams({ status });
  if (objectType) params.set("object_type", objectType);

  let response: AxiosResponse<Blob>;
  try {
    response = await apiClient.get<Blob>(
      `/api/v1/cleaning/export/${format}?${params.toString()}`,
      { responseType: "blob" },
    );
  } catch (err: unknown) {
    // Axios wraps the error body (a Blob here) in err.response.data.
    const errResponse = (err as { response?: { data?: unknown } }).response;
    if (errResponse?.data instanceof Blob) {
      const detail = await readBlobErrorDetail(errResponse.data);
      if (detail) throw new Error(detail);
    }
    throw err;
  }

  const disposition = response.headers["content-disposition"] ?? "";
  const filenameMatch = disposition.match(/filename=(.+)/);
  const filename =
    filenameMatch?.[1] ??
    `cleaning_export_${status}_${objectType ?? "all"}.${defaultExtensionFor(format)}`;

  const url = window.URL.createObjectURL(new Blob([response.data]));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
