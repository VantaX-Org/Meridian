import type { AskAnswer } from "./AskBodyNative";

export type Pt = { label: string; value: number };
export type Viz =
  | { kind: "none" }
  | { kind: "trend"; points: Pt[] }
  | { kind: "stack"; segs: Pt[]; total: Pt }
  | { kind: "ranked"; items: Pt[]; keepOrder: boolean; more: number }
  | { kind: "stat"; figures: Pt[]; delta?: number };

const MAX_ROWS = 8;
const DATED = /^\d{4}-\d{2}-\d{2}/;

/** Choose the one lead visual from the real /assistant/ask result. Pure, first match wins. */
export function pickViz(a: Pick<AskAnswer, "grounded" | "answer" | "intent" | "chart" | "data">): Viz {
  const d = (a.data ?? []).filter((p) => Number.isFinite(p.value));
  if (!a.grounded || !a.answer || !d.length) return { kind: "none" };
  if ((a.chart === "line" && d.length >= 2) || (a.chart === "bar" && d.length >= 2 && d.every((p) => DATED.test(p.label)))) return { kind: "trend", points: d };
  let keepOrder = false;
  if (a.intent === "fixes" && d.length >= 2) {
    if (d.every((p, i) => p.value >= 0 && (i === d.length - 1 || p.value >= d[i + 1].value))) {
      return { kind: "stack", segs: d.map((p, i) => ({ label: p.label, value: i < d.length - 1 ? p.value - d[i + 1].value : p.value })), total: d[0] };
    }
    keepOrder = true;
  }
  if (d.length === 1 || (d.length === 2 && a.chart !== "line")) return { kind: "stat", figures: d, delta: d.length === 2 ? d[0].value - d[1].value : undefined };
  const items = keepOrder ? d : [...d].sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
  return { kind: "ranked", items: items.slice(0, MAX_ROWS), keepOrder, more: Math.max(0, items.length - MAX_ROWS) };
}
