/**
 * Fixture answers for the subject-request screen (`?fixture=1`). Every value is synthetic: the subject "SYNTH-0001"
 * is a made-up key, never a real person. A dry run must run before an execute, as on the server.
 */
import type { SubjectErase, SubjectLedgerRow, SubjectSearch } from "../subject-requests";

export const NONE_SUBJECT = Symbol("no-subject-fixture");

class Refused extends Error {
  response: { status: number; data: { detail: { error: string; message: string } } };
  constructor(status: number, error: string, message: string) {
    super(message);
    this.response = { status, data: { detail: { error, message } } };
  }
}

const COUNTS: Record<string, number> = { finding_records: 4, record_issues: 3, work_records: 1, record_hashes: 2, cleaning_audit: 1 };
const EXTRACTS = { files: 2, rows: 2, scanned_bytes: 48_000, skipped: 0, errors: 0, complete: true };
const NO_EXTRACTS = { files: 0, rows: 0, scanned_bytes: 0, skipped: 0, errors: 0, complete: true };
const total = (c: Record<string, number>, e: { rows: number }): number => Object.values(c).reduce((a, b) => a + b, 0) + e.rows;

let ledger: SubjectLedgerRow[] = [];
let seq = 0;
let erased = false;
let dryId: string | null = null;

export function resetSubjectFixture(): void {
  ledger = [];
  seq = 0;
  erased = false;
  dryId = null;
}

const known = (s: string): boolean => /^(MATNR=)?SYNTH-0001$/i.test(s.trim());
const live = (s: string): boolean => known(s) && !erased;
const counts = (s: string): Record<string, number> => (live(s) ? { ...COUNTS } : {});
const rid = (): string => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

function record(kind: "access" | "erasure", dry: boolean, c: Record<string, number>, extractRows: number, reason: string | null = null): string {
  const id = rid();
  ledger = [{ request_id: id, kind, dry_run: dry, key_count: Object.keys(c).length ? 1 : 0, rows_by_table: c, extract_rows: extractRows, reason, status: "done", actor: "admin@example.invalid", created_at: "2026-11-05T09:00:00Z" }, ...ledger];
  return id;
}

export function subjectRead(path: string): unknown {
  if (path !== "/admin/subject-requests") return NONE_SUBJECT;
  return ledger;
}

export function subjectWrite(method: string, path: string, body: unknown): unknown {
  if (method !== "POST") return NONE_SUBJECT;
  const b = (body ?? {}) as { subject?: string; dry_run?: boolean; confirm?: string; reason?: string; dry_run_id?: string };
  const subject = String(b.subject ?? "");
  if (path === "/admin/subject-requests/search") {
    const c = counts(subject);
    const e = live(subject) ? EXTRACTS : NO_EXTRACTS;
    const out: SubjectSearch = { request_id: record("access", true, c, e.rows), full_key: subject.includes("="), keys: live(subject) ? ["MATNR=SYNTH-0001"] : [], rows_by_table: c, extracts: e, total_rows: total(c, e) };
    return out;
  }
  if (path === "/admin/subject-requests/erase") {
    if (b.dry_run !== false) {
      const c = counts(subject);
      const e = live(subject) ? EXTRACTS : NO_EXTRACTS;
      const id = record("erasure", true, c, e.rows);
      dryId = id;
      const out: SubjectErase = { request_id: id, dry_run: true, keys: live(subject) ? ["MATNR=SYNTH-0001"] : [], rows_by_table: c, extracts: e, total_rows: total(c, e) };
      return out;
    }
    if (b.confirm !== "ERASE") throw new Refused(400, "confirm_required", "Type ERASE to confirm.");
    if ((b.reason ?? "").trim().length < 10) throw new Refused(400, "reason_required", "Give a reason of at least 10 characters.");
    if (!b.dry_run_id || b.dry_run_id !== dryId) throw new Refused(409, "dry_run_unknown", "That dry run does not exist for this subject.");
    const c = counts(subject);
    const id = record("erasure", false, c, EXTRACTS.rows, b.reason ?? null);
    erased = true;
    dryId = null;
    const out: SubjectErase = { request_id: id, dry_run: false, keys: ["MATNR=SYNTH-0001"], rows_by_table: c, extracts: EXTRACTS, total_rows: total(c, EXTRACTS), complete: true };
    return out;
  }
  return NONE_SUBJECT;
}
