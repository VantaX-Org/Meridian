/**
 * Cleansing fixture: eight weekly snapshots of the cleaning queue by status, the applied proposals still inside
 * their rollback window and the audit trail, shaped like api/routes/cleaning.py. A rollback moves the proposal out
 * of the applied list and writes an audit row, as the route does. The deadlines are relative to now so one proposal
 * is always past its window and the others are not.
 */
import type { CleaningAudit, CleaningGroup, CleaningItem, CleaningMetric, DedupCandidate, MergePreview, Proposal, SafetyReport } from "../cleaning";

export const NONE_CLEANING = Symbol("not a cleaning path");

const HOUR = 3_600_000;
const refuse = (detail: string): never => {
  throw Object.assign(new Error(detail), { status: 400, response: { status: 400, data: { detail } } });
};
const WEEKS = ["2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30"];

// object, then per week: detected, recommended, approved, rejected, applied, verified, rolled back, auto approved
const SERIES: [string, [number, number, number, number, number, number, number, number][]][] = [
  ["material_master", [
    [3_410, 1_180, 220, 64, 410, 120, 6, 90], [3_022, 1_240, 260, 71, 690, 260, 9, 140], [2_704, 1_118, 240, 80, 1_020, 410, 11, 210],
    [2_366, 1_040, 300, 88, 1_310, 640, 14, 280], [2_018, 960, 280, 97, 1_640, 880, 15, 350], [1_744, 902, 260, 101, 1_930, 1_120, 18, 420],
    [1_502, 830, 240, 110, 2_180, 1_390, 19, 480], [1_288, 760, 210, 116, 2_402, 1_640, 21, 530],
  ]],
  ["business_partner", [
    [1_220, 410, 60, 22, 140, 30, 2, 20], [1_160, 430, 70, 25, 210, 70, 2, 40], [1_080, 420, 90, 27, 290, 110, 3, 60],
    [990, 400, 80, 30, 380, 160, 4, 80], [910, 390, 70, 31, 460, 220, 4, 100], [840, 370, 80, 33, 530, 280, 5, 120],
    [780, 350, 70, 35, 590, 330, 6, 130], [720, 330, 60, 36, 650, 380, 6, 140],
  ]],
  ["sd_customer_master", [
    [640, 180, 30, 9, 40, 0, 0, 0], [610, 190, 40, 10, 70, 10, 1, 10], [590, 200, 30, 12, 100, 30, 1, 20],
    [560, 190, 40, 13, 130, 50, 1, 30], [530, 180, 40, 14, 160, 70, 2, 40], [500, 170, 30, 15, 190, 90, 2, 50],
    [470, 160, 30, 16, 220, 110, 2, 50], [450, 150, 30, 16, 240, 130, 3, 60],
  ]],
];

const METRICS: CleaningMetric[] = WEEKS.flatMap((period, w) =>
  SERIES.map(([object_type, rows]) => {
    const [detected, recommended, approved, rejected, applied, verified, rolled_back, auto_approved] = rows[w];
    return { period, period_type: "weekly", object_type, detected, recommended, approved, rejected, applied, verified, rolled_back, auto_approved };
  }),
).reverse();

// id, object, record key, hours since applied, before, after
const APPLIED: [string, string, string, number, Record<string, string>, Record<string, string>][] = [
  ["cq-1001", "material_master", "MATNR 000000000010004711", 6, { MEINS: "ea", MTART: "ERSA" }, { MEINS: "EA", MTART: "ERSA" }],
  ["cq-1002", "material_master", "MATNR 000000000010004802", 14, { MAKTX: "BEARING  ROLLER 6205 ", MATKL: "B100" }, { MAKTX: "BEARING ROLLER 6205", MATKL: "B100" }],
  ["cq-1003", "material_master", "MATNR 000000000010005130", 30, { GEWEI: "", BRGEW: "2.4" }, { GEWEI: "KG", BRGEW: "2.4" }],
  ["cq-1004", "business_partner", "PARTNER 0001000412", 41, { TEL_NUMBER: "011 555 0192" }, { TEL_NUMBER: "+27 11 555 0192" }],
  ["cq-1005", "sd_customer_master", "KUNNR 0000200318", 58, { LAND1: "ZA", REGIO: "gp" }, { LAND1: "ZA", REGIO: "GP" }],
  ["cq-1006", "material_master", "MATNR 000000000010003391", 80, { MEINS: "pc" }, { MEINS: "PC" }],
];

