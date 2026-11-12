/**
 * Clean in Excel, upload back, re-score (api/routes/upload.py).
 *   POST /upload/roundtrip  multipart: file (.xlsx or .csv), parent_version_id (only when the file carries no marker)
 *        The edited migration template or cleaning workbook becomes the next run of the same lineage and is analysed at
 *        once. 422 {error: "parent_required"} means the file does not say which run it came from.
 */
import { uploadApiClient } from "@/lib/api/client";
import { fixtureActive } from "./fixture";
import { getVersionsPage } from "./runs";

export interface RoundTripResult {
  version_id: string;
  job_id: string | null;
  status: string;
  parent_version_id: string;
  kind: "template" | "cleaning";
  applied: number;
  unchanged: number;
  unmatched: number;
  /** Sheet name to the columns that map to no SuccessFactors field; those columns were not read. */
  unmapped: Record<string, string[]>;
  /** Sheet name to the reason it was not read. */
  skipped: Record<string, string>;
  no_table: string[];
  no_field: string[];
}

/** True when the API says the file names no parent run, so the person must choose one. */
export function needsParent(err: unknown): boolean {
  const detail = (err as { response?: { data?: { detail?: { error?: string } } } } | null)?.response?.data?.detail;
  return detail?.error === "parent_required";
}

/** The sentence a rejected upload carries: the API's plain sentence, or the `detail` of its structured error. */
export function uploadSentence(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  const inner = (detail as { detail?: unknown } | null)?.detail;
  return typeof inner === "string" && inner.trim() ? inner : fallback;
}

export async function uploadCleaned(file: File, parentVersionId?: string): Promise<RoundTripResult> {
  if (fixtureActive()) {
    const [after, before] = (await getVersionsPage({ limit: 2 })).versions;
    return { version_id: after.id, job_id: null, status: "pending", parent_version_id: parentVersionId ?? before.id, kind: "template", applied: 42, unchanged: 3, unmatched: 0, unmapped: {}, skipped: {}, no_table: [], no_field: [] };
  }
  const form = new FormData();
  form.append("file", file);
  if (parentVersionId) form.append("parent_version_id", parentVersionId);
  const { data } = await uploadApiClient.post<RoundTripResult>("/api/v1/upload/roundtrip", form, { headers: { "Content-Type": "multipart/form-data" } });
  return data;
}
