/**
 * The fix screen's pure parts: which rows a chip or a rule filter keeps, what a decision does to a cached row, the
 * body the projection call takes and the sentences in the pinned strip. No React and no network.
 */
import type { WorkRow } from "@/lib/api/v2/types";
import type { SimulateBody } from "@/lib/api/v2/step9";
import { t } from "@/lib/v2/i18n";
import { ruleIds, type ChipId, type LedgerState } from "@/lib/v2/work";

/** The API takes at most this many records in one projection call. */
export const PROJECTION_CAP = 5000;

export const rowId = (r: Pick<WorkRow, "module" | "record_key">): string => `${r.module}|${r.record_key}`;

/** The value the engine proposes for a row: the PR 791 suggestion when the API sends it, else the older field. */
export const machineValue = (r: WorkRow): string | null => r.suggestion?.value ?? r.suggested_value ?? null;
/** A row whose value waits in a draft fix batch: a decision was made and nothing is sent yet. */
export const isDraft = (r: WorkRow): boolean => r.status === "proposed";

/**
 * The chips are filters over one list of open rows, so a decided row stays where it is and changes state.
 * Fixed and Exceptions are not open rows: the screen reads them from their own server query.
 */
export function inChip(r: WorkRow, chip: ChipId | null): boolean {
  switch (chip) {
    case null: return true;
    case "tofix": return r.status === "to_fix";
    case "proposed": return r.status === "to_fix" && machineValue(r) !== null;
    case "approvals": return r.status === "proposed";
    case "approved": return r.status === "approved";
    case "sent": return r.status === "sent";
    default: return true;
  }
}

/** The rule ids and the seg of the URL, plus the rail's own pick, applied to a row. */
export function inScope(r: WorkRow, s: Pick<LedgerState, "rule" | "seg">, picked: string | null): boolean {
  const ids = picked ? [picked] : ruleIds(s);
  if (ids.length && !r.checks.some((c) => ids.includes(c))) return false;
  if (s.seg === "proposed") return machineValue(r) !== null || isDraft(r);
  if (s.seg === "manual") return machineValue(r) === null && !isDraft(r);
  return true;
}

/** What a cached row becomes once a decision is made, before the server answers. Null removes the row from the open list. */
export function decided(r: WorkRow, action: "accept" | "edit" | "reject", value?: string): WorkRow | null {
  if (action === "reject") return null;
  const v = action === "edit" ? value ?? "" : machineValue(r) ?? "";
  return { ...r, status: "proposed", new_value: v };
}

/** The draft rows of one object and the body the projection takes for them. */
export function projectionBody(module: string, drafts: WorkRow[], fullRules: string[]): { body: SimulateBody; capped: boolean } {
  const full = new Set(fullRules);
  // A row whose every rule is a fully accepted rule is covered by the rule ids, so only the rest are sent by key.
  const keyed = drafts.filter((r) => !(fullRules.length && r.checks.length && r.checks.every((c) => full.has(c))));
  const send = keyed.length > PROJECTION_CAP ? keyed.slice(0, PROJECTION_CAP) : keyed;
  const body: SimulateBody = { module, records: send.map((r) => ({ module: r.module, record_key: r.record_key })) };
  if (fullRules.length && drafts.length > PROJECTION_CAP) body.rules = fullRules;
  return { body, capped: keyed.length > PROJECTION_CAP };
}

/** "12 draft decisions in 3 rules". */
export const decisionSentence = (n: number, rules: number): string =>
  t("{n, plural, one {# draft decision} other {# draft decisions}} in {m, plural, one {# rule} other {# rules}}", { n, m: rules });

/** The cap state of the projection: what holds the score down now and what the drafted fixes would lift. */
export function capSentence(before: { cap_level: number | null; breaches: string[] }, after: { cap_level: number | null } | null): string {
  const n = before.breaches.length;
  if (before.cap_level === null) return t("No cap");
  const now = t("Capped at {cap} by {n, plural, one {# critical rule} other {# critical rules}}", { cap: before.cap_level, n });
  if (!after) return now;
  if (after.cap_level === null) return `${now}. ${t("The drafted fixes lift the cap")}`;
  if (after.cap_level > before.cap_level) return `${now}. ${t("Cap lifts to {cap}", { cap: after.cap_level })}`;
  return now;
}

/** Records decided per rule, counting rows in a draft state. */
export function decidedByRule(rows: WorkRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) if (isDraft(r)) for (const c of r.checks) m.set(c, (m.get(c) ?? 0) + 1);
  return m;
}
