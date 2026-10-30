import workJson from "./work.json";
import type { Batch, BatchDetail, BatchEvent, BatchItem } from "@/lib/api/remediation";
import type { BatchRowApi, SendResult } from "../batches";
import rulesJson from "./rules.json";
import type { Decision, WorkGroup, WorkIssue, WorkRecordDetail, WorkSummary } from "@/lib/api/work";
import type { RuleRow, WorkPage, WorkRow, WorkStatus } from "../types";
import type { DecideResult, GroupResult, ImportResult, RecordLinks, SavedView, UndoResult, WorkFilters } from "../work";

/**
 * The Work ledger in fixture mode (`/work?fixture=1`): a small in-memory copy of the work list that answers the same
 * reads as the API and applies the same writes, so deciding, undoing, saving a view and exporting can be built,
 * screenshotted and tested with no backend. The headline numbers are the prototype's (25,712 to fix, 3,418 with a
 * suggested value, 612 waiting for approval, 48 exceptions); the rows are a sample of them, as the first page of a
 * real list is.
 */

type Params = Record<string, string | number | boolean | undefined>;

const MODULE = "material_master";
const VERSION = (workJson as unknown as WorkPage).items[0].version_id ?? "d3229ded-0708-4967-9dfb-1b7f4fada953";
const HEADLINE = { to_fix: 25712, proposed_flag: 3418, waiting: 612, exceptions: 48, approved: 180, sent: 96 };
const ME = "me";

interface RuleMeta {
  id: string;
  message: string;
  field: string;
  fieldDescription: string;
  severity: WorkRow["severity"];
  dimension: string;
  records: number;
  proposed: number;
  suggestion: string | null;
  invalid: string[];
  values: { value: string; label: string | null }[];
  total: number;
  features: [string, "blocked" | "degraded"][];
}

// The units of measure the check table accepts: 38 of them, so the list in the inspector has more than it first shows.
const UOM: [string, string][] = [
  ["EA", "Each"], ["PC", "Piece"], ["KG", "Kilogram"], ["M", "Metre"], ["L", "Litre"], ["ST", "Piece (German)"], ["G", "Gram"], ["T", "Tonne"],
  ["LB", "Pound"], ["CM", "Centimetre"], ["MM", "Millimetre"], ["KM", "Kilometre"], ["IN", "Inch"], ["FT", "Foot"], ["ML", "Millilitre"],
  ["M2", "Square metre"], ["M3", "Cubic metre"], ["PAL", "Pallet"], ["BOX", "Box"], ["CAR", "Carton"], ["DR", "Drum"], ["BAG", "Bag"],
  ["ROL", "Roll"], ["SET", "Set"], ["PR", "Pair"], ["DZ", "Dozen"], ["H", "Hour"], ["MIN", "Minute"], ["S", "Second"], ["D", "Day"],
  ["MON", "Month"], ["YR", "Year"], ["KWH", "Kilowatt hour"], ["W", "Watt"], ["V", "Volt"], ["A", "Ampere"], ["BAR", "Bar"], ["PA", "Pascal"],
];
const RULE_DEF: Record<string, Omit<RuleMeta, "id" | "message" | "field" | "severity" | "records">> = {
  MM142: { fieldDescription: "Base unit of measure", dimension: "consistency", proposed: 112, suggestion: "EA", invalid: ["PCS", "STK", "EACH", "XX"], values: UOM.map(([value, label]) => ({ value, label })), total: 38, features: [["Migration cockpit: material load", "blocked"], ["Material ledger actual costing", "blocked"], ["Embedded EWM product master", "blocked"]] },
  MM003: { fieldDescription: "Material type", dimension: "completeness", proposed: 0, suggestion: null, invalid: [""], values: [["ROH", "Raw materials"], ["HALB", "Semifinished products"], ["FERT", "Finished products"], ["HAWA", "Trading goods"], ["ERSA", "Spare parts"]].map(([value, label]) => ({ value, label })), total: 12, features: [["Migration cockpit: material load", "blocked"], ["Embedded EWM product master", "blocked"]] },
  MM007: { fieldDescription: "Material group", dimension: "completeness", proposed: 640, suggestion: "0420", invalid: [""], values: [["0420", "Fasteners"], ["0430", "Seals and gaskets"], ["0510", "Hydraulics"], ["0620", "Electrical"], ["0710", "Lubricants"]].map(([value, label]) => ({ value, label })), total: 214, features: [["Product compliance", "degraded"]] },
  MM015: { fieldDescription: "Gross weight", dimension: "completeness", proposed: 0, suggestion: null, invalid: ["0"], values: [], total: 0, features: [["Advanced available-to-promise", "degraded"]] },
  MM302: { fieldDescription: "Purchasing group", dimension: "completeness", proposed: 880, suggestion: "P01", invalid: [""], values: [["P01", "Raw materials"], ["P02", "Spares"], ["P03", "Packaging"], ["P04", "Services"]].map(([value, label]) => ({ value, label })), total: 9, features: [["Source of supply determination", "degraded"]] },
  MM023: { fieldDescription: "MRP type", dimension: "validity", proposed: 700, suggestion: "PD", invalid: ["ND", "VB"], values: [["PD", "MRP"], ["VB", "Manual reorder point"], ["VV", "Forecast-based planning"], ["ND", "No planning"]].map(([value, label]) => ({ value, label })), total: 14, features: [["MRP Live", "degraded"]] },
  MM035: { fieldDescription: "Valuation class", dimension: "completeness", proposed: 520, suggestion: "3000", invalid: [""], values: [["3000", "Raw materials"], ["3100", "Operating supplies"], ["7900", "Services"], ["7920", "Trading goods"]].map(([value, label]) => ({ value, label })), total: 27, features: [["Inventory valuation by plant", "degraded"]] },
  MM028: { fieldDescription: "Procurement type", dimension: "validity", proposed: 566, suggestion: "F", invalid: [""], values: [["E", "In-house production"], ["F", "External procurement"], ["X", "Both types of procurement"]].map(([value, label]) => ({ value, label })), total: 3, features: [] },
};

const rawItems = (workJson as unknown as WorkPage).items;
const ruleRows = (rulesJson as unknown as { rules: RuleRow[] }).rules;

const RULES: Record<string, RuleMeta> = Object.fromEntries(
  ruleRows.map((r) => {
    const d = RULE_DEF[r.check_id];
    const first = rawItems.find((i) => i.checks[0] === r.check_id);
    return [r.check_id, { id: r.check_id, message: first?.top_message ?? r.name, field: r.field ?? first?.top_field ?? "", severity: r.severity, records: r.affected_count, ...d }];
  }),
);
const RULE_IDS = ruleRows.map((r) => r.check_id);

