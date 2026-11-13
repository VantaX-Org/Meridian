"use client";

/** A stacked bar of parts of a whole, with a legend. Zero parts are left out; an all-zero or empty bar draws an empty track. */
import { t } from "@/lib/v2/i18n";
import "./charts.css";

export type SegTone = "good" | "warn" | "bad" | "data" | "quiet";
export interface Seg { key: string; label: string; value: number; tone: SegTone }

export function SegBar({ segs, testid, format = (n: number) => String(n) }: { segs: Seg[]; testid?: string; format?: (n: number) => string }) {
  const total = segs.reduce((s, x) => s + Math.max(0, x.value), 0);
  const shown = segs.filter((s) => s.value > 0);
  const text = total === 0 ? t("No rows to show") : segs.map((s) => `${s.label} ${format(s.value)}`).join(", ");
  let at = 0;
  return (
    <figure className="nx-chart nx-segbar" data-testid={testid} data-empty={total === 0}>
      <svg viewBox="0 0 100 12" preserveAspectRatio="none" width="100%" height="48" role="img" aria-label={text}>
        <rect x="0" y="0" width="100" height="12" rx="4" className="nx-seg-track" />
        {shown.map((s) => {
          const w = (s.value / total) * 100;
          const x = at;
          at += w;
          return (
            <rect key={s.key} x={x} y="0" width={Math.max(w, 1)} height="12" rx="4" className={`nx-seg nx-seg-${s.tone}`}>
              <title>{`${s.label}: ${format(s.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption>
        <ul className="nx-seg-legend">
          {segs.map((s) => (
            <li key={s.key}><i className={`nx-seg-dot nx-seg-${s.tone}`} aria-hidden="true" />{s.label} <span className="nx-num">{format(s.value)}</span></li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
