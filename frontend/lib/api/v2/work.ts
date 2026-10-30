import apiClient, { uploadApiClient } from "@/lib/api/client";
import type { Decision, WorkGroup, WorkRecordDetail, WorkSummary } from "@/lib/api/work";
import { fixtureActive } from "./fixture";
import { errorSentence, v2Get, v2Send } from "./client";
import { fixtureExport, fixtureImport } from "./fixtures";
import type { WorkPage } from "./types";

export type { WorkSummary, WorkGroup, WorkRecordDetail, Decision };

/**
 * The filters of the Work ledger, named as the API names them (GET /work/records, /work/summary, /work/export).
 * `status` defaults to open on the server; `proposed` keeps only records with a machine-proposed value.
 */
export interface WorkFilters {
  module?: string;
  check_id?: string;
  severity?: string;
  status?: string;
  assigned?: string;
  proposed?: boolean;
  due?: string;
  q?: string;
  /** One fix batch (not in GET /work/records yet: the ledger also keeps only the rows that name it). */
  batch_id?: string;
  /** Step 10: a policy pack or pack:class; GET /work/records only. */
  policy?: string;
  /** A source system id, or "upload". */
  system?: string;
  /** Step 10: the ledger as it stood at this run; GET /work/records only, never with scope=current. */
  as_of_run?: string;
}

export interface WorkQuery extends WorkFilters {
  sort?: string;
  after?: string;
  limit?: number;
}

const scoped = { scope: "current" } as const;

/** GET /work/records. As of a run, the server reads the current state as it stood then: no scope is sent with it. */
export const getWork = (q: WorkQuery): Promise<WorkPage> => v2Get<WorkPage>("/work/records", q.as_of_run ? { ...q } : { ...scoped, ...q });
export const getSummary = (f: WorkFilters = {}): Promise<WorkSummary> => v2Get<WorkSummary>("/work/summary", { ...scoped, ...f });
export const getGroups = (
  f: Pick<WorkFilters, "module" | "severity" | "proposed" | "q"> & { limit?: number } = {},
): Promise<{ version_id: string | null; built: boolean; total: number; groups: WorkGroup[] }> => v2Get("/work/groups", { ...scoped, ...f });
export const getRecord = (module: string, key: string, version?: string): Promise<WorkRecordDetail> =>
  v2Get<WorkRecordDetail>(`/work/records/${encodeURIComponent(module)}/${encodeURIComponent(key)}`, { version_id: version });

export interface DecideResult {
  updated: number;
  draft_batch_id: string | null;
  action_id?: string | null;
}

/** POST /work/decide for the records of one run. The result carries the action id that /actions/undo takes. */
export const postDecide = (items: Decision[], version?: string): Promise<DecideResult> => v2Send<DecideResult>("POST", "/work/decide", { version_id: version, items });

export interface GroupResult {
  accepted?: number;
  updated?: number;
  draft_batch_id: string;
  action_id?: string | null;
}
export const postAcceptAll = (check: string, version?: string): Promise<GroupResult> =>
  v2Send<GroupResult>("POST", `/work/groups/${encodeURIComponent(check)}/accept-all`, undefined, { version_id: version });
export const postSetValue = (check: string, value: string, onlyBlank: boolean, version?: string): Promise<GroupResult> =>
  v2Send<GroupResult>("POST", `/work/groups/${encodeURIComponent(check)}/set-value`, { value, only_blank: onlyBlank }, { version_id: version });

export interface UndoResult {
  action_id: string;
  kind: string;
  undone_at: string;
  restored: { issues: number; items_restored: number; items_removed: number; batch: boolean };
}
export const postUndo = (actionId: string): Promise<UndoResult> => v2Send<UndoResult>("POST", "/actions/undo", { action_id: actionId });

export interface BatchResult {
  id: string;
  status: string;
  action_id?: string | null;
}
/** Four eyes: the approver is not the person who built the batch. Approves every row of the batch. */
export const postApproveBatch = (batch: string): Promise<BatchResult> => v2Send<BatchResult>("POST", `/remediation/batches/${encodeURIComponent(batch)}/approve`);
export const postSendBack = (batch: string, note: string): Promise<BatchResult> => v2Send<BatchResult>("POST", `/remediation/batches/${encodeURIComponent(batch)}/send-back`, { note });

