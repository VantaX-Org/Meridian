import apiClient from "./client";

/** Days are null when that class of data is kept for ever (api/services/retention.py). */
export interface RetentionPolicy {
  versions_days: number | null;
  reports_days: number | null;
  audit_days: number | null;
  keep_baseline: boolean;
  keep_latest_per_system: number;
}

/** Whether the nightly task deletes for real: the env flag plus a week of nightly dry runs
 *  under the current policy (the window restarts when the policy is saved). */
export interface RetentionEnforcement {
  flag_enabled: boolean;
  dry_run_until: string | null;
  enforced: boolean;
}

export interface RetentionResponse {
  policy: RetentionPolicy;
  enforcement: RetentionEnforcement;
}

/** Rows a purge removes per table; "<table> (unlinked)" counts tenant assets whose pointer was cleared. */
export type RowsByTable = Record<string, number | string[]>;

export interface RetentionPreviewItem {
  version_id: string;
  label: string | null;
  run_at: string | null;
  system_id: string;
  blocked_reason: string | null;
  rows_by_table: RowsByTable;
  bytes_freed: number;
}

export type PurgeKind = "version" | "reports" | "audit" | "tenant";

export interface PurgeLogEntry {
  id: string;
  kind: PurgeKind;
  target_id: string | null;
  dry_run: boolean;
  rows_by_table: RowsByTable;
  bytes_freed: number;
  blocked_reason: string | null;
  actor_email: string | null;
  created_at: string;
}

export interface PurgeResult {
  version_id: string;
  rows_by_table: RowsByTable;
  bytes_freed: number;
  blocked_reason: string | null;
  storage_errors: string[];
  purge_log_id: string | null;
}

export async function getRetention(): Promise<RetentionResponse> {
  const { data } = await apiClient.get<RetentionResponse>("/api/v1/settings/retention");
  return data;
}

export async function updateRetention(policy: RetentionPolicy): Promise<RetentionResponse> {
  const { data } = await apiClient.put<RetentionResponse>("/api/v1/settings/retention", policy);
  return data;
}

/** What the policy would purge now, as a dry run (nothing is deleted). */
export async function getRetentionPreview(): Promise<RetentionPreviewItem[]> {
  const { data } = await apiClient.get<{ items: RetentionPreviewItem[] }>("/api/v1/settings/retention/preview");
  return data.items;
}

export async function getPurgeLog(limit = 50): Promise<PurgeLogEntry[]> {
  const { data } = await apiClient.get<{ items: PurgeLogEntry[] }>("/api/v1/settings/purge-log", { params: { limit } });
  return data.items;
}

/** Purge one archived run for good. `confirm` must equal the run's label, or its id when it has none. */
export async function deleteVersion(id: string, confirm: string): Promise<PurgeResult> {
  const { data } = await apiClient.delete<PurgeResult>(`/api/v1/versions/${id}`, { data: { confirm } });
  return data;
}

/** The blocked reason a 409 from `deleteVersion` carries, else null. */
export function blockedReasonOf(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const resp = (error as { response?: { status?: number; data?: { detail?: unknown } } }).response;
  if (resp?.status !== 409) return null;
  const detail = resp.data?.detail;
  if (detail && typeof detail === "object" && typeof (detail as { blocked_reason?: unknown }).blocked_reason === "string") {
    return (detail as { blocked_reason: string }).blocked_reason;
  }
  return null;
}
