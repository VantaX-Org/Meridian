/**
 * Verified survivorship fixture, shaped like api/routes/aletheia_survivorship.py. Keys are synthetic; no value appears,
 * a candidate is its source and the shape of its value. A decision flips the pick and moves the accuracy counts.
 */
import type { AccuracyCounts, Survivorship, SurvivorshipAccuracy, SurvivorshipDecisionBody } from "../aletheia-survivorship";

export const NONE_SURVIVORSHIP = Symbol("not a survivorship path");

const refuse = (status: number, detail: unknown): never => {
  throw Object.assign(new Error(String(detail)), { status, response: { status, data: { detail } } });
};

const ok = [{ code: "SOURCE_KNOWN", passed: true }, { code: "VALUE_PRESENT", passed: true }, { code: "CONFIDENCE_VALID", passed: true }];

const seed = (): Survivorship => ({
  domains: [
    { domain: "material_master", verified: 41, rejected: 3 },
    { domain: "sd_customer_master", verified: 18, rejected: 2 },
  ],
  counts: { proposed: 2, approved: 51, rejected: 4, auto_applied: 2 },
  picks: [
    {
      domain: "material_master", sap_object_key: "MAT-000103", field: "MARA.MEINS", field_text: "Base unit of measure", recommended_source: "SYS_B", confidence: 0.74,
      reasoning: "SYS_B holds a value extracted 2026-11-03; the other source holds a value of a different shape.", verified: true, checks: ok, applied: false, state: "pending",
      candidates: [
        { source_system: "SYS_A", shape: "AAA", length: 3, blank: false, picked: false },
        { source_system: "SYS_B", shape: "AA", length: 2, blank: false, picked: true },
      ],
    },
    {
      domain: "material_master", sap_object_key: "MAT-000104", field: "MARA.BISMT", field_text: "Old material number", recommended_source: "SYS_A", confidence: 0.61,
      reasoning: "SYS_A holds the longer value; SYS_B holds a blank.", verified: true, checks: ok, applied: false, state: "pending",
      candidates: [
        { source_system: "SYS_A", shape: "AAA-9999", length: 8, blank: false, picked: true },
        { source_system: "SYS_B", shape: "", length: 0, blank: true, picked: false },
      ],
    },
    {
      domain: "material_master", sap_object_key: "MAT-000101", field: "MARA.MTART", field_text: "Material type", recommended_source: "SYS_A", confidence: 0.82,
      reasoning: "SYS_A holds a value extracted 2026-11-04; 1 of the other 2 sources hold the same value.", verified: true, checks: ok, applied: true, state: "pending",
      candidates: [
        { source_system: "SYS_A", shape: "AAAA", length: 4, blank: false, picked: true },
        { source_system: "SYS_B", shape: "AAAA", length: 4, blank: false, picked: false },
        { source_system: "SYS_C", shape: "", length: 0, blank: true, picked: false },
      ],
    },
    {
      domain: "material_master", sap_object_key: "MAT-000102", field: "MARA.MATKL", field_text: "Material group", recommended_source: "SYS_Z", confidence: 0, reasoning: "", verified: false,
      checks: [{ code: "SOURCE_KNOWN", passed: false }, { code: "VALUE_PRESENT", passed: false }, { code: "CONFIDENCE_VALID", passed: true }], applied: false, state: "pending", candidates: [],
    },
  ],
});

const seedAccuracy = (): SurvivorshipAccuracy => ({
  accepted: 31, overridden: 6, pending: 1, acceptance_rate: 0.8378, override_rate: 0.1622,
  by_object: [
    { domain: "material_master", accepted: 21, overridden: 2, pending: 1, acceptance_rate: 0.913, override_rate: 0.087 },
    { domain: "sd_customer_master", accepted: 10, overridden: 4, pending: 0, acceptance_rate: 0.7143, override_rate: 0.2857 },
  ],
  by_field: [
    { domain: "material_master", field: "MARA.MTART", field_text: "Material type", accepted: 12, overridden: 0, pending: 1, acceptance_rate: 1, override_rate: 0 },
    { domain: "material_master", field: "MARA.MATKL", field_text: "Material group", accepted: 9, overridden: 2, pending: 0, acceptance_rate: 0.8182, override_rate: 0.1818 },
    { domain: "sd_customer_master", field: "KNA1.SORTL", field_text: "Search term", accepted: 10, overridden: 4, pending: 0, acceptance_rate: 0.7143, override_rate: 0.2857 },
  ],
  by_week: [
    { week: "2026-10-12", accepted: 5, overridden: 3, pending: 0, acceptance_rate: 0.625, override_rate: 0.375 },
    { week: "2026-10-19", accepted: 8, overridden: 2, pending: 0, acceptance_rate: 0.8, override_rate: 0.2 },
    { week: "2026-10-26", accepted: 10, overridden: 1, pending: 0, acceptance_rate: 0.9091, override_rate: 0.0909 },
    { week: "2026-11-02", accepted: 8, overridden: 0, pending: 0, acceptance_rate: 1, override_rate: 0 },
  ],
  reason_codes: [
    { code: "wrong_source", text: "This source is not the right one for the field" },
    { code: "stale_value", text: "The picked value is out of date" },
    { code: "incomplete_value", text: "The picked value is incomplete" },
    { code: "format_issue", text: "The picked value is in the wrong format" },
    { code: "other", text: "Another reason" },
  ],
});

