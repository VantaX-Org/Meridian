import type { AskEvidence } from "@/lib/api/v2/assistant";

export type Pt = { label: string; value: number };
export type Viz =
  | { kind: "none" }
  | { kind: "line"; points: Pt[] }
  | { kind: "bars"; items: Pt[]; more: number }
  | { kind: "share"; segs: Pt[]; total: number }
  | { kind: "stat"; figures: Pt[]; delta?: number };

const MAX_ROWS = 8;
const DATED = /^\d{4}-\d{2}-\d{2}/;

/** Choose the one lead visual for an answer from the real /assistant/ask figures. Pure, first match wins. */
export function pickViz(a: Pick<AskEvidence, "grounded" | "intent" | "chart" | "data">): Viz {
  const d = (a.data ?? []).filter((p) => Number.isFinite(p.value)).map(({ label, value }) => ({ label, value }));
  if (!a.grounded || !d.length) return { kind: "none" };
  if (d.length >= 2 && (a.chart === "line" || (a.chart === "bar" && d.every((p) => DATED.test(p.label))))) return { kind: "line", points: d };
  let keepOrder = false;
  if (a.intent === "fixes" && d.length >= 2) {
    // a cumulative series (each step no larger than the last) reads as the share each step adds
    if (d.every((p, i) => p.value >= 0 && (i === d.length - 1 || p.value >= d[i + 1].value))) {
      return { kind: "share", segs: d.map((p, i) => ({ label: p.label, value: i < d.length - 1 ? p.value - d[i + 1].value : p.value })), total: d[0].value };
    }
    keepOrder = true;
  }
  const sum = d.reduce((n, p) => n + p.value, 0);
  if (a.intent === "share" && d.length >= 2 && d.length <= MAX_ROWS && sum > 0 && d.every((p) => p.value >= 0)) return { kind: "share", segs: d, total: sum };
  if (d.length === 1 || (d.length === 2 && a.chart !== "line")) return { kind: "stat", figures: d, delta: d.length === 2 ? d[0].value - d[1].value : undefined };
  const items = keepOrder ? d : [...d].sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
  return { kind: "bars", items: items.slice(0, MAX_ROWS), more: Math.max(0, items.length - MAX_ROWS) };
}

/** The facts grouped by the source they were read from, with the rule codes behind each group. */
export function sourcesOf(facts: { source?: string; checks: { check_id: string }[] }[]): { source: string; checks: string[]; n: number }[] {
  const groups = new Map<string, { checks: Set<string>; n: number }>();
  for (const f of facts) {
    if (!f.source) continue;
    const g = groups.get(f.source) ?? { checks: new Set<string>(), n: 0 };
    g.n += 1;
    f.checks.forEach((c) => g.checks.add(c.check_id));
    groups.set(f.source, g);
  }
  return [...groups].map(([source, g]) => ({ source, checks: [...g.checks], n: g.n }));
}
