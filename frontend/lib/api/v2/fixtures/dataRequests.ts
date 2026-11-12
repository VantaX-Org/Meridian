/**
 * Data collection fixture, shaped like api/routes/data_collection.py: one request for a required-field rule with two
 * records. Submitting checks the value against the allowed list and moves the row to submitted. Synthetic keys only.
 */
import type { FindingOptions, RequestDetail, RequestItem, RequestSummary, SubmitOut } from "../data-requests";

export const NONE_DATA_REQUESTS = Symbol("not a data requests path");

const refuse = (status: number, detail: unknown): never => {
  throw Object.assign(new Error(String(detail)), { status, response: { status, data: { detail } } });
};

const ALLOWED = [{ value: "ROH", label: "Raw material" }, { value: "FERT", label: "Finished product" }];
const seed = (): RequestItem[] => [
  { id: "item-1", check_id: "FS-MARA-REQ", record_key: "MAT-0001", field: "MARA.MTART", field_label: "Material type", current_value: null, new_value: null, state: "open", max_length: 4, allowed_values: ALLOWED },
  { id: "item-2", check_id: "FS-MARA-REQ", record_key: "MAT-0002", field: "MARA.MTART", field_label: "Material type", current_value: null, new_value: null, state: "open", max_length: 4, allowed_values: ALLOWED },
];
let items = seed();
export const resetDataRequests = () => { items = seed(); };

const count = (s: string) => items.filter((i) => i.state === s).length;
const summary = (): RequestSummary => {
  const total = items.length;
  const approved = count("approved");
  return {
    id: "req-1", version_id: "v-1", module: "material_master", owner_id: "owner-1", owner_name: "Sam Owner", due_date: "2030-01-31", note: "Please fill the material type.",
    created_at: "2026-11-10T08:00:00+00:00", total, open: count("open"), submitted: count("submitted"), approved, rejected: count("rejected"),
    status: total && approved === total ? "approved" : count("open") === 0 && count("rejected") === 0 ? "submitted" : "open",
  };
};

export function dataRequestsRead(path: string): unknown {
  if (path === "/data-requests/findings") {
    const o: FindingOptions = { version_id: "v-1", module: "material_master", findings: [{ check_id: "FS-MARA-REQ", field: "MARA.MTART", field_label: "Material type", failing: 2, required_empty: true }] };
    return o;
  }
  if (path === "/data-requests") return [summary()];
  if (path === "/data-requests/req-1") { const d: RequestDetail = { ...summary(), items }; return d; }
  return NONE_DATA_REQUESTS;
}

export function dataRequestsWrite(method: string, path: string, body: unknown): unknown {
  if (method !== "POST" || !path.startsWith("/data-requests")) return NONE_DATA_REQUESTS;
  if (path === "/data-requests") return summary();
  if (path !== "/data-requests/req-1/submit") return refuse(404, "No such request");
  const out: SubmitOut = { submitted: 0, errors: [] };
  for (const v of (body as { values: { item_id: string; value: string }[] }).values) {
    const it = items.find((i) => i.id === v.item_id);
    if (!it) continue;
    if (!ALLOWED.some((a) => a.value === v.value.trim())) { out.errors.push({ item_id: it.id, error: "Use one of the allowed values" }); continue; }
    it.state = "submitted";
    it.new_value = v.value.trim();
    out.submitted += 1;
  }
  return out;
}
