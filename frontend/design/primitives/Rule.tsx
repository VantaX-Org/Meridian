"use client";

// frontend/design/primitives/Rule.tsx
//
// The Rule: Meridian's one instrument for a score. A ruler from 0 to 100 with the measured value as a filled
// run and a needle, the target as a tick, and the cap (when a critical finding holds the score down) as a
// second tick. The same geometry at three sizes, so a reader learns it once: hero (the score sheet), row (a
// table cell beside the numeral) and inline (a sparkline-sized mark in a sentence).
import type { CSSProperties } from "react";
import { dqsBand } from "../tokens";
import { DEFAULT_SCORE_BANDS, type ScoreBands } from "./ScoreRing";

export type RuleSize = "hero" | "row" | "inline";

export interface RuleProps {
  /** The measured score, 0 to 100. Null draws the empty ruler. */
  value: number | null | undefined;
  /** The target tick; defaults to the bands' target. */
  target?: number;
  /** The cap tick: a critical finding holds the score at this value. */
  cap?: number;
  bands?: ScoreBands;
  size?: RuleSize;
  /** The hue, when the caller knows it; else the DQS band of the value. */
  tone?: "pass" | "medium" | "high" | "critical";
  /** Names the instrument for assistive tech; the value, target and cap are appended. */
  label?: string;
  /** Overrides the size's own width (a row rule stretched across a stat tile). */
  width?: number | string;
  className?: string;
  style?: CSSProperties;
}

const GEOMETRY: Record<RuleSize, { h: number; track: number; trackY: number; needle: number; tick: number; labels: boolean; width: string | number }> = {
  hero: { h: 44, track: 6, trackY: 14, needle: 2, tick: 8, labels: true, width: "100%" },
  row: { h: 12, track: 4, trackY: 4, needle: 2, tick: 4, labels: false, width: 96 },
  inline: { h: 8, track: 3, trackY: 2.5, needle: 1.5, tick: 3, labels: false, width: 56 },
};

const clamp = (n: number) => Math.min(100, Math.max(0, n));
const pct = (n: number) => `${clamp(n)}%`;

export function Rule({ value, target, cap, bands = DEFAULT_SCORE_BANDS, size = "row", tone, label, width, className, style }: RuleProps) {
  const g = GEOMETRY[size];
  const t = target ?? bands.target;
  const v = value == null ? null : clamp(value);
  const capped = v != null && cap != null && v > cap;
  const shown = capped ? cap! : v;
  const hue = `var(--m-${tone ?? (shown == null ? "low" : dqsBand(shown, bands))})`;
  const name = `${label ?? "Score"} ${v == null ? "not measured" : Math.round(v * 10) / 10}${capped ? `, capped at ${cap}` : ""}, target ${t}`;
  const mid = g.trackY + g.track / 2;
  return (
    <svg
      role="img"
      aria-label={name}
      data-rule={size}
      className={className}
      width={width ?? g.width}
      height={g.h}
      style={{ display: "block", overflow: "visible", ...style }}
    >
      {g.labels && (
        <g aria-hidden stroke="var(--m-line-strong)" strokeWidth={1}>
          {Array.from({ length: 11 }, (_, i) => (
            <line key={i} x1={pct(i * 10)} x2={pct(i * 10)} y1={0} y2={i % 5 === 0 ? g.tick : g.tick / 2} />
          ))}
        </g>
      )}
      <rect x={0} y={g.trackY} width="100%" height={g.track} rx={g.track / 2} fill="var(--m-sheet-sunken)" />
      {shown != null && <rect className="m-bar-fill" x={0} y={g.trackY} width={pct(shown)} height={g.track} rx={g.track / 2} fill={hue} />}
      {capped && v != null && (
        // The measured value beyond the cap: a hollow run, so the cap reads as a cap and not as the score.
        <rect x={pct(cap!)} y={g.trackY} width={`${clamp(v) - clamp(cap!)}%`} height={g.track} fill="none" stroke={hue} strokeDasharray="2 2" strokeOpacity={0.7} />
      )}
      {/* target tick */}
      <line x1={pct(t)} x2={pct(t)} y1={mid - g.track / 2 - g.tick / 2} y2={mid + g.track / 2 + g.tick / 2} stroke="var(--m-ink-2)" strokeWidth={size === "inline" ? 1 : 1.5} />
      {/* cap tick */}
      {cap != null && <line x1={pct(cap)} x2={pct(cap)} y1={mid - g.track / 2 - g.tick} y2={mid + g.track / 2 + g.tick / 2} stroke="var(--m-critical)" strokeWidth={size === "inline" ? 1 : 2} />}
      {/* needle: the measured value */}
      {shown != null && <line x1={pct(shown)} x2={pct(shown)} y1={mid - g.track / 2 - g.tick} y2={mid + g.track / 2 + g.tick} stroke="var(--m-ink)" strokeWidth={g.needle} strokeLinecap="round" />}
      {g.labels && (
        <g aria-hidden fill="var(--m-ink-3)" fontSize={11} fontFamily="var(--m-font-ui)">
          <text x={0} y={g.h - 4}>0</text>
          <text x={pct(t)} y={g.h - 4} textAnchor={t > 82 ? "end" : "middle"}>Target {t}</text>
          {cap != null && <text x={pct(cap)} y={g.h - 4} textAnchor={cap > 82 ? "end" : "middle"} fill="var(--m-critical)" dy={Math.abs(cap - t) < 14 ? -(g.h - 8) : 0}>Cap {cap}</text>}
          {t <= 82 && (cap == null || cap <= 82) && <text x="100%" y={g.h - 4} textAnchor="end">100</text>}
        </g>
      )}
    </svg>
  );
}
