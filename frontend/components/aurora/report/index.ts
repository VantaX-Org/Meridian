/**
 * Aurora report primitives — WS7 §2.5.
 *
 * Long-scroll document surfaces used for the Record Report and the
 * Process Report. Composed from `<ReportSurface>` — a shell that owns
 * the anchored scroll nav + section rendering — plus per-domain
 * composite views.
 */

export { ReportSurface, ReportSection } from "./report-surface";
export type {
  ReportSurfaceProps,
  ReportSurfaceSection,
  ReportSectionProps,
} from "./report-surface";

export { RecordReport } from "./record-report";
export type {
  RecordReportProps,
  RecordReportSeverity,
  RecordReportStatus,
  RecordReportFinding,
  RecordReportContextItem,
  RecordReportConfigImpactItem,
  RecordReportRelatedItem,
  RecordReportFixHistory,
  RecordReportActivityItem,
} from "./record-report";

export { ProcessReport } from "./process-report";
export type {
  ProcessReportProps,
  ProcessReportReadiness,
  ProcessReportHierarchyNode,
  ProcessReportVariantRow,
  ProcessReportConfigRow,
  ProcessReportBlockingFinding,
  ProcessReportReadinessPoint,
  ProcessReportRecommendation,
} from "./process-report";
