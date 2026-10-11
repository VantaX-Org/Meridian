// frontend/design/charts/theme.ts
import { mColor } from "../tokens";

/** Every chart's data point carries enough to build a DrillLink target. */
export interface ChartPoint {
  x: string | number;
  y: number;
  /** Optional drill target fields — charts pass these through untouched. */
  object?: string;
  dimension?: string;
  ruleId?: string;
  runId?: string;
  /** Waterfall only: an absolute total bar (drawn from 0 in `--m-ink-2`) instead of a delta. */
  total?: boolean;
}

export const chartTheme = {
  grid: mColor.line,
  axis: mColor.ink3,
  series: mColor.viz,
  area: mColor.vizArea,
  tooltipBg: mColor.vizTooltipBg,
  tooltipInk: mColor.vizTooltipInk,
  threshold: mColor.ink2,
  accentHover: mColor.accentHover,
  sheet: mColor.sheet,
  critical: mColor.critical,
  high: mColor.high,
  medium: mColor.medium,
  pass: mColor.pass,
};
