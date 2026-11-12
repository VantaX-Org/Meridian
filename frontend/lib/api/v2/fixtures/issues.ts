/**
 * Record issues fixture: the steward work list for ECC production, shaped like api/routes/record_issues.py. Filters
 * work as the route's do (the counts per status ignore the status filter), the order is severity then first seen, and
 * bulk changes and comments are kept in memory with their events, refused the way the route refuses them.
 */
import { assignableFixture } from "./approvals";
import type { Issue, IssueEvent, IssueRun, IssueStatus } from "../issues";

export const NONE_ISSUES = Symbol("not a record issues path");

const USERS: Record<string, string> = Object.fromEntries(assignableFixture().map((u) => [u.id, u.email]));

// module, check, record, severity, status, assignee, day first seen in October, reopened, due day (null: none), SLA, message, field
const ROWS: [string, string, string, string, IssueStatus, string | null, number, number, number | null, string | null, string, string][] = [
  ["material_master", "MM142", "000000000010004711", "critical", "open", null, 12, 0, 2, "breached", "Valuation class is blank for a valuated material type", "MBEW.BKLAS"],
  ["material_master", "MM142", "000000000010009120", "critical", "in_progress", "u-an", 14, 0, 4, "at_risk", "Valuation class is blank for a valuated material type", "MBEW.BKLAS"],
  ["business_partner", "BP018", "0001000412", "critical", "waiting_sap", "u-tm", 9, 1, 6, "paused", "Bank account has no IBAN for a country that requires one", "BUT0BK.IBAN"],
  ["material_master", "MM003", "000000000010007220", "high", "open", "u-me", 18, 0, 7, "on_track", "Base unit of measure differs from the purchasing unit without a conversion", "MARA.MEINS"],
  ["material_master", "MM035", "000000000010007781", "high", "open", null, 20, 0, 8, "on_track", "Gross weight is lower than net weight", "MARA.BRGEW"],
  ["business_partner", "BP004", "0001003318", "high", "waiting_requester", "u-an", 16, 0, 5, "paused", "Tax number is missing for a business partner in a VAT country", "DFKKBPTAXNUM.TAXNUM"],
  ["material_master", "MM061", "000000000010008804", "high", "in_progress", "u-me", 21, 2, 9, "on_track", "MRP type is set but no MRP controller is assigned", "MARC.DISPO"],
  ["business_partner", "BP011", "0001000377", "medium", "open", null, 22, 0, null, null, "Search term is empty", "BUT000.BU_SORT1"],
  ["material_master", "MM088", "000000000010004712", "medium", "open", "u-tm", 23, 0, null, null, "Material description is in upper case only", "MAKT.MAKTX"],
  ["material_master", "MM019", "000000000010006130", "medium", "accepted", "u-an", 10, 0, null, null, "Old material number points to a material that no longer exists", "MARA.BISMT"],
  ["business_partner", "BP027", "0001001108", "medium", "resolved", "u-tm", 11, 0, null, null, "Postal code does not match the country format", "ADRC.POST_CODE1"],
  ["material_master", "MM112", "000000000010009977", "low", "open", null, 25, 0, null, null, "Laboratory or design office is not set", "MARA.LABOR"],
  ["business_partner", "BP033", "0001000877", "low", "resolved", "u-me", 8, 1, null, null, "Communication language is not set", "BUT000.LANGU"],
  ["material_master", "MM142", "000000000010003305", "critical", "open", null, 27, 0, 3, "at_risk", "Valuation class is blank for a valuated material type", "MBEW.BKLAS"],
  ["business_partner", "BP018", "0001002240", "critical", "accepted", "u-tm", 6, 0, null, null, "Bank account has no IBAN for a country that requires one", "BUT0BK.IBAN"],
];

function refuse(detail: string, code = 400): never {
  throw Object.assign(new Error(detail), { status: code, response: { status: code, data: { detail } } });
}

const day = (d: number, h = 2) => `2026-10-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:10:00+00:00`;
const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2 };

let issues: Issue[] | null = null;
let events: Map<string, IssueEvent[]> = new Map();

function state(): Issue[] {
  if (issues) return issues;
  issues = ROWS.map(([module, check_id, record_key, severity, status, who, first, reopened, due, sla, message, field], i) => ({
    id: `issue-${i + 1}`, scope: "ecc_prd", module, check_id, record_key, severity, status,
    resolution: status === "accepted" ? "accepted_risk" : status === "resolved" ? "fixed_in_source" : null,
    assigned_to: who, assignee_email: who ? USERS[who] : null, first_seen_at: day(first), last_seen_at: day(30),
    resolved_at: status === "resolved" ? day(29, 9) : null, reopened_count: reopened, due_at: due == null ? null : `2026-11-${String(due).padStart(2, "0")}T17:00:00+00:00`,
    sla_state: sla, message, field,
  }));
  events = new Map(issues.map((x) => [x.id, [
    ...(x.assigned_to ? [{ action: "assign" as const, from_value: null, to_value: x.assignee_email, note: null, user_label: "r.govender@example.com", created_at: day(29, 8) }] : []),
    ...(x.status !== "open" ? [{ action: "status" as const, from_value: "open", to_value: x.status, note: x.status === "accepted" ? "Legacy material, blocked for procurement; kept for history." : null, user_label: x.assignee_email, created_at: day(29, 10) }] : []),
  ]]));
  return issues;
}

