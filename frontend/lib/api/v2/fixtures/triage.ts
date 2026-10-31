/**
 * Triage fixture: the ranked work queue, bulk actions, SLA metrics, teams and assignment rules, shaped like
 * api/routes/triage.py. Bulk actions, team and rule changes change the rows in memory the way the routes do.
 */
import type { AssignRule, QueueItem, Team, TriageMetrics } from "../triage";

export const NONE_TRIAGE = Symbol("not a triage path");

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const ahead = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const endOfDay = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.toISOString(); };

// kind, id, module, check, severity, record, owner, team, priority, sla state, hours to due, affected records
const ROWS: [QueueItem["kind"], string, string, string, string, string, string | null, string | null, number | null, string, number, number][] = [
  ["issue", "iss-101", "material_master", "MM142", "critical", "10004711", "u-me", null, 1, "breached", -6, 12],
  ["issue", "iss-102", "accounts_payable", "AP031", "high", "1000412", "u-me", "tm-fin", 2, "breached", -2, 3],
  ["queue", "q-201", "business_partner", "BP007", "high", "BP 300112", "u-me", null, null, "at_risk", 3, 1],
  ["issue", "iss-103", "material_master", "MM118", "medium", "10009977", "u-me", "tm-mdm", 3, "on_track", 30, 40],
  ["issue", "iss-104", "sd_customer_master", "SD022", "medium", "2000814", null, null, null, "on_track", 54, 8],
  ["queue", "q-202", "plant_maintenance", "PM014", "low", "EQ 400120", null, "tm-mdm", null, "on_track", 120, 1],
  ["issue", "iss-105", "fi_gl", "GL009", "high", "4100", "u-an", "tm-fin", 2, "at_risk", 2, 2],
];

const SEV_WEIGHT: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

let items: QueueItem[] | null = null;
let teams: Team[] | null = null;
let rules: AssignRule[] | null = null;

function itemState(): QueueItem[] {
  items ??= ROWS.map(([kind, id, module, check_id, severity, ref, assigned_to, assigned_team_id, priority, sla_state, due, affected]) => {
    // As the service: severity weight times affected records, and urgency is the share of the SLA window used.
    const impact = (SEV_WEIGHT[severity] ?? 1) * affected;
    const urgency = sla_state === "breached" ? 1 : sla_state === "at_risk" ? 0.7 : 0.3;
    return {
      kind, id, module, check_id, severity, status: "open", ref, assigned_to, assigned_team_id, priority, sla_state,
      due_at: ahead(due), ack_due_at: null, acknowledged_at: assigned_to ? ago(4) : null, sla_paused_at: null,
      snoozed_until: null, snooze_reason: null, impact, urgency, rank_score: Math.round(impact * (1 + 2 * urgency) * 100) / 100,
    };
  });
  return items;
}

function teamState(): Team[] {
  teams ??= [
    { id: "tm-mdm", name: "Master data stewards", strategy: "least_loaded", lead_user_id: "u-an", member_ids: ["u-an", "u-me", "u-pk"], open_items: 0 },
    { id: "tm-fin", name: "Finance data", strategy: "round_robin", lead_user_id: "u-tm", member_ids: ["u-tm", "u-rg"], open_items: 0 },
  ];
  return teams;
}

function ruleState(): AssignRule[] {
  rules ??= [
    { id: "ar-1", name: "Critical material findings", position: 1, enabled: true, match: { module: ["material_master"], severity: ["critical"] }, assign_user_id: "u-an", assign_team_id: null, updated_at: ago(72) },
    { id: "ar-2", name: "Finance modules", position: 2, enabled: true, match: { module: ["fi_gl", "accounts_payable"] }, assign_user_id: null, assign_team_id: "tm-fin", updated_at: ago(240) },
    { id: "ar-3", name: "Plant 1100 maintenance", position: 3, enabled: false, match: { module: ["plant_maintenance"], plant: ["1100"] }, assign_user_id: null, assign_team_id: "tm-mdm", updated_at: ago(500) },
  ];
  return rules;
}

export const resetTriageFixture = (): void => { items = null; teams = null; rules = null; };

function refuse(detail: string, code = 400): never {
  throw Object.assign(new Error(detail), { status: code, response: { status: code, data: { detail } } });
}

const snoozed = (x: QueueItem) => x.snoozed_until !== null && x.snoozed_until > new Date().toISOString();

function queue(params: Record<string, unknown>) {
  const who = String(params.assignee ?? "me");
  const mine = (x: QueueItem) =>
    who === "all" ? true : who === "me" ? x.assigned_to === "u-me" : who === "unassigned" ? !x.assigned_to && !x.assigned_team_id
      : who.startsWith("team:") ? x.assigned_team_id === who.slice(5) : x.assigned_to === who;
  const now = new Date().toISOString(), eod = endOfDay();
  const hit = itemState().filter((x) => mine(x) && (params.include_snoozed || !snoozed(x)))
    .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || b.rank_score - a.rank_score);
  const bucket = (f: (x: QueueItem) => boolean) => { const l = hit.filter(f); return { count: l.length, items: l }; };
  return {
    assignee: who, as_of: now,
    overdue: bucket((x) => String(x.due_at) < now),
    due_today: bucket((x) => String(x.due_at) >= now && String(x.due_at) <= eod),
    later: bucket((x) => String(x.due_at) > eod),
  };
}

