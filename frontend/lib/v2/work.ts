/**
 * The Work ledger's pure parts: the filter chips, the state that lives in the URL, sorting, the words in cells and the
 * sentence above the grid. No React and no network here, so each can be tested on its own.
 */
import type { WorkRow } from "@/lib/api/v2/types";
import type { ExportQuery, SavedView, WorkFilters, WorkSummary } from "@/lib/api/v2/work";
import { t as tr } from "@/lib/v2/i18n";
import { whole } from "./format";

export type ChipId = "tofix" | "proposed" | "approvals" | "exceptions";
export type SortKey = "value" | "due" | "age" | "owner";
export type Density = "comfortable" | "compact";

export interface ChipDef {
  id: ChipId;
  label: string;
  /** The work status the chip lists. */
  status: string;
  /** Only records that have a machine-proposed value. */
  proposed?: boolean;
  /** The count the chip carries, from GET /work/summary (one object's when `module` is given). */
  count(s: WorkSummary | undefined, module?: string | null): number | null;
}

const objectsOf = (s: WorkSummary, module?: string | null) => (module ? s.objects.filter((o) => o.module === module) : s.objects);
const sumStatus = (s: WorkSummary | undefined, status: string, module?: string | null): number | null =>
  s ? objectsOf(s, module).reduce((n, o) => n + (o.statuses[status as keyof typeof o.statuses] ?? 0), 0) : null;

/**
 * The four states a row can be asked for. "Fix proposed" is a row still to fix that already has a value the rules
 * propose; "Waiting for approval" is a row whose value sits in a draft fix batch that a second person approves
 * (the API's work status "proposed"); exceptions are the rows signed off as not an issue or accepted as a risk.
 */
export const CHIPS: readonly ChipDef[] = [
  { id: "tofix", get label() { return tr("To fix"); }, status: "to_fix", count: (s, m) => sumStatus(s, "to_fix", m) },
  { id: "proposed", get label() { return tr("Fix proposed"); }, status: "to_fix", proposed: true, count: (s, m) => (s ? objectsOf(s, m).reduce((n, o) => n + o.proposed, 0) : null) },
  { id: "approvals", get label() { return tr("Waiting for approval"); }, status: "proposed", count: (s, m) => sumStatus(s, "proposed", m) },
  { id: "exceptions", get label() { return tr("Exceptions"); }, status: "not_an_issue", count: (s, m) => sumStatus(s, "not_an_issue", m) },
];
export const chipDef = (id: ChipId): ChipDef => CHIPS.find((c) => c.id === id) ?? CHIPS[0];

export interface LedgerState {
  /** Null: every open row. */
  chip: ChipId | null;
  module: string | null;
  rule: string | null;
  severity: string | null;
  assigned: string | null;
  due: string | null;
  /** One fix batch: its records in every open state, with the status of each. */
  batch: string | null;
  /** Step 10: a policy pack or pack:class (sox:vendor_bank): the records failing a rule that evidences it. */
  policy: string | null;
  /** A source system id, or "upload" (the natural language mode fills it). */
  system: string | null;
  /** Time travel: the ledger as it stood when this run finished; the statuses are today's. */
  asOf: string | null;
  group: boolean;
  sort: SortKey;
  /** The ledger's own density (?density= or a saved view); null follows the density in Preferences. */
  density: Density | null;
}

export const DEFAULT_STATE: LedgerState = { chip: "tofix", module: null, rule: null, severity: null, assigned: null, due: null, batch: null, policy: null, system: null, asOf: null, group: false, sort: "value", density: null };

/** The query keys the ledger owns; everything else in the address (fixture, persona, open) is left alone. */
export const MANAGED = ["filter", "status", "proposed", "module", "rule", "check_id", "severity", "assigned", "due", "batch", "policy", "system", "as_of_run", "group", "sort", "density", "view"] as const;

