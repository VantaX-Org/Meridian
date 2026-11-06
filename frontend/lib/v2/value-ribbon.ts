import type { Timeline } from "@/lib/api/v2/runs";

export interface Ribbon {
  object: string;
  currency: string;
  /** Value at risk per run, oldest first; null where that run priced nothing. */
  series: (number | null)[];
  latest: number | null;
}

/** One ribbon per object that has at least one priced run. Amounts are never added across objects or currencies. */
export function valueRibbons(tl: Timeline): Ribbon[] {
  const names = new Set<string>();
  for (const r of tl.runs) for (const k of Object.keys(r.objects)) names.add(k);
  const out: Ribbon[] = [];
  for (const object of [...names].sort()) {
    const pts = tl.runs.map((r) => r.objects[object]?.value_at_risk ?? null);
    const priced = pts.filter((p) => p !== null);
    if (!priced.length) continue;
    const series = pts.map((p) => p?.amount ?? null);
    out.push({ object, currency: priced[priced.length - 1]!.currency, series, latest: series[series.length - 1] ?? null });
  }
  return out.sort((a, b) => (b.latest ?? 0) - (a.latest ?? 0));
}
