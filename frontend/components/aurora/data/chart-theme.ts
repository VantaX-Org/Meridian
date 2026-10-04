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

import { accent, canvas, ink, status, viz } from "@/lib/aurora";

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
 * Walk up from `element` looking for the closest ancestor that declares a
 * `data-theme` attribute, falling back to the document root. Mirrors how
 * the Aurora CSS cascade resolves `[data-theme="dark"]` / `[data-theme="light"]`
 * so charts pick up scoped themes instead of only the root.
 */
function resolveThemeForElement(element?: Element | null): "dark" | "light" {
  if (typeof document === "undefined") return "light";
  let node: Element | null = element ?? null;
  while (node) {
  const value = node.getAttribute?.("data-theme");
    if (value === "light" || value === "dark") return value;
    node = node.parentElement;
  }
  const root = document.documentElement.getAttribute("data-theme");
  return root === "dark" ? "dark" : "light";
}

/**
 * Build the chart token set for the current theme. Pass the chart's host
 * element (e.g. via `ref.current`) so the resolver finds the nearest
 * `[data-theme]` ancestor — matching how the CSS cascade works. Call once
 * per surface; callers should memoise the result if the surface renders
 * many charts.
 */
export function resolveChartTokens(element?: Element | null): ChartTokens {
  const light = resolveThemeForElement(element) === "light";

  return {
    axisLine: light ? canvas.light.line : canvas.dark.line,
    axisInk: light ? ink[500] : ink[400],
    gridInk: light ? canvas.light.line : canvas.dark.line,
    tooltipBg: light ? canvas.light.raised : canvas.dark.elevated,
    tooltipLine: light ? canvas.light.line : canvas.dark.line,
    tooltipInk: light ? ink[900] : ink[100],
    categorical: viz.categorical.slice(),
    sequentialBlue: viz.sequential.blue.slice(),
    diverging: viz.diverging.redGreen.slice(),
    accent: light ? accent[500] : accent.dark500,
    status: {
      success: light ? status.success[500] : status.success.dark500,
      warning: light ? status.warning[500] : status.warning.dark500,
      danger: light ? status.danger[500] : status.danger.dark500,
      info: light ? status.info[500] : status.info.dark500,
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
        "var(--aurora-font-ui)",
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