export const resetIssuesFixture = (): void => { issues = null; };

function runs(x: Issue): IssueRun[] {
  const first = Number(x.first_seen_at?.slice(8, 10) ?? 1);
  return [30, 28, 26, 24, 22, 20, 18, 16, 14, 12, 10, 8].filter((d) => d >= first).map((d, i) => ({
    version_id: `run-${d}`, run_at: day(d), failing: x.status !== "resolved" || i > 0,
  }));
}

export function issuesRead(path: string, params: Record<string, unknown>): unknown {
  const one = /^\/issues\/([^/]+)$/.exec(path);
  if (one && one[1] !== "export") {
    const x = state().find((i) => i.id === decodeURIComponent(one[1]));
    if (!x) refuse("Issue not found.", 404);
    return { issue: x, events: [...(events.get(x.id) ?? [])].reverse(), runs: runs(x) };
  }
  if (path !== "/issues") return NONE_ISSUES;
  const who = params.assigned_to as string | undefined;
  const search = String(params.search ?? "").toLowerCase();
  const base = state()
    .filter((i) => !params.severity || i.severity === params.severity)
    .filter((i) => !params.module || i.module === params.module)
    .filter((i) => !params.check_id || i.check_id === params.check_id)
    .filter((i) => !who || (who === "unassigned" ? !i.assigned_to : i.assigned_to === (who === "me" ? "u-me" : who)))
    .filter((i) => !search || i.record_key.toLowerCase().includes(search));
  const counts: Partial<Record<IssueStatus, number>> = {};
  for (const i of base) counts[i.status] = (counts[i.status] ?? 0) + 1;
  const rows = base
    .filter((i) => !params.status || i.status === params.status)
    .sort((a, b) => (RANK[a.severity] ?? 3) - (RANK[b.severity] ?? 3) || (a.first_seen_at ?? "").localeCompare(b.first_seen_at ?? "") || a.check_id.localeCompare(b.check_id));
  const offset = Number(params.offset ?? 0);
  const limit = Number(params.limit ?? 100);
  return { total: rows.length, counts, items: rows.slice(offset, offset + limit) };
}

export function issuesWrite(method: string, path: string, body: unknown): unknown {
  if (method !== "POST") return NONE_ISSUES;
  const note = /^\/issues\/([^/]+)\/comments$/.exec(path);
  if (note) {
    const id = decodeURIComponent(note[1]);
    if (!state().some((i) => i.id === id)) refuse("Issue not found.", 404);
    events.get(id)?.push({ action: "comment", from_value: null, to_value: null, note: (body as { body: string }).body, user_label: USERS["u-me"], created_at: new Date().toISOString() });
    return { ok: true };
  }
  if (path !== "/issues/bulk") return NONE_ISSUES;
  const b = body as { ids: string[]; status?: IssueStatus; resolution?: string; assigned_to?: string; note?: string };
  if (!b.status && b.assigned_to === undefined && !b.note) refuse("Nothing to change.");
  if ((b.status === "accepted" || b.status === "resolved") && !b.resolution) refuse("Choose a resolution for this status.");
  if (b.resolution === "false_positive" && !b.note) refuse("Say why the finding is a false positive.");
  const now = new Date().toISOString();
  let updated = 0;
  for (const x of state().filter((i) => b.ids.includes(i.id))) {
    const log = events.get(x.id) ?? [];
    if (b.status && b.status !== x.status) {
      log.push({ action: "status", from_value: x.status, to_value: b.status, note: b.note ?? null, user_label: USERS["u-me"], created_at: now });
      x.status = b.status;
      x.resolution = (b.resolution as Issue["resolution"]) ?? null;
      x.resolved_at = b.status === "resolved" ? now : null;
    }
    if (b.assigned_to !== undefined) {
      const email = b.assigned_to ? USERS[b.assigned_to] ?? `${b.assigned_to}@example.com` : null;
      log.push({ action: "assign", from_value: x.assignee_email, to_value: email, note: null, user_label: USERS["u-me"], created_at: now });
      x.assigned_to = b.assigned_to || null;
      x.assignee_email = email;
    }
    if (!b.status && b.assigned_to === undefined && b.note) log.push({ action: "comment", from_value: null, to_value: null, note: b.note, user_label: USERS["u-me"], created_at: now });
    events.set(x.id, log);
    updated += 1;
  }
  return { updated };
}