function chipFrom(get: (k: string) => string | null, fallback: ChipId | null): ChipId | null {
  const filter = get("filter");
  if (filter === "open" || filter === "all") return null;
  if (filter && CHIPS.some((c) => c.id === filter)) return filter as ChipId;
  if (filter === "approval") return "approvals";
  const status = get("status");
  if (!status) return fallback;
  if (status === "open" || status === "all") return null;
  if (status === "to_fix") return get("proposed") === "true" ? "proposed" : "tofix";
  if (status === "proposed" || status === "approved") return "approvals";
  if (status === "not_an_issue") return "exceptions";
  return fallback;
}

/** The ledger state from the address, over the saved view (`?view=`) when one is chosen. The address wins. */
export function readState(params: URLSearchParams, view?: SavedView): LedgerState {
  const get = (k: string): string | null => params.get(k) ?? view?.filters[k] ?? null;
  const urlHasChip = params.has("filter") || params.has("status");
  // A batch lists its records in every open state, so it opens on "all open" unless a chip is asked for.
  const chip = urlHasChip || view ? chipFrom(get, view ? null : "tofix") : get("batch") ? null : "tofix";
  const sort = get("sort");
  const density = params.get("density") ?? view?.density ?? view?.filters.density ?? null;
  return {
    chip,
    module: get("module"),
    rule: get("rule") ?? get("check_id"),
    severity: get("severity"),
    assigned: get("assigned"),
    due: get("due"),
    batch: get("batch"),
    policy: get("policy"),
    system: get("system"),
    asOf: params.get("as_of_run"),
    group: get("group") === "rule",
    sort: sort === "due" || sort === "age" || sort === "owner" ? sort : "value",
    density: density === "compact" || density === "comfortable" ? density : null,
  };
}

/** The API filters for a state: what GET /work/records, /work/summary and /work/export are asked. */
export function filtersOf(s: LedgerState): WorkFilters {
  const c = s.chip ? chipDef(s.chip) : null;
  return {
    module: s.module ?? undefined,
    check_id: s.rule ?? undefined,
    severity: s.severity ?? undefined,
    assigned: s.assigned ?? undefined,
    due: s.due ?? undefined,
    batch_id: s.batch ?? undefined,
    policy: s.policy ?? undefined,
    system: s.system ?? undefined,
    as_of_run: s.asOf ?? undefined,
    status: c ? c.status : "open",
    proposed: c?.proposed ? true : undefined,
  };
}

/** What the fix-sheet exports are asked: the ledger's filters (batch and policy included) and its order. */
export function exportQueryOf(s: LedgerState): ExportQuery {
  return { ...filtersOf(s), sort: EXPORT_SORT[s.sort] };
}

/** The address query for a state, defaults left out. */
export function toParams(s: LedgerState): Record<string, string> {
  const out: Record<string, string> = {};
  if (s.chip !== "tofix") out.filter = s.chip ?? "open";
  if (s.module) out.module = s.module;
  if (s.rule) out.rule = s.rule;
  if (s.severity) out.severity = s.severity;
  if (s.assigned) out.assigned = s.assigned;
  if (s.due) out.due = s.due;
  if (s.batch) out.batch = s.batch;
  if (s.policy) out.policy = s.policy;
  if (s.system) out.system = s.system;
  if (s.asOf) out.as_of_run = s.asOf;
  if (s.group) out.group = "rule";
  if (s.sort !== "value") out.sort = s.sort;
  if (s.density) out.density = s.density;
  return out;
}

/** The filters a saved view keeps: the API's own names, so a built-in and a saved view read alike. */
export function viewFilters(s: LedgerState): Record<string, string> {
  const f = filtersOf(s);
  const out: Record<string, string> = { status: f.status ?? "open" };
  if (f.proposed) out.proposed = "true";
  for (const k of ["module", "check_id", "severity", "assigned", "due", "policy", "system"] as const) if (f[k]) out[k] = String(f[k]);
  if (s.group) out.group = "rule";
  if (s.sort !== "value") out.sort = s.sort;
  return out;
}

