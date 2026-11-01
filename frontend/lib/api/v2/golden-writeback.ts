import { v2Get, v2Send } from "./client";
import type { MasterRecordHistoryEntry } from "@/types/api";

/**
 * Golden record audit trail, promotion and write-back to SAP (api/routes/master_records.py,
 * api/routes/golden_writeback.py). A write-back is planned and simulated first, sent for a second person's approval,
 * then written by the worker. Shapes follow api/services/golden_writeback.py.
 */

export type { MasterRecordHistoryEntry };

/** One golden field as a target system would take it. `result` and `current_value` appear once a simulation has run. */
export interface WritebackFieldPlan {
  field: string;
  golden_value: unknown;
  target: string | null;
  supported: boolean;
  reason: string | null;
  result?: "unsupported" | "unchanged" | "would_change" | "written" | "error";
  current_value?: unknown;
  message?: string;
}

export interface WritebackTarget {
  system_id: string;
  system_name: string | null;
  system_type: string;
  supported: boolean;
  method: "rfc_bapi" | "odata_patch" | null;
  bapi?: string;
  reason: string | null;
  fields: WritebackFieldPlan[];
}

/** GET /master-records/{id}/writeback/preview */
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

export interface WritebackRequest {
  id: string;
  master_record_id: string;
  /** simulating, simulated, simulation_failed, pending_approval, approved, applying, applied, failed, rejected, cancelled */
  status: string;
  requested_by: string | null;
  approved_by: string | null;
  rejected_by: string | null;
  targets: WritebackTarget[];
  error: string | null;
  counts: Record<string, number>;
  created_at: string | null;
  simulated_at: string | null;
  decided_at: string | null;
  applied_at: string | null;
}

export interface PromoteResult {
  status: string;
  promoted_at: string;
  related_reviews_queued: number;
}

const base = (id: string): string => `/master-records/${encodeURIComponent(id)}`;

/** GET /master-records/{id}/history: the field-level audit trail, newest first. Needs view. */
export function getGoldenHistory(id: string): Promise<MasterRecordHistoryEntry[]> {
  return v2Get<MasterRecordHistoryEntry[]>(`${base(id)}/history`);
}

/** POST /master-records/{id}/promote: makes the record golden. Needs approve. */
export function promoteGolden(id: string): Promise<PromoteResult> {
  return v2Send<PromoteResult>("POST", `${base(id)}/promote`, {});
}

/** GET .../writeback/preview: target systems and which fields each can take. Never contacts SAP. Needs view. */
export function getWritebackPreview(id: string): Promise<WritebackPreview> {
  return v2Get<WritebackPreview>(`${base(id)}/writeback/preview`);
}

/** GET .../writeback/requests: the record's last ten requests, newest first. Needs view. */
export async function getWritebackRequests(id: string): Promise<WritebackRequest[]> {
  return (await v2Get<{ requests: WritebackRequest[] }>(`${base(id)}/writeback/requests`)).requests;
}

/** POST .../writeback/requests: plans the targets and starts the simulation (202). Needs apply. */
export function createWritebackRequest(id: string): Promise<WritebackRequest> {
  return v2Send<WritebackRequest>("POST", `${base(id)}/writeback/requests`);
}

/** POST .../writeback/requests/{rid}/submit: sends a simulated request for approval. Only its requester, needs apply. */
export function submitWritebackRequest(id: string, requestId: string): Promise<WritebackRequest> {
  return v2Send<WritebackRequest>("POST", `${base(id)}/writeback/requests/${encodeURIComponent(requestId)}/submit`);
}

/** POST .../writeback/approve | reject: the second person's decision on the request waiting. Needs approve. */
export function decideWriteback(id: string, action: "approve" | "reject"): Promise<WritebackRequest> {
  return v2Send<WritebackRequest>("POST", `${base(id)}/writeback/${action}`);
}
