/**
 * Pure helpers for the To do surface (GET /attention): the words for tiers and kinds, the action the home takes from
 * the top item, the "as of" time and the sentence that names a viewer's scope. The list itself is ranked and
 * filtered server-side (api/services/attention.py); nothing here re-ranks it.
 */
import type { AttentionItem } from "@/lib/api/attention";
import { formatDate, formatModuleName, labelOf } from "@/lib/format";

/** The ranking tiers (plan 3.2), named for a filter chip. */
export const TIER_LABELS: Readonly<Record<number, string>> = {
  1: "Blocked work",
  2: "Data regressions",
  3: "Freshness",
  4: "Hygiene",
  5: "Admin",
};

export const TIERS = [1, 2, 3, 4, 5] as const;

const KIND_LABELS: Readonly<Record<string, string>> = {
  regression: "Regressions",
  stale_object: "Stale objects",
  schedule_missed: "Missed schedules",
  schedule_failed: "Failed schedules",
  job_failed: "Failed jobs",
  connection: "Connections",
  config_missing: "Missing configuration",
  config_drift: "Configuration drift",
  approvals: "Approvals",
  sla_breach: "Overdue by SLA",
  overdue_records: "Overdue records",
  object_no_go: "No-go objects",
  discovery_failed: "Failed discovery",
  fitness_drop: "Fitness drops",
  discovery_due: "Discovery due",
  rule_review: "Rules to review",
  contract_breach: "Contract breaches",
  access_requests: "Access requests",
  invites_pending: "Pending invites",
  seats: "Seats and licence",
  grants_expiring: "Grants expiring",
  dormant_users: "Dormant users",
  api_key_expiring: "Keys expiring",
};

/** A kind as a filter chip label. An unknown kind reads as its humanised id. */
export const kindLabel = (kind: string): string => KIND_LABELS[kind] ?? labelOf(kind);

/** The item's object by name (never the API's own label), else null. */
export const itemObject = (item: Pick<AttentionItem, "module" | "object">): string | null =>
  item.module ? formatModuleName(item.module) : item.object ? formatModuleName(item.object) : null;

/** The home's one action from the top item, when it is tier 3 or better (blocked work, a regression, freshness); lower-ranked work leaves the home's own action alone. */
export function attentionAction(top: AttentionItem | null | undefined): { label: string; href: string } | undefined {
  return top && top.tier <= 3 ? { label: top.action_label, href: top.href } : undefined;
}

/** "14:32", the time the list was built, in the viewer's zone. */
export function asOfTime(iso: string): string {
  const text = formatDate(iso, "datetime");
  return text === "—" ? text : text.split(", ").pop() ?? text;
}

/**
 * A viewer's scope in words: "every system and object" for an unscoped grant, else the grants' objects and systems
 * ("Material master on KSA PRD, Vendors"). `systems` names system ids.
 */
export function scopeSentence(
  scopes: readonly { system_id: string | null; module: string | null }[],
  systems: ReadonlyMap<string, string>,
): string {
  if (!scopes.length) return "every system and object";
  const parts = scopes.map((s) => {
    const system = s.system_id ? systems.get(s.system_id) ?? "one system" : null;
    const object = s.module ? formatModuleName(s.module) : null;
    if (object && system) return `${object} on ${system}`;
    return object ?? (system ? `all objects on ${system}` : "everything");
  });
  return [...new Set(parts)].join(", ");
}
