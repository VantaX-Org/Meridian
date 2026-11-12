import apiClient from "@/lib/api/client";
import type { Batch, BatchDetail, BatchEvent, BatchItem, BatchSummary, ExportFormat } from "@/lib/api/remediation";
import { fixtureActive } from "./fixture";
import { fixtureWrite } from "./fixtures";
import { v2Get, v2Send } from "./client";

export type { Batch, BatchDetail, BatchEvent, BatchItem, BatchSummary };

const enc = encodeURIComponent;

/**
 * GET /remediation/batches: every batch with its counts. The fields this interface also reads when the API has them
 * (it does not send them yet, and a dash is shown without them): `value_at_risk` (the cost model's figure for the
 * batch's records), `due_at` and `steward_label` (who the work is assigned to).
 */
export interface BatchRowApi extends BatchSummary {
  value_at_risk?: number | null;
  due_at?: string | null;
  steward_label?: string | null;
  /** The objects of the batch's records (module keys); the object page's Fixes tab filters on it. */
  modules?: string[];
  /** The first run after the load: how many records of the batch it found fixed, and how many still fail. */
  verification?: { version_id: string; run_at: string | null; records: number; fixed: number; still_failing: number; verified_at: string | null; sentence: string } | null;
}

export const getBatches = (): Promise<{ items: BatchRowApi[] }> => v2Get("/remediation/batches");
export const getBatch = (id: string): Promise<BatchDetail> => v2Get(`/remediation/batches/${enc(id)}`);
/** POST /remediation/batches/{id}/reassign (assign): every open issue on the batch's records goes to one person. Undoable. */
export const reassignBatch = (id: string, assigneeId: string): Promise<{ batch_id: string; reassigned: number; action_id: string }> => v2Send("POST", `/remediation/batches/${enc(id)}/reassign`, { assignee_id: assigneeId });
export const getBatchEvents = (id: string): Promise<{ items: BatchEvent[] }> => v2Get(`/remediation/batches/${enc(id)}/events`);

/** GET /writeback/approvals carries the deployment's `live_enabled` flag; it needs the approve permission. */
export const getWritebackMode = (): Promise<{ live_enabled: boolean }> => v2Get("/writeback/approvals");

/** One live write-back request waiting for a second person (GET /writeback/approvals, needs approve). */
export interface PendingWriteback {
  id: string; finding_id: string | null; version_id: string | null; requested_by: string | null; records_updated: number; sap_host: string | null; created_at: string | null;
  check_id: string | null; module: string | null; rule_message: string | null; requested_by_name: string | null;
}
export const getPendingWritebacks = (): Promise<{ approvals: PendingWriteback[]; live_enabled: boolean }> => v2Get("/writeback/approvals");
/** POST /writeback/approve/{id} (approve): the second person releases the write to SAP. Four eyes: never the requester. */
export interface WritebackApproved { applied: number; errors: string[]; status: string }
export const approveWriteback = (id: string): Promise<WritebackApproved> => v2Send("POST", `/writeback/approve/${enc(id)}`);

/* ── Live write-back of an approved batch (POST /writeback/batches/{id}/check and /send) ── */

/** One field of the batch: whether a BAPI carries it (delivery "bapi") or it goes out with the export, and why. */
export interface WritebackField {
  record_key: string;
  /** TABLE.FIELD */
  field: string;
  supported: boolean;
  bapi: string | null;
  reason: string | null;
  delivery: "bapi" | "export";
}

/** A message of SAP's RETURN table. */
export interface SapMessage {
  type: string;
  id: string;
  number: string;
  message: string;
}

/** Check with SAP: nothing is sent. */
export interface BatchWritebackCheck {
  batch_id: string;
  live_enabled: boolean;
  records: number;
  bapi: number;
  export_only: number;
  fields: WritebackField[];
  errors: string[];
}

export type RunStatus = "queued" | "running" | "paused" | "cancelling" | "completed" | "completed_with_errors" | "cancelled";
export type RunRecordState = "pending" | "sending" | "committed" | "failed" | "needs_check" | "export_only";
export const OPEN_RUN: readonly RunStatus[] = ["queued", "running", "paused", "cancelling"];

export interface RunCounts {
  pending: number;
  sending: number;
  committed: number;
  failed: number;
  needs_check: number;
  export_only: number;
}