/** The address with the ledger's keys replaced by this state and every other key kept. */
export function withState(search: string, s: LedgerState, extra: Record<string, string | null> = {}): string {
  const next = new URLSearchParams(search);
  for (const k of MANAGED) next.delete(k);
  for (const [k, v] of Object.entries(toParams(s))) next.set(k, v);
  for (const [k, v] of Object.entries(extra)) {
    if (v === null) next.delete(k);
    else next.set(k, v);
  }
  const qs = next.toString();
  return qs;
}

export const SORT_LABEL: Record<SortKey, string> = { get value() { return tr("Value at risk"); }, get due() { return tr("Due"); }, get age() { return tr("Age"); }, get owner() { return tr("Owner"); } };

/** What the server is asked to sort by. It sorts by severity and age; the other keys sort the rows loaded. */
export const SERVER_SORT: Record<SortKey, string> = { value: "severity", due: "severity", age: "-age", owner: "severity" };
/**
 * What the fix-sheet exports are asked to sort by: the whole order the ledger shows (compareRows), which the server
 * can sort in full for an export. Ties fall back to value at risk, highest first, as on screen.
 */
// i18n-ignore: GET /work/records sort names, not words
export const EXPORT_SORT: Record<SortKey, string> = { value: "-value,severity", due: "due,-value", age: "-age,-value", owner: "owner,-value" };
export const SORTS_LOADED_ROWS: ReadonlySet<SortKey> = new Set<SortKey>(["value", "due", "owner"]);

const last = <T>(a: T | null | undefined, b: T | null | undefined, cmp: (x: T, y: T) => number): number => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : cmp(a, b));

export function compareRows(sort: SortKey): (a: WorkRow, b: WorkRow) => number {
  return (a, b) => {
    let d = 0;
    if (sort === "value") d = last(a.value_at_risk, b.value_at_risk, (x, y) => y - x);
    else if (sort === "due") d = last(a.due_at, b.due_at, (x, y) => x.localeCompare(y));
    else if (sort === "age") d = last(a.first_seen_at, b.first_seen_at, (x, y) => x.localeCompare(y));
    else d = last(ownerLabel(a), ownerLabel(b), (x, y) => x.localeCompare(y));
    return d !== 0 ? d : (b.value_at_risk ?? 0) - (a.value_at_risk ?? 0);
  };
}

export const ownerLabel = (r: Pick<WorkRow, "assignee_email" | "assigned_to">): string | null => r.assignee_email ?? null;

/** Two letters for a person: "a.naidoo@example.com" is AN, "Demo user" is DU. */
export function initials(label: string | null | undefined): string | null {
  if (!label) return null;
  const local = label.includes("@") ? label.split("@")[0] : label;
  const parts = local.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return null;
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
}

// Keys ----------------------------------------------------------------------------------------------------------

export const KEY_LABEL: Record<string, string> = {
  get MATNR() { return tr("Material number"); },
  get LIFNR() { return tr("Vendor number"); },
  get KUNNR() { return tr("Customer number"); },
  get PARTNER() { return tr("Business partner"); },
  get SAKNR() { return tr("G/L account"); },
  get BUKRS() { return tr("Company code"); },
  get WERKS() { return tr("Plant"); },
  get VKORG() { return tr("Sales organisation"); },
  get VTWEG() { return tr("Distribution channel"); },
  get SPART() { return tr("Division"); },
  get EKORG() { return tr("Purchasing organisation"); },
  get LGORT() { return tr("Storage location"); },
  get ANLN1() { return tr("Asset number"); },
  get EQUNR() { return tr("Equipment number"); },
  get AUFNR() { return tr("Order number"); },
  get PERNR() { return tr("Personnel number"); },
};

export interface KeyPart {
  field: string;
  value: string;
}

/** "MATNR=000000000000000101|WERKS=3000" is two parts. A bare part has no field. Leading zeros are kept. */
export function splitKey(key: string): KeyPart[] {
  return key.split("|").map((p) => {
    const at = p.indexOf("=");
    return at < 0 ? { field: "", value: p } : { field: p.slice(0, at), value: p.slice(at + 1) };
  });
}

export const keyLabel = (field: string): string => (field ? (KEY_LABEL[field] ?? field) : tr("Record"));

