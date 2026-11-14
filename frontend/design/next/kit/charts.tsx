"use client";

/**
 * Chart parts for cards, inline SVG and CSS only. Colours come from the accent and ink ramps, never the status
 * colours. Every mark has a tooltip and the whole chart has a text label. With no data each part draws its own empty
 * shape and one line of copy, never a made-up number.
 */
import type { ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import "./charts.css";

/** A progress ring: `value` of `max`, the child (usually the big number) sits in the middle. */
export function Ring({ value, max = 100, label, size = 128, children }: { value: number | null; max?: number; label: string; size?: number; children?: ReactNode }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = value === null ? 0 : Math.max(0, Math.min(1, value / max));
  return (
    <div className="nx-ring" style={{ inlineSize: size, blockSize: size }} data-empty={value === null ? "" : undefined}>
      <svg viewBox="0 0 128 128" role="img" aria-label={label}>
        <title>{label}</title>
        <circle className="nx-ring-track" cx="64" cy="64" r={r} fill="none" strokeWidth="10" />
        {value === null ? null : <circle className="nx-ring-arc" cx="64" cy="64" r={r} fill="none" strokeWidth="10" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform="rotate(-90 64 64)" />}
      </svg>
      <div className="nx-ring-mid" aria-hidden="true">{children}</div>
    </div>
  );
}

export interface SparkPoint { label: string; value: number }

/** A 2px line over a soft area, a dot with a tooltip per point. Needs two points; fewer draws the empty shape. */
export function AreaSpark({ points, label, empty }: { points: SparkPoint[]; label: string; empty?: string }) {
  const w = 320;
  const h = 88;
  if (points.length < 2) {
    return (
      <figure className="nx-area" data-empty="">
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={empty ?? t("Not enough runs for a trend yet")}>
          <line className="nx-area-base" x1="0" y1={h - 4} x2={w} y2={h - 4} strokeDasharray="4 6" strokeWidth="2" />
        </svg>
        <figcaption className="nx-muted">{empty ?? t("Not enough runs for a trend yet")}</figcaption>
      </figure>
    );
  }
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals);
  const span = Math.max(...vals) - lo || 1;
  const xy = points.map((p, i) => [(i / (points.length - 1)) * (w - 8) + 4, h - 8 - ((p.value - lo) / span) * (h - 20)] as const);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <figure className="nx-area">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <polygon className="nx-area-fill" points={`4,${h} ${line} ${w - 4},${h}`} />
        <polyline className="nx-area-line" points={line} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {xy.map(([x, y], i) => (
          <circle key={points[i].label} className="nx-area-dot" cx={x} cy={y} r="4"><title>{`${points[i].label}: ${points[i].value}`}</title></circle>
        ))}
      </svg>
    </figure>
  );
}

export interface Seg { label: string; value: number }

/** One bar split in parts, 4px rounded ends, the parts and their numbers written under it. */
export function SegBar({ segments, label, format }: { segments: Seg[]; label: string; format: (n: number) => string }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  return (
    <div className="nx-segbar" role="img" aria-label={`${label}: ${segments.map((s) => `${s.label} ${format(s.value)}`).join(", ")}`} data-empty={total === 0 ? "" : undefined}>
      <div className="nx-segbar-bar">
        {total === 0 ? <span className="nx-segbar-part" data-i="empty" style={{ flexGrow: 1 }} /> : segments.filter((s) => s.value > 0).map((s) => (
          <span key={s.label} className="nx-segbar-part" data-i={segments.indexOf(s)} style={{ flexGrow: s.value }} title={`${s.label}: ${format(s.value)}`} />
        ))}
      </div>
      <ul className="nx-segbar-key" aria-hidden="true">
        {segments.map((s, i) => <li key={s.label}><span className="nx-segbar-sw" data-i={i} /> {s.label} <span className="nx-num">{format(s.value)}</span></li>)}
      </ul>
    </div>
  );
}