const AUDIT_SEED: [string, string, string, string, number][] = [
  ["applied", "Thandi Mokoena", "MATNR 000000000010004711", "material_master", 6],
  ["approved", "Thandi Mokoena", "MATNR 000000000010004711", "material_master", 7],
  ["applied", "scheduler", "MATNR 000000000010004802", "material_master", 14],
  ["auto_approved", "scheduler", "MATNR 000000000010004802", "material_master", 14],
  ["rejected", "Pieter van Wyk", "PARTNER 0001000377", "business_partner", 22],
  ["applied", "Pieter van Wyk", "MATNR 000000000010005130", "material_master", 30],
  ["applied", "Pieter van Wyk", "PARTNER 0001000412", "business_partner", 41],
  ["rolled_back", "Thandi Mokoena", "MATNR 000000000010002208", "material_master", 50],
];

// Proposals still to decide: id, object, kind, what it does, run, record key, confidence, before, after, status at start
const RUN = { version_id: "run-30", run_label: "Run 30", run_at: "2026-10-30T04:10:00Z" };
const PROPOSALS: [string, string, string, string, string, number, Record<string, string>, Record<string, string>, string][] = [
  ["cq-2001", "material_master", "MEINS", "Base unit in upper case", "MATNR 000000000010006120", 0.97, { MEINS: "ea" }, { MEINS: "EA" }, "recommended"],
  ["cq-2002", "material_master", "MEINS", "Base unit in upper case", "MATNR 000000000010006121", 0.95, { MEINS: "pc" }, { MEINS: "PC" }, "recommended"],
  ["cq-2003", "material_master", "MEINS", "Base unit in upper case", "MATNR 000000000010006188", 0.71, { MEINS: "e" }, { MEINS: "EA" }, "detected"],
  ["cq-2004", "material_master", "GEWEI", "Weight unit set where a gross weight is given", "MATNR 000000000010006202", 0.91, { GEWEI: "", BRGEW: "3.1" }, { GEWEI: "KG", BRGEW: "3.1" }, "recommended"],
  ["cq-2005", "material_master", "GEWEI", "Weight unit set where a gross weight is given", "MATNR 000000000010006230", 0.62, { GEWEI: "", BRGEW: "410" }, { GEWEI: "GR", BRGEW: "410" }, "detected"],
  ["cq-2006", "business_partner", "TEL_NUMBER", "Telephone number in international format", "PARTNER 0001000520", 0.93, { TEL_NUMBER: "011 555 0144" }, { TEL_NUMBER: "+27 11 555 0144" }, "recommended"],
  ["cq-2007", "business_partner", "TEL_NUMBER", "Telephone number in international format", "PARTNER 0001000533", 0.58, { TEL_NUMBER: "555 0101" }, { TEL_NUMBER: "+27 555 0101" }, "detected"],
  ["cq-2008", "sd_customer_master", "REGIO", "Region code in upper case", "KUNNR 0000200402", 0.96, { REGIO: "kzn" }, { REGIO: "KZN" }, "approved"],
  ["cq-2009", "material_master", "MEINS", "Base unit in upper case", "MATNR 000000000010006099", 0.98, { MEINS: "kg" }, { MEINS: "KG" }, "approved"],
];
const RULE_ID: Record<string, string> = { MEINS: "MM014", GEWEI: "MM031", TEL_NUMBER: "BP022", REGIO: "SD008" };

let rolledBack = new Set<string>();
let extraAudit: CleaningAudit[] = [];
let decided = new Map<string, string>();
let appliedNow = new Map<string, string>();
// Who approved: preset approvals belong to another steward; approvals made in the demo belong to the demo user.
let approvedBy = new Map<string, string>();

export const resetCleaningFixture = (): void => {
  rolledBack = new Set();
  extraAudit = [];
  decided = new Map();
  appliedNow = new Map();
  approvedBy = new Map();
  merged = new Set();
};

