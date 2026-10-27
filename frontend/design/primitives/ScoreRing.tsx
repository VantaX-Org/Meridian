import type { CSSProperties } from "react";
import { dqsBand, mColor } from "../tokens";

/** Mirrors `--m-dqs-target`, `--m-dqs-warning`, `--m-dqs-critical` in tokens.css. */
export interface ScoreBands {
  target: number;
  warning: number;
  critical: number;
}
export const DEFAULT_SCORE_BANDS: ScoreBands = { target: 90, warning: 75, critical: 60 };

const ARC = 0.75; // 270 degrees, open at 12 o'clock like the logo
const START = 45; // degrees clockwise from 12 o'clock where the arc begins

const clamp = (n: number) => Math.min(100, Math.max(0, n));

/**
 * The hue a score is drawn in: its verdict family. Below the warning band and above the critical band is still at
 * risk, so it takes the at-risk (medium) hue the dimension bars use, never a second orange.
 */
export function scoreHue(score: number, bands: ScoreBands = DEFAULT_SCORE_BANDS): "pass" | "medium" | "critical" {
  const band = dqsBand(score, bands);
  return band === "high" ? "medium" : band;
}

/** A score as every surface prints it: one decimal ("71.7", "70.0"); a full score reads "100". */
/** "4 critical failing rules": the cap's count always carries its noun (lib/help/glossary.ts, failing rules). */
export function criticalRules(n: number): string {
  return `${n.toLocaleString()} critical failing rule${n === 1 ? "" : "s"}`;
}

export function formatScore(n: number): string {
  const r = Math.round(n * 10) / 10;
  return r >= 100 ? "100" : r.toFixed(1);
}

/**
 * DQS gauge. `score` is the measured value; when `cap` is set the ring fills only to the cap,
 * a tick marks the cap and a dashed ghost arc shows the measured value beyond it.
 */
export function ScoreRing({
  score, size = 48, cap, criticals, bands = DEFAULT_SCORE_BANDS,
}: {
  score: number;
  size?: number;
  cap?: number;
  /** Critical findings behind the cap, used in the label under the ring. */
  criticals?: number;
  bands?: ScoreBands;
}) {
  const measured = clamp(score);
  const capV = cap !== undefined ? clamp(cap) : undefined;
  const capped = capV !== undefined && measured > capV;
  const shown = capped ? capV : measured;
  const stroke = Math.max(3, size / 10);
  const c = size / 2;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const arcLen = circ * ARC;
  const color = mColor[scoreHue(shown, bands)];
  const rot = `rotate(${START - 90} ${c} ${c})`;
  const point = (pct: number, radius: number) => {
    const a = ((START + 270 * (pct / 100)) * Math.PI) / 180;
    return { x: c + radius * Math.sin(a), y: c - radius * Math.cos(a) };
  };
  const arc = (from: number, to: number) => ({
    strokeDasharray: `${(arcLen * (to - from)) / 100} ${circ}`,
    strokeDashoffset: -(arcLen * from) / 100,
  });
  // One decimal has to fit inside the ring: four glyphs at about a third of its size.
  const numSize = size >= 96 ? size / 3 : size / 3.4;
  const big = size >= 96;
  const capA = capV !== undefined ? point(capV, r - stroke / 2) : null;
  const capB = capV !== undefined ? point(capV, r + stroke / 2) : null;

  const svg = (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={capped ? `Score ${formatScore(shown)}, capped from ${formatScore(measured)}${criticals ? `, ${criticalRules(criticals)}` : ""}` : `Score ${formatScore(shown)}`}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--m-dqs-track)" strokeWidth={stroke} strokeLinecap="round" transform={rot} {...arc(0, 100)} />
      {big && <line x1={c} x2={c} y1={stroke / 2} y2={size - stroke / 2} stroke="var(--m-line-strong)" strokeWidth={1} />}
      {capped && capV !== undefined && (
        <path data-ghost d={`M ${point(capV, r).x} ${point(capV, r).y} A ${r} ${r} 0 ${(measured - capV) * 2.7 > 180 ? 1 : 0} 1 ${point(measured, r).x} ${point(measured, r).y}`} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray="3 3" strokeOpacity={0.5} />
      )}
      {shown > 0 && (
        <circle
          data-value
          className="m-motion-draw"
          cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" transform={rot}
          style={{ "--m-draw-length": (arcLen * shown) / 100 } as CSSProperties}
          {...arc(0, shown)}
        />
      )}
      {capA && capB && <line data-cap x1={capA.x} y1={capA.y} x2={capB.x} y2={capB.y} stroke="var(--m-dqs-cap-line)" strokeWidth={2} />}
      <text className="m-numeric" x={c} y={big ? c - numSize * 0.1 : c} textAnchor="middle" dominantBaseline="central" fontSize={numSize} fontWeight={600} fill="var(--m-ink)">
        {formatScore(shown)}
      </text>
      {big && (
        <text x={c} y={c + numSize * 0.75} textAnchor="middle" dominantBaseline="central" fontSize={12} fill="var(--m-ink-3)">/100</text>
      )}
    </svg>
  );
  if (!capped) return svg;
  return (
    <div className="inline-flex flex-col items-center gap-1">
      {svg}
      <span className="m-text-meta" style={{ color: "var(--m-ink-2)" }}>
        {`Capped at ${formatScore(capV)}${criticals ? `, ${criticalRules(criticals)}` : ""}`}
      </span>
    </div>
  );
}