const SIGN_OFF: { by: string; note: [string, string] }[] = [
  { by: "T. Mokoena", note: ["Legacy material, blocked for use; the value is correct for the old plant", "Replaced by the new plant in wave 2; the risk is accepted until then"] },
  { by: "R. Govender", note: ["Service item: no unit of measure applies", "Migration cut-over is first; fix after go-live"] },
  { by: "P. Khumalo", note: ["Sample material, never procured", "Supplier will correct the master data in Q1"] },
];
const NAMES = ["Hex bolt M8 zinc", "Hydraulic hose 3/8 in", "Gasket flange DN50", "Relay 24 V DC 2 CO", "Grease EP2 18 kg", "Circuit breaker 3P 32A", "Pump seal kit KSB 80", "Ball bearing 6204-2RS", "Cable gland M20", "Filter cartridge 10 micron"];
const PLANTS = ["1000", "2000", "3000", "4000"];

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}
const pad = (n: number) => String(n).padStart(18, "0");
const plantLevel = (rule: string) => /^(MARC|MBEW)\./.test(RULES[rule]?.field ?? "");

function currentFor(rule: string, key: string): string {
  const inv = RULES[rule].invalid;
  return inv[hash(key + rule) % inv.length];
}

interface Row extends WorkRow {
  base_status: WorkStatus;
}

function withDerived(r: WorkRow): WorkRow {
  const rule = r.checks[0];
  const m = RULES[rule];
  const suggestion = r.suggested_value ?? null;
  return {
    ...r,
    current_value: currentFor(rule, r.record_key),
    possible_values: m.values.length ? m.values.slice(0, 8) : null,
    possible_values_total: m.values.length ? m.total : null,
    field_description: m.fieldDescription,
    new_value: r.new_value ?? null,
    suggested_value: suggestion,
  };
}

function buildRows(): Row[] {
  const out: Row[] = [];
  for (const r of rawItems) out.push({ ...withDerived({ ...r, status: "to_fix" }), module: r.module, version_id: r.version_id ?? VERSION, base_status: "to_fix" });
  // More rows to fix: lower value at risk than any above, every rule, plant keys on the plant-level rules.
  for (let i = 0; i < 76; i++) {
    const rule = RULE_IDS[(i * 3) % RULE_IDS.length];
    const m = RULES[rule];
    const matnr = pad(1100 + i * 37);
    const key = plantLevel(rule) ? `MATNR=${matnr}|WERKS=${PLANTS[i % 4]}` : `MATNR=${matnr}`;
    const suggested = m.suggestion && i % 3 !== 0 ? m.suggestion : null;
    out.push({
      ...withDerived({
        module: MODULE,
        version_id: VERSION,
        record_key: key,
        name: NAMES[(i * 7) % NAMES.length],
        issues: 1,
        severity: m.severity,
        checks: [rule],
        proposed: suggested ? 1 : 0,
        status: "to_fix",
        due_at: i % 11 === 0 ? "2026-10-10T00:00:00Z" : null,
        assigned_to: i % 5 === 0 ? "u-an" : null,
        assignee_email: i % 5 === 0 ? "a.naidoo@example.com" : null,
        top_message: m.message,
        top_field: m.field,
        first_seen_at: i % 4 === 0 ? "2026-10-02T05:11:00Z" : "2026-08-14T05:11:00Z",
        suggested_value: suggested,
        value_at_risk: Math.round(2500 * Math.pow(0.97, i)),
      }),
      base_status: "to_fix",
    });
  }
  // Waiting for approval: a value is in a draft fix batch.
  for (let i = 0; i < 24; i++) {
    const rule = RULE_IDS[(i * 5 + 1) % RULE_IDS.length];
    const m = RULES[rule];
    const matnr = pad(700 + i * 53);
    const value = m.suggestion ?? m.values[0]?.value ?? "1";
    out.push({
      ...withDerived({
        module: MODULE,
        version_id: VERSION,
        record_key: plantLevel(rule) ? `MATNR=${matnr}|WERKS=${PLANTS[i % 4]}` : `MATNR=${matnr}`,
        name: NAMES[(i * 3) % NAMES.length],
        issues: 1,
        severity: m.severity,
        checks: [rule],
        proposed: 1,
        status: "proposed",
        due_at: null,
        assigned_to: null,
        assignee_email: null,
        top_message: m.message,
        top_field: m.field,
        first_seen_at: "2026-09-12T05:11:00Z",
        suggested_value: m.suggestion,
        new_value: value,
        value_at_risk: Math.round(1800 * Math.pow(0.95, i)),
        ...(i < 14 ? { batch_id: "B-241", batch_name: "Unit of measure and material type" } : i < 21 ? { batch_id: "B-238", batch_name: "Purchasing and MRP data" } : { batch_id: "B-244", batch_name: "Fixes by Demo user" }),
      }),
      base_status: "proposed",
    });
  }
  // Approved, and sent to SAP: the rows of the two batches that have moved on.
  const later: [WorkStatus, string, string, number][] = [["approved", "B-236", "Material groups", 8], ["sent", "B-229", "Valuation classes", 6]];
  later.forEach(([status, batch, batchName, count], g) => {
    for (let i = 0; i < count; i++) {
      const rule = RULE_IDS[(i * 2 + g) % RULE_IDS.length];
      const m = RULES[rule];
      const matnr = pad(2100 + g * 400 + i * 41);
      out.push({
        ...withDerived({
          module: MODULE,
          version_id: VERSION,
          record_key: plantLevel(rule) ? `MATNR=${matnr}|WERKS=${PLANTS[i % 4]}` : `MATNR=${matnr}`,
          name: NAMES[(i * 4 + g) % NAMES.length],
          issues: 1,
          severity: m.severity,
          checks: [rule],
          proposed: 1,
          status,
          due_at: null,
          assigned_to: null,
          assignee_email: null,
          top_message: m.message,
          top_field: m.field,
          first_seen_at: "2026-08-30T05:11:00Z",
          suggested_value: m.suggestion,
          new_value: m.suggestion ?? m.values[0]?.value ?? "1",
          value_at_risk: Math.round(900 * Math.pow(0.93, i)),
          batch_id: batch,
          batch_name: batchName,
        }),
        base_status: status,
      });
    }
  });
  // Exceptions: signed off as not an issue or accepted as a risk.
  for (let i = 0; i < 12; i++) {
    const rule = RULE_IDS[(i * 5 + 2) % RULE_IDS.length];
    const m = RULES[rule];
    const matnr = pad(1500 + i * 67);
    out.push({
      ...withDerived({
        module: MODULE,
        version_id: VERSION,
        record_key: plantLevel(rule) ? `MATNR=${matnr}|WERKS=${PLANTS[i % 4]}` : `MATNR=${matnr}`,
        name: NAMES[(i * 9) % NAMES.length],
        issues: 1,
        severity: m.severity,
        checks: [rule],
        proposed: 0,
        status: "not_an_issue",
        due_at: null,
        assigned_to: null,
        assignee_email: null,
        top_message: m.message,
        top_field: m.field,
        first_seen_at: "2026-07-03T05:11:00Z",
        suggested_value: null,
        resolution: i % 3 === 0 ? "accepted_risk" : "false_positive",
        resolution_note: SIGN_OFF[i % SIGN_OFF.length].note[i % 3 === 0 ? 1 : 0],
        resolved_by: SIGN_OFF[i % SIGN_OFF.length].by,
        resolved_at: `2026-10-${String(2 + (i % 12)).padStart(2, "0")}T0${(i % 8) + 1}:20:00Z`,
        value_at_risk: Math.round(1200 * Math.pow(0.9, i)),
      }),
      base_status: "not_an_issue",
    });
  }
  return out;
}

