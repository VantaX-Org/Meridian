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
}

export const getBatches = (): Promise<{ items: BatchRowApi[] }> => v2Get("/remediation/batches");
export const getBatch = (id: string): Promise<BatchDetail> => v2Get(`/remediation/batches/${enc(id)}`);
export const getBatchEvents = (id: string): Promise<{ items: BatchEvent[] }> => v2Get(`/remediation/batches/${enc(id)}/events`);

/** GET /writeback/approvals carries the deployment's `live_enabled` flag; it needs the approve permission. */
export const getWritebackMode = (): Promise<{ live_enabled: boolean }> => v2Get("/writeback/approvals");

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

/** One record sent: the simulation, the call and the commit, with SAP's RETURN messages. */
export interface WritebackRecord {
  record_key: string;
  bapis: string[];
  fields: string[];
  simulated: boolean;
  simulate_messages: SapMessage[];
  applied: boolean;
  committed: boolean;
  messages: SapMessage[];
  error: string | null;
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

/** Send to SAP: what SAP committed, refused, and what stays for the export. */
export interface BatchWritebackSend {
  batch_id: string;
  status: "completed" | "completed_with_errors";
  sent: number;
  failed: number;
  export_only: number;
  errors: string[];
  fields: WritebackField[];
  records: WritebackRecord[];
}

/** POST /writeback/batches/{id}/check (apply): per field, BAPI or export and why. */
export const checkBatchWriteback = (id: string): Promise<BatchWritebackCheck> => v2Send("POST", `/writeback/batches/${enc(id)}/check`);
/** POST /writeback/batches/{id}/send (approve, never the batch creator, only with live write-back on). */
export const sendBatchWriteback = (id: string): Promise<BatchWritebackSend> => v2Send("POST", `/writeback/batches/${enc(id)}/send`);

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
 * (status exported, shown as Sent to SAP). Meridian hands the load file; a person loads it, so the result is the file's
 * name and checksum. The batch creator is refused (403, the server's own sentence).
 */
export async function sendBatchToSap(id: string, records: number | null, format: ExportFormat = "cockpit_xlsx"): Promise<SendResult> {
  if (fixtureActive()) return fixtureWrite<SendResult>("POST", `/remediation/batches/${enc(id)}/export`, { format }, {});
  try {
    const res = await apiClient.post<Blob>(`/api/v1/remediation/batches/${enc(id)}/export`, undefined, { params: { format }, responseType: "blob" });
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
