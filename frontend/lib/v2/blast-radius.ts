import type { BlastRadius, LineageGraph, LineageGraphNode } from "@/lib/api/v2/lineage";
import type { MoneyFeature } from "@/lib/api/v2/step9";

/**
 * The blast radius of one rule as four columns: the fields it reads, the process steps those fields feed, the S/4HANA
 * features the steps enable, and the KPIs the features drive. Tables, objects, configuration and processes sit between
 * them in the lineage model; they are folded into the edges, so a field joins every step it reaches through them.
 * Documents per step come from the blast radius read (failing record keys joined to the transactional tables); money
 * per feature from the config impact cost model. A value the backend has not measured stays null.
 */

export type BlastColumn = "field" | "step" | "feature" | "kpi";
export const BLAST_COLUMNS: BlastColumn[] = ["field", "step", "feature", "kpi"];

export interface BlastNode {
  id: string;
  col: BlastColumn;
  label: string;
  /** The second line: field description, transaction and L1 process, owning system, or the feature status. */
  sub: string | null;
  /** Documents in flight the failing records touch at this step; null when not measured. */
  documents: number | null;
  /** Opportunity cost per month of a blocked or degraded feature; null without a cost model. */
  perMonth: number | null;
  status: "blocked" | "degraded" | null;
}

export interface BlastModel {
  nodes: BlastNode[];
  edges: [string, string][];
  documents: number | null;
  perMonth: number | null;
  blocked: number;
}

const colOf = (n: LineageGraphNode): BlastColumn | null =>
  n.type === "field" || n.type === "step" || n.type === "feature" || n.type === "kpi" ? n.type : null;

export function blastModel(graph: LineageGraph, blast: BlastRadius | null, money: MoneyFeature[]): BlastModel {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map<string, string[]>();
  for (const e of graph.edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target]);

  const docs = new Map<string, number>();
  for (const t of blast?.targets ?? []) if (t.step && t.status === "ok") docs.set(t.step, (docs.get(t.step) ?? 0) + t.documents);

  const nodes: BlastNode[] = [];
  for (const n of graph.nodes) {
    const col = colOf(n);
    if (!col) continue;
    const sub = col === "field" ? (n.description ?? null) : col === "step" ? [n.tcode, n.l1].filter(Boolean).join("  ") || null : col === "feature" ? (n.system ?? null) : null;
    nodes.push({ id: n.id, col, label: n.label, sub, documents: col === "step" && blast ? (docs.get(n.id) ?? 0) : null, perMonth: null, status: null });
  }

  // Visible edges: from each shown node, walk forward through hidden nodes until the next shown node in a later column.
  const rank = (id: string) => {
    const n = byId.get(id);
    const c = n ? colOf(n) : null;
    return c ? BLAST_COLUMNS.indexOf(c) : -1;
  };
  const edges = new Set<string>();
  for (const n of nodes) {
    const r = rank(n.id);
    const seen = new Set([n.id]);
    const stack = [...(out.get(n.id) ?? [])];
    while (stack.length) {
      const m = stack.pop() as string;
      if (seen.has(m)) continue;
      seen.add(m);
      const rm = rank(m);
      if (rm > r) edges.add(`${n.id}\n${m}`);
      else if (rm < 0 && byId.get(m)?.type !== "check") stack.push(...(out.get(m) ?? []));
    }
  }

  // Config impact features the rule blocks: joined to the rule's fields, carrying the money.
  const fields = nodes.filter((n) => n.col === "field");
  for (const f of money) {
    const id = `money:${f.feature}`;
    nodes.push({ id, col: "feature", label: f.feature, sub: f.system, documents: null, perMonth: f.opportunity_cost_per_month, status: f.status });
    for (const fd of fields) edges.add(`${fd.id}\n${id}`);
  }

  const order = (a: BlastNode, b: BlastNode) => (b.documents ?? -1) - (a.documents ?? -1) || (b.perMonth ?? -1) - (a.perMonth ?? -1) || (a.status ? 0 : 1) - (b.status ? 0 : 1) || a.label.localeCompare(b.label);
  nodes.sort(order);
  const costs = money.map((f) => f.opportunity_cost_per_month).filter((v): v is number => v != null);
  return {
    nodes,
    edges: [...edges].map((e) => e.split("\n") as [string, string]),
    documents: blast ? [...docs.values()].reduce((s, v) => s + v, 0) : null,
    perMonth: costs.length ? costs.reduce((s, v) => s + v, 0) : null,
    blocked: money.filter((f) => f.status === "blocked").length,
  };
}

/** Every node on a path through `id`: its ancestors and descendants along the shown edges. */
export function pathThrough(model: BlastModel, id: string): Set<string> {
  const lit = new Set([id]);
  for (const dir of [0, 1] as const) {
    const stack = [id];
    while (stack.length) {
      const n = stack.pop() as string;
      for (const e of model.edges) {
        if (e[dir] !== n || lit.has(e[1 - dir])) continue;
        lit.add(e[1 - dir]);
        stack.push(e[1 - dir]);
      }
    }
  }
  return lit;
}
