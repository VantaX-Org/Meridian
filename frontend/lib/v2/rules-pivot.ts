import { DIMENSIONS, type RuleRow } from "@/lib/api/v2/types";
import { t } from "@/lib/v2/i18n";

/**
 * Ranking and pivoting of an object's rules, computed here from the rules the Rules tab already holds.
 * GET /insights/rules is a ranking (no pivot parameter), so the five pivots are built on the client.
 */

export type Pivot = "rule" | "field" | "dimension" | "severity" | "feature";

export const PIVOTS: ReadonlyArray<{ key: Pivot; label: string }> = [
  { key: "rule", get label() { return t("By rule"); } },
  { key: "field", get label() { return t("By field"); } },
  { key: "dimension", get label() { return t("By dimension"); } },
  { key: "severity", get label() { return t("By severity"); } },
  { key: "feature", get label() { return t("By S/4 feature"); } },
];

/** Value at risk first (unpriced last), then failing records, then id: the order the tab ranks in. */
export function rankRules(rows: readonly RuleRow[]): RuleRow[] {
  return [...rows].sort((a, b) => (b.value_at_risk ?? -1) - (a.value_at_risk ?? -1) || b.affected_count - a.affected_count || a.check_id.localeCompare(b.check_id));
}

export interface FeatureLink {
  feature: string;
  status: "blocked" | "degraded";
}

export interface PivotGroup {
  key: string;
  label: string;
  /** A second line under the label: the SAP field of a field group, the state of a feature group. */
  sub?: string;
  mono?: boolean;
  rules: RuleRow[];
  failing: number;
  value: number | null;
}

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"];

function add(map: Map<string, PivotGroup>, key: string, label: string, rule: RuleRow, extra: Partial<PivotGroup> = {}): void {
  let g = map.get(key);
  if (!g) {
    g = { key, label, rules: [], failing: 0, value: null, ...extra };
    map.set(key, g);
  }
  g.rules.push(rule);
  g.failing += rule.affected_count;
  if (rule.value_at_risk != null) g.value = (g.value ?? 0) + rule.value_at_risk;
}

/** Groups already-ranked rules. `features` maps a check id to the S/4 features it blocks or degrades. */
export function pivotRules(ranked: readonly RuleRow[], pivot: Exclude<Pivot, "rule">, features: ReadonlyMap<string, FeatureLink[]>): PivotGroup[] {
  const map = new Map<string, PivotGroup>();
  for (const r of ranked) {
    if (pivot === "field") add(map, r.field ?? "none", r.field ?? t("No field recorded"), r, { mono: Boolean(r.field), sub: r.field_description ?? undefined });
    else if (pivot === "dimension") {
      const d = DIMENSIONS.find((x) => x.key === r.dimension);
      add(map, r.dimension ?? "none", d?.label ?? t("No dimension recorded"), r);
    } else if (pivot === "severity") add(map, r.severity, r.severity.charAt(0).toUpperCase() + r.severity.slice(1), r);
    else {
      const links = features.get(r.check_id) ?? [];
      if (links.length === 0) add(map, "none", t("No S/4 feature"), r);
      for (const l of links) add(map, l.feature, l.feature, r, { sub: l.status === "blocked" ? t("Blocked") : t("Degraded") });
    }
  }
  const out = [...map.values()];
  const rank = (g: PivotGroup) => (pivot === "severity" ? SEVERITY_ORDER.indexOf(g.key) : 0);
  const unset = (g: PivotGroup) => (g.key === "none" ? 1 : 0);
  return out.sort((a, b) => unset(a) - unset(b) || rank(a) - rank(b) || (b.value ?? -1) - (a.value ?? -1) || b.failing - a.failing || a.label.localeCompare(b.label));
}
