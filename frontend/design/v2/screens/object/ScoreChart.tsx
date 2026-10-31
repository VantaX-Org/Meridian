import { useMemo } from "react";
import { f1 } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { TrendChart, trendGeometry, TREND_H, TREND_RIGHT, type TrendGeometry } from "../../charts/TrendChart";

/**
 * The measured score over the last runs: the chart grammar's trend chart (design/v2/charts) on the score scale every
 * object shares, 60 to 100 with gridlines at 70, 80, 90 and 100, the cap level dashed and named, the baseline run
 * marked by a 1 pixel rule, the last measured score at the end of the line.
 */

export const Y_MIN = 60;
export const Y_MAX = 100;
export const GRID = [70, 80, 90, 100] as const;
const DOMAIN = [Y_MIN, Y_MAX] as const;
const TICKS = [Y_MIN, ...GRID] as const;

export interface ChartPoint {
  id: string;
  /** Short date for the axis: "16 Oct". */
  label: string;
  /** The full reading for the hover title and the accessible name: "16 Oct 2026: measured 71.8". */
  title: string;
  measured: number;
  baseline: boolean;
}

export interface ChartGeometry extends TrendGeometry {
  capY: number | null;
  baselineX: number | null;
}

const W = 560;
/** The phone draws the chart at the width it is shown, so the text keeps its size instead of shrinking with the scale. */
const W_COMPACT = 340;

/** Y for a score, clamped to the 60 to 100 scale. */
export function yOf(value: number): number {
  return trendGeometry([value], { width: W, domain: DOMAIN, ticks: TICKS }).ys[0] ?? 0;
}

export function chartGeometry(points: readonly ChartPoint[], capLevel: number | null, compact = false): ChartGeometry {
  const g = trendGeometry(
    points.map((p) => p.measured),
    { width: compact ? W_COMPACT : W, height: TREND_H, domain: DOMAIN, ticks: TICKS, refs: capLevel != null ? [{ value: capLevel, label: "" }] : [], marker: points.findIndex((p) => p.baseline) },
  );
  return { ...g, capY: g.refs[0]?.y ?? null, baselineX: g.markerX };
}

export { TREND_RIGHT };

export function ScoreChart({ points, capLevel, label, compact = false }: { points: readonly ChartPoint[]; capLevel: number | null; label: string; compact?: boolean }) {
  const trend = useMemo(() => points.map((p) => ({ id: p.id, label: p.label, title: p.title, value: p.measured })), [points]);
  const refs = useMemo(() => (capLevel != null ? [{ value: capLevel, label: t("cap {capLevel}", { capLevel }), testId: "cap-line" }] : []), [capLevel]);
  const bi = points.findIndex((p) => p.baseline);
  const marker = useMemo(() => (bi >= 0 ? { index: bi, label: t("baseline {label}", { label: points[bi].label }) } : null), [bi, points]);
  return (
    <TrendChart
      points={trend}
      domain={DOMAIN}
      ticks={TICKS}
      refs={refs}
      marker={marker}
      label={label}
      yLabel={t("score")}
      format={f1}
      fallbackWidth={compact ? W_COMPACT : W}
      testId="score-chart"
      lineTestId="score-line"
    />
  );
}
