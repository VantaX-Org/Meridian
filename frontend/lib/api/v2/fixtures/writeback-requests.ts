import type { ChangeRow, RequestDetail, RequestRow } from "@/lib/api/next/approvals";

/**
 * Fixture for the write-back request routes. The viewer (id "me") made request WB-1 and WB-2, so four eyes blocks them;
 * WB-3 was made by someone else and waits for the viewer; WB-4 is decided. Approve and reject change the in-memory rows.
 */
export const NONE_WB = Symbol("none-wb");

const ROW_KEYS: (keyof RequestRow)[] = [
  "id", "state", "finding_id", "version_id", "module", "check_id", "rule_message", "requested_by", "requested_by_name",
  "approved_by_name", "rejected_by_name", "records_updated", "sap_host", "created_at", "applied_at", "rejected_at", "reject_reason",
];

const CHANGES: ChangeRow[] = [
  { record_key: "MARA|000000000000100200", field: "MARA.MEINS", before: "PCE", after: "EA", delivery: "bapi", bapi: "BAPI_MATERIAL_SAVEDATA", reason: null },
  { record_key: "MARA|000000000000100201", field: "MARA.MATKL", before: "", after: "FG100", delivery: "bapi", bapi: "BAPI_MATERIAL_SAVEDATA", reason: null },
  { record_key: "MARA|000000000000100202", field: "MARA.BISMT", before: "OLD-77", after: "NEW-77", delivery: "export", bapi: null, reason: "No BAPI carries this field." },
];

const base = (id: string, who: string, mine: boolean, state: RequestRow["state"]): RequestDetail => ({
  id, state, finding_id: `F-${id}`, version_id: "run-1", module: "material_master", check_id: "MM142",
  rule_message: "Base unit of measure is not a valid ISO unit", requested_by: mine ? "me" : "u2", requested_by_name: who,
  approved_by_name: state === "approved" ? "Second Reviewer" : null, rejected_by_name: null, records_updated: state === "approved" ? 3 : 0,
  sap_host: "sandbox", created_at: "2026-11-12T09:00:00Z", applied_at: state === "approved" ? "2026-11-12T10:00:00Z" : null,
  rejected_at: null, reject_reason: null, changes: CHANGES, approvers: ["Second Reviewer"], is_requester: mine,
  can_decide: state === "pending" && !mine, cannot_decide_reason: state !== "pending" ? "not_pending" : mine ? "own_request" : null,
  errors: [], live_enabled: true, undo_available: false,
  undo_note: "SAP's previous values are not stored by a write-back, so it cannot be reversed here. The before column is the value Meridian found at the last run.",
});

const seed = (): RequestDetail[] => [base("WB-1", "Test Requester", true, "pending"), base("WB-2", "Test Requester", true, "pending"), base("WB-3", "Other Steward", false, "pending"), base("WB-4", "Other Steward", false, "approved")];
let rows = seed();
export const resetWbFixture = () => { rows = seed(); };

/** One failing rule whose record fixes are structured (auto_fix, record_key, field, proposed_value): what POST /writeback takes. */
const FINDING_FIXES = CHANGES.map((c) => ({ record_key: c.record_key, field: c.field, invalid_value: c.before, proposed_value: c.after, auto_fix: true }));
export const WB_FINDINGS = {
  findings: [
    { id: "F-WB-1", version_id: "run-1", module: "material_master", check_id: "MM142", finding_type: "rule", severity: "high", affected_count: 3, total_count: 1284,
      details: { message: "Base unit of measure is not a valid ISO unit" }, record_fixes: FINDING_FIXES },
    { id: "F-WB-2", version_id: "run-1", module: "material_master", check_id: "MM077", finding_type: "rule", severity: "medium", affected_count: 12, total_count: 1284,
      details: { message: "Material description is empty" }, record_fixes: [{ record_id: "100300", id_field: "MATNR", invalid_value: "", fix_instruction: "Enter a description", sql_statement: null }] },
  ],
  total: 2,
};

export function wbRead(path: string, params: Record<string, string | number | boolean | undefined>): unknown {
  // The write-back screen's read: failing rules across every object (no module), with their record fixes.
  if (path === "/findings" && params.failing === true && params.type === "rule" && params.module === undefined) return WB_FINDINGS;
  if (path === "/writeback/requests") {
    // The list sends RequestRow only; the viewer's verdict, errors and undo note come with the detail.
    const items = rows.filter((r) => !params.state || r.state === params.state)
      .map((r) => Object.fromEntries(ROW_KEYS.map((k) => [k, r[k]])));
    return { items, live_enabled: true };
  }
  const m = /^\/writeback\/requests\/([^/]+)$/.exec(path);
  if (!m) return NONE_WB;
  const r = rows.find((x) => x.id === m[1]);
  if (!r) throw Object.assign(new Error("not found"), { response: { status: 404, data: { detail: "That request does not exist." } } });
  return r;
}

export function wbWrite(method: string, path: string, body: unknown): unknown {
  if (method === "POST" && path === "/writeback") {
    const b = body as { finding_id: string; record_fixes: { record_key: string; field: string; proposed_value: unknown }[]; system_id: string; dry_run?: boolean };
    const fields = b.record_fixes.map((f) => {
      const c = CHANGES.find((x) => x.record_key === f.record_key && x.field === f.field);
      return { record_key: f.record_key, field: f.field, supported: c?.delivery === "bapi", bapi: c?.bapi ?? null, reason: c?.reason ?? null, delivery: c?.delivery ?? "export" };
    });
    const dry = b.dry_run !== false;
    const id = `WB-${rows.length + 1}`;
    if (!dry) rows.push({ ...base(id, "You", true, "pending"), finding_id: b.finding_id });
    return { applied: 0, skipped: 0, errors: [], dry_run: dry, pending_approval_id: id, fields };
  }
  const m = /^\/writeback\/(approve|reject)\/([^/]+)$/.exec(path);
  if (method !== "POST" || !m) return NONE_WB;
  const r = rows.find((x) => x.id === m[2]);
  const fail = (status: number, detail: string): never => { throw Object.assign(new Error(detail), { response: { status, data: { detail } } }); };
  if (!r) return NONE_WB; // an id of the older pending-approval fixture
  if (r.state !== "pending") return fail(409, "That request was already decided.");
  if (r.is_requester) return fail(403, "You made this request. A second person must decide it.");
  if (m[1] === "approve") Object.assign(r, { state: "approved", approved_by_name: "You", records_updated: r.changes.length, can_decide: false, cannot_decide_reason: "not_pending" });
  else Object.assign(r, { state: "rejected", rejected_by_name: "You", reject_reason: (body as { reason?: string }).reason ?? null, can_decide: false, cannot_decide_reason: "not_pending" });
  return m[1] === "approve" ? { applied: r.changes.length, errors: [], status: "approved" } : { status: "rejected" };
}