// The pairs the cleaning engine found, each with the two records it compared.
const DEDUP: [DedupCandidate, Record<string, string>, Record<string, string>][] = [
  [
    { id: "dd-1", object_type: "business_partner", record_key_a: "0000100231", record_key_b: "0000100877", match_score: 94, match_method: "fuzzy", status: "pending", created_at: "2026-10-30T06:10:00Z",
      match_fields: { NAME_ORG1: { a: "Komatsu Mining Corp", b: "Komatsu Mining Corp.", method: "fuzzy", score: 97 }, STCD1: { a: "4410187263", b: "4410187263", method: "exact" } } },
    { PARTNER: "0000100231", NAME_ORG1: "Komatsu Mining Corp", STCD1: "4410187263", CITY1: "Milwaukee", TEL_NUMBER: "" },
    { PARTNER: "0000100877", NAME_ORG1: "Komatsu Mining Corp.", STCD1: "4410187263", CITY1: "Milwaukee", TEL_NUMBER: "+1 414 671 4400" },
  ],
  [
    { id: "dd-2", object_type: "material_master", record_key_a: "000000000010004711", record_key_b: "000000000010006640", match_score: 88, match_method: "fuzzy", status: "pending", created_at: "2026-10-30T06:10:00Z",
      match_fields: { MAKTX: { a: "Hydraulic pump seal kit", b: "Seal kit, hydraulic pump", method: "token_sort", score: 88 } } },
    { MATNR: "000000000010004711", MAKTX: "Hydraulic pump seal kit", MEINS: "EA", EAN11: "" },
    { MATNR: "000000000010006640", MAKTX: "Seal kit, hydraulic pump", MEINS: "EA", EAN11: "4006381333931" },
  ],
];
let merged = new Set<string>();

function preview(a: Record<string, string>, b: Record<string, string>): MergePreview {
  // As the route does: each field keeps the longer of the two values.
  return Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].sort().map((f) => {
    const va = a[f] ?? "", vb = b[f] ?? "";
    return [f, { a: va, b: vb, survivor: va.length >= vb.length ? va : vb }];
  }));
}

const statusOf = (p: (typeof PROPOSALS)[number]) => decided.get(p[0]) ?? p[8];

function proposals(): Proposal[] {
  return PROPOSALS.map((p) => {
    const [id, object_type, kind, , record_key, confidence, before, after] = p;
    return {
      id, object_type, status: statusOf(p), record_key, confidence, priority: null, detected_at: RUN.run_at,
      applied_at: appliedNow.get(id) ?? null, rollback_deadline: null, record_data_before: before, record_data_after: after,
      merge_preview: {}, version_id: RUN.version_id, rule_id: RULE_ID[kind],
      approved_by: statusOf(p) === "approved" ? (approvedBy.get(id) ?? "u-steward") : null,
    };
  });
}

function groups(): { groups: CleaningGroup[]; records: number; confident: number; runs: number } {
  const open = PROPOSALS.filter((p) => ["detected", "recommended"].includes(statusOf(p)));
  const by = new Map<string, (typeof PROPOSALS)[number][]>();
  for (const p of open) by.set(`${p[1]}|${p[2]}`, [...(by.get(`${p[1]}|${p[2]}`) ?? []), p]);
  const out = [...by.values()].map((ps): CleaningGroup => ({
    version_id: RUN.version_id, object_type: ps[0][1], kind: ps[0][2], rule_name: ps[0][3], records: ps.length,
    avg_confidence: ps.reduce((a, p) => a + p[5], 0) / ps.length, confident: ps.filter((p) => p[5] >= 0.85).length,
    run_label: RUN.run_label, run_at: RUN.run_at,
  })).sort((a, b) => b.records - a.records);
  return { groups: out, records: open.length, confident: open.filter((p) => p[5] >= 0.85).length, runs: out.length ? 1 : 0 };
}

const audit = (action: string, p: (typeof PROPOSALS)[number]) => {
  extraAudit = [{ id: `ca-${action}-${p[0]}`, action, actor_name: "Demo user", record_key: p[4], object_type: p[1], created_at: new Date().toISOString() }, ...extraAudit];
};

const ago = (h: number) => new Date(Date.now() - h * HOUR).toISOString();

