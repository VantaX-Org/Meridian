import type { ImpactResult } from "@/lib/api/v2/object";
import type { RuleRow } from "@/lib/api/v2/types";
import { describeField } from "./sap-fields";
import { t } from "@/lib/v2/i18n";
import { whole } from "./format";

/**
 * The lineage of one object as a graph: source tables, the fields read from them, the rules that read the fields, and
 * the S/4HANA features those rules block or degrade. It is derived from two reads the page already makes: the object's
 * failing rules (each names the TABLE.FIELD it reads) and the config impact of the run (which rules sit behind which
 * feature). The graph holds the rules that matter most, ranked by value at risk, so a thousand rules stay readable.
 */

export type NodeKind = "table" | "field" | "rule" | "feature";

export interface LineageNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** The facts the side list shows when the node is hovered or focused: label, value. */
  facts: [string, string][];
  /** Where a click goes: the rule or feature inspector. Tables and fields only show their facts. */
  open: { kind: "rule" | "feature"; id: string } | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LineageEdge {
  from: string;
  to: string;
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
  width: number;
  height: number;
  /** Rules of the object not drawn (below the cut, or reading no field). */
  hidden: number;
  /** Rules drawn. */
  shown: number;
}

export const MAX_RULES = 12;
const COLS: Record<NodeKind, { x: number; w: number }> = {
  table: { x: 1, w: 110 },
  field: { x: 151, w: 140 },
  rule: { x: 331, w: 110 },
  feature: { x: 481, w: 240 },
};
const ROW = 34;
const NODE_H = 26;
export const COLUMN_TITLES: Record<NodeKind, string> = { get table() { return t("Source tables"); }, get field() { return t("Fields"); }, get rule() { return t("Rules"); }, get feature() { return t("S/4 features"); } };
const HEAD = 22;

const int = (n: number): string => whole(Math.round(n));
const tableOf = (field: string): string => field.split(/[.-]/)[0];

export function buildLineage(rules: readonly RuleRow[], impact: readonly ImpactResult[], module: string, cap = MAX_RULES): LineageGraph {
  const withField = rules.filter((r) => r.field && r.field.includes("."));
  const ranked = [...withField].sort((a, b) => (b.value_at_risk ?? 0) - (a.value_at_risk ?? 0) || b.affected_count - a.affected_count).slice(0, cap);
  const nodes = new Map<string, LineageNode>();
  const edges = new Map<string, LineageEdge>();
  const mk = (id: string, kind: NodeKind, label: string, facts: [string, string][], open: LineageNode["open"]): LineageNode => {
    const prior = nodes.get(id);
    if (prior) return prior;
    const n: LineageNode = { id, kind, label, facts, open, x: COLS[kind].x, y: 0, w: COLS[kind].w, h: NODE_H };
    nodes.set(id, n);
    return n;
  };
  const link = (from: string, to: string) => edges.set(`${from}>${to}`, { from, to });

  const featuresOf = new Map<string, ImpactResult[]>();
  for (const res of impact) {
    if (res.status === "ok") continue;
    for (const f of res.blocking_findings) {
      if (f.module && f.module !== module) continue;
      featuresOf.set(f.check_id, [...(featuresOf.get(f.check_id) ?? []), res]);
    }
  }

  const ruleIds = new Set(ranked.map((r) => r.check_id));
  for (const r of ranked) {
    const field = r.field as string;
    const table = tableOf(field);
    const readers = ranked.filter((x) => x.field === field);
    const tableRules = ranked.filter((x) => tableOf(x.field as string) === table);
    const tableFields = new Set(tableRules.map((x) => x.field));
    mk(`table:${table}`, "table", table, [[t("Table"), table], [t("Fields read"), int(tableFields.size)], [t("Rules reading it"), int(tableRules.length)], [t("Rule failures"), int(tableRules.reduce((s, x) => s + x.affected_count, 0))]], null);
    const desc = describeField(field) ?? r.field_description ?? null;
    mk(`field:${field}`, "field", field, [[t("Field"), field], [t("Meaning"), desc ?? "—"], [t("Table"), table], [t("Rules reading it"), readers.map((x) => x.check_id).join(", ")]], null);
    mk(`rule:${r.check_id}`, "rule", r.check_id, [[t("Rule"), r.check_id], [t("Name"), r.name], [t("Severity"), r.severity.charAt(0).toUpperCase() + r.severity.slice(1)], [t("Failing records"), int(r.affected_count)], [t("Reads"), field]], { kind: "rule", id: r.check_id });
    link(`table:${table}`, `field:${field}`);
    link(`field:${field}`, `rule:${r.check_id}`);
    for (const res of featuresOf.get(r.check_id) ?? []) {
      const mine = res.blocking_findings.filter((f) => ruleIds.has(f.check_id) && (!f.module || f.module === module)).map((f) => f.check_id);
      mk(
        `feature:${res.feature}`,
        "feature",
        res.feature,
        [
          [t("Feature"), res.feature],
          [t("Status"), res.status === "blocked" ? t("Blocked") : t("Degraded")],
          [t("Blocking rules"), [...new Set(mine)].join(", ")],
          [t("Records affected"), res.total_affected_records == null ? "—" : int(res.total_affected_records)],
          [t("Opportunity cost"), res.opportunity_cost_summary || t("No summary for this run")],
        ],
        { kind: "feature", id: res.feature },
      );
      link(`rule:${r.check_id}`, `feature:${res.feature}`);
    }
  }

  // Rows follow the order in which each column was first reached from the ranked rules, so edges stay short.
  let tall = 0;
  (["table", "field", "rule", "feature"] as NodeKind[]).forEach((kind) => {
    const col = [...nodes.values()].filter((n) => n.kind === kind);
    col.forEach((n, i) => {
      n.y = HEAD + i * ROW + 2;
    });
    tall = Math.max(tall, col.length);
  });
  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    width: COLS.feature.x + COLS.feature.w + 1,
    height: HEAD + Math.max(1, tall) * ROW + 4,
    hidden: rules.length - ranked.length,
    shown: ranked.length,
  };
}

/** Fields the object's rules read that no glossary term governs, as TABLE.FIELD, in rule order and each once. */
export function fieldsWithoutTerm(rules: readonly RuleRow[], termFields: ReadonlySet<string>): { field: string; rules: string[] }[] {
  const by = new Map<string, string[]>();
  for (const r of rules) {
    if (!r.field) continue;
    const key = r.field.replace("-", ".").toUpperCase();
    if (termFields.has(key)) continue;
    by.set(key, [...(by.get(key) ?? []), r.check_id]);
  }
  return [...by.entries()].map(([field, ids]) => ({ field, rules: ids }));
}
