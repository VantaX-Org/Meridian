import type { SurvivorshipRuleInput, SurvivorshipRuleType } from "@/lib/api/survivorship";
import { t as tr } from "@/lib/v2/i18n";

export const RULE_TYPES: { value: SurvivorshipRuleType; label: string; needsSources: boolean; help: string }[] = [
  { value: "most_recent", get label() { return tr("Most recent"); }, needsSources: false, get help() { return tr("The value from the record changed last survives."); } },
  { value: "most_complete", get label() { return tr("Most complete"); }, needsSources: false, get help() { return tr("The longest non-empty value survives."); } },
  { value: "most_frequent", get label() { return tr("Most frequent"); }, needsSources: false, get help() { return tr("The value most of the records agree on survives."); } },
  { value: "trusted_source", get label() { return tr("Trusted source"); }, needsSources: true, get help() { return tr("The value from the first trusted system that has one survives."); } },
  { value: "chain", get label() { return tr("Chain of systems"); }, needsSources: true, get help() { return tr("Systems are tried in the order listed; the first with a value survives."); } },
  { value: "manual_override", get label() { return tr("Manual override"); }, needsSources: false, get help() { return tr("A steward chooses the value on each merge."); } },
];

export const typeLabel = (t: string): string => RULE_TYPES.find((x) => x.value === t)?.label ?? t;
export const needsSources = (t: string): boolean => RULE_TYPES.find((x) => x.value === t)?.needsSources ?? false;

/** One rule as the editor holds it: the API's fields, with the weight as typed. */
export interface DraftRule {
  key: string;
  field: string;
  rule_type: SurvivorshipRuleType;
  trusted_sources: string[];
  weight: string;
  active: boolean;
  ai_inferred?: boolean;
}

export function validateRules(rules: readonly DraftRule[]): Record<string, { field?: string; sources?: string; weight?: string }> {
  const out: Record<string, { field?: string; sources?: string; weight?: string }> = {};
  const seen = new Map<string, number>();
  for (const r of rules) seen.set(r.field.trim(), (seen.get(r.field.trim()) ?? 0) + 1);
  for (const r of rules) {
    const e: { field?: string; sources?: string; weight?: string } = {};
    if (!r.field.trim()) e.field = "Enter the field";
    else if ((seen.get(r.field.trim()) ?? 0) > 1) e.field = "Another rule already covers this field";
    if (needsSources(r.rule_type) && r.trusted_sources.length === 0) e.sources = "Choose at least one system";
    if (!/^\d+$/.test(r.weight.trim()) || Number(r.weight) > 100) e.weight = "Enter a whole number from 0 to 100";
    if (e.field || e.sources || e.weight) out[r.key] = e;
  }
  return out;
}

export function toInput(rules: readonly DraftRule[]): SurvivorshipRuleInput[] {
  return rules.map((r) => ({
    field: r.field.trim(),
    rule_type: r.rule_type,
    trusted_sources: needsSources(r.rule_type) ? r.trusted_sources : null,
    weight: Number(r.weight),
    active: r.active,
  }));
}

/** Moves item `i` by `dir` (-1 up, 1 down); returns the same list when it cannot move. */
export function moveBy<T>(list: readonly T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= list.length) return [...list];
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
