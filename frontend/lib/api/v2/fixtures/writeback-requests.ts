import type { ChangeRow, RequestDetail, RequestRow } from "@/lib/api/next/approvals";

/**
 * Fixture for the write-back request routes. The viewer (id "me") made request WB-1 and WB-2, so four eyes blocks them;
 * WB-3 was made by someone else and waits for the viewer; WB-4 is decided. Approve and reject change the in-memory rows.
 */
export const NONE_WB = Symbol("none-wb");

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

export function wbRead(path: string, params: Record<string, string | number | boolean | undefined>): unknown {
  if (path === "/writeback/requests") {
    const items = rows.filter((r) => !params.state || r.state === params.state).map(({ changes: _c, approvers: _a, ...row }) => row);
    return { items, live_enabled: true };
  }
  const m = /^\/writeback\/requests\/([^/]+)$/.exec(path);
  if (!m) return NONE_WB;
  const r = rows.find((x) => x.id === m[1]);
  if (!r) throw Object.assign(new Error("not found"), { response: { status: 404, data: { detail: "That request does not exist." } } });
  return r;
}

export function wbWrite(method: string, path: string, body: unknown): unknown {
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
