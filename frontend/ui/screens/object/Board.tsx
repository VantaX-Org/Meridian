"use client";

/** The board's own parts for the object overview: tone-coloured dimension bars and the shown-vs-measured run lines. */
import { score as fmt, signed } from "./format";

const toneOf = (n: number): "go" | "watch" | "stop" => (n >= 85 ? "go" : n >= 70 ? "watch" : "stop");

export interface ToneBar { key: string; label: string; value: number | null; delta: number | null }

/** One bar per dimension, coloured by the gate it sits against, with a line at the 85 go level. */
export function ToneBars({ items, naLabel, lineLabel }: { items: ToneBar[]; naLabel: string; lineLabel: string }) {
  return (
    <ul className="mx-tonebars" aria-label={lineLabel}>
      {items.map((b) => (
        <li key={b.key} data-testid="tonebar">
          <span className="mx-tb-l">{b.label}</span>
          <span className="mx-tb-track" role="img" aria-label={`${b.label} ${b.value === null ? naLabel : fmt(b.value)}`}>
            {b.value !== null ? <span className="mx-tb-fill" data-tone={toneOf(b.value)} style={{ inlineSize: `${Math.max(0, Math.min(100, b.value))}%` }} /> : null}
            <span className="mx-tb-line" aria-hidden="true" />
          </span>
          <span className="mx-tb-v">{b.value === null ? naLabel : fmt(b.value)}</span>
          <span className="mx-tb-d" data-sign={b.delta === null ? undefined : b.delta > 0 ? "up" : b.delta < 0 ? "down" : "flat"}>{b.delta === null ? "" : signed(b.delta)}</span>
        </li>
      ))}
    </ul>
  );
}

export interface RunPoint { n: number | string; axis: string; shown: number | null; measured: number | null }

/** Shown and measured score per run, gate lines at 70 and 85. Measured is drawn only when some run stored it. */
export function RunLines({ points, labels, ariaLabel }: { points: RunPoint[]; labels: { shown: string; measured: string; go: string; gate: string }; ariaLabel: string }) {
  const W = 320, H = 170, L = 30, R = 8, T = 10, B = 28;
  const vals = points.flatMap((p) => [p.shown, p.measured]).filter((v): v is number => v !== null);
  if (points.length < 2 || vals.length === 0) return null;
  const lo = Math.max(0, Math.floor(Math.min(...vals, 70) / 10) * 10 - 10);
  const x = (i: number) => L + (points.length === 1 ? 0 : (i * (W - L - R)) / (points.length - 1));
  const y = (v: number) => T + ((100 - Math.min(100, Math.max(lo, v))) * (H - T - B)) / (100 - lo);
  const line = (k: "shown" | "measured") => points.map((p, i) => (p[k] === null ? null : `${x(i)},${y(p[k] as number)}`)).filter(Boolean).join(" ");
  const hasMeasured = points.some((p) => p.measured !== null && p.shown !== null && p.measured !== p.shown);
  return (
    <svg className="mx-runlines" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
      {[85, 70].map((g) => (
        <g key={g}>
          <line className="mx-rl-gate" x1={L} x2={W - R} y1={y(g)} y2={y(g)} />
          <text className="mx-ruler-ax" x={L - 4} y={y(g) + 4} textAnchor="end" fontSize={10}>{g}</text>
        </g>
      ))}
      {hasMeasured ? <polyline className="mx-rl-measured" points={line("measured")} fill="none" /> : null}
      <polyline className="mx-rl-shown" points={line("shown")} fill="none" />
      {points.map((p, i) => (p.shown === null ? null : <circle key={i} className="mx-rl-dot" cx={x(i)} cy={y(p.shown)} r={3} />))}
      {points.map((p, i) => (i === 0 || i === points.length - 1 || points.length <= 8 ? <text key={`a${i}`} className="mx-ruler-ax" x={x(i)} y={H - 12} textAnchor="middle" fontSize={10}>{p.n}</text> : null))}
      <text className="mx-ruler-ax" x={L} y={H - 1} fontSize={10}>{points[0].axis}</text>
      <text className="mx-ruler-ax" x={W - R} y={H - 1} textAnchor="end" fontSize={10}>{points[points.length - 1].axis}</text>
      <title>{hasMeasured ? `${labels.shown}, ${labels.measured}` : labels.shown}</title>
    </svg>
  );
}