function metrics(): TriageMetrics {
  const all = itemState();
  const backlog = (l: QueueItem[]) => ({ open: l.length, breached: l.filter((x) => x.sla_state === "breached").length, at_risk: l.filter((x) => x.sla_state === "at_risk").length });
  const owners = [...new Set(all.map((x) => x.assigned_to).filter((x): x is string => !!x))];
  const week = (n: number) => { const d = new Date(); d.setDate(d.getDate() - d.getDay() + 1 - n * 7); return d.toISOString().slice(0, 10); };
  const WEEKLY = [[14, 9, 7, 2], [18, 12, 10, 3], [11, 15, 13, 1], [16, 14, 11, 2], [21, 13, 9, 4], [12, 17, 15, 1], [9, 14, 13, 0], [7, 6, 5, 2]];
  return {
    weeks: 8,
    backlog_by_owner: owners.map((u) => ({ user_id: u, email: `${u.slice(2)}@example.com`, ...backlog(all.filter((x) => x.assigned_to === u)) })),
    backlog_by_team: teamState().map((t) => ({ team_id: t.id, name: t.name, ...backlog(all.filter((x) => x.assigned_team_id === t.id)) })),
    unassigned: all.filter((x) => !x.assigned_to).length,
    resolved_in_sla: 83, resolved_total: 100, sla_attainment_pct: 83.0, mtta_hours: 3.4, mttr_hours: 41.7, breach_count: 15,
    weekly: WEEKLY.map(([opened, resolved, in_sla, breached], i) => ({ week: week(7 - i), opened, resolved, resolved_in_sla: in_sla, breached })),
  };
}

export function triageRead(path: string, params: Record<string, unknown>): unknown {
  if (path === "/triage/queue") return queue(params);
  if (path === "/triage/metrics") return metrics();
  if (path === "/triage/teams") return teamState().map((t) => ({ ...t, open_items: itemState().filter((x) => x.assigned_team_id === t.id).length }));
  if (path === "/triage/rules") return [...ruleState()].sort((a, b) => a.position - b.position);
  return NONE_TRIAGE;
}

export function triageWrite(method: string, path: string, body: unknown): unknown {
  const b = (body ?? {}) as Record<string, unknown>;
  if (method === "POST" && path === "/triage/bulk") {
    const ids = (b.ids as string[] | undefined) ?? [];
    const hit = itemState().filter((x) => x.kind === b.kind && ids.includes(x.id));
    if ((b.action === "assign" || b.action === "reassign") && !b.user_id && !b.team_id) refuse("assign needs user_id or team_id", 422);
    if (b.action === "snooze" && (!b.reason || !b.until || String(b.until) <= new Date().toISOString())) refuse("snooze needs a reason and a future until", 422);
    for (const x of hit) {
      if (b.action === "assign" || b.action === "reassign") { x.assigned_to = (b.user_id as string) ?? null; x.assigned_team_id = (b.team_id as string) ?? x.assigned_team_id; }
      if (b.action === "release") x.assigned_to = null;
      if (b.action === "snooze") { x.snoozed_until = String(b.until); x.snooze_reason = String(b.reason); }
      if (b.action === "unsnooze") { x.snoozed_until = null; x.snooze_reason = null; }
      if (b.action === "priority") x.priority = Number(b.priority);
      if (b.action === "acknowledge") x.acknowledged_at = new Date().toISOString();
      if (b.action === "wait") { x.status = String(b.waiting); x.sla_paused_at = new Date().toISOString(); }
      if (b.action === "resume") { x.status = "open"; x.sla_paused_at = null; }
    }
    return { action: b.action, updated: hit.length, sla: {} };
  }
  if (method === "POST" && path === "/triage/teams") {
    const t: Team = { id: `tm-${teamState().length + 1}`, name: String(b.name), strategy: (b.strategy as Team["strategy"]) ?? "round_robin", lead_user_id: null, member_ids: (b.member_ids as string[]) ?? [], open_items: 0 };
    teamState().push(t);
    return t;
  }
  const tm = /^\/triage\/teams\/([^/]+)(\/members)?$/.exec(path);
  if (tm) {
    const t = teamState().find((x) => x.id === decodeURIComponent(tm[1])) ?? refuse("Team not found", 404);
    if (method === "DELETE") { teams = teamState().filter((x) => x !== t); return null; }
    if (method === "PUT" && tm[2]) { t.member_ids = (b.user_ids as string[]) ?? []; return t; }
  }
  if (method === "POST" && path === "/triage/rules") {
    if (!b.assign_user_id === !b.assign_team_id) refuse("exactly one of assign_user_id / assign_team_id", 422);
    const r: AssignRule = {
      id: `ar-${ruleState().length + 1}`, name: String(b.name), position: ruleState().length + 1, enabled: b.enabled !== false,
      match: (b.match as AssignRule["match"]) ?? {}, assign_user_id: (b.assign_user_id as string) ?? null, assign_team_id: (b.assign_team_id as string) ?? null, updated_at: new Date().toISOString(),
    };
    ruleState().push(r);
    return r;
  }
  const rm = /^\/triage\/rules\/([^/]+)$/.exec(path);
  if (rm) {
    const r = ruleState().find((x) => x.id === decodeURIComponent(rm[1])) ?? refuse("Rule not found", 404);
    if (method === "DELETE") { rules = ruleState().filter((x) => x !== r); return null; }
    if (method === "PATCH") { Object.assign(r, { enabled: b.enabled !== false, updated_at: new Date().toISOString() }); return r; }
  }
  return NONE_TRIAGE;
}
