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
}

export const chartTheme = {
  grid: mColor.line,
  axis: mColor.ink3,
  series: mColor.viz,
  critical: mColor.critical,
  high: mColor.high,
  medium: mColor.medium,
  pass: mColor.pass,
};
