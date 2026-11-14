"use client";

import { t } from "@/lib/v2/i18n";
import "./viz.css";

/** Chart colours come from the --nx-chart ramp, in order; the 9th part wraps. */
const ramp = (i: number) => `var(--nx-chart-${(i % 8) + 1})`;

/** A ring: `value` of `max`, the big number in its centre. Every mark carries a title (the hover tooltip) and the text sits beside it for screen readers. */
export function Ring({ value, max, label, caption }: { value: number; max: number; label: string; caption: string }) {
  const R = 40;
  const C = 2 * Math.PI * R;
  const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <figure className="nx-viz nx-ring" aria-label={`${label}: ${caption}`}>
      <svg viewBox="0 0 100 100" role="img" aria-label={caption}>
        <circle className="nx-ring-track" cx="50" cy="50" r={R} />
        <circle className="nx-ring-arc" cx="50" cy="50" r={R} strokeDasharray={`${C * frac} ${C}`} transform="rotate(-90 50 50)"><title>{caption}</title></circle>
        <text className="nx-ring-num" x="50" y="54" textAnchor="middle">{value}</text>
      </svg>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export interface Seg { label: string; value: number }

/** A segmented bar of parts of a whole. A hover title and a list in text on every part. */
export function SegBar({ parts, label }: { parts: Seg[]; label: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const text = parts.map((p) => `${p.label} ${p.value}`).join(", ");
  return (
    <figure className="nx-viz nx-segbar" aria-label={`${label}: ${text}`}>
      <div className="nx-segbar-track" role="img" aria-label={text}>
        {parts.filter((p) => p.value > 0).map((p, i) => (
          <span key={p.label} style={{ flexGrow: p.value, background: ramp(i) }} title={`${p.label}: ${p.value}`} />
        ))}
      </div>
      <ul className="nx-segbar-key">
        {parts.map((p, i) => (<li key={p.label}><i style={{ background: ramp(i) }} />{p.label} <b>{p.value}</b></li>))}
      </ul>
      {total === 0 ? <figcaption className="nx-sub">{t("Nothing to show yet.")}</figcaption> : null}
    </figure>
  );
}

/** The designed empty chart: the shape of the chart with one line of copy, never a made-up number. */
export function EmptyViz({ line }: { line: string }) {
  return (
    <figure className="nx-viz nx-emptyviz" aria-label={line}>
      <div className="nx-emptyviz-bars" aria-hidden="true"><i /><i /><i /><i /><i /></div>
      <figcaption className="nx-sub">{line}</figcaption>
    </figure>
  );
}
