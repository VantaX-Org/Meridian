"use client";

import { t } from "@/lib/v2/i18n";
import "./viz.css";

/** Shared chart parts for the Story feed cards. Inline SVG, token colours, a native tooltip (<title>) on every mark and an aria label that says the same in words. */

export interface RingProps {
  /** 0 to 100, or null when there is no score yet (an empty ring is drawn). */
  value: number | null;
  size?: number;
  label: string;
  /** Text in the middle; defaults to the one-decimal value. */
  center?: string;
}

export function ScoreRing({ value, size = 120, label, center }: RingProps) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <svg className="nx-viz-ring" width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={label}>
      <title>{label}</title>
      <circle className="nx-viz-ring-track" cx="60" cy="60" r={r} fill="none" strokeWidth="10" />
      {value == null ? null : (
        <circle className="nx-viz-ring-arc" cx="60" cy="60" r={r} fill="none" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${((pct / 100) * c).toFixed(2)} ${c.toFixed(2)}`} transform="rotate(-90 60 60)" />
      )}
      <text className="nx-viz-ring-text" x="60" y="66" textAnchor="middle">{center ?? (value == null ? t("No score") : value.toFixed(1))}</text>
    </svg>
  );
}

export interface TrendPoint { label: string; value: number }

/** A 2px line over a soft area. Fewer than two points draws a dashed empty shape with the caption beside it. */
export function AreaTrend({ points, label, height = 72, empty, emphasisLast = false }: { points: TrendPoint[]; label: string; height?: number; empty: string; emphasisLast?: boolean }) {
  const w = 240;
  if (points.length < 2) {
    return (
      <div className="nx-viz-empty" role="img" aria-label={empty}>
        <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden="true"><line className="nx-viz-dash" x1="4" x2={w - 4} y1={height / 2} y2={height / 2} strokeWidth="2" strokeDasharray="4 6" /></svg>
        <small>{empty}</small>
      </div>
    );
  }
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals);
  const span = Math.max(...vals) - lo || 1;
  const pad = 6;
  const xy = points.map((p, i) => [pad + (i / (points.length - 1)) * (w - 2 * pad), height - pad - ((p.value - lo) / span) * (height - 2 * pad)] as const);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${pad},${height - pad} ${line} ${w - pad},${height - pad}`;
  return (
    <svg className="nx-viz-trend" width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <title>{label}</title>
      <polygon className="nx-viz-area" points={area} />
      <polyline className="nx-viz-line" points={line} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {xy.map(([x, y], i) => (
        <circle key={points[i].label} className={emphasisLast && i === points.length - 1 ? "nx-viz-dot nx-viz-dot-last" : "nx-viz-dot"} cx={x} cy={y} r={emphasisLast && i === points.length - 1 ? 4 : 3}><title>{`${points[i].label}: ${points[i].value.toFixed(1)}`}</title></circle>
      ))}
    </svg>
  );
}

export interface Seg { id: string; label: string; value: number; tone: "good" | "warn" | "bad" | "chart1" | "chart2" | "chart3" | "mute" }

/** One bar split into segments with 4px rounded ends. Zero total draws an empty track. */
export function StackedBar({ segs, label }: { segs: Seg[]; label: string }) {
  const total = segs.reduce((a, s) => a + Math.max(0, s.value), 0);
  const w = 240;
  let x = 0;
  return (
    <svg className="nx-viz-stack" width="100%" height="20" viewBox={`0 0 ${w} 20`} preserveAspectRatio="none" role="img" aria-label={label}>
      <title>{label}</title>
      <rect className="nx-viz-track" x="0" y="0" width={w} height="20" rx="4" />
      {total === 0 ? null : segs.filter((s) => s.value > 0).map((s) => {
        const sw = (s.value / total) * w;
        const x0 = x;
        x += sw;
        return <rect key={s.id} className={`nx-viz-seg nx-viz-${s.tone}`} x={x0} y="0" width={Math.max(sw - 1, 1)} height="20" rx="4"><title>{`${s.label}: ${s.value}`}</title></rect>;
      })}
    </svg>
  );
}

export interface HeatCell { key: string; title: string; value: number | null }

/** Rows by columns; each cell is shaded by value (0 to 100) on one ramp, an empty cell is outlined. */
export function HeatGrid({ rows, cols, cells, label }: { rows: string[]; cols: string[]; cells: Record<string, HeatCell>; label: string }) {
  const cw = 18;
  const ch = 14;
  return (
    <svg className="nx-viz-heat" width="100%" height={rows.length * (ch + 2)} viewBox={`0 0 ${cols.length * (cw + 2)} ${rows.length * (ch + 2)}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <title>{label}</title>
      {rows.flatMap((r, ri) => cols.map((c, ci) => {
        const cell = cells[`${r}|${c}`];
        const v = cell?.value;
        const step = v == null ? 0 : Math.min(4, Math.max(1, Math.ceil(v / 25)));
        return <rect key={`${r}|${c}`} className={`nx-viz-cell nx-viz-h${step}`} x={ci * (cw + 2)} y={ri * (ch + 2)} width={cw} height={ch} rx="3"><title>{cell?.title ?? `${r}, ${c}`}</title></rect>;
      }))}
    </svg>
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1));
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));
export { fmt as vizNum, signed as vizSigned };

/** Ranked horizontal bars by magnitude: one emphasised row, the rest quiet. Signed text, bar width is |value|. */
export function RankedBars({ items, label, emphasis = "top" }: { items: { label: string; value: number }[]; label: string; emphasis?: "top" | "first" | "none" }) {
  const max = Math.max(...items.map((d) => Math.abs(d.value)), 0);
  const hot = emphasis === "none" || max === 0 ? -1 : emphasis === "first" ? 0 : items.findIndex((d) => Math.abs(d.value) === max);
  return (
    <ul className="nx-viz-ranked" aria-label={label}>
      {items.map((d, i) => (
        <li key={d.label} data-hot={i === hot ? "1" : undefined} title={`${d.label}: ${fmt(d.value)}`}>
          <span className="nx-viz-ranked-l"><span className="nx-viz-ranked-n" aria-hidden="true">{i + 1}</span>{d.label}</span>
          <span className="nx-viz-ranked-bar" aria-hidden="true"><span style={{ width: `${max ? (Math.abs(d.value) / max) * 100 : 0}%` }} /></span>
          <span className="nx-viz-ranked-v">{fmt(d.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** One or two big figures; with two, the first is the accent and a delta line follows. */
export function Stat({ figures, label, delta }: { figures: { label: string; value: number }[]; label: string; delta?: number }) {
  return (
    <div className="nx-viz-stat" role="img" aria-label={label} title={label}>
      <div className="nx-viz-stat-row">
        {figures.map((f, i) => (
          <div key={f.label} data-accent={i === 0 && figures.length > 1 ? "1" : undefined}>
            <b>{fmt(f.value)}</b>
            <span>{f.label}</span>
          </div>
        ))}
      </div>
      {delta != null && figures.length === 2 ? <small>{`${figures[0].label} \u2212 ${figures[1].label}: ${signed(delta)}`}</small> : null}
    </div>
  );
}

/** Legend under a StackedBar: swatch, label, value and share of the total. */
export function VizLegend({ items }: { items: { label: string; value: number; tone: Seg["tone"]; note: string }[] }) {
  return (
    <ul className="nx-viz-legend">
      {items.map((s) => (
        <li key={s.label}>
          <svg width="8" height="8" aria-hidden="true"><rect width="8" height="8" rx="2" className={`nx-viz-${s.tone}`} /></svg>
          {s.label} <b>{fmt(s.value)}</b> <span>{s.note}</span>
        </li>
      ))}
    </ul>
  );
}
