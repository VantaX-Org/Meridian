/**
 * Cleansing fixture: eight weekly snapshots of the cleaning queue by status, the applied proposals still inside
 * their rollback window and the audit trail, shaped like api/routes/cleaning.py. A rollback moves the proposal out
 * of the applied list and writes an audit row, as the route does. The deadlines are relative to now so one proposal
 * is always past its window and the others are not.
 */
import type { CleaningAudit, CleaningItem, CleaningMetric } from "../cleaning";

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

let rolledBack = new Set<string>();
let extraAudit: CleaningAudit[] = [];

export const resetCleaningFixture = (): void => {
  rolledBack = new Set();
  extraAudit = [];
};

const ago = (h: number) => new Date(Date.now() - h * HOUR).toISOString();

function applied(): CleaningItem[] {
  return APPLIED.filter(([id]) => !rolledBack.has(id)).map(([id, object_type, record_key, h, before, after]) => ({
    id,
    object_type,
    status: "applied",
    record_key,
    applied_at: ago(h),
    rollback_deadline: ago(h - 72),
    record_data_before: before,
    record_data_after: after,
  }));
}

export function cleaningRead(path: string): unknown {
  if (path === "/cleaning/metrics") return { metrics: METRICS };
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

export function cleaningWrite(method: string, path: string): unknown {
  const m = method === "POST" ? /^\/cleaning\/rollback\/([^/]+)$/.exec(path) : null;
  if (!m) return NONE_CLEANING;
  const id = decodeURIComponent(m[1]);
  const row = APPLIED.find((r) => r[0] === id);
  if (!row || rolledBack.has(id)) return refuse("Only applied items can be rolled back");
  if (row[3] > 72) return refuse("Rollback window has expired");
  rolledBack.add(id);
  extraAudit = [{ id: `ca-rb-${id}`, action: "rolled_back", actor_name: "Demo user", record_key: row[2], object_type: row[1], created_at: new Date().toISOString() }, ...extraAudit];
  return { id, status: "rolled_back" };
}
