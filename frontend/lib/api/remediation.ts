import type { AxiosResponse } from "axios";
import apiClient from "./client";

// ── Types ────────────────────────────────────────────────────────────────────

export type BatchStatus = "draft" | "approved" | "exported";
export type ProposalSource = "rule" | "steward" | "manual";
export type Confidence = "high" | "medium" | "low";
export type ReconStatus = "fixed" | "still_failing";
export type ExportFormat = "cockpit_xlsx" | "cockpit_csv" | "mass_change_csv";
export type EventAction = "created" | "proposed" | "accepted" | "approved" | "exported" | "reconciled";

export interface BatchFilter {
  status?: string | null;
  module?: string | null;
  check_id?: string | null;
  severity?: string | null;
  assigned_to?: string | null;
  scope?: string | null;
  search?: string | null;
  version_id?: string | null;
  issue_ids?: string[] | null;
  baseline_id?: string | null;
  monitor?: boolean | null;
}

export interface Batch {
  id: string;
  name: string;
  status: BatchStatus;
  filter: BatchFilter;
  created_by: string | null;
  created_by_label: string | null;
  created_at: string;
  approved_by: string | null;
  approved_by_label: string | null;
  approved_at: string | null;
  exported_at: string | null;
}

/** One row of GET /batches: the batch plus its counts. */
export interface BatchSummary extends Batch {
  items: number;
  with_proposal: number;
  auto_approvable: number;
  fixed: number;
  still_failing: number;
}

export interface BatchItem {
  id: string;
  batch_id: string;
  issue_id: string;
  scope: string;
  module: string;
  check_id: string;
  record_key: string;
  grain: string | null;
  field: string | null;
  current_value: string | null;
  proposed_value: string | null;
  proposal_source: ProposalSource;
  confidence: Confidence | null;
  accepted: boolean;
  recon_status: ReconStatus | null;
  recon_version: string | null;
  updated_at: string;
  auto_approvable: boolean;
}

export interface BatchDetail {
  batch: Batch;
  items: BatchItem[];
}

export interface BatchEvent {
  item_id: string;
  action: EventAction;
  from_value: string | null;
  to_value: string | null;
  user_label: string | null;
  version_id: string | null;
  created_at: string;
}

export interface MonitorRun {
  id: string;
  run_at: string | null;
  dqs: number | null;
}

export interface RegressedCheck {
  check_id: string;
  module: string;
  severity: string;
  new: number;
}

export interface MonitorSummary {
  baseline_id: string;
  baseline_run_at: string | null;
  new_records: number;
  regressed_checks: RegressedCheck[];
  regressed_check_count: number;
  resolved_records: number;
  batch_id: string | null;
  batch_items: number;
  batch_auto_approvable?: number;
}

export interface MonitorItem {
  scope: string;
  system_name: string | null;
  baseline: MonitorRun;
  latest: MonitorRun;
  monitor: MonitorSummary | null;
}

// ── Labels (never show a raw id, DESIGN.md rule 18) ─────────────────────────

export const STATUS_LABEL: Record<BatchStatus, string> = { draft: "Draft", approved: "Approved", exported: "Exported" };
export const SOURCE_LABEL: Record<ProposalSource, string> = { rule: "Rule", steward: "Steward", manual: "Manual" };
export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: "High", medium: "Medium", low: "Low" };
export const RECON_LABEL: Record<ReconStatus, string> = { fixed: "Fixed", still_failing: "Still failing" };
export const FORMAT_LABEL: Record<ExportFormat, string> = {
  cockpit_xlsx: "Migration Cockpit workbook (xlsx)",
  cockpit_csv: "Migration Cockpit CSV",
  mass_change_csv: "Mass change CSV",
};
export const EVENT_LABEL: Record<EventAction, string> = {
  created: "Drafted", proposed: "Proposal changed", accepted: "Accepted", approved: "Approved", exported: "Exported", reconciled: "Reconciled",
};

// ── Reads ────────────────────────────────────────────────────────────────────

