import apiClient from "./client";
import { downloadBlob } from "./download";
import type { IssueFilter } from "./issues";

/** Remediation batches: Meridian builds correction files for a person to
 * load into SAP. Nothing here writes to SAP. */

export type BatchStatus = "draft" | "approved" | "exported";
export type ExportFormat = "cockpit_xlsx" | "cockpit_csv" | "mass_change_csv";
export type BatchFilter = IssueFilter & { issue_ids?: string[] };

export interface RemediationBatch {
  id: string;
  name: string;
  status: BatchStatus;
  filter: BatchFilter;
  created_by: string;
  created_by_label: string | null;
  created_at: string;
  approved_by: string | null;
  approved_by_label: string | null;
  approved_at: string | null;
  exported_at: string | null;
}

export interface BatchSummary extends RemediationBatch {
  items: number;
  with_proposal: number;
  fixed: number;
  still_failing: number;
}

export interface BatchItem {
  id: string;
  issue_id: string;
  scope: string;
  module: string;
  check_id: string;
  record_key: string;
  grain: string | null;
  field: string | null;
  current_value: string | null;
  proposed_value: string | null;
  proposal_source: "rule" | "steward" | "manual" | null;
  recon_status: "fixed" | "still_failing" | null;
  recon_version: string | null;
  updated_at: string;
}

export interface BatchEvent {
  item_id: string | null;
  action: "created" | "proposed" | "approved" | "exported" | "reconciled";
  from_value: string | null;
  to_value: string | null;
  user_label: string | null;
  version_id: string | null;
  created_at: string;
}

const BASE = "/api/v1/remediation";
const is404 = (e: unknown) => (e as { response?: { status?: number } }).response?.status === 404;

/** `available: false` when this server has no remediation API yet. */
export async function listBatches(): Promise<{ items: BatchSummary[]; available: boolean }> {
  try {
    const { data } = await apiClient.get<{ items: BatchSummary[] }>(`${BASE}/batches`);
    return { items: data.items, available: true };
  } catch (e) {
    if (is404(e)) return { items: [], available: false };
    throw e;
  }
}

export async function createBatch(body: { name: string; filter: BatchFilter }): Promise<{ id: string; status: BatchStatus; items: number; with_proposal: number }> {
  return (await apiClient.post(`${BASE}/batches`, body)).data;
}

/** null when the batch (or the API) is gone. */
export async function getBatch(id: string): Promise<{ batch: RemediationBatch; items: BatchItem[] } | null> {
  try {
    return (await apiClient.get(`${BASE}/batches/${id}`)).data;
  } catch (e) {
    if (is404(e)) return null;
    throw e;
  }
}

export async function getBatchEvents(id: string): Promise<BatchEvent[]> {
  try {
    return (await apiClient.get<{ items: BatchEvent[] }>(`${BASE}/batches/${id}/events`)).data.items;
  } catch (e) {
    if (is404(e)) return [];
    throw e;
  }
}

export async function proposeValue(batchId: string, itemId: string, proposed_value: string | null): Promise<void> {
  await apiClient.patch(`${BASE}/batches/${batchId}/items/${itemId}`, { proposed_value });
}

export async function approveBatch(id: string): Promise<void> {
  await apiClient.post(`${BASE}/batches/${id}/approve`);
}

export function exportBatch(id: string, format: ExportFormat): Promise<void> {
  const ext = format === "cockpit_xlsx" ? "xlsx" : "csv";
  return downloadBlob(`${BASE}/batches/${id}/export`, { format }, `remediation_${format}.${ext}`, "post");
}

/** The API's `detail` text (e.g. "The batch creator cannot approve it."), else the transport message. */
export function errorDetail(e: unknown): string {
  const d = (e as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
  return typeof d === "string" ? d : (e as Error).message || "The request failed";
}
