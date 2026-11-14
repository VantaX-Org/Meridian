"use client";

/** A 0 to 100 score as a ring with the number inside. No value draws an empty ring and a dash. Colour is the data hue, never status. */
import { t } from "@/lib/v2/i18n";
import "./charts.css";

export function ScoreRing({ value, label, size = 112, compact = false, testid }: { value: number | null | undefined; label: string; size?: number; compact?: boolean; testid?: string }) {
  const has = value !== null && value !== undefined;
  const v = has ? Math.max(0, Math.min(100, value)) : 0;
  const r = 44;
  const c = 2 * Math.PI * r;
  const text = has ? t("{label}: {value} of 100", { label, value: String(Math.round(v * 10) / 10) }) : t("{label}: no score", { label });
  return (
    <figure className="nx-chart nx-vring" data-testid={testid} data-empty={!has}>
      <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={text}>
        <title>{text}</title>
        <circle cx="50" cy="50" r={r} className="nx-vring-track" />
        {has ? <circle cx="50" cy="50" r={r} className="nx-vring-arc" strokeDasharray={`${(c * v) / 100} ${c}`} transform="rotate(-90 50 50)" /> : null}
        {compact ? null : <text x="50" y="55" textAnchor="middle" className="nx-vring-num">{has ? Math.round(v) : "—"}</text>}
      </svg>
      {compact ? null : <figcaption>{label}</figcaption>}
    </figure>
  );
}
