/**
 * Verified fixes fixture, shaped like api/routes/aletheia_fix_drafts.py: per-object coverage and two pending drafts.
 * Approve and reject flip the status. Masks are shapes (A upper, a lower, 9 digit), never values; no record names a person.
 */
import type { FixDraft, FixCoverage } from "../fix-drafts";

export const NONE_FIX_DRAFTS = Symbol("not a fix drafts path");

const refuse = (status: number, detail: unknown): never => {
  throw Object.assign(new Error(String(detail)), { status, response: { status, data: { detail } } });
};

const LEGEND = { A: "upper-case letter", a: "lower-case letter", "9": "digit", "~": "space", "?": "other character" };

const seed = (): FixDraft[] => [
  {
    rule_id: "MM_FIX_DEMO_1", module: "material_master", field: "MARA.MATNR", rule_text: "Material number must be upper case", field_text: "Material number",
    status: "pending", source: "deterministic", steps: [{ op: "upper" }], confidence: "low", errors: [], llm_tried: false, drafted_at: "2026-11-04T08:10:00+00:00",
    shape: { total_failing: 412, blank: 0, masks: [{ mask: "aaa999", count: 301 }, { mask: "Aaa999", count: 111 }], other_masks: 0, lengths: [{ length: 6, count: 412 }], case: { upper: 0, lower: 301, mixed: 111 }, leading_ws: 0, trailing_ws: 0, inner_ws: 0, legend: LEGEND },
    verification: { failing: 412, fixed: 412, rejected: 0, still_failing: 0, touched_passing: 0, broken: 0 },
  },
  {
    rule_id: "SD_FIX_DEMO_2", module: "sd_customer_master", field: "KNA1.SORTL", rule_text: "Search term must be upper case without spaces", field_text: "Sort field",
    status: "pending", source: "llm", steps: [{ op: "strip" }, { op: "upper" }], confidence: "low", errors: [], llm_tried: true, drafted_at: "2026-11-04T08:12:00+00:00",
    shape: { total_failing: 96, blank: 0, masks: [{ mask: "~AAAA", count: 40 }, { mask: "aaaa", count: 56 }], other_masks: 0, lengths: [{ length: 4, count: 56 }, { length: 5, count: 40 }], case: { upper: 40, lower: 56, mixed: 0 }, leading_ws: 40, trailing_ws: 0, inner_ws: 0, legend: LEGEND },
    verification: { failing: 96, fixed: 90, rejected: 0, still_failing: 6, touched_passing: 0, broken: 0 },
  },
];

const COVERAGE: FixCoverage[] = [
  { module: "material_master", rules: 876, with_fix: 244 },
  { module: "sd_customer_master", rules: 567, with_fix: 116 },
  { module: "employee_central", rules: 654, with_fix: 93 },
  { module: "business_partner", rules: 157, with_fix: 9 },
  { module: "hcm", rules: 117, with_fix: 4 },
];

let state = seed();
export const resetFixDrafts = () => { state = seed(); };

export function fixDraftsRead(path: string): unknown {
  if (path === "/aletheia/fix-drafts/coverage") return { modules: COVERAGE };
  return path === "/aletheia/fix-drafts" ? { drafts: state } : NONE_FIX_DRAFTS;
}

export function fixDraftsWrite(method: string, path: string, body: unknown): unknown {
  if (method !== "POST" || !path.startsWith("/aletheia/fix-drafts")) return NONE_FIX_DRAFTS;
  const m = path.match(/^\/aletheia\/fix-drafts\/([^/]+)\/(approve|reject)$/);
  if (m) {
    const d = state.find((x) => x.rule_id === m[1]);
    if (!d) return refuse(404, "No draft for this rule.");
    if (d.status !== "pending") return refuse(409, "The draft is already decided.");
    d.status = m[2] === "approve" ? "approved" : "rejected";
    d.note = (body as { note?: string } | undefined)?.note ?? null;
    return d;
  }
  return refuse(409, "No extraction to draft against.");
}
