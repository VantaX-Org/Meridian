import type { AskAnswer } from "./AskBodyNative";

export type Pt = { label: string; value: number };
export type Viz =
  | { kind: "none" }
  | { kind: "pace"; pct: number; coverage: number }
  | { kind: "line"; points: Pt[]; nowIndex: number }
  | { kind: "bars"; items: Pt[]; keepOrder: boolean; more: number }
  | { kind: "share"; segs: Pt[]; total: number }
  | { kind: "stat"; figures: Pt[]; delta?: number }
  | { kind: "compare"; naive: Pt; truth: Pt }
  | { kind: "source"; rows: { source: string; checks: string[]; n: number }[] }
  | { kind: "findings"; items: string[] }
  | { kind: "ledger"; value: number; unit: string }
  | { kind: "map"; never: true }; // gap M1: no geo endpoint; declared for parity, never produced

const MAX_ROWS = 8;
const MAX_FINDINGS = 4;
const DATED = /^\d{4}-\d{2}-\d{2}/;

/** Choose the one lead visual from the real /assistant/ask result. Pure, first match wins. */
export function pickViz(a: Pick<AskAnswer, "grounded" | "answer" | "intent" | "chart" | "data">): Viz {
  const d = (a.data ?? []).filter((p) => Number.isFinite(p.value));
  if (!a.grounded || !a.answer || !d.length) return { kind: "none" };
  if ((a.chart === "line" && d.length >= 2) || (a.chart === "bar" && d.length >= 2 && d.every((p) => DATED.test(p.label)))) return { kind: "line", points: d, nowIndex: d.length - 1 };
  let keepOrder = false;
  if (a.intent === "fixes" && d.length >= 2) {
    if (d.every((p, i) => p.value >= 0 && (i === d.length - 1 || p.value >= d[i + 1].value))) {
      return { kind: "share", segs: d.map((p, i) => ({ label: p.label, value: i < d.length - 1 ? p.value - d[i + 1].value : p.value })), total: d[0].value };
    }
    keepOrder = true;
  }
  const sum = d.reduce((n, p) => n + p.value, 0);
  if (a.intent === "share" && d.length >= 2 && d.length <= MAX_ROWS && sum > 0 && d.every((p) => p.value >= 0)) return { kind: "share", segs: d, total: sum };
  if (d.length === 1 || (d.length === 2 && a.chart !== "line")) return { kind: "stat", figures: d, delta: d.length === 2 ? d[0].value - d[1].value : undefined };
  const items = keepOrder ? d : [...d].sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
  return { kind: "bars", items: items.slice(0, MAX_ROWS), keepOrder, more: Math.max(0, items.length - MAX_ROWS) };
}

/**
 * The living rail: up to four widgets, each only when its backing field is present and finite.
 * Slot 1 lead (compare, pace, else the pickViz lead), 2 source, 3 findings, 4 ledger. Map is never returned (gap M1).
 */
export function pickRail(a: AskAnswer, suggestions: string[]): Viz[] {
  if (!a.grounded || !a.answer?.trim()) return [];
  const d = (a.data ?? []).filter((p) => Number.isFinite(p.value));
  const naive = d.filter((p) => p.role === "naive");
  const truth = d.filter((p) => p.role === "true");
  let lead: Viz = { kind: "none" };
  if (naive.length === 1 && truth.length === 1) lead = { kind: "compare", naive: naive[0], truth: truth[0] };
  else if (typeof a.pace_pct === "number" && Number.isFinite(a.pace_pct)) lead = { kind: "pace", pct: a.pace_pct, coverage: a.coverage };
  else lead = pickViz(a);

  const groups = new Map<string, { checks: Set<string>; n: number }>();
  for (const f of a.facts ?? []) {
    if (!f.source) continue;
    const g = groups.get(f.source) ?? { checks: new Set<string>(), n: 0 };
    g.n += 1;
    f.checks.forEach((c) => g.checks.add(c.check_id));
    groups.set(f.source, g);
  }
  const source: Viz = groups.size ? { kind: "source", rows: [...groups].map(([s, g]) => ({ source: s, checks: [...g.checks], n: g.n })) } : { kind: "none" };
  const items = suggestions.filter((s) => s.trim()).slice(0, MAX_FINDINGS);
  const findings: Viz = items.length ? { kind: "findings", items } : { kind: "none" };
  const ledger: Viz = typeof a.value_found === "number" && Number.isFinite(a.value_found) ? { kind: "ledger", value: a.value_found, unit: "" } : { kind: "none" };
  return [lead, source, findings, ledger].filter((v) => v.kind !== "none").slice(0, 4);
}
