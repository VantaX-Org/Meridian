import { f1 } from "@/lib/v2/score";

/**
 * The measured score over the last runs, in the chart house style: one 2 pixel line in the data hue, four gridlines
 * on a 60 to 100 scale, the cap level dashed and named, the baseline run marked by a 1 pixel vertical rule, no
 * markers and no legend. Pure SVG; the geometry is computed here so it can be tested without a layout.
 */

export const Y_MIN = 60;
export const Y_MAX = 100;
export const GRID = [70, 80, 90, 100] as const;

export interface ChartPoint {
  id: string;
  /** Short date for the axis: "16 Oct". */
  label: string;
  /** The full reading for the hover title and the accessible name: "16 Oct 2026: measured 71.8". */
  title: string;
  measured: number;
  baseline: boolean;
}

export interface ChartGeometry {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  xs: number[];
  ys: number[];
  points: string;
  gridY: { value: number; y: number }[];
  axisY: number;
  capY: number | null;
  baselineX: number | null;
}

const W = 560;
/** The phone draws the chart at the width it is shown, so the text keeps its size instead of shrinking with the scale. */
const W_COMPACT = 340;
const H = 232;
const PLOT = { left: 40, right: W - 76, top: 16, bottom: H - 28 };

/** Y for a score, clamped to the 60 to 100 scale. */
export function yOf(value: number): number {
  const v = Math.max(Y_MIN, Math.min(Y_MAX, value));
  const y = PLOT.top + (PLOT.bottom - PLOT.top) * (1 - (v - Y_MIN) / (Y_MAX - Y_MIN));
  return Math.round(y * 100) / 100;
}

export function chartGeometry(points: readonly ChartPoint[], capLevel: number | null, compact = false): ChartGeometry {
  const n = points.length;
  const width = compact ? W_COMPACT : W;
  const plot = { ...PLOT, right: width - 76 };
  const span = plot.right - plot.left;
  const xs = points.map((_, i) => Math.round((n <= 1 ? plot.left + span / 2 : plot.left + (span * i) / (n - 1)) * 100) / 100);
  const ys = points.map((p) => yOf(p.measured));
  const bi = points.findIndex((p) => p.baseline);
  return {
    width,
    height: H,
    plot,
    xs,
    ys,
    points: xs.map((x, i) => `${x},${ys[i]}`).join(" "),
    gridY: GRID.map((value) => ({ value, y: yOf(value) })),
    axisY: yOf(Y_MIN),
    capY: capLevel != null && capLevel >= Y_MIN && capLevel <= Y_MAX ? yOf(capLevel) : null,
    baselineX: bi >= 0 ? xs[bi] : null,
  };
}

export function ScoreChart({ points, capLevel, label, compact = false }: { points: readonly ChartPoint[]; capLevel: number | null; label: string; compact?: boolean }) {
  const g = chartGeometry(points, capLevel, compact);
  // On a phone every other date is named, the last one always.
  const step = compact && points.length > 5 ? 2 : 1;
  const last = points[points.length - 1];
  const base = points.find((p) => p.baseline);
  const endX = g.plot.right + 8;
  return (
    <svg className="m2-chart" viewBox={`0 0 ${g.width} ${g.height}`} width={g.width} height={g.height} role="img" aria-label={label} data-testid="score-chart">
      {g.gridY.map((l) => (
        <g key={l.value}>
          <line className="m2-gl" x1={g.plot.left} x2={endX} y1={l.y} y2={l.y} />
          <text className="m2-ax" x={g.plot.left - 8} y={l.y + 4} textAnchor="end">{l.value}</text>
        </g>
      ))}
      <line className="m2-axis" x1={g.plot.left} x2={endX} y1={g.axisY} y2={g.axisY} />
      <text className="m2-ax" x={g.plot.left - 8} y={g.axisY + 4} textAnchor="end">{Y_MIN}</text>
      <text className="m2-ax" x={g.plot.left - 8} y={g.plot.top - 6} textAnchor="end">score</text>
      {points.map((p, i) => ((points.length - 1 - i) % step === 0 ? (
        <text key={p.id} className="m2-ax" x={g.xs[i]} y={g.height - 8} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>{p.label}</text>
      ) : null))}
      {g.baselineX != null ? (
        <>
          <line className="m2-vbar" x1={g.baselineX} x2={g.baselineX} y1={g.plot.top} y2={g.axisY} data-testid="baseline-rule" />
          <text className="m2-ax" x={g.baselineX + 4} y={g.plot.top + 10}>{`baseline ${base?.label ?? ""}`}</text>
        </>
      ) : null}
      {g.capY != null ? (
        <>
          <line className="m2-capl" x1={g.plot.left} x2={endX} y1={g.capY} y2={g.capY} data-level={capLevel ?? undefined} data-testid="cap-line" />
          <text className="m2-ax" x={endX + 4} y={g.capY + 4}>{`cap ${capLevel}`}</text>
        </>
      ) : null}
      {points.length > 1 ? <polyline className="m2-ln" points={g.points} data-testid="score-line" /> : null}
      {last ? <text className="m2-lab" x={endX + 4} y={g.ys[g.ys.length - 1] - 5}>{f1(last.measured)}</text> : null}
      {points.map((p, i) => (
        <rect key={`h${p.id}`} className="m2-hit" x={g.xs[i] - 14} y={g.plot.top} width={28} height={g.axisY - g.plot.top}>
          <title>{p.title}</title>
        </rect>
      ))}
    </svg>
  );
}