function applied(): CleaningItem[] {
  const now = proposals().filter((p) => p.status === "applied").map((p) => ({ ...p, rollback_deadline: new Date(Date.now() + 72 * HOUR).toISOString() }));
  return [...now, ...APPLIED.filter(([id]) => !rolledBack.has(id)).map(([id, object_type, record_key, h, before, after]) => ({
    id,
    object_type,
    status: "applied",
    record_key,
    applied_at: ago(h),
    rollback_deadline: ago(h - 72),
    record_data_before: before,
    record_data_after: after,
  }))];
}

// The waiting proposals' new values as api/services/ddic_value_check.py checks them against the ECC 6 dictionary and
// the SAP-standard baseline (no live configuration here). cq-2005's GR is not a unit in T006; TEL_NUMBER has no one field.
const SAFETY = {
  items: [
    {"id": "cq-2001", "record_key": "MATNR 000000000010006120", "object_type": "material_master", "value": "EA", "field": "MARA.MEINS", "verdict": "safe", "reasons": [], "evidence": {"field": "MARA.MEINS", "value": "EA", "stored": "EA", "field_text": "Base Unit of Measure", "data_element": "MEINS", "domain": "MEINS", "type": "UNIT", "length": 3, "decimals": 0, "check_table": "T006", "check_field": "MSEHI", "conversion_exit": "CUNIT", "lowercase": true, "fixed_values": [], "source": "baseline", "checks": [{"check": "type", "verdict": "pass", "reason": null}, {"check": "conversion_exit", "verdict": "skip", "reason": "CUNIT converts the value on input; not run here"}, {"check": "check_table", "verdict": "pass", "reason": "EA is in T006 (baseline)"}], "verdict": "safe", "nearest": [], "reasons": []}},
    {"id": "cq-2002", "record_key": "MATNR 000000000010006121", "object_type": "material_master", "value": "PC", "field": "MARA.MEINS", "verdict": "safe", "reasons": [], "evidence": {"field": "MARA.MEINS", "value": "PC", "stored": "PC", "field_text": "Base Unit of Measure", "data_element": "MEINS", "domain": "MEINS", "type": "UNIT", "length": 3, "decimals": 0, "check_table": "T006", "check_field": "MSEHI", "conversion_exit": "CUNIT", "lowercase": true, "fixed_values": [], "source": "baseline", "checks": [{"check": "type", "verdict": "pass", "reason": null}, {"check": "conversion_exit", "verdict": "skip", "reason": "CUNIT converts the value on input; not run here"}, {"check": "check_table", "verdict": "pass", "reason": "PC is in T006 (baseline)"}], "verdict": "safe", "nearest": [], "reasons": []}},
    {"id": "cq-2003", "record_key": "MATNR 000000000010006188", "object_type": "material_master", "value": "EA", "field": "MARA.MEINS", "verdict": "safe", "reasons": [], "evidence": {"field": "MARA.MEINS", "value": "EA", "stored": "EA", "field_text": "Base Unit of Measure", "data_element": "MEINS", "domain": "MEINS", "type": "UNIT", "length": 3, "decimals": 0, "check_table": "T006", "check_field": "MSEHI", "conversion_exit": "CUNIT", "lowercase": true, "fixed_values": [], "source": "baseline", "checks": [{"check": "type", "verdict": "pass", "reason": null}, {"check": "conversion_exit", "verdict": "skip", "reason": "CUNIT converts the value on input; not run here"}, {"check": "check_table", "verdict": "pass", "reason": "EA is in T006 (baseline)"}], "verdict": "safe", "nearest": [], "reasons": []}},
    {"id": "cq-2004", "record_key": "MATNR 000000000010006202", "object_type": "material_master", "value": "KG", "field": "MARA.GEWEI", "verdict": "safe", "reasons": [], "evidence": {"field": "MARA.GEWEI", "value": "KG", "stored": "KG", "field_text": "Weight Unit", "data_element": "GEWEI", "domain": "MEINS", "type": "UNIT", "length": 3, "decimals": 0, "check_table": "T006", "check_field": "MSEHI", "conversion_exit": "CUNIT", "lowercase": true, "fixed_values": [], "source": "baseline", "checks": [{"check": "type", "verdict": "pass", "reason": null}, {"check": "conversion_exit", "verdict": "skip", "reason": "CUNIT converts the value on input; not run here"}, {"check": "check_table", "verdict": "pass", "reason": "KG is in T006 (baseline)"}], "verdict": "safe", "nearest": [], "reasons": []}},
    {"id": "cq-2004", "record_key": "MATNR 000000000010006202", "object_type": "material_master", "value": "3.1", "field": "MARA.BRGEW", "verdict": "safe", "reasons": [], "evidence": {"field": "MARA.BRGEW", "value": "3.1", "stored": "3.1", "field_text": "Gross weight", "data_element": "BRGEW", "domain": "MENG13", "type": "QUAN", "length": 13, "decimals": 3, "check_table": null, "check_field": null, "conversion_exit": null, "lowercase": false, "fixed_values": [], "source": null, "checks": [{"check": "type", "verdict": "pass", "reason": null}], "verdict": "safe", "nearest": [], "reasons": []}},
    {"id": "cq-2005", "record_key": "MATNR 000000000010006230", "object_type": "material_master", "value": "GR", "field": "MARA.GEWEI", "verdict": "reject", "reasons": ["not in check table T006 (baseline)"], "evidence": {"field": "MARA.GEWEI", "value": "GR", "stored": "GR", "field_text": "Weight Unit", "data_element": "GEWEI", "domain": "MEINS", "type": "UNIT", "length": 3, "decimals": 0, "check_table": "T006", "check_field": "MSEHI", "conversion_exit": "CUNIT", "lowercase": true, "fixed_values": [], "source": "baseline", "checks": [{"check": "type", "verdict": "pass", "reason": null}, {"check": "conversion_exit", "verdict": "skip", "reason": "CUNIT converts the value on input; not run here"}, {"check": "check_table", "verdict": "fail", "reason": "not in check table T006 (baseline)"}], "verdict": "reject", "nearest": [{"code": "G", "text": "Gram"}, {"code": "KG", "text": "Kilogram"}, {"code": "HR", "text": "Hour"}], "reasons": ["not in check table T006 (baseline)"]}},
    {"id": "cq-2005", "record_key": "MATNR 000000000010006230", "object_type": "material_master", "value": "410", "field": "MARA.BRGEW", "verdict": "safe", "reasons": [], "evidence": {"field": "MARA.BRGEW", "value": "410", "stored": "410", "field_text": "Gross weight", "data_element": "BRGEW", "domain": "MENG13", "type": "QUAN", "length": 13, "decimals": 3, "check_table": null, "check_field": null, "conversion_exit": null, "lowercase": false, "fixed_values": [], "source": null, "checks": [{"check": "type", "verdict": "pass", "reason": null}], "verdict": "safe", "nearest": [], "reasons": []}},
    {"id": "cq-2006", "record_key": "PARTNER 0001000520", "object_type": "business_partner", "value": "+27 11 555 0144", "field": null, "verdict": "unknown", "reasons": ["TEL_NUMBER could not be matched to one SAP field, so it was not checked"]},
    {"id": "cq-2007", "record_key": "PARTNER 0001000533", "object_type": "business_partner", "value": "+27 555 0101", "field": null, "verdict": "unknown", "reasons": ["TEL_NUMBER could not be matched to one SAP field, so it was not checked"]},
  ],
  totals: {"checked": 9, "safe": 6, "reject": 1, "unknown": 2},
  truncated: false,
} satisfies SafetyReport;

