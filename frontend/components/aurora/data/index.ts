/**
 * Aurora WS3 data primitives — barrel.
 *
 * Consumers import from `@/components/aurora`. These primitives compose
 * into the Signature moments (WS5), Command Centre (WS6), and
 * Workbench/Process (WS7) surfaces.
 */

export { DataTable } from "./table";
export type { DataTableProps, AuroraColumnMeta } from "./table";

export { Stat, KpiRail } from "./stat";
export type {
  DeltaDirection,
  KpiRailProps,
  StatDelta,
  StatProps,
  StatTone,
} from "./stat";

export {
  AreaChart,
  BarChart,
  DonutChart,
  LineChart,
  Sparkline,
} from "./charts";
export type {
  AreaChartProps,
  BarChartProps,
  DonutChartProps,
  DonutSlice,
  LineChartProps,
  SeriesDef,
  SparklineProps,
} from "./charts";

export { ProcessGraph } from "./process-graph";
export type {
  ProcessAlignment,
  ProcessEdgeData,
  ProcessGraphProps,
  ProcessNodeData,
  ProcessStepKind,
} from "./process-graph";

export { resolveChartTokens, auroraEChartsTheme } from "./chart-theme";
export type { ChartTokens } from "./chart-theme";
