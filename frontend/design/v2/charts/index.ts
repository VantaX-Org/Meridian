/**
 * The chart grammar of the interface: one set of components for every chart, built on the palette tokens
 * (--m2-chart-*, --m2-seq-*, --m2-sev-*) and drawn the same way in light and dark (DESIGN.md, Charts).
 */
export { ChartFrame, ChartTable, Legend, Readout, usePointer, type ChartState, type LegendItem } from "./Frame";
export { TrendChart, trendGeometry, TREND_H, type TrendPoint, type TrendRef, type TrendGeometry } from "./TrendChart";
export { Sparkline, sparkGeometry } from "./Sparkline";
export { StackedBar, STACK_H, type StackPart } from "./StackedBar";
export { Distribution, distGeometry, DIST_H, type DistItem } from "./Distribution";
export { SmallMultiples, MULTI_H, type Multiple } from "./SmallMultiples";
export { DeltaBar } from "./DeltaBar";
export { bins, linear, nearest, niceTicks, scoreDomain, stack } from "./scale";
export { severityParts, verdictParts } from "./presets";
