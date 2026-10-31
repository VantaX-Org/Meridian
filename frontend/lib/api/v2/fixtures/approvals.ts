import type { Notification } from "@/types/api";
import type { NextStep, Person } from "../people";
import type { AssignableUser, Digest, SlaPolicy } from "../triage";
import { batchesFixture } from "./work-fixture";

/**
 * People, notifications, triage settings and assignable users in fixture mode (`?fixture=1`). The people are the
 * demo tenant's: the person looking is "Demo user" (id u-me), and the approvals each can act on follow the batches of
 * the work fixture, so approving one changes the counts here too.
 */

function fail(status: number, detail: string): never {
  throw Object.assign(new Error(detail), { status, response: { status, data: { detail } } });
}

export const ME = "u-me";

const USERS: AssignableUser[] = [
  { id: "u-me", name: "Demo user", email: "demo.user@example.com", role: "programme_lead" },
  { id: "u-rg", name: "R. Govender", email: "r.govender@example.com", role: "programme_lead" },
  { id: "u-an", name: "A. Naidoo", email: "a.naidoo@example.com", role: "data_steward" },
  { id: "u-tm", name: "T. Mokoena", email: "t.mokoena@example.com", role: "data_owner" },
  { id: "u-pk", name: "P. Khumalo", email: "p.khumalo@example.com", role: "data_owner" },
  { id: "u-sd", name: "S. Dlamini", email: "s.dlamini@example.com", role: "sap_basis" },
];

const APPROVERS = new Set(["programme_lead", "data_owner", "admin"]);

type Base = Omit<Person, "approvals_waiting" | "name" | "email" | "role" | "id" | "is_me">;
const BASE: Record<string, Base> = {
  "u-me": { objects_owned: [{ module: "material_master", label: "Material master", as: "steward" }], open_work: 38, overdue: 3, sla_hours: 72, breaches_this_month: 1, last_action_at: "2026-10-16T08:55:00Z" },
  "u-rg": { objects_owned: [{ module: "material_master", label: "Material master", as: "owner" }, { module: "accounts_payable", label: "Accounts payable", as: "owner" }], open_work: 12, overdue: 0, sla_hours: 72, breaches_this_month: 0, last_action_at: "2026-10-15T16:20:00Z" },
  "u-an": { objects_owned: [{ module: "material_master", label: "Material master", as: "steward" }, { module: "mm_purchasing", label: "MM purchasing", as: "steward" }], open_work: 214, overdue: 31, sla_hours: 24, breaches_this_month: 9, last_action_at: "2026-10-16T08:12:00Z" },
  "u-tm": { objects_owned: [{ module: "business_partner", label: "Business partner", as: "owner" }, { module: "accounts_payable", label: "Accounts payable", as: "owner" }, { module: "accounts_receivable", label: "Accounts receivable", as: "owner" }], open_work: 6, overdue: 0, sla_hours: 72, breaches_this_month: 0, last_action_at: "2026-10-15T11:05:00Z" },
  "u-pk": { objects_owned: [{ module: "fi_gl", label: "FI general ledger", as: "owner" }, { module: "asset_accounting", label: "Asset accounting", as: "owner" }], open_work: 0, overdue: 0, sla_hours: null, breaches_this_month: 0, last_action_at: "2026-09-30T14:48:00Z" },
  "u-sd": { objects_owned: [], open_work: 0, overdue: 0, sla_hours: null, breaches_this_month: 0, last_action_at: "2026-10-14T07:30:00Z" },
};

/** GET /people: the caller's row first, then by open work. Approvals waiting are the draft batches a person did not build. */
export function peopleFixture(): { people: Person[] } {
  const drafts = batchesFixture().items.filter((b) => b.status === "draft" && b.items > 0);
  const people = USERS.map<Person>((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    is_me: u.id === ME,
    ...BASE[u.id],
    approvals_waiting: APPROVERS.has(u.role) ? drafts.filter((b) => b.created_by !== u.id).length : 0,
  }));
  people.sort((a, b) => Number(b.is_me) - Number(a.is_me) || b.open_work - a.open_work || a.name.localeCompare(b.name));
  return { people };
}

/** GET /people/next for Demo user: the drafts of others to approve, their own sent back, their overdue work. */
export function nextFixture(): { items: NextStep[] } {
  const batches = batchesFixture().items.filter((b) => b.items > 0);
  const step = (kind: NextStep["kind"], id: string, title: string, href: string, count = 1, due_at: string | null = null): NextStep => ({ kind, id, title, count, due_at, href });
  const items: NextStep[] = [
    ...batches.filter((b) => b.status === "draft" && b.created_by !== ME).map((b) => step("approve_batch", b.id, b.name, `/?open=batch:${b.id}`, 1, b.due_at ?? null)),
    ...batches.filter((b) => b.status === "draft" && b.created_by === ME && (b.filter as { returned?: unknown }).returned).map((b) => step("sent_back", b.id, b.name, `/?open=batch:${b.id}`)),
  ];
  const late = BASE[ME].overdue;
  if (late) items.push(step("overdue", ME, "", "/work?assigned=me&due=overdue", late));
  return { items };
}

/** POST /people/{id}/remind. */
export function remindFixture(id: string): { user_id: string; status: string } {
  if (!USERS.some((u) => u.id === id)) fail(404, "No such person.");
  return { user_id: id, status: "sent" };
}

