import { linear } from "./scale";

/**
 * The trend in a row: the last runs' values as a 1.5 pixel line in the quiet ink and the latest as a dot in the data
 * hue, on the same 0 to 100 scale as the ruler beside it when it is a score, so two rows compare at a glance. No axis,
 * no label of its own: the accessible name says the first and the last value, and the row's own text carries the rest.
 */
export interface SparkGeometry {
  points: string;
  last: { x: number; y: number } | null;
}

export function sparkGeometry(values: readonly (number | null)[], width: number, height: number, domain: readonly [number, number]): SparkGeometry {
  const n = values.length;
  const pad = 2;
  const x = (i: number) => Math.round((n <= 1 ? width / 2 : pad + ((width - 2 * pad) * i) / (n - 1)) * 100) / 100;
  const y = linear(domain, [height - pad, pad]);
  const pts = values.map((v, i) => (v == null ? null : { x: x(i), y: y(v) })).filter((p): p is { x: number; y: number } => p !== null);
  return { points: pts.map((p) => `${p.x},${p.y}`).join(" "), last: pts[pts.length - 1] ?? null };
}

export function Sparkline({ values, label, width = 48, height = 12, domain = [0, 100], testId }: { values: readonly (number | null)[]; label: string; width?: number; height?: number; domain?: readonly [number, number]; testId?: string }) {
  const g = sparkGeometry(values, width, height, domain);
  if (!g.last) return null;
  return (
    <svg className="m2-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} data-testid={testId}>
      <title>{label}</title>
      {g.points.includes(" ") ? <polyline className="m2-spark-l" points={g.points} /> : null}
      <circle className="m2-spark-d" cx={g.last.x} cy={g.last.y} r={2} />
    </svg>
  );
}
