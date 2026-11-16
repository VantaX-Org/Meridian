/** Chart arithmetic for the kit's small charts. Pure, so the geometry is tested without a layout. */

/** A linear scale from a domain to a range, clamped to the domain and rounded to two decimals. */
export function linear(domain: readonly [number, number], range: readonly [number, number]): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v: number) => {
    const c = Math.max(Math.min(d0, d1), Math.min(Math.max(d0, d1), v));
    return Math.round((r0 + ((c - d0) / span) * (r1 - r0)) * 100) / 100;
  };
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

export interface SparkGeometry {
  /** SVG polyline points, "x,y x,y". */
  points: string;
  last: { x: number; y: number } | null;
}

/** A line through the values over the width, on the domain; null values are left out. */
export function sparkGeometry(values: readonly (number | null)[], width: number, height: number, domain: readonly [number, number]): SparkGeometry {
  const n = values.length;
  const pad = 2;
  const x = (i: number) => Math.round((n <= 1 ? width / 2 : pad + ((width - 2 * pad) * i) / (n - 1)) * 100) / 100;
  const y = linear(domain, [height - pad, pad]);
  const pts = values.map((v, i) => (v == null ? null : { x: x(i), y: y(v) })).filter((p): p is { x: number; y: number } => p !== null);
  return { points: pts.map((p) => `${p.x},${p.y}`).join(" "), last: pts[pts.length - 1] ?? null };
}