interface Override {
  status?: WorkStatus;
  new_value?: string | null;
  assigned_to?: string | null;
  assignee_email?: string | null;
  resolution?: "false_positive" | "accepted_risk" | null;
  resolution_note?: string | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
}
interface Delta {
  to_fix: number;
  proposed_flag: number;
  waiting: number;
  exceptions: number;
  approved: number;
  sent: number;
}
interface Done {
  id: string;
  kind: string;
  before: Map<string, Override | null>;
  delta: Delta;
  groupAccepted?: string;
  /** The batch a batch action changed, as it was. */
  batchBefore?: FxBatch;
  undone: boolean;
}

/** A fix batch of the fixture. Events are written per record, as the API writes them. */
export interface FxBatch {
  id: string;
  name: string;
  status: "draft" | "approved" | "exported";
  created_by: string;
  created_by_label: string;
  steward_label: string | null;
  created_at: string;
  approved_by: string | null;
  approved_by_label: string | null;
  approved_at: string | null;
  exported_at: string | null;
  items: number;
  value_at_risk: number;
  due_at: string | null;
  returned: { by: string; note: string; at: string } | null;
  events: { action: string; user_label: string; at: string; note: string | null }[];
}

function buildBatches(): FxBatch[] {
  const b = (x: Omit<FxBatch, "approved_by" | "approved_by_label" | "approved_at" | "exported_at" | "returned" | "events"> & Partial<FxBatch>): FxBatch => ({
    approved_by: null,
    approved_by_label: null,
    approved_at: null,
    exported_at: null,
    returned: null,
    events: [],
    ...x,
  });
  const created = (name: string, at: string) => ({ action: "created", user_label: name, at, note: null });
  return [
    b({ id: "B-241", name: "Unit of measure and material type", status: "draft", created_by: "u-rg", created_by_label: "R. Govender", steward_label: "A. Naidoo", created_at: "2026-10-14T08:10:00Z", items: 328, value_at_risk: 412600, due_at: "2026-10-23T00:00:00Z", events: [created("R. Govender", "2026-10-14T08:10:00Z"), { action: "proposed", user_label: "A. Naidoo", at: "2026-10-14T15:42:00Z", note: null }] }),
    b({ id: "B-238", name: "Purchasing and MRP data", status: "draft", created_by: "u-an", created_by_label: "A. Naidoo", steward_label: "A. Naidoo", created_at: "2026-10-13T10:30:00Z", items: 272, value_at_risk: 233400, due_at: "2026-10-28T00:00:00Z", events: [created("A. Naidoo", "2026-10-13T10:30:00Z")] }),
    b({ id: "B-244", name: "Fixes by Demo user", status: "draft", created_by: "u-me", created_by_label: "Demo user", steward_label: "Demo user", created_at: "2026-10-16T08:02:00Z", items: 12, value_at_risk: 9800, due_at: null, events: [created("Demo user", "2026-10-16T08:02:00Z")] }),
    b({ id: "B-236", name: "Material groups", status: "approved", created_by: "u-an", created_by_label: "A. Naidoo", steward_label: "A. Naidoo", created_at: "2026-10-09T09:00:00Z", approved_by: "u-tm", approved_by_label: "T. Mokoena", approved_at: "2026-10-15T11:05:00Z", items: 180, value_at_risk: 121300, due_at: "2026-10-30T00:00:00Z", events: [created("A. Naidoo", "2026-10-09T09:00:00Z"), { action: "approved", user_label: "T. Mokoena", at: "2026-10-15T11:05:00Z", note: null }] }),
    b({ id: "B-229", name: "Valuation classes", status: "exported", created_by: "u-rg", created_by_label: "R. Govender", steward_label: "R. Govender", created_at: "2026-10-02T09:00:00Z", approved_by: "u-tm", approved_by_label: "T. Mokoena", approved_at: "2026-10-08T10:00:00Z", exported_at: "2026-10-09T13:20:00Z", items: 96, value_at_risk: 64200, due_at: "2026-10-09T00:00:00Z", events: [created("R. Govender", "2026-10-02T09:00:00Z"), { action: "approved", user_label: "T. Mokoena", at: "2026-10-08T10:00:00Z", note: null }, { action: "exported", user_label: "R. Govender", at: "2026-10-09T13:20:00Z", note: "cockpit_xlsx" }] }),
  ];
}

const rowKey = (module: string, key: string) => `${module}:${key}`;
const zero = (): Delta => ({ to_fix: 0, proposed_flag: 0, waiting: 0, exceptions: 0, approved: 0, sent: 0 });

class WorkFixture {
  rows: Row[] = buildRows();
  batches: FxBatch[] = buildBatches();
  overrides = new Map<string, Override>();
  actions = new Map<string, Done>();
  accepted = new Set<string>();
  delta: Delta = zero();
  seq = 0;
  views: SavedView[] = [];
  history: Map<string, RecordLinks["history"]> = new Map();

  reset(): void {
    this.rows = buildRows();
    this.batches = buildBatches();
    this.overrides.clear();
    this.actions.clear();
    this.accepted.clear();
    this.delta = zero();
    this.seq = 0;
    this.views = [];
    this.history.clear();
  }

