import apiClient from "./client";
import { downloadBlob } from "./download";

export interface AuditEntry {
  id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  method: string;
  path: string;
  status_code: number;
  ip: string | null;
  user_agent: string | null;
  before_json: unknown;
  after_json: unknown;
  created_at: string;
}

export interface AuditListResponse {
  entries: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditListParams {
  actor_user_id?: string;
  entity_type?: string;
  entity_id?: string;
  action?: string;
  method?: string;
  since?: string;
  until?: string;
  /** Substring of the request path, for entities with no UUID/numeric id. */
  path_contains?: string;
  limit?: number;
  offset?: number;
}

export async function getAuditEntries(
  params?: AuditListParams,
): Promise<AuditListResponse> {
  const { data } = await apiClient.get<AuditListResponse>("/api/v1/audit", {
    params,
  });
  return data;
}

export interface AuditSummaryRow {
  action: string;
  entity_type: string | null;
  count: number;
}

export async function getAuditSummary(): Promise<{
  summary: AuditSummaryRow[];
  /** Every event recorded in the window, exact even when `summary` is capped. */
  total?: number;
}> {
  const { data } = await apiClient.get("/api/v1/audit/summary");
  return data;
}

/** GET /api/v1/audit/export — same filters as getAuditEntries, CSV or XLSX. */
export function exportAuditEntries(format: "csv" | "xlsx", params?: AuditListParams): Promise<void> {
  return downloadBlob("/api/v1/audit/export", { format, ...params }, `audit_log.${format}`);
}

/* ─── AI audit (GET /audit/llm) ─── */

export interface LlmAuditEntry {
  id: string;
  service_name: string;
  called_at: string;
  model_version: string | null;
  prompt_hash: string | null;
  token_count: number | null;
  latency_ms: number | null;
  success: boolean;
  deterministic_hit: boolean;
  skip_reason: string | null;
}

export interface LlmAuditResponse {
  entries: LlmAuditEntry[];
  total: number;
  limit: number;
  offset: number;
  cache: { service_name: string; decisions: number; deterministic: number }[];
}

export async function getLlmAudit(params?: { limit?: number; offset?: number }): Promise<LlmAuditResponse> {
  return (await apiClient.get<LlmAuditResponse>("/api/v1/audit/llm", { params })).data;
}
