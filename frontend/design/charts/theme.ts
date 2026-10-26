// frontend/design/charts/theme.ts
import { mColor, type DomainKey } from "../tokens";

/** Every chart's data point carries enough to build a DrillLink target. */
export interface ChartPoint {
  x: string | number;
  y: number;
  /** Display text for `x` on ticks and tooltips when `x` is a key (a run id); `x` itself is shown otherwise. */
  label?: string;
  /** Optional drill target fields — charts pass these through untouched. */
  object?: string;
  dimension?: string;
  ruleId?: string;
  runId?: string;
  /** Waterfall only: an absolute total bar (drawn from 0 in `--m-ink-2`) instead of a delta. */
  total?: boolean;
  /** Bar and Pareto: fill this point in its domain solid instead of the first series hue. */
  domain?: DomainKey;
}

export const chartTheme = {
  grid: mColor.line,
  axis: mColor.ink3,
  /** Ten-hue series palette, `--m-viz-1` to `--m-viz-10`. */
  series: mColor.viz,
  /** Series hue at 15 percent opacity for fills, same order as `series`. */
  seriesFill: mColor.viz.map((_, i) => `var(--m-viz-${i + 1}-fill)`),
  /** Domain solid for a domain key. */
  domain: (key: DomainKey): string => mColor.dom[key],
  /** Five-step sequential ramp, lightest first. */
  seq: mColor.seq,
  /** Five-step diverging ramp, negative end first. */
  div: mColor.div,
  accent: mColor.accent,
  ink: mColor.ink,
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

/** Text alternative for a chart: caller's label (or a default) plus every point as "x y", y through `format` when given. */
export function chartSummary(data: ChartPoint[], label = "Chart", format?: (n: number) => string): string {
  return `${label}: ${data.map((p) => `${p.label ?? p.x} ${format ? format(p.y) : p.y}`).join(", ") || "no data"}`;
}
