/**
 * Clean in Excel, upload back, re-score (api/routes/upload.py).
 *   POST /upload/roundtrip  multipart: file (.xlsx or .csv), parent_version_id (only when the file carries no marker)
 *        The edited migration template or cleaning workbook becomes the next run of the same lineage and is analysed at
 *        once. 422 {error: "parent_required"} means the file does not say which run it came from.
 */
import { uploadApiClient } from "@/lib/api/client";
import { fixtureActive } from "./fixture";
import { getVersionsPage } from "./runs";
import { v2Download } from "./download";

/** GET /reports/{run}/cleaning/{module}.xlsx: the cleaning workbook for one object of one run, ready to edit and upload back. */
export const downloadCleaningWorkbook = (runId: string, module: string) =>
  v2Download(`/reports/${encodeURIComponent(runId)}/cleaning/${encodeURIComponent(module)}.xlsx`, undefined, `cleaning_${module}.xlsx`);

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

export type CheckStatus = "pass" | "warn" | "fail";
export type CheckId = "fingerprint" | "run" | "template" | "columns" | "rows" | "keys" | "values" | "formulas";
/** One upload check. `detail` is a sentence with ids and counts only, never a cell value. */
export interface UploadCheck { id: CheckId; status: CheckStatus; detail: string }
export interface UploadChecks { verdict: CheckStatus; checks: UploadCheck[]; parent_version_id: string; latest_version_id: string | null; edits: number }

/** The checks a 422 `checks_failed` or `confirm_required` answer carries; null for any other error. */
export function checksOf(err: unknown): { error: string; checks: UploadCheck[] } | null {
  const d = (err as { response?: { data?: { detail?: { error?: string; checks?: UploadCheck[] } } } } | null)?.response?.data?.detail;
  return d?.checks && (d.error === "checks_failed" || d.error === "confirm_required") ? { error: d.error, checks: d.checks } : null;
}

const FIXTURE_IDS: CheckId[] = ["fingerprint", "run", "template", "columns", "rows", "keys", "values", "formulas"];
/** Fixture mode: every check passes, except a file named "warn" (one warning) or "bad" (one failure). */
export function fixtureChecks(name: string, parent: string): UploadChecks {
  const at = name.includes("bad") ? "columns" : name.includes("warn") ? "template" : "";
  const checks = FIXTURE_IDS.map((id): UploadCheck => ({ id, status: id !== at ? "pass" : name.includes("bad") ? "fail" : "warn", detail: "" }));
  const verdict: CheckStatus = at ? checks.find((c) => c.id === at)!.status : "pass";
  return { verdict, checks, parent_version_id: parent, latest_version_id: parent, edits: 42 };
}

/** POST /upload/roundtrip/check: run every check on the file and change nothing. */
export async function checkCleaned(file: File, parentVersionId?: string): Promise<UploadChecks> {
  if (fixtureActive()) return fixtureChecks(file.name, parentVersionId ?? "");
  const form = new FormData();
  form.append("file", file);
  if (parentVersionId) form.append("parent_version_id", parentVersionId);
  const { data } = await uploadApiClient.post<UploadChecks>("/api/v1/upload/roundtrip/check", form, { headers: { "Content-Type": "multipart/form-data" } });
  return data;
}

export async function uploadCleaned(file: File, parentVersionId?: string, confirmWarnings = false): Promise<RoundTripResult> {
  if (fixtureActive()) {
    const [after, before] = (await getVersionsPage({ limit: 2 })).versions;
    return { version_id: after.id, job_id: null, status: "pending", parent_version_id: parentVersionId ?? before.id, kind: "template", applied: 42, unchanged: 3, unmatched: 0, unmapped: {}, skipped: {}, no_table: [], no_field: [] };
  }
  const form = new FormData();
  form.append("file", file);
  if (parentVersionId) form.append("parent_version_id", parentVersionId);
  if (confirmWarnings) form.append("confirm_warnings", "true");
  const { data } = await uploadApiClient.post<RoundTripResult>("/api/v1/upload/roundtrip", form, { headers: { "Content-Type": "multipart/form-data" } });
  return data;
}