/** The sentence to show for a failed write: the server's own, else the fallback. */
export { errorSentence };

// Saved views --------------------------------------------------------------------------------------------------

export interface SavedView {
  id: string;
  route: string;
  name: string;
  filters: Record<string, string>;
  columns: string[] | null;
  density: "compact" | "comfortable" | null;
  builtin: boolean;
  created_at: string | null;
  /** Every user of the tenant sees it (step 6c). */
  shared?: boolean;
  /** False for a view another user shared. */
  mine?: boolean;
}
export const getViews = (route: string): Promise<{ route: string; views: SavedView[] }> => v2Get("/views", { route });
export const putView = (view: { route: string; name: string; filters: Record<string, string>; columns: string[] | null; density: "compact" | "comfortable" | null }): Promise<SavedView> =>
  v2Send<SavedView>("PUT", "/views", view);

// Record links ------------------------------------------------------------------------------------------------

export interface RecordLinks {
  module: string;
  record_key: string;
  run_id: string;
  failing_rules: { check_id: string; name: string | null; severity: string | null; dimension: string | null; field: string | null }[];
  variants: { identity: string; total: number; items: { module: string; record_key: string; differs_in: Record<string, string | null>; failing: { check_id: string; severity: string | null }[] }[] } | null;
  features: { feature: string; status: "blocked" | "degraded"; because: string[] }[];
  provenance: {
    source_tables: { table: string; fields: string[] }[];
    run_id: string;
    run_at: string | null;
    system_id: string | null;
    system_name: string | null;
    extracted_at: string | null;
    record_hash: string | null;
  };
  history: { check_id: string; action: string; from_value: string | null; to_value: string | null; note: string | null; user: string | null; at: string | null }[];
}
export const getLinks = (module: string, key: string, run?: string, checkId?: string): Promise<RecordLinks> =>
  v2Get<RecordLinks>(`/records/${encodeURIComponent(module)}/${encodeURIComponent(key)}/links`, { run, check_id: checkId });

// Export and import -------------------------------------------------------------------------------------------

function saveBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

/** What the fix-sheet exports take: the ledger's filters and its order (GET /work/records' sort names). */
export interface ExportQuery extends WorkFilters {
  sort?: string;
}

/** The query an export sends: the ledger's filters, batch, policy and sort included; a past run is not exported. */
export function exportParams(f: ExportQuery): Record<string, string | boolean> {
  const { as_of_run: _asOf, ...rest } = f;
  void _asOf;
  return Object.fromEntries(Object.entries({ ...scoped, ...rest }).filter(([, v]) => v !== undefined && v !== null && v !== "")) as Record<string, string | boolean>;
}

async function exportFile(path: string, f: ExportQuery, fallback: string): Promise<{ filename: string }> {
  if (fixtureActive()) {
    const { filename, blob } = fixtureExport(f as Record<string, unknown>, fallback);
    saveBlob(blob, filename);
    return { filename };
  }
  let response;
  try {
    response = await uploadApiClient.get<Blob>(path, { responseType: "blob", params: exportParams(f) });
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
  const disposition = (response.headers?.["content-disposition"] as string | undefined) ?? "";
  const filename = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] ?? /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? fallback;
  saveBlob(response.data, decodeURIComponent(filename));
  return { filename };
}

/** GET /work/export with the filters and the order on screen (the same rows the ledger shows), saved as a file. */
export const exportFixSheet = (f: ExportQuery): Promise<{ filename: string }> => exportFile("/api/v1/work/export", f, "fix-sheet.xlsx");

/** GET /work/export/per-object: the same rows, one sheet per object with each record's value at risk. */
export const exportFixSheetByObject = (f: ExportQuery): Promise<{ filename: string }> =>
  exportFile("/api/v1/work/export/per-object", f, "records-to-fix-by-object.xlsx");

export interface ImportResult {
  updated: number;
  rows: number;
  skipped: string[];
  draft_batch_id?: string | null;
  action_id?: string | null;
}

/** POST /work/import: a filled fix sheet read back as decisions. */
export async function importFixSheet(file: File): Promise<ImportResult> {
  if (fixtureActive()) return fixtureImport(file.name);
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<ImportResult>("/api/v1/work/import", form, { params: scoped, headers: { "Content-Type": "multipart/form-data" } });
  return data;
}
