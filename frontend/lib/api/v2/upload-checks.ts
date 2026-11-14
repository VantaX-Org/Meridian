/**
 * Upload checks (api/services/upload_checks.py), read before a cleaned workbook is scored.
 *   POST /upload/roundtrip/check  multipart: file, parent_version_id (only when the file carries no marker)
 *        -> {verdict, checks[{id, status, detail}], parent_version_id, latest_version_id, edits}; changes nothing.
 * A `fail` blocks the upload; a `warn` needs `confirm_warnings` on POST /upload/roundtrip. The types are the ones of
 * the round-trip client; this file adds what the screens need to read a result: the sentence of every check, the
 * worst status and the sentence of a refusal. Fixture mode answers from fixtures/upload-checks.json: a file whose name
 * holds "bad" fails (the marker), one that holds "warn" warns, anything else passes.
 */
import { uploadApiClient } from "@/lib/api/client";
import { t } from "@/lib/v2/i18n";
import { fixtureActive } from "./fixture";
import { checksOf, type CheckId, type CheckStatus, type UploadCheck, type UploadChecks } from "./roundtrip";
import canned from "./fixtures/upload-checks.json";

export type { CheckId, CheckStatus, UploadCheck, UploadChecks };

/** Every check id the server can return (CHECK_IDS in upload_checks.py), in the order it returns them. */
export const CHECK_ORDER: readonly CheckId[] = ["fingerprint", "run", "template", "columns", "rows", "keys", "values", "formulas"];

/** One plain sentence per check id, each a key of lib/v2/i18n. */
export const CHECK_SENTENCE: Record<CheckId, () => string> = {
  fingerprint: () => t("Made by Meridian for this object"),
  run: () => t("Made from this run, and the run is still the latest"),
  template: () => t("Template version is current"),
  columns: () => t("Required columns are present and not renamed"),
  rows: () => t("No rows added or removed"),
  keys: () => t("Key values exist in the run"),
  values: () => t("Values fit the field types and lengths"),
  formulas: () => t("No formulas in edited cells"),
};

export const STATUS_SENTENCE: Record<CheckStatus, () => string> = { pass: () => t("Passed"), warn: () => t("Warning"), fail: () => t("Failed") };

/** The check's sentence; an id the client does not know yet shows as it came, never as a blank. */
export const checkSentence = (id: string): string => (CHECK_SENTENCE as Record<string, (() => string) | undefined>)[id]?.() ?? id;

/** The worst status of a list: fail, else warn, else pass. */
export function worstOf(checks: readonly UploadCheck[] | undefined): CheckStatus {
  return checks?.some((c) => c.status === "fail") ? "fail" : checks?.some((c) => c.status === "warn") ? "warn" : "pass";
}

export const blocks = (checks: readonly UploadCheck[] | undefined): boolean => worstOf(checks) === "fail";

/** Why the primary action is off for these checks, or null when it may go on (a warning is allowed once confirmed). */
export function holdReason(checks: readonly UploadCheck[] | undefined, confirmed: boolean): string | null {
  const w = worstOf(checks);
  if (w === "fail") return t("A check failed. Fix the workbook and add it again.");
  if (w === "warn" && !confirmed) return t("Confirm the warnings to continue.");
  return null;
}

/** The fixture answer for a file name. */
export function fixtureWorkbookChecks(name: string, parent: string): UploadChecks {
  const key = name.includes("bad") ? "bad" : name.includes("warn") ? "warn" : "clean";
  return { ...(canned[key] as UploadChecks), parent_version_id: parent, latest_version_id: parent };
}

/** POST /upload/roundtrip/check: run every check on the file and change nothing. A 422 that carries checks is an answer too. */
export async function checkWorkbook(file: File, parentVersionId?: string): Promise<UploadChecks> {
  if (fixtureActive()) return fixtureWorkbookChecks(file.name, parentVersionId ?? "");
  const form = new FormData();
  form.append("file", file);
  if (parentVersionId) form.append("parent_version_id", parentVersionId);
  try {
    const { data } = await uploadApiClient.post<UploadChecks>("/api/v1/upload/roundtrip/check", form, { headers: { "Content-Type": "multipart/form-data" } });
    return data;
  } catch (err) {
    const c = checksOf(err);
    if (c) return { verdict: worstOf(c.checks), checks: c.checks, parent_version_id: parentVersionId ?? "", latest_version_id: null, edits: 0 };
    throw err;
  }
}

/** 409 `stale_run`: the run the workbook was made from is no longer the latest. Its sentence and the newer run. */
export function staleRun(err: unknown): { sentence: string; latest: string | null } | null {
  const d = (err as { response?: { status?: number; data?: { detail?: { error?: string; detail?: string; latest_version_id?: string } } } } | null)?.response;
  return d?.status === 409 && d.data?.detail?.error === "stale_run" ? { sentence: d.data.detail.detail ?? t("This run is no longer the latest."), latest: d.data.detail.latest_version_id ?? null } : null;
}
