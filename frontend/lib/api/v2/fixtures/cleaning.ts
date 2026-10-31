/**
 * Cleansing fixture: eight weekly snapshots of the cleaning queue by status, the applied proposals still inside
 * their rollback window and the audit trail, shaped like api/routes/cleaning.py. A rollback moves the proposal out
 * of the applied list and writes an audit row, as the route does. The deadlines are relative to now so one proposal
 * is always past its window and the others are not.
 */
import type { CleaningAudit, CleaningGroup, CleaningItem, CleaningMetric, Proposal } from "../cleaning";

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
  ["cq-2005", "material_master", "GEWEI", "Weight unit set where a gross weight is given", "MATNR 000000000010006230", 0.62, { GEWEI: "", BRGEW: "410" }, { GEWEI: "G", BRGEW: "410" }, "detected"],
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

export const resetCleaningFixture = (): void => {
  rolledBack = new Set();
  extraAudit = [];
  decided = new Map();
  appliedNow = new Map();
};

const statusOf = (p: (typeof PROPOSALS)[number]) => decided.get(p[0]) ?? p[8];

function proposals(): Proposal[] {
  return PROPOSALS.map((p) => {
    const [id, object_type, kind, , record_key, confidence, before, after] = p;
    return {
      id, object_type, status: statusOf(p), record_key, confidence, priority: null, detected_at: RUN.run_at,
      applied_at: appliedNow.get(id) ?? null, rollback_deadline: null, record_data_before: before, record_data_after: after,
      merge_preview: {}, version_id: RUN.version_id, rule_id: RULE_ID[kind],
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

export function cleaningRead(path: string, params: Record<string, unknown> = {}): unknown {
  if (path === "/cleaning/metrics") return { metrics: METRICS };
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
  if (path === "/cleaning/bulk-approve") {
    const min = Number(body.min_confidence ?? 0);
    const hit = PROPOSALS.filter((p) => ["detected", "recommended"].includes(statusOf(p)) && (!body.kind || p[2] === body.kind) && p[5] >= min);
    for (const p of hit) { decided.set(p[0], "approved"); audit("approved", p); }
    return { approved_count: hit.length, skipped_count: 0 };
  }
  const d = /^\/cleaning\/(approve|reject|apply)\/([^/]+)$/.exec(path);
  if (d) {
    const p = PROPOSALS.find((r) => r[0] === decodeURIComponent(d[2]));
    if (!p) return refuse("Item not found");
    const st = statusOf(p);
    if (d[1] === "apply") {
      if (st !== "approved") return refuse("Item must be approved before applying");
      decided.set(p[0], "applied");
      appliedNow.set(p[0], new Date().toISOString());
      audit("applied", p);
      return { id: p[0], status: "applied", rollback_deadline: new Date(Date.now() + 72 * HOUR).toISOString() };
    }
    if (!["detected", "recommended"].includes(st)) return refuse(`Item is ${st}`);
    if (d[1] === "reject" && !String(body.reason ?? "").trim()) return refuse("A reason is required");
    const to = d[1] === "approve" ? "approved" : "rejected";
    decided.set(p[0], to);
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