let data = seed();
let acc = seedAccuracy();
let approval = { required: true };
export const resetSurvivorship = () => { data = seed(); acc = seedAccuracy(); approval = { required: true }; };

export function survivorshipRead(path: string): unknown {
  // Clones, so React Query sees a new object after a write mutates the store.
  if (path === "/aletheia/survivorship/accuracy") return structuredClone(acc);
  if (path === "/aletheia/survivorship/approval-setting") return { ...approval };
  return path === "/aletheia/survivorship" ? structuredClone(data) : NONE_SURVIVORSHIP;
}

const bump = (c: AccuracyCounts, over: boolean) => {
  if (c.pending > 0) c.pending -= 1;
  if (over) c.overridden += 1; else c.accepted += 1;
  const n = c.accepted + c.overridden;
  c.acceptance_rate = Math.round((c.accepted / n) * 1e4) / 1e4;
  c.override_rate = Math.round((c.overridden / n) * 1e4) / 1e4;
};

export function survivorshipWrite(method: string, path: string, body: unknown): unknown {
  if (method === "PUT" && path === "/aletheia/survivorship/approval-setting") {
    approval = { required: Boolean((body as { required?: boolean }).required) };
    return approval;
  }
  if (method === "POST" && path === "/aletheia/survivorship/decision/bulk") {
    const failed: { domain: string; sap_object_key: string; field: string; detail: string }[] = [];
    let approved = 0;
    for (const r of (body as { picks: { domain: string; sap_object_key: string; field: string }[] }).picks) {
      try { survivorshipWrite("POST", "/aletheia/survivorship/decision", { ...r, decision: "accept" }); approved += 1; } catch (e) { failed.push({ ...r, detail: (e as Error).message }); }
    }
    return { approved, failed };
  }
  if (method !== "POST" || path !== "/aletheia/survivorship/decision") return NONE_SURVIVORSHIP;
  const b = body as SurvivorshipDecisionBody;
  const p = data.picks.find((x) => x.sap_object_key === b.sap_object_key && x.field === b.field && x.domain === b.domain);
  if (!p || !p.candidates.length) return refuse(409, "no AI pick for this record and field");
  if (p.state !== "pending") return refuse(409, "this pick has already been decided");
  const held = !p.applied;
  if (b.decision === "reject") {
    if (!b.note?.trim()) return refuse(422, "a rejection needs a reason");
    if (!held) return refuse(409, "this pick is already applied; override it with another source instead");
    p.state = "rejected";
    p.decided_source = p.recommended_source;
    p.note = b.note.trim();
    data.counts.proposed -= 1;
    data.counts.rejected += 1;
    return { decision: "reject", prior_source: p.recommended_source, new_source: p.recommended_source, field: b.field };
  }
  if (held) { data.counts.proposed -= 1; data.counts.approved += 1; } else { data.counts.auto_applied -= 1; data.counts.approved += 1; }
  const over = b.decision === "override";
  if (over && (!b.source_system || b.source_system === p.recommended_source || !p.candidates.some((c) => c.source_system === b.source_system))) {
    return refuse(409, "override must be one of the offered candidate sources");
  }
  const prior = p.recommended_source;
  const next = over ? (b.source_system as string) : prior;
  p.state = over ? "overridden" : "accepted";
  p.decided_source = next;
  p.reason_code = b.reason_code ?? null;
  bump(acc, over);
  const o = acc.by_object.find((x) => x.domain === p.domain);
  if (o) bump(o, over);
  const f = acc.by_field.find((x) => x.domain === p.domain && x.field === p.field);
  if (f) bump(f, over);
  return { decision: b.decision, prior_source: prior, new_source: next, field: b.field };
}
