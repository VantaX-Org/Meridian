import apiClient from "./client";

/** Per-field outcome: planned (no result yet), then the simulation's and the write's (api/services/golden_writeback.py). */
export type WritebackFieldResult = "unsupported" | "unchanged" | "would_change" | "written" | "error";

export interface WritebackField {
  field: string;
  golden_value: unknown;
  /** The BAPI or OData property the field is written through; null when unsupported. */
  target: string | null;
  supported: boolean;
  reason: string | null;
  current_value?: unknown;
  result?: WritebackFieldResult;
  message?: string | null;
}

export interface WritebackTarget {
  system_id: string;
  system_name: string;
  system_type: string;
  supported: boolean;
  method: "odata_patch" | "rfc_bapi" | null;
  reason: string | null;
  fields: WritebackField[];
}

export interface WritebackPreview {
  record_id: string;
  domain: string;
  sap_object_key: string;
  golden_fields: Record<string, unknown>;
  writeback_supported: boolean;
  live_enabled: boolean;
  message: string;
  targets: WritebackTarget[];
  unresolved_sources: string[];
}

export type WritebackStatus =
  | "simulating" | "simulated" | "simulation_failed" | "pending_approval" | "approved" | "applying"
  | "applied" | "applied_with_errors" | "failed" | "rejected" | "cancelled";

export interface WritebackRequest {
  id: string;
  master_record_id: string;
  status: WritebackStatus;
  requested_by: string;
  approved_by: string | null;
  rejected_by: string | null;
  targets: WritebackTarget[];
  error: string | null;
  counts: Partial<Record<WritebackFieldResult | "supported", number>>;
  created_at: string | null;
  simulated_at: string | null;
  decided_at: string | null;
  applied_at: string | null;
}

const base = (id: string) => `/api/v1/master-records/${encodeURIComponent(id)}/writeback`;

/** Target systems (the record's source systems) and which fields each can take. Never contacts SAP. */
export async function getWritebackPreview(id: string): Promise<WritebackPreview> {
  return (await apiClient.get<WritebackPreview>(`${base(id)}/preview`)).data;
}

/** This record's write-back requests, newest first. */
export async function getWritebackRequests(id: string): Promise<{ requests: WritebackRequest[] }> {
  return (await apiClient.get<{ requests: WritebackRequest[] }>(`${base(id)}/requests`)).data;
}

/** Start a write-back: the worker simulates it (reads SAP, diffs) before anything can be approved. */
export async function requestWriteback(id: string): Promise<WritebackRequest> {
  return (await apiClient.post<WritebackRequest>(`${base(id)}/requests`)).data;
}

/** Send a simulated write-back to the inbox for a second person to approve. */
export async function submitWriteback(id: string, requestId: string): Promise<WritebackRequest> {
  return (await apiClient.post<WritebackRequest>(`${base(id)}/requests/${encodeURIComponent(requestId)}/submit`)).data;
}
