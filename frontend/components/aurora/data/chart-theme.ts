/**
 * Aurora chart theming — WS3.
 *
 * Centralised theme for Recharts + ECharts. Every chart in the product
 * reads from these helpers so axis ink, grid tones, and categorical swaps
 * stay in lock-step with the Aurora tokens.
 *
 * Resolve CSS variables at runtime so the same theme object follows
 * `[data-theme="dark"]` vs `[data-theme="light"]` without a consumer re-wire.
 */

import { accent, ink, status, viz } from "@/lib/aurora";

export interface ChartTokens {
  /** Axis lines, grid lines. */
  axisLine: string;
  /** Tick label ink. */
  axisInk: string;
  /** Subtle grid ink. */
  gridInk: string;
  /** Tooltip background + border. */
  tooltipBg: string;
  tooltipLine: string;
  tooltipInk: string;
  /** Categorical swatch — 12 colours, iterate in order. */
  categorical: string[];
  /** Sequential blue ramp (6 stops, low → high). */
  sequentialBlue: string[];
  /** Diverging red/green ramp (7 stops). */
  diverging: string[];
  accent: string;
  status: {
    success: string;
    warning: string;
    danger: string;
    info: string;
  };
}

/**
 * Build the chart token set for the current theme. Call once per surface;
 * callers should memoise the result if the surface renders many charts.
 */
export function resolveChartTokens(): ChartTokens {
  const light = typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "light";

  return {
    axisLine: light ? ink[200] : "#2A3654",
    axisInk: light ? ink[500] : ink[300],
    gridInk: light ? "rgba(10, 14, 26, 0.06)" : "rgba(255, 255, 255, 0.06)",
    tooltipBg: light ? ink[0] : "#172034",
    tooltipLine: light ? ink[200] : "#2A3654",
    tooltipInk: light ? ink[900] : ink[50],
    categorical: viz.categorical.slice(),
    sequentialBlue: viz.sequential.blue.slice(),
    diverging: viz.diverging.redGreen.slice(),
    accent: accent[500],
    status: {
      success: status.success[500],
      warning: status.warning[500],
      danger: status.danger[500],
      info: status.info[500],
    },
  };
}

/**
 * Compact Aurora theme for ECharts. Pass to `echarts.init(el, theme)`
 * after calling `echarts.registerTheme("aurora", auroraEChartsTheme())`.
 * Shipped separately from Recharts to avoid pulling ECharts when only
 * Recharts is needed.
 */
export function auroraEChartsTheme(): Record<string, unknown> {
  const t = resolveChartTokens();
  return {
    color: t.categorical,
    backgroundColor: "transparent",
    textStyle: {
      fontFamily:
        'var(--aurora-font-ui), "Inter", system-ui, -apple-system, sans-serif',
      color: t.axisInk,
    },
    title: {
      textStyle: { color: t.axisInk, fontWeight: 600, fontSize: 14 },
    },
    legend: { textStyle: { color: t.axisInk } },
    tooltip: {
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipLine,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: t.tooltipInk, fontSize: 12 },
    },
    categoryAxis: {
      axisLine: { lineStyle: { color: t.axisLine } },
      axisTick: { lineStyle: { color: t.axisLine } },
      axisLabel: { color: t.axisInk, fontSize: 11 },
      splitLine: { show: false },
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: t.axisInk, fontSize: 11 },
      splitLine: { lineStyle: { color: t.gridInk, type: "dashed" } },
    },
  };
}