/** The headings of the first two key columns, from the key fields of the rows on screen. */
export function keyHeaders(rows: readonly Pick<WorkRow, "record_key">[]): { first: string; second: string } {
  let first = "";
  let second = "";
  for (const r of rows) {
    const parts = splitKey(r.record_key);
    if (!first && parts[0]?.field) first = parts[0].field;
    if (!second && parts[1]?.field) second = parts[1].field;
    if (first && second) break;
  }
  return { first: first ? keyLabel(first) : tr("Record"), second: second ? keyLabel(second) : tr("Plant") };
}

export const recordItemId = (r: Pick<WorkRow, "module" | "record_key">): string => `${r.module}:${r.record_key}`;
export const overrideKey = (r: Pick<WorkRow, "module" | "record_key">): string => `${r.module}|${r.record_key}`;

// Words -----------------------------------------------------------------------------------------------------------

const SHOWN_VALUES = 3;

/** "EA, PC, KG" and how many more there are. */
export function possibleValues(r: Pick<WorkRow, "possible_values" | "possible_values_total">): { text: string; more: number; full: string } | null {
  const list = r.possible_values;
  if (!list || list.length === 0) return null;
  const shown = list.slice(0, SHOWN_VALUES);
  const total = Math.max(r.possible_values_total ?? list.length, list.length);
  return {
    text: shown.map((v) => v.value).join(", "),
    more: total - shown.length,
    full: list.map((v) => (v.label ? `${v.value} (${v.label})` : v.value)).join(", ") + (total > list.length ? tr(", and {count} more", { count: total - list.length }) : ""),
  };
}

const DAY = 86_400_000;
/** Whole days since the oldest failing issue was first seen, or null when the API did not say. */
export function daysOpen(firstSeen: string | null | undefined, now: number = Date.now()): number | null {
  if (!firstSeen) return null;
  const t = Date.parse(firstSeen);
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now - t) / DAY));
}

export const STATUS_LABEL: Record<string, string> = {
  get to_fix() { return tr("To fix"); },
  get proposed() { return tr("Waiting for approval"); },
  get approved() { return tr("Approved"); },
  get sent() { return tr("Sent to SAP"); },
  get not_an_issue() { return tr("Exception"); },
  get fixed() { return tr("Fixed"); },
};

const n = (x: number): string => whole(x);

/** The sentence under the title. Numbers are the summary's; nothing here is estimated. */
export function sentence(opts: { persona: string; chip: ChipId | null; summary: WorkSummary | undefined; objectLabel: string | null; module?: string | null }): string {
  const { persona, chip, summary, objectLabel } = opts;
  if (!summary) return "";
  const where = objectLabel ? tr(" in {objectLabel}", { objectLabel }) : "";
  const { module } = opts;
  const toFix = chipDef("tofix").count(summary, module) ?? 0;
  const suggested = chipDef("proposed").count(summary, module) ?? 0;
  const waiting = chipDef("approvals").count(summary, module) ?? 0;
  const exceptions = chipDef("exceptions").count(summary, module) ?? 0;
  if (chip === "approvals") return waiting > 0 ? tr("{n} {waiting, plural, one {record waits} other {records wait}} for approval{where}: the values are in a draft fix batch that a second person approves.", { n: n(waiting), waiting, where }) : tr("Nothing is waiting for approval{where}.", { where });
  if (chip === "exceptions") return tr("{n} {exceptions, plural, one {record is} other {records are}} signed off{where} as not an issue or an accepted risk.", { n: n(exceptions), exceptions, where });
  if (toFix === 0) return tr("Nothing is waiting to be fixed{where}.", { where });
  if (persona === "steward" || chip === "proposed") return tr("{n} {toFix, plural, one {record} other {records}} to fix{where}, {n2} with a suggested value.", { n: n(toFix), toFix, where, n2: n(suggested) });
  return tr("{n} {toFix, plural, one {record} other {records}} to fix{where}, ranked by value at risk.", { n: n(toFix), toFix, where });
}