/** The send of a batch to SAP: a worker sends it in chunks and this is its progress. */
export interface WritebackRun {
  id: string;
  batch_id: string;
  status: RunStatus;
  /** Why a paused run stopped, in a sentence. */
  pause_reason: string | null;
  /** Records the run sends. */
  records: number;
  counts: RunCounts;
  export_only_fields: number;
  errors: string[];
  /** The worker stopped reporting; Resume takes the run over. */
  stale: boolean;
  requested_label: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/** A message of SAP's RETURN table. */
export interface SapMessage {
  type: string;
  id: string;
  number: string;
  message: string;
}

export interface RunRecord {
  record_key: string;
  description: string | null;
  module: string;
  state: RunRecordState;
  fields: string[];
  error: string | null;
  messages: SapMessage[];
  attempts: number;
}

export interface RunRecordsPage {
  items: RunRecord[];
  total: number;
  limit: number;
  offset: number;
}

/** POST /writeback/batches/{id}/check (apply): per field, BAPI or export and why. */
export const checkBatchWriteback = (id: string): Promise<BatchWritebackCheck> => v2Send("POST", `/writeback/batches/${enc(id)}/check`);
/** POST /writeback/batches/{id}/send (approve, never the batch creator, only with live write-back on): queues the run and returns it; a send while a run is open returns that run. */
export const sendBatchWriteback = (id: string): Promise<WritebackRun> => v2Send("POST", `/writeback/batches/${enc(id)}/send`);
/** GET /writeback/batches/{id}/run: the latest run, 404 when the batch was never sent. */
export const getBatchRun = (id: string): Promise<WritebackRun> => v2Get(`/writeback/batches/${enc(id)}/run`);
/** GET .../run/records: records of the latest run, failed and needs_check first unless a state is given. */
export const getBatchRunRecords = (id: string, state?: RunRecordState, limit = 50, offset = 0): Promise<RunRecordsPage> => v2Get(`/writeback/batches/${enc(id)}/run/records`, { state, limit, offset });
/** POST .../run/resume (approve, never the batch creator): continue a paused run or take over a stalled one. */
export const resumeBatchRun = (id: string): Promise<WritebackRun> => v2Send("POST", `/writeback/batches/${enc(id)}/run/resume`);
/** POST .../run/cancel (approve): stop after the record in flight. */
export const cancelBatchRun = (id: string): Promise<WritebackRun> => v2Send("POST", `/writeback/batches/${enc(id)}/run/cancel`);
/** POST .../run/retry-failed (approve, never the batch creator); needs_check records only when someone has looked in SAP. */
export const retryFailedBatchRun = (id: string, includeNeedsCheck = false): Promise<WritebackRun> => v2Send("POST", `/writeback/batches/${enc(id)}/run/retry-failed`, { include_needs_check: includeNeedsCheck });

export interface SendResult {
  /** The load file handed over. */
  filename: string;
  sha256: string | null;
  records: number | null;
  /** The job a live write-back started, when the API names one (the export API starts none). */
  job_id: string | null;
}

function save(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

/**
 * Send an approved batch to SAP: POST /remediation/batches/{id}/export, the one call that moves an approved batch on
 * (status awaiting_load, Exported, waiting for the SAP load, until someone confirms the load). Meridian hands the load file; a person loads it, so the result is the file's
 * name and checksum. The batch creator is refused (403, the server's own sentence).
 */
export async function sendBatchToSap(id: string, records: number | null, loaderId: string | null = null, format: ExportFormat = "cockpit_xlsx"): Promise<SendResult> {
  const params = loaderId ? { format, loader_id: loaderId } : { format };
  if (fixtureActive()) return fixtureWrite<SendResult>("POST", `/remediation/batches/${enc(id)}/export`, params, {});
  try {
    const res = await apiClient.post<Blob>(`/api/v1/remediation/batches/${enc(id)}/export`, undefined, { params, responseType: "blob" });
    const disposition = (res.headers?.["content-disposition"] as string | undefined) ?? "";
    const filename = decodeURIComponent(/filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] ?? /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? `remediation_${id}.xlsx`);
    save(res.data, filename);
    return { filename, sha256: (res.headers?.["x-content-sha256"] as string | undefined) ?? null, records, job_id: null };
  } catch (err: unknown) {
    const data = (err as { response?: { data?: unknown } }).response?.data;
    if (data instanceof Blob) {
      const detail = await data
        .text()
        .then((t) => (JSON.parse(t) as { detail?: string }).detail)
        .catch(() => undefined);
      if (detail) throw new Error(detail);
    }
    throw err;
  }
}

/**
 * The batch's load file was loaded in SAP: POST /remediation/batches/{id}/loaded. An approver or SAP Basis confirms
 * it (not the person who built the batch), and the batch moves from awaiting_load to exported (Sent to SAP).
 */
export async function confirmBatchLoaded(id: string, note: string | null): Promise<void> {
  if (fixtureActive()) {
    await fixtureWrite<Record<string, never>>("POST", `/remediation/batches/${enc(id)}/loaded`, { note }, {});
    return;
  }
  await apiClient.post(`/api/v1/remediation/batches/${enc(id)}/loaded`, { note });
}

const formula = /^[=+\-@\t\r]/;
const cell = (v: string | null | undefined): string => {
  const raw = v ?? "";
  const safe = formula.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** The sheet of a batch as CSV, from its items: what is in the batch, read-only (no status changes). */
export function batchSheetCsv(items: readonly BatchItem[]): string {
  const head = ["Object", "Record", "Rule", "Field", "Current value", "New value", "Source", "Confidence"];
  const rows = items.map((i) => [i.module, i.record_key, i.check_id, i.field, i.current_value, i.proposed_value, i.proposal_source, i.confidence].map(cell).join(","));
  return [head.join(","), ...rows].join("\n");
}

export function downloadBatchSheet(name: string, items: readonly BatchItem[]): string {
  const filename = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "batch"}-sheet.csv`;
  save(new Blob([batchSheetCsv(items)], { type: "text/csv" }), filename);
  return filename;
}
