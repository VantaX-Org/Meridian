/**
 * The arithmetic of every chart in design/v2/charts: scales, ticks and bins. Pure functions, so the geometry of each
 * chart is tested without a layout.
 */

/** A linear scale from a domain to a range, clamped to the domain. */
export function linear(domain: readonly [number, number], range: readonly [number, number]): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v: number) => {
    const c = Math.max(Math.min(d0, d1), Math.min(Math.max(d0, d1), v));
    return Math.round((r0 + ((c - d0) / span) * (r1 - r0)) * 100) / 100;
  };
}

/** Round tick values over a domain: steps of 1, 2, 2.5 or 5 times a power of ten, about `count` of them. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / Math.max(1, count);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step / 1e6; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/**
 * A score domain that shows the movement: the scores' own range widened to whole tens, never below 0 or above 100,
 * and at least `span` wide so a flat line is not drawn as a cliff. Reference lines (a cap) are kept in view.
 */
export function scoreDomain(values: readonly number[], keep: readonly number[] = [], span = 30): [number, number] {
  const all = [...values, ...keep].filter((v) => Number.isFinite(v));
  if (all.length === 0) return [0, 100];
  let lo = Math.floor(Math.min(...all) / 10) * 10;
  let hi = Math.ceil(Math.max(...all) / 10) * 10;
  if (hi === lo) hi = lo + 10;
  while (hi - lo < span) {
    if (lo > 0) lo -= 10;
    if (hi - lo < span && hi < 100) hi += 10;
    if (lo <= 0 && hi >= 100) break;
  }
  return [Math.max(0, lo), Math.min(100, hi)];
}

export interface Bin {
  from: number;
  to: number;
  /** The items that fall in [from, to), the last bin closed at the top. */
  ids: string[];
}

/** Equal bins over a domain; each value falls in the bin whose lower edge it reaches. */
export function bins(values: readonly { id: string; value: number }[], domain: readonly [number, number], width: number): Bin[] {
  const [lo, hi] = domain;
  const out: Bin[] = [];
  for (let from = lo; from < hi - 1e-9; from += width) out.push({ from, to: Math.min(hi, from + width), ids: [] });
  for (const v of values) {
    if (!Number.isFinite(v.value)) continue;
    const i = Math.min(out.length - 1, Math.max(0, Math.floor((v.value - lo) / width)));
    out[i]?.ids.push(v.id);
  }
  return out;
}

/** The index of the point nearest to `x` among sorted x positions. */
export function nearest(xs: readonly number[], x: number): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
  return best;
}

/** Shares of a whole for a stacked bar: each segment's start and width in pixels with a gap between segments. */
export function stack(values: readonly number[], width: number, gap = 2): { x: number; w: number }[] {
  const total = values.reduce((a, b) => a + Math.max(0, b), 0);
  const shown = values.filter((v) => v > 0).length;
  const room = Math.max(0, width - gap * Math.max(0, shown - 1));
  let x = 0;
  return values.map((v) => {
    if (!(v > 0) || total === 0) return { x, w: 0 };
    // Every non-zero part keeps at least 2 pixels, so a small count is still seen (its number is in the legend).
    const w = Math.max(2, Math.round((room * v) / total * 100) / 100);
    const seg = { x: Math.round(x * 100) / 100, w };
    x += w + gap;
    return seg;
  });
}
