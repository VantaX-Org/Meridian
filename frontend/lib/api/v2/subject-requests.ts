import { uploadApiClient } from "@/lib/api/client";
import { fixtureActive } from "./fixture";
import { v2Get, v2Send } from "./client";

/** Data-subject access and erasure (api/routes/subject_requests.py). The subject travels in the body, never in a URL. */
export interface ExtractCoverage {
  files: number;
  rows: number;
  scanned_bytes: number;
  skipped: number;
  errors: number;
  complete: boolean;
}

export interface SubjectResult {
  request_id: string;
  keys: string[];
  rows_by_table: Record<string, number>;
  extracts: ExtractCoverage;
  total_rows: number;
}

export interface SubjectSearch extends SubjectResult {
  full_key: boolean;
}

export interface SubjectErase extends SubjectResult {
  dry_run: boolean;
  complete?: boolean;
}

export interface SubjectLedgerRow {
  request_id: string;
  kind: "access" | "erasure";
  dry_run: boolean;
  key_count: number;
  rows_by_table: Record<string, number>;
  extract_rows: number;
  reason: string | null;
  status: string;
  actor: string | null;
  created_at: string;
}

export interface SuppressionItem {
  request_id: string | null;
  key_fields: string[];
  keys: number;
  dropped: number;
  last_dropped_at: string | null;
  created_at: string;
  created_by: string | null;
  active_keys: number;
  lifted_at: string | null;
  lifted_by: string | null;
  lift_reason: string | null;
}

/** The suppression list: erased keys that extraction drops. No key and no hash, only field names and counts. */
export interface SuppressionList {
  active_keys: number;
  dropped_total: number;
  field_texts: Record<string, string>;
  items: SuppressionItem[];
}

const BASE = "/admin/subject-requests";

export const searchSubject = (subject: string): Promise<SubjectSearch> => v2Send("POST", `${BASE}/search`, { subject });
export const dryRunErasure = (subject: string): Promise<SubjectErase> => v2Send("POST", `${BASE}/erase`, { subject, dry_run: true });
export const executeErasure = (subject: string, dryRunId: string, confirm: string, reason: string): Promise<SubjectErase> =>
  v2Send("POST", `${BASE}/erase`, { subject, dry_run: false, dry_run_id: dryRunId, confirm, reason });
export const listSubjectRequests = (): Promise<SubjectLedgerRow[]> => v2Get(BASE);
export const listSuppressions = (): Promise<SuppressionList> => v2Get(`${BASE}/suppressions`);
export const liftSuppression = (requestId: string, reason: string): Promise<{ request_id: string; lifted: number }> =>
  v2Send("POST", `${BASE}/suppressions/${encodeURIComponent(requestId)}/lift`, { reason });

/** The sentence a refusal carries. The API sends `detail` as { error, message }; a string detail also works. */
export function subjectError(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  const message = (detail as { message?: unknown } | null)?.message;
  if (typeof message === "string" && message.trim()) return message;
  return fallback;
}

function save(blob: Blob, name: string): string {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
  return name;
}

/** POST the subject and save the zip the API builds. In fixture mode the file is a small text stand-in. */
export async function downloadSubjectExport(subject: string): Promise<string> {
  if (fixtureActive()) return save(new Blob(["Synthetic fixture export. No data is held."], { type: "text/plain" }), "subject-export-fixture.txt");
  try {
    const res = await uploadApiClient.post<Blob>(`/api/v1${BASE}/export`, { subject }, { responseType: "blob" });
    const disposition = String(res.headers?.["content-disposition"] ?? "");
    const name = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? "subject-export.zip";
    return save(res.data, name);
  } catch (err: unknown) {
    const data = (err as { response?: { data?: unknown } }).response?.data;
    if (data instanceof Blob) {
      const text = await data.text().catch(() => "");
      let message: string | undefined;
      try {
        const detail = (JSON.parse(text) as { detail?: unknown }).detail;
        message = typeof detail === "string" ? detail : (detail as { message?: string } | null)?.message;
      } catch {
        message = undefined;
      }
      if (message) throw new Error(message);
    }
    throw err;
  }
}
