/**
 * The checks a cleaned workbook passes before it is uploaded, and the gate they make: a fail blocks the upload,
 * a warning needs a confirm, a clean list goes straight through. Pure, so the matrix is tested without a screen.
 */
export type CheckId = "structure" | "keys" | "domain" | "mandatory" | "deleted";
export type CheckStatus = "pass" | "warn" | "fail";
export interface UploadCheck {
  id: CheckId;
  status: CheckStatus;
  /** How many rows are behind a warn or fail. */
  count: number;
}

/** What is read from the workbook: the header row, the rows, the marker and the allowed values by field. */
export interface CleanedInput {
  headers: string[];
  rows: Record<string, string>[];
  /** Row count the exported workbook carried in its marker, when it did. */
  exportedRows?: number;
  allowed: Record<string, string[]>;
}

export const REQUIRED_HEADERS = ["Record key", "Field", "Corrected value"] as const; // i18n-ignore: workbook header names
const blank = (v: string | undefined) => v === undefined || v === "";

export function checkCleaned(input: CleanedInput): UploadCheck[] {
  const missing = REQUIRED_HEADERS.filter((h) => !input.headers.includes(h));
  const structure: UploadCheck = { id: "structure", status: missing.length ? "fail" : "pass", count: missing.length };
  if (missing.length) {
    const rest: CheckId[] = ["keys", "domain", "mandatory", "deleted"];
    return [structure, ...rest.map((id): UploadCheck => ({ id, status: "warn", count: 0 }))];
  }
  const edited = input.rows.filter((r) => !blank(r["Corrected value"]) && r["Corrected value"] !== r["Current value"]);
  const keyless = edited.filter((r) => blank(r["Record key"]) || blank(r.Field)).length;
  const seen = new Set<string>();
  let twice = 0;
  for (const r of edited) {
    const k = `${r["Record key"]}|${r.Field}`;
    if (seen.has(k)) twice += 1;
    seen.add(k);
  }
  const outside = edited.filter((r) => {
    const ok = input.allowed[r.Field];
    return ok && ok.length > 0 && !ok.includes(r["Corrected value"]);
  }).length;
  // A required field emptied: spaces only (not empty to Excel, empty to SAP) or the #CLEAR code.
  const emptied = input.rows.filter((r) => r["Required field empty"] === "Yes" && r["Corrected value"] !== undefined && r["Corrected value"] !== "" && (r["Corrected value"].trim() === "" || r["Corrected value"] === "#CLEAR")).length;
  // Without a row count in the marker nothing can be proved deleted, so the check passes.
  const gone = input.exportedRows !== undefined ? Math.max(0, input.exportedRows - input.rows.length) : 0;
  return [
    structure,
    { id: "keys", status: keyless ? "fail" : twice ? "warn" : "pass", count: keyless || twice },
    { id: "domain", status: outside ? "warn" : "pass", count: outside },
    { id: "mandatory", status: emptied ? "fail" : "pass", count: emptied },
    { id: "deleted", status: gone ? "fail" : "pass", count: gone },
  ];
}

/** "1,180 rows changed, 24 unchanged, 0 rejected": the rows the checks read. */
export function tally(input: CleanedInput, checks: UploadCheck[]): { changed: number; unchanged: number; rejected: number } {
  const edited = input.rows.filter((r) => !blank(r["Corrected value"]) && r["Corrected value"] !== r["Current value"]).length;
  const rejected = checks.filter((c) => c.status === "fail" && (c.id === "keys" || c.id === "mandatory")).reduce((s, c) => s + c.count, 0);
  return { changed: Math.max(0, edited - rejected), unchanged: input.rows.length - edited, rejected };
}

export type Gate = { state: "blocked" | "confirm" | "ready"; canUpload: boolean; fails: number; warns: number };

export function gate(checks: UploadCheck[], confirmed: boolean): Gate {
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  if (fails) return { state: "blocked", canUpload: false, fails, warns };
  if (warns) return { state: "confirm", canUpload: confirmed, fails, warns };
  return { state: "ready", canUpload: true, fails, warns };
}