export function cleaningRead(path: string, params: Record<string, unknown> = {}): unknown {
  if (path === "/cleaning/metrics") return { metrics: METRICS };
  if (path === "/cleaning/queue/safety") return SAFETY;
  if (path === "/cleaning/queue/groups") return groups();
  if (path === "/cleaning/queue" && params.status && params.status !== "applied") {
    const want = String(params.status).split(",");
    const items = proposals().filter((p, i) => want.includes(p.status) && (!params.kind || PROPOSALS[i][2] === params.kind));
    return { items, total: items.length, page: 1, per_page: 50 };
  }
  if (path === "/cleaning/queue") {
    const items = applied();
    return { items, total: items.length, page: 1, per_page: 100 };
  }
  if (path === "/dedup/candidates") {
    const items = DEDUP.map(([c]) => c).filter((c) => !merged.has(c.id));
    return { items, total: items.length, page: 1, per_page: 50 };
  }
  if (path === "/cleaning/export-options") {
    const all = [...new Map([...proposals(), ...applied()].map((r) => [r.id, r])).values()];
    const count = (key: "object_type" | "status") => [...new Set(all.map((r) => r[key]))].sort().map((value) => ({ value, count: all.filter((r) => r[key] === value).length }));
    return { object_types: count("object_type"), statuses: count("status") };
  }
  if (path === "/cleaning/audit") {
    const items = [
      ...extraAudit,
      ...AUDIT_SEED.map(([action, actor_name, record_key, object_type, h], i) => ({ id: `ca-${i}`, action, actor_name, record_key, object_type, created_at: ago(h) })),
    ];
    return { items, total: items.length, page: 1, per_page: 25 };
  }
  return NONE_CLEANING;
}