export const listBatches = async (): Promise<{ items: BatchSummary[] }> => {
  const { data } = await apiClient.get<{ items: BatchSummary[] }>("/api/v1/remediation/batches");
  return data;
};

export const getBatch = async (id: string): Promise<BatchDetail> => {
  const { data } = await apiClient.get<BatchDetail>(`/api/v1/remediation/batches/${id}`);
  return data;
};

export const getBatchEvents = async (id: string, itemId?: string): Promise<{ items: BatchEvent[] }> => {
  const { data } = await apiClient.get<{ items: BatchEvent[] }>(`/api/v1/remediation/batches/${id}/events`, {
    params: itemId ? { item_id: itemId } : undefined,
  });
  return data;
};

export const getMonitor = async (): Promise<{ items: MonitorItem[] }> => {
  const { data } = await apiClient.get<{ items: MonitorItem[] }>("/api/v1/remediation/monitor");
  return data;
};

// ── Writes ───────────────────────────────────────────────────────────────────

export const patchItem = async (
  batchId: string,
  itemId: string,
  proposed_value: string | null,
): Promise<{ id: string; proposed_value: string | null }> => {
  const { data } = await apiClient.patch<{ id: string; proposed_value: string | null }>(
    `/api/v1/remediation/batches/${batchId}/items/${itemId}`,
    { proposed_value },
  );
  return data;
};

export const acceptHighConfidence = async (id: string): Promise<{ id: string; accepted: number; accepted_by: string }> => {
  const { data } = await apiClient.post<{ id: string; accepted: number; accepted_by: string }>(
    `/api/v1/remediation/batches/${id}/accept-high-confidence`,
  );
  return data;
};

export const approveBatch = async (id: string): Promise<{ id: string; status: "approved"; approved_by: string }> => {
  const { data } = await apiClient.post<{ id: string; status: "approved"; approved_by: string }>(
    `/api/v1/remediation/batches/${id}/approve`,
  );
  return data;
};

// ── Export (POST that streams a file; the GET-only blob helpers in cleaning.ts don't fit) ──

function defaultExtensionFor(format: ExportFormat): string {
  return format === "cockpit_xlsx" ? "xlsx" : "csv";
}

async function readBlobErrorDetail(blob: Blob): Promise<string | null> {
  try {
    const text = await blob.text();
    const parsed = JSON.parse(text) as { detail?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
  } catch {
    // Not JSON — fall through.
  }
  return null;
}

/** POST that streams a file. Surfaces the JSON `detail` from a non-2xx Blob error as a sentence. */
export async function exportBatch(id: string, format: ExportFormat): Promise<void> {
  let response: AxiosResponse<Blob>;
  try {
    response = await apiClient.post<Blob>(
      `/api/v1/remediation/batches/${id}/export?format=${format}`,
      undefined,
      { responseType: "blob" },
    );
  } catch (err: unknown) {
    const errResponse = (err as { response?: { data?: unknown } }).response;
    if (errResponse?.data instanceof Blob) {
      const detail = await readBlobErrorDetail(errResponse.data);
      if (detail) throw new Error(detail);
    }
    throw err;
  }

  const disposition = response.headers["content-disposition"] ?? "";
  const filenameMatch = disposition.match(/filename=(.+)/);
  const filename = filenameMatch?.[1] ?? `remediation_${id}_${format}.${defaultExtensionFor(format)}`;

  const url = window.URL.createObjectURL(new Blob([response.data]));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

/** Error message for any remediation call: the API's `detail` sentence, else the client error. */
/** The API's own detail message, or "Could not reach the server." — never the raw Error/AxiosError message (spec 5). */
export function errorText(e: unknown): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? detail : "Could not reach the server.";
}

export interface BatchCreated {
  id: string;
  name: string;
  status: BatchStatus;
  item_count: number;
}

/** Drafts a batch from the open issues matching `filter`. The API answers 400 when nothing matches or the cap is exceeded. */
export async function createBatch(name: string, filter: BatchFilter): Promise<BatchCreated> {
  const { data } = await apiClient.post<BatchCreated>("/api/v1/remediation/batches", { name, filter });
  return data;
}