export const assignableFixture = (): AssignableUser[] => USERS;

// Notifications ----------------------------------------------------------------------------------------------------

/** A moment `days` ago at the given local hour, so "Today" and "Earlier" read the same whenever the fixture is opened. */
function at(days: number, hour: number, minute: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function buildNotifications(): Notification[] {
  const n = (id: string, type: Notification["type"], title: string, body: string, link: string | null, read: boolean, when: string): Notification => ({ id, tenant_id: "t1", user_id: ME, type, title, body, link, is_read: read, created_at: when });
  return [
    n("n1", "approval", "Batch B-241 waits for your approval", "328 records of Material master, ZAR 412,600 at risk. Built by R. Govender.", "/work?filter=approvals&open=batch:B-241", false, at(0, 8, 41)),
    n("n2", "sla_at_risk", "41 records of Material master are close to their due date", "They are due within two days; A. Naidoo holds 38 of them.", "/o/ecc-production/material-master", false, at(0, 7, 58)),
    n("n3", "sla_breached", "3 records breached their SLA", "Critical rule MM003 is 2 days past its due date on 3 records.", "/work?due=overdue", false, at(0, 7, 20)),
    n("n4", "info", "Analysis finished on ECC production", "61,816 records checked; Material master scores 70.0, capped by MM003 and MM035.", "/runs", false, at(0, 5, 31)),
    n("n5", "approval", "Batch B-236 was approved", "T. Mokoena approved 180 records. It is ready to send to SAP.", "/work?filter=open&batch=B-236&open=batch:B-236", false, at(1, 11, 5)),
    n("n6", "dq_alert", "MM142 failures rose by 112 records", "Base unit of measure is not valid on 112 more records than in the run before.", "/r/MM142", false, at(1, 6, 2)),
    n("n7", "exception", "A. Naidoo signed off 4 records as not an issue", "Material master, rule MM007. Open Exceptions to review the reasons.", "/work?filter=exceptions", false, at(2, 15, 12)),
    n("n8", "digest", "Your weekly digest", "38 records assigned to you, 3 overdue, 2 batches waiting for approval.", "/people", true, at(3, 7, 0)),
    n("n9", "report", "The board pack for September is ready", "Open Reports in the current interface to download it.", "/reports", true, at(5, 9, 30)),
    n("n10", "monitor", "5 new failing records since the baseline", "ECC production, Purchasing: new records fail EKGRP.", "/o/ecc-production/mm-purchasing", true, at(6, 8, 15)),
    n("n11", "cleaning", "Cleaning proposals for Business partner are ready", "214 proposals await review.", "/o/ecc-production/business-partner", true, at(8, 10, 40)),
    n("n12", "info", "SuccessFactors has not been extracted yet", "Extract it from the Landscape to see its objects.", "/", true, at(11, 13, 5)),
  ];
}

let notifications = buildNotifications();

export const notificationsFixture = (limit = 50): { items: Notification[]; total: number } => ({ items: notifications.slice(0, limit), total: notifications.length });
export const unreadFixture = (): { count: number } => ({ count: notifications.filter((x) => !x.is_read).length });

export function readFixture(id: string): { id: string; is_read: boolean } {
  if (!notifications.some((x) => x.id === id)) fail(404, "Notification not found");
  notifications = notifications.map((x) => (x.id === id ? { ...x, is_read: true } : x));
  return { id, is_read: true };
}

export function readAllFixture(): { status: string } {
  notifications = notifications.map((x) => ({ ...x, is_read: true }));
  return { status: "ok" };
}

// Triage ---------------------------------------------------------------------------------------------------------

const buildPolicies = (): SlaPolicy[] => [
  { id: "sla-critical", severity: "critical", module: null, ack_minutes: 240, resolve_minutes: 1 * 1440, at_risk_pct: 80, business_hours: false },
  { id: "sla-high", severity: "high", module: null, ack_minutes: 480, resolve_minutes: 3 * 1440, at_risk_pct: 80, business_hours: false },
  { id: "sla-medium", severity: "medium", module: null, ack_minutes: null, resolve_minutes: 7 * 1440, at_risk_pct: 80, business_hours: false },
  { id: "sla-low", severity: "low", module: null, ack_minutes: null, resolve_minutes: 14 * 1440, at_risk_pct: 80, business_hours: false },
];
let policies = buildPolicies();
let digest: Digest = "weekly";

export const policiesFixture = (): SlaPolicy[] => policies;
export function putPolicyFixture(body: Omit<SlaPolicy, "id" | "is_default">): SlaPolicy {
  if (!(body.resolve_minutes > 0)) fail(422, "resolve_minutes must be greater than 0");
  const row: SlaPolicy = { ...body, id: `sla-${body.severity}` };
  policies = policies.map((p) => (p.severity === body.severity && p.module === body.module ? row : p));
  return row;
}
export const preferencesFixture = (): { notifications: { digest: Digest } } => ({ notifications: { digest } });
export function patchPreferencesFixture(body: { notifications?: { digest?: Digest } }): { notifications: { digest: Digest } } {
  if (body.notifications?.digest) digest = body.notifications.digest;
  return preferencesFixture();
}

export function resetApprovalsFixture(): void {
  notifications = buildNotifications();
  policies = buildPolicies();
  digest = "weekly";
}