export function cleaningWrite(method: string, path: string, body: Record<string, unknown> = {}): unknown {
  if (method !== "POST") return NONE_CLEANING;
  if (path === "/ai/feedback") return { id: "fb-1", status: "recorded" };
  if (path === "/dedup/preview") {
    const hit = DEDUP.find(([c]) => c.record_key_a === body.record_key_a && c.record_key_b === body.record_key_b);
    return { merge_preview: hit ? preview(hit[1], hit[2]) : {}, record_key_a: body.record_key_a, record_key_b: body.record_key_b };
  }
  if (path === "/dedup/merge") {
    const hit = DEDUP.find(([c]) => c.id === body.candidate_id);
    if (!hit) return refuse("Dedup candidate not found");
    if (merged.has(hit[0].id)) return refuse("This candidate has already been merged");
    if (![hit[0].record_key_a, hit[0].record_key_b].includes(String(body.survivor_key))) return refuse("survivor_key must be one of the candidate's two records.");
    if (!String(body.reason ?? "").trim()) return refuse("A reason is required");
    merged.add(hit[0].id);
    return { status: "merged", survivor_key: body.survivor_key };
  }
  if (path === "/cleaning/bulk-approve") {
    const min = Number(body.min_confidence ?? 0);
    const hit = PROPOSALS.filter((p) => ["detected", "recommended"].includes(statusOf(p)) && (!body.kind || p[2] === body.kind) && p[5] >= min);
    for (const p of hit) { decided.set(p[0], "approved"); approvedBy.set(p[0], "u-me"); audit("approved", p); }
    return { approved_count: hit.length, skipped_count: 0 };
  }
  const d = /^\/cleaning\/(approve|reject|apply)\/([^/]+)$/.exec(path);
  if (d) {
    const p = PROPOSALS.find((r) => r[0] === decodeURIComponent(d[2]));
    if (!p) return refuse("Item not found");
    const st = statusOf(p);
    if (d[1] === "apply") {
      if (st !== "approved") return refuse("Item must be approved before applying");
      if (approvedBy.get(p[0]) === "u-me") return refuse("A different user must mark this change as loaded");
      decided.set(p[0], "applied");
      appliedNow.set(p[0], new Date().toISOString());
      audit("applied", p);
      return { id: p[0], status: "applied", rollback_deadline: new Date(Date.now() + 72 * HOUR).toISOString() };
    }
    if (!["detected", "recommended"].includes(st)) return refuse(`Item is ${st}`);
    if (d[1] === "reject" && !String(body.reason ?? "").trim()) return refuse("A reason is required");
    const to = d[1] === "approve" ? "approved" : "rejected";
    decided.set(p[0], to);
    if (to === "approved") approvedBy.set(p[0], "u-me");
    audit(to, p);
    return { id: p[0], status: to };
  }
  const m = /^\/cleaning\/rollback\/([^/]+)$/.exec(path);
  if (!m) return NONE_CLEANING;
  const id = decodeURIComponent(m[1]);
  const row = APPLIED.find((r) => r[0] === id);
  if (!row || rolledBack.has(id)) return refuse("Only applied items can be rolled back");
  if (row[3] > 72) return refuse("Rollback window has expired");
  rolledBack.add(id);
  extraAudit = [{ id: `ca-rb-${id}`, action: "rolled_back", actor_name: "Demo user", record_key: row[2], object_type: row[1], created_at: new Date().toISOString() }, ...extraAudit];
  return { id, status: "rolled_back" };
}