  row(module: string, key: string): Row | undefined {
    return this.rows.find((r) => r.module === module && r.record_key === key);
  }

  now(r: Row): Row {
    const o = this.overrides.get(rowKey(r.module, r.record_key));
    return o ? ({ ...r, ...stripUndefined(o) } as Row) : r;
  }

  open(): number {
    const c = this.counts();
    return c.to_fix + c.waiting + c.approved + c.sent;
  }
  counts(): Delta {
    return {
      to_fix: HEADLINE.to_fix + this.delta.to_fix,
      proposed_flag: HEADLINE.proposed_flag + this.delta.proposed_flag,
      waiting: HEADLINE.waiting + this.delta.waiting,
      exceptions: HEADLINE.exceptions + this.delta.exceptions,
      approved: HEADLINE.approved + this.delta.approved,
      sent: HEADLINE.sent + this.delta.sent,
    };
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

const state = new WorkFixture();
export const resetWorkFixture = (): void => state.reset();
/** The records the open number has moved since the page loaded: the landscape and the shell counts follow it. */
export const workOpenDelta = (): number => state.delta.to_fix + state.delta.waiting + state.delta.approved + state.delta.sent;

function fail(status: number, detail: string): never {
  throw Object.assign(new Error(detail), { status, response: { status, data: { detail } } });
}

const inSet = (r: Row, cat: keyof Delta): boolean =>
  cat === "to_fix" ? r.status === "to_fix" : cat === "proposed_flag" ? r.status === "to_fix" && !!r.suggested_value : cat === "waiting" ? r.status === "proposed" : cat === "approved" ? r.status === "approved" : cat === "sent" ? r.status === "sent" : r.status === "not_an_issue";

function deltaOf(before: Row, after: Row): Delta {
  const d = zero();
  (Object.keys(d) as (keyof Delta)[]).forEach((c) => {
    d[c] = (inSet(after, c) ? 1 : 0) - (inSet(before, c) ? 1 : 0);
  });
  return d;
}
const add = (a: Delta, b: Delta, sign = 1): Delta => ({ to_fix: a.to_fix + sign * b.to_fix, proposed_flag: a.proposed_flag + sign * b.proposed_flag, waiting: a.waiting + sign * b.waiting, exceptions: a.exceptions + sign * b.exceptions, approved: a.approved + sign * b.approved, sent: a.sent + sign * b.sent });

// Reads -----------------------------------------------------------------------------------------------------------

function matches(r: Row, p: Params): boolean {
  if (p.module && r.module !== p.module) return false;
  if (p.check_id && !r.checks.includes(String(p.check_id))) return false;
  const sev = p.severity ? String(p.severity) : "";
  if (sev === "blocking" ? !(r.severity === "critical" || r.severity === "high") : sev && r.severity !== sev) return false;
  const status = p.status ? String(p.status) : "to_fix";
  if (status === "open") {
    if (r.status !== "to_fix" && r.status !== "proposed" && r.status !== "approved" && r.status !== "sent") return false;
  } else if (status !== "all" && r.status !== status) return false;
  if (p.batch_id && r.batch_id !== p.batch_id) return false;
  if (p.assigned === "me" && r.assigned_to !== ME) return false;
  if (p.assigned === "unassigned" && r.assigned_to) return false;
  if (p.assigned && p.assigned !== "me" && p.assigned !== "unassigned" && r.assigned_to !== p.assigned) return false;
  if (p.proposed === true || p.proposed === "true") {
    if (!r.suggested_value) return false;
  }
  if (p.due === "overdue" && !(r.due_at && r.due_at < "2026-10-16T00:00:00Z")) return false;
  if (p.q) {
    const q = String(p.q).toLowerCase();
    if (!(r.name ?? "").toLowerCase().includes(q) && !r.record_key.toLowerCase().includes(q.replace(/^0+/, ""))) return false;
  }
  return true;
}

const SEV = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;
function sorted(rows: Row[], sort: string): Row[] {
  const keys = sort.split(",").map((s) => s.trim()).filter(Boolean);
  const cmp = (a: Row, b: Row): number => {
    for (const k of keys.length ? keys : ["-value"]) {
      const desc = k.startsWith("-");
      const name = k.replace(/^-/, "");
      let d = 0;
      if (name === "severity") d = (SEV[a.severity] - SEV[b.severity]) * (desc ? -1 : 1);
      // "-age" is the oldest first, "age" the newest; "-value" the highest first.
      else if (name === "age") d = (a.first_seen_at ?? "9").localeCompare(b.first_seen_at ?? "9") * (desc ? 1 : -1);
      else if (name === "value") d = ((a.value_at_risk ?? 0) - (b.value_at_risk ?? 0)) * (desc ? -1 : 1);
      if (d !== 0) return d;
    }
    return (b.value_at_risk ?? 0) - (a.value_at_risk ?? 0);
  };
  return [...rows].sort(cmp);
}

const FILTER_KEYS = ["check_id", "severity", "assigned", "due", "q", "batch_id"] as const;

/** What the first page of a person's open work stands for: the people of the fixture hold more than the sample lists. */
const ASSIGNED_OPEN: Record<string, number> = { "u-an": 214, me: 38 };

function totalFor(p: Params, matched: number): number {
  const only = !p.check_id && !p.severity && !p.due && !p.q && !p.batch_id && !p.module;
  if (p.assigned && ASSIGNED_OPEN[String(p.assigned)] && only && (!p.status || p.status === "open")) return Math.max(matched, ASSIGNED_OPEN[String(p.assigned)]);
  if (FILTER_KEYS.some((k) => p[k] !== undefined && p[k] !== "")) {
    if (p.check_id && !p.severity && !p.assigned && !p.due && !p.q) {
      const g = RULES[String(p.check_id)];
      const status = p.status ? String(p.status) : "to_fix";
      if (g && status === "to_fix" && !p.proposed) return Math.max(0, g.records - [...state.accepted].filter((c) => c === g.id).length * g.proposed);
    }
    return matched;
  }
  const c = state.counts();
  const status = p.status ? String(p.status) : "to_fix";
  if (p.module && p.module !== MODULE) return 0;
  if (status === "to_fix") return p.proposed === true || p.proposed === "true" ? c.proposed_flag : c.to_fix;
  if (status === "proposed") return c.waiting;
  if (status === "approved") return c.approved;
  if (status === "sent") return c.sent;
  if (status === "not_an_issue") return c.exceptions;
  if (status === "open") return c.to_fix + c.waiting + c.approved + c.sent;
  return matched;
}

function publicRow(r: Row): WorkRow {
  const copy: Partial<Row> = { ...r };
  delete copy.base_status;
  return copy as WorkRow;
}

function restore(before: Map<string, Override | null>): void {
  for (const [k, o] of before) {
    if (o) state.overrides.set(k, o);
    else state.overrides.delete(k);
  }
}

export function workRecords(p: Params): WorkPage {
  const all = sorted(state.rows.map((r) => state.now(r)).filter((r) => matches(r, p)), String(p.sort ?? "-value"));
  const offset = p.after ? Number(p.after) || 0 : 0;
  const limit = Number(p.limit ?? 50);
  const items = all.slice(offset, offset + limit).map(publicRow);
  const total = totalFor(p, all.length);
  return { version_id: null, total, total_capped: false, next: offset + limit < all.length ? String(offset + limit) : null, items };
}

export function workSummary(p: Params): WorkSummary {
  const c = state.counts();
  const on = !p.module || p.module === MODULE;
  const z = (n: number) => (on ? n : 0);
  const obj = {
    module: MODULE,
    version_id: VERSION,
    records: z(c.to_fix + c.waiting + c.approved + c.sent + c.exceptions),
    open: z(c.to_fix + c.waiting + c.approved + c.sent),
    issues: z(c.to_fix + c.waiting + c.approved + c.sent + 1840),
    critical: z(6544),
    proposed: z(c.proposed_flag),
    overdue: z(1940),
    statuses: on ? { to_fix: c.to_fix, proposed: c.waiting, approved: c.approved, sent: c.sent, not_an_issue: c.exceptions } : {},
  };
  const objects = on ? [obj] : [];
  return {
    version_id: null,
    scope: null,
    mode: "current",
    version_ids: [VERSION],
    unbuilt: [],
    built: true,
    objects,
    totals: { records: obj.records, open: obj.open, issues: obj.issues, critical: obj.critical, proposed: obj.proposed, overdue: obj.overdue },
  };
}

export function workGroups(p: Params): { version_id: string | null; built: boolean; total: number; groups: WorkGroup[] } {
  const order = [...RULE_IDS];
  const groups: WorkGroup[] = order.map((id) => {
    const m = RULES[id];
    const done = state.accepted.has(id);
    const records = m.records;
    const proposed = done ? 0 : m.proposed;
    return {
      check_id: id,
      module: MODULE,
      version_id: VERSION,
      severity: m.severity,
      dimension: m.dimension,
      message: m.message,
      field: m.field,
      records,
      population: 61816,
      proposed,
      truncated: false,
      statuses: { to_fix: records - (done ? m.proposed : 0), ...(done ? { proposed: m.proposed } : {}) },
      open: records,
    };
  });
  const filtered = groups.filter((g) => (!p.module || g.module === p.module) && (!p.proposed || g.proposed > 0));
  return { version_id: null, built: true, total: filtered.length, groups: filtered };
}

const FIELDS: Record<string, string> = { "MARA.MATNR": "MATNR", "MAKT.MAKTX": "MAKTX" };

function valuesFor(row: Row, issues: IssueSpec[]): Record<string, string | null> {
  const matnr = row.record_key.split("|")[0].split("=")[1];
  const plant = row.record_key.split("|").find((p) => p.startsWith("WERKS="))?.split("=")[1] ?? "1000";
  const v: Record<string, string | null> = {
    "MARA.MATNR": matnr,
    "MAKT.MAKTX": row.name,
    "MARA.MTART": "ROH",
    "MARA.MATKL": "0420",
    "MARA.MEINS": "EA",
    "MARA.BRGEW": "0.018",
    "MARA.GEWEI": "KG",
    "MARC.WERKS": plant,
    "MARC.EKGRP": "P01",
    "MARC.DISMM": "PD",
    "MARC.BESKZ": "F",
    "MBEW.BKLAS": "3000",
  };
  void FIELDS;
  for (const i of issues) v[i.rule.field] = i.current === "" ? null : i.current;
  return v;
}

interface IssueSpec {
  rule: RuleMeta;
  current: string;
}

/** Part `n` of `total` split over `parts`, whole numbers that add up to `total` (the remainder on the first part). */
function shareOf(total: number, parts: number, n: number): number {
  const each = Math.floor(total / parts);
  return n === 0 ? total - each * (parts - 1) : each;
}

export function workRecord(module: string, key: string): WorkRecordDetail {
  const base = state.row(module, key);
  if (!base) fail(404, "This record does not fail any check in this run.");
  const row = state.now(base);
  const extras = RULE_IDS.filter((r) => r !== row.checks[0] && hash(key + r) % 5 === 0).slice(0, 2);
  const specs: IssueSpec[] = [row.checks[0], ...extras].map((id, n) => ({ rule: RULES[id], current: n === 0 ? (row.current_value ?? "") : currentFor(id, key) }));
  const issues: WorkIssue[] = specs.map((s, n) => {
    const m = s.rule;
    const primary = n === 0;
    const status: WorkStatus = primary ? row.status : "to_fix";
    const suggestion = primary ? (row.suggested_value ?? null) : m.suggestion && hash(key + m.id) % 2 === 0 ? m.suggestion : null;
    return {
      // The record's value at risk is the row's, shared over its issues: the inspector and the ledger read the same figure.
      rule: { id: `rule-${m.id}`, name: m.message, dimension: m.dimension, authority: "shipped", cost_at_risk: m.records * 330, cost_per_record: shareOf(row.value_at_risk ?? 0, specs.length, n) },
      failing: m.records,
      others_failing: m.records - 1,
      population: 61816,
      pass_rate: Math.round((1 - m.records / 61816) * 1000) / 10,
      allowed_values: m.values.length ? m.values : null,
      check_id: m.id,
      severity: m.severity,
      dimension: m.dimension,
      message: m.message,
      field: m.field,
      current_value: s.current === "" ? null : s.current,
      instruction: `Set ${m.fieldDescription.toLowerCase()} to a value the rule accepts.`,
      why_it_matters: null,
      sap_impact: null,
      suggestion: suggestion ? { value: suggestion, source: "rule", confidence: null, why: null } : null,
      status,
      issue_id: `fx-issue-${m.id}`,
      resolution: primary ? (row.resolution ?? null) : null,
      first_seen_at: row.first_seen_at ?? null,
      reopened_count: 0,
      due_at: row.due_at ?? null,
      sla_state: null,
      decision: primary && row.status === "proposed" ? { batch_id: row.batch_id ?? "fx-batch", batch_status: "draft", batch_name: row.batch_name ?? "Fixes by Demo user", value: row.new_value ?? null, source: "steward", still_failing: false, at: null } : null,
    };
  });
  return {
    version_id: VERSION,
    module,
    record_key: key,
    name: row.name,
    status: row.status,
    assigned_to: row.assigned_to ?? null,
    assignee_email: row.assignee_email ?? null,
    values: valuesFor(row, specs),
    issues,
    events: [],
    other_runs: null,
    currency: "ZAR",
    can: { fix: true, sign_off: true, assign: true, comment: true },
  };
}

const FEATURE_BECAUSE = (ids: string[]): RecordLinks["features"] => {
  const out = new Map<string, RecordLinks["features"][number]>();
  for (const id of ids)
    for (const [feature, status] of RULES[id]?.features ?? []) {
      const cur = out.get(feature);
      if (cur) cur.because.push(id);
      else out.set(feature, { feature, status, because: [id] });
    }
  return [...out.values()];
};

export function recordLinks(module: string, key: string): RecordLinks {
  const detail = workRecord(module, key);
  const ids = detail.issues.map((i) => i.check_id);
  const parts = key.split("|");
  const plantPart = parts.find((p) => p.startsWith("WERKS="));
  const ident = parts.filter((p) => !p.startsWith("WERKS=")).join("|");
  const variants = plantPart
    ? PLANTS.filter((p) => `WERKS=${p}` !== plantPart).slice(0, 2).map((p) => ({ module, record_key: `${ident}|WERKS=${p}`, differs_in: { WERKS: p }, failing: [{ check_id: ids[0], severity: RULES[ids[0]].severity }] }))
    : [];
  const tables = new Map<string, string[]>();
  for (const i of detail.issues) {
    const [t, f] = (i.field ?? "").split(".");
    if (t) tables.set(t, [...(tables.get(t) ?? []), `${t}.${f}`]);
  }
  return {
    module,
    record_key: key,
    run_id: VERSION,
    failing_rules: detail.issues.map((i) => ({ check_id: i.check_id, name: i.message, severity: i.severity, dimension: i.dimension, field: i.field })),
    variants: { identity: ident, total: variants.length, items: variants },
    features: FEATURE_BECAUSE(ids),
    provenance: { source_tables: [...tables].map(([table, fields]) => ({ table, fields })), run_id: VERSION, run_at: "2026-10-16T05:17:00Z", system_id: "ecc-prd", system_name: "ECC production", extracted_at: "2026-10-16T04:41:00Z", record_hash: hash(key).toString(16).padStart(8, "0").slice(0, 8) },
    history: [...(state.history.get(rowKey(module, key)) ?? []), { check_id: ids[0], action: "assign", from_value: null, to_value: "A. Naidoo", note: null, user: "R. Govender", at: "2026-09-29T08:00:00Z" }],
  };
}

const BUILTIN: [string, Record<string, string>, "compact" | "comfortable"][] = [
  ["My open work", { assigned: "me", status: "open" }, "comfortable"],
  ["Critical and unassigned", { severity: "critical", assigned: "unassigned", status: "open" }, "comfortable"],
  ["Overdue", { due: "overdue", status: "open" }, "compact"],
];
export function views(route: string): { route: string; views: SavedView[]; columns: string[] | null } {
  const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const builtin: SavedView[] = BUILTIN.map(([name, filters, density]) => ({ id: `builtin:${route}:${slug(name)}`, route, name, filters, columns: null, density, builtin: true, created_at: null }));
  const mine = state.views.filter((v) => v.route === route);
  // The reserved `_columns` row is the person's remembered columns, never a view (api/routes/views.py).
  const columns = mine.find((v) => v.name === "_columns")?.columns ?? null;
  return { route, views: [...builtin, ...mine.filter((v) => !v.name.startsWith("_"))], columns };
}

// Writes ----------------------------------------------------------------------------------------------------------

function applyOne(d: Decision, before: Map<string, Override | null>, delta: Delta): number {
  const base = state.row(d.module, d.record_key);
  // The fixture keeps a sample of each batch's records; reassigning the rest of a batch has nothing to change here.
  if (!base && d.action === "assign") return 0;
  if (!base) fail(404, `${d.record_key} does not fail ${d.check_id ?? "any check"} in this run.`);
  const k = rowKey(d.module, d.record_key);
  const cur = state.now(base);
  if (!before.has(k)) before.set(k, state.overrides.get(k) ?? null);
  const next: Override = { ...(state.overrides.get(k) ?? {}) };
  if (d.action === "accept") {
    if (!cur.suggested_value) fail(409, "No proposed value to accept: enter one.");
    next.status = "proposed";
    next.new_value = cur.suggested_value;
  } else if (d.action === "edit") {
    if (!d.value || !d.value.trim()) fail(400, "Give the value to use.");
    next.status = "proposed";
    next.new_value = d.value;
  } else if (d.action === "not_an_issue" || d.action === "accept_risk") {
    if (!d.note || !d.note.trim()) fail(400, "Say why: a sign-off needs a reason.");
    next.status = "not_an_issue";
    next.resolution = d.action === "not_an_issue" ? "false_positive" : "accepted_risk";
    next.resolution_note = d.note;
    next.resolved_by = "Demo user";
    next.resolved_at = new Date().toISOString();
  } else if (d.action === "assign") {
    next.assigned_to = d.assignee === "" ? null : (d.assignee ?? ME);
    next.assignee_email = d.assignee === "" ? null : "demo.user@example.com";
  } else if (d.action === "undo") {
    next.status = base.base_status === "not_an_issue" ? "to_fix" : base.base_status;
    next.new_value = null;
    next.resolution = null;
    next.resolution_note = null;
    next.resolved_by = null;
    next.resolved_at = null;
  }
  state.overrides.set(k, next);
  const after = state.now(base);
  const dd = deltaOf(cur, after);
  (Object.keys(delta) as (keyof Delta)[]).forEach((c) => (delta[c] += dd[c]));
  return 1;
}

export function decideFixture(body: { items: Decision[] }): DecideResult {
  const before = new Map<string, Override | null>();
  const delta = zero();
  let n = 0;
  try {
    for (const d of body.items) n += applyOne(d, before, delta);
  } catch (e) {
    restore(before);
    throw e;
  }
  state.delta = add(state.delta, delta);
  const id = `fx-action-${++state.seq}`;
  state.actions.set(id, { id, kind: "decide", before, delta, undone: false });
  for (const d of body.items) {
    if (d.action === "comment") continue;
    const k = rowKey(d.module, d.record_key);
    const label = d.action === "accept" ? "Fix proposed" : d.action === "edit" ? `Value set to ${d.value}` : d.action === "assign" ? "Assigned" : d.action === "undo" ? "Decision undone" : "Signed off";
    state.history.set(k, [{ check_id: d.check_id ?? "", action: d.action === "assign" ? "assign" : "status", from_value: null, to_value: label, note: d.note ?? null, user: "Demo user", at: "2026-10-16T09:00:00Z" }, ...(state.history.get(k) ?? [])]);
  }
  return { updated: n, draft_batch_id: "fx-batch", action_id: id };
}

export function acceptAllFixture(check: string): GroupResult {
  const m = RULES[check];
  if (!m) fail(404, "No such group.");
  const n = state.accepted.has(check) ? 0 : m.proposed;
  const before = new Map<string, Override | null>();
  const delta = zero();
  if (n > 0) {
    for (const r of state.rows) {
      const cur = state.now(r);
      if (cur.checks[0] !== check || cur.status !== "to_fix" || !cur.suggested_value) continue;
      before.set(rowKey(r.module, r.record_key), state.overrides.get(rowKey(r.module, r.record_key)) ?? null);
      state.overrides.set(rowKey(r.module, r.record_key), { ...(state.overrides.get(rowKey(r.module, r.record_key)) ?? {}), status: "proposed", new_value: cur.suggested_value });
    }
    state.accepted.add(check);
    delta.to_fix = -n;
    delta.proposed_flag = -n;
    delta.waiting = n;
    state.delta = add(state.delta, delta);
  }
  const id = `fx-action-${++state.seq}`;
  state.actions.set(id, { id, kind: "accept_all", before, delta, groupAccepted: n > 0 ? check : undefined, undone: false });
  return { accepted: n, draft_batch_id: "fx-batch", action_id: id };
}

export function setValueFixture(check: string, body: { value: string }): GroupResult {
  const m = RULES[check];
  if (!m) fail(404, "No such group.");
  const before = new Map<string, Override | null>();
  let n = 0;
  for (const r of state.rows) {
    const cur = state.now(r);
    if (cur.checks[0] !== check || cur.status !== "to_fix") continue;
    before.set(rowKey(r.module, r.record_key), state.overrides.get(rowKey(r.module, r.record_key)) ?? null);
    state.overrides.set(rowKey(r.module, r.record_key), { ...(state.overrides.get(rowKey(r.module, r.record_key)) ?? {}), status: "proposed", new_value: body.value });
    n++;
  }
  const delta = zero();
  delta.to_fix = -n;
  delta.waiting = n;
  state.delta = add(state.delta, delta);
  const id = `fx-action-${++state.seq}`;
  state.actions.set(id, { id, kind: "set_value", before, delta, undone: false });
  return { updated: n, draft_batch_id: "fx-batch", action_id: id };
}

export function undoFixture(body: { action_id: string }): UndoResult {
  const a = state.actions.get(body.action_id);
  if (!a) fail(404, "No such change to undo.");
  if (a.undone) fail(409, "This change was already undone.");
  restore(a.before);
  state.delta = add(state.delta, a.delta, -1);
  if (a.groupAccepted) state.accepted.delete(a.groupAccepted);
  if (a.batchBefore) state.batches = state.batches.map((b) => (b.id === a.batchBefore?.id ? (a.batchBefore as FxBatch) : b));
  a.undone = true;
  return { action_id: a.id, kind: a.kind, undone_at: "2026-10-16T09:01:00Z", restored: { issues: a.before.size, items_restored: 0, items_removed: a.before.size, batch: false } };
}

function findBatch(id: string): FxBatch {
  const b = state.batches.find((x) => x.id === id);
  if (!b) fail(404, "Batch not found");
  return b;
}

const ME_ID = "u-me";
const ME_LABEL = "Demo user";

function moveRows(batch: string, from: WorkStatus, to: WorkStatus, before: Map<string, Override | null>): void {
  for (const r of state.rows) {
    const cur = state.now(r);
    if (cur.batch_id !== batch || cur.status !== from) continue;
    const k = rowKey(r.module, r.record_key);
    before.set(k, state.overrides.get(k) ?? null);
    state.overrides.set(k, { ...(state.overrides.get(k) ?? {}), status: to });
  }
}

/** Approve a draft batch, or send one back (a draft stays a draft and is marked returned; an approved one goes back to draft). */
export function batchFixture(kind: "approve" | "send-back", id: string, note?: string): { id: string; status: string; action_id: string } {
  const b = findBatch(id);
  const snapshot: FxBatch = { ...b, returned: b.returned ? { ...b.returned } : null, events: [...b.events] };
  const before = new Map<string, Override | null>();
  const delta = zero();
  if (kind === "approve") {
    if (b.status !== "draft") fail(409, `Batch is already ${b.status}.`);
    if (b.created_by === ME_ID) fail(403, "The batch creator cannot approve it.");
    b.status = "approved";
    b.approved_by = ME_ID;
    b.approved_by_label = ME_LABEL;
    b.approved_at = "2026-10-16T09:00:00Z";
    b.events = [...b.events, { action: "approved", user_label: ME_LABEL, at: b.approved_at, note: null }];
    moveRows(id, "proposed", "approved", before);
    delta.waiting -= b.items;
    delta.approved += b.items;
  } else {
    if (b.status === "exported") fail(409, "Batch is already exported; it can no longer be sent back.");
    if (b.created_by === ME_ID) fail(403, "The batch creator cannot send it back.");
    if (!note || !note.trim()) fail(422, "Say what the author has to change.");
    const wasApproved = b.status === "approved";
    b.status = "draft";
    b.approved_by = null;
    b.approved_by_label = null;
    b.approved_at = null;
    b.returned = { by: ME_LABEL, note: note.trim(), at: "2026-10-16T09:00:00Z" };
    b.events = [...b.events, { action: "sent_back", user_label: ME_LABEL, at: b.returned.at, note: note.trim() }];
    if (wasApproved) {
      moveRows(id, "approved", "proposed", before);
      delta.approved -= b.items;
      delta.waiting += b.items;
    }
  }
  state.delta = add(state.delta, delta);
  const action = `fx-action-${++state.seq}`;
  state.actions.set(action, { id: action, kind: kind === "approve" ? "approve_batch" : "send_back_batch", before, delta, batchBefore: snapshot, undone: false });
  return { id, status: b.status, action_id: action };
}

/** Send an approved batch to SAP: the export. The batch creator is refused, as the API refuses. */
export function sendBatchFixture(id: string): SendResult {
  const b = findBatch(id);
  if (b.status === "draft") fail(409, "Approve the batch before exporting it.");
  if (b.created_by === ME_ID) fail(403, "The batch creator cannot export it.");
  const delta = zero();
  if (b.status === "approved") {
    b.status = "exported";
    b.exported_at = "2026-10-16T09:05:00Z";
    b.events = [...b.events, { action: "exported", user_label: ME_LABEL, at: b.exported_at, note: "cockpit_xlsx" }];
    moveRows(id, "approved", "sent", new Map());
    delta.approved -= b.items;
    delta.sent += b.items;
    state.delta = add(state.delta, delta);
  }
  return { filename: `remediation-cockpit_xlsx-${id}.xlsx`, sha256: "9f2c4e1a7b3d58e0c6a14f92d7b05e38a1c4d6f90b2e7a35c8d1f4b60a93e27c", records: b.items, job_id: null };
}

export function batchesFixture(): { items: BatchRowApi[] } {
  const items: BatchRowApi[] = state.batches.map((b) => ({
    id: b.id,
    name: b.name,
    status: b.status,
    filter: { source: "worklist", ...(b.returned ? { returned: b.returned } : {}) } as unknown as Batch["filter"],
    created_by: b.created_by,
    created_by_label: b.created_by_label,
    created_at: b.created_at,
    approved_by: b.approved_by,
    approved_by_label: b.approved_by_label,
    approved_at: b.approved_at,
    exported_at: b.exported_at,
    items: b.items,
    with_proposal: b.items,
    auto_approvable: 0,
    fixed: 0,
    still_failing: 0,
    value_at_risk: b.value_at_risk,
    due_at: b.due_at,
    steward_label: b.steward_label,
  }));
  return { items };
}

export function batchFixtureDetail(id: string): BatchDetail {
  const b = findBatch(id);
  const mine = state.rows.map((r) => state.now(r)).filter((r) => r.batch_id === id);
  const items: BatchItem[] = [];
  for (let i = 0; i < Math.min(b.items, 60); i++) {
    const row = mine[i];
    const rule = row?.checks[0] ?? RULE_IDS[(i * 3) % RULE_IDS.length];
    const m = RULES[rule];
    items.push({
      id: `${id}-item-${i + 1}`,
      batch_id: id,
      issue_id: `${id}-issue-${i + 1}`,
      scope: "ecc-prd",
      module: MODULE,
      check_id: rule,
      record_key: row?.record_key ?? `MATNR=${pad(3000 + i * 29)}`,
      grain: null,
      field: m.field,
      current_value: row?.current_value ?? currentFor(rule, `${id}${i}`),
      proposed_value: row?.new_value ?? m.suggestion,
      proposal_source: "steward",
      confidence: null,
      accepted: b.status !== "draft",
      recon_status: null,
      recon_version: null,
      updated_at: b.created_at,
      auto_approvable: false,
    });
  }
  const batch = batchesFixture().items.find((x) => x.id === id) as BatchRowApi;
  return { batch: batch as Batch, items };
}

export function batchEventsFixture(id: string): { items: (Omit<BatchEvent, "action"> & { action: string })[] } {
  const b = findBatch(id);
  const items: (Omit<BatchEvent, "action"> & { action: string })[] = [];
  for (const e of b.events) {
    if (e.action === "sent_back") items.push({ item_id: null as unknown as string, action: e.action, from_value: null, to_value: e.note, user_label: e.user_label, version_id: null, created_at: e.at });
    else for (let i = 0; i < b.items; i++) items.push({ item_id: `${id}-item-${i + 1}`, action: e.action, from_value: null, to_value: e.note, user_label: e.user_label, version_id: null, created_at: e.at });
  }
  return { items };
}

export function putViewFixture(body: { route: string; name: string; filters?: Record<string, string>; columns?: string[] | null; density?: "compact" | "comfortable" | null; shared?: boolean }): SavedView {
  const name = body.name.trim();
  if (!name) fail(422, "Name is required");
  if (views(body.route).views.some((v) => v.builtin && v.name.toLowerCase() === name.toLowerCase())) fail(409, `'${name}' is a built-in view of this page; save yours under another name.`);
  const existing = state.views.find((v) => v.route === body.route && v.name === name);
  const view: SavedView = { id: existing?.id ?? `fx-view-${state.views.length + 1}`, route: body.route, name, filters: body.filters ?? {}, columns: body.columns ?? null, density: body.density ?? null, builtin: false, created_at: "2026-10-16T09:00:00Z", ...(body.shared ? { shared: true } : {}) };
  state.views = existing ? state.views.map((v) => (v === existing ? view : v)) : [...state.views, view];
  return view;
}

export function exportFixture(f: WorkFilters, name = "fix-sheet.xlsx"): { filename: string; blob: Blob } {
  const page = workRecords({ ...(f as Params), status: f.status ?? "to_fix", limit: 500 });
  const head = ["Object", "Record", "Name", "Check", "Severity", "Issue", "Field", "Current value", "Suggested value", "New value", "Decision", "Reason"];
  const lines = [head.join("\t"), ...page.items.map((r) => [r.module, r.record_key, r.name ?? "", r.checks[0], r.severity, r.top_message ?? "", r.top_field ?? "", r.current_value ?? "", r.suggested_value ?? "", "", "", ""].join("\t"))];
  return { filename: `${name.replace(/\.xlsx$/, "")}-fixture.tsv`, blob: new Blob([lines.join("\n")], { type: "text/tab-separated-values" }) };
}

export function importFixture(name: string): ImportResult {
  if (!/\.(xlsx|csv)$/i.test(name)) fail(422, "This is not an .xlsx file.");
  const targets = state.rows.map((r) => state.now(r)).filter((r) => r.status === "to_fix" && r.suggested_value).slice(0, 3);
  const res = decideFixture({ items: targets.map((r) => ({ module: r.module, record_key: r.record_key, check_id: r.checks[0], action: "accept" as const })) });
  return { updated: res.updated, rows: targets.length, skipped: ["Fix sheet row 9: a sign-off needs a reason"], draft_batch_id: res.draft_batch_id, action_id: res.action_id };
}

export const fixtureWorkIds = { MODULE, VERSION };
