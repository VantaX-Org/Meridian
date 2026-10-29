/**
 * The People canvas's pure parts: the role words, the figures a row shows and the order of the table.
 */
import type { Person } from "@/lib/api/v2/people";
import type { Landscape } from "@/lib/api/v2/types";
import { moduleSlug, systemSlug } from "./score";

export const ROLE_WORD: Record<string, string> = {
  admin: "Administrator",
  platform_admin: "Administrator",
  manager: "Programme lead",
  programme_lead: "Programme lead",
  steward: "Data steward",
  data_steward: "Data steward",
  approver: "Data owner",
  data_owner: "Data owner",
  analyst: "Analyst",
  auditor: "Auditor",
  viewer: "Viewer",
  ai_reviewer: "AI reviewer",
  process_analyst: "Process analyst",
  sap_basis: "SAP Basis",
};

export const roleWord = (role: string): string => ROLE_WORD[role] ?? role.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * SLA met, as a percentage. The API's own figure when it sends one; otherwise the share of open work that is not yet
 * past its due date (null when the person has no open work), which the column's heading says.
 */
export function slaMet(p: Pick<Person, "open_work" | "overdue" | "sla_met_pct">): number | null {
  if (p.sla_met_pct != null) return Math.round(p.sla_met_pct);
  if (p.open_work <= 0) return null;
  return Math.round((100 * (p.open_work - Math.min(p.overdue, p.open_work))) / p.open_work);
}

export type PeopleSort = "open" | "name" | "approvals" | "overdue" | "sla" | "breaches" | "last";

export const PEOPLE_SORT_LABEL: Record<PeopleSort, string> = {
  open: "Open work",
  name: "Person",
  approvals: "Approvals waiting",
  overdue: "Overdue",
  sla: "SLA met",
  breaches: "Breaches this month",
  last: "Last action",
};

const num = (a: number | null, b: number | null, desc: boolean): number => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return desc ? b - a : a - b;
};

/**
 * The table's order. The caller's own row is always first. Most columns sort high first (open work, overdue, breaches);
 * SLA met sorts low first, because the lowest is who needs a word.
 */
export function sortPeople(people: readonly Person[], key: PeopleSort, reverse = false): Person[] {
  const cmp = (a: Person, b: Person): number => {
    let d = 0;
    if (key === "open") d = num(a.open_work, b.open_work, true);
    else if (key === "approvals") d = num(a.approvals_waiting, b.approvals_waiting, true);
    else if (key === "overdue") d = num(a.overdue, b.overdue, true);
    else if (key === "breaches") d = num(a.breaches_this_month, b.breaches_this_month, true);
    else if (key === "sla") d = num(slaMet(a), slaMet(b), false);
    else if (key === "last") d = num(a.last_action_at ? Date.parse(a.last_action_at) : null, b.last_action_at ? Date.parse(b.last_action_at) : null, true);
    else d = a.name.localeCompare(b.name);
    if (reverse && d !== 0) d = -d;
    return d !== 0 ? d : b.open_work - a.open_work || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  };
  const sorted = [...people].sort(cmp);
  const me = sorted.findIndex((p) => p.is_me);
  if (me > 0) sorted.unshift(...sorted.splice(me, 1));
  return sorted;
}

/** "2 owned, 1 stewarded", or null when the person holds no object. */
export function objectsLine(p: Pick<Person, "objects_owned">): string | null {
  const owned = p.objects_owned.filter((o) => o.as === "owner").length;
  const stewarded = p.objects_owned.filter((o) => o.as === "steward").length;
  const parts = [owned ? `${owned} owned` : null, stewarded ? `${stewarded} stewarded` : null].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** The SLA hours as days when they are whole days ("3 days"), else hours. */
export function slaWord(hours: number | null): string | null {
  if (hours == null) return null;
  if (hours >= 24 && Math.abs(hours / 24 - Math.round(hours / 24)) < 0.01) {
    const d = Math.round(hours / 24);
    return `${d} ${d === 1 ? "day" : "days"}`;
  }
  const h = Math.round(hours * 10) / 10;
  return `${h} ${h === 1 ? "hour" : "hours"}`;
}

/** The link to an object canvas: the system it was last analysed on, else the first system, else the landscape. */
export function objectHref(landscape: Landscape | undefined, module: string): string {
  const cell = landscape?.cells.find((c) => c.module === module);
  const system = landscape?.systems.find((s) => s.id === cell?.system_id) ?? landscape?.systems.find((s) => s.state === "analysed") ?? landscape?.systems[0];
  return system ? `/v2/o/${systemSlug(system.name)}/${moduleSlug(module)}` : "/v2";
}

/** Open work grouped by object, largest first: what a person's inspector lists. */
export function workByObject(rows: readonly { module: string }[]): { module: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.module, (counts.get(r.module) ?? 0) + 1);
  return [...counts].map(([module, count]) => ({ module, count })).sort((a, b) => b.count - a.count || a.module.localeCompare(b.module));
}
