/**
 * Aurora WS6+ surfaces — composed home-workspace-level views.
 *
 * Surfaces are opinionated compositions of primitives / data / shell /
 * moments — e.g. the Command Centre verse home, the Workbench triage
 * table with drawer, the Process map. They are pure-view (props in /
 * render out); page files wire data via react-query.
 */

export {
  CommandCentre,
  LlmSavingsStrip,
  buildVerdict,
  isSavingsNonTrivial,
} from "./command-centre";
export type {
  CommandCentreProps,
  CommandCentreVerdict,
  CommandCentreKpi,
  CommandCentreInboxItem,
  CommandCentreTrendPoint,
  CommandCentreIssueBucket,
  CommandCentreLlmSavings,
  CommandCentreAskState,
  LlmSavingsStripProps,
  BuildVerdictInput,
} from "./command-centre";

export { Workbench, WorkbenchDrawerHeader } from "./workbench";
export type {
  WorkbenchProps,
  WorkbenchDrawerHeaderProps,
  WorkbenchVerdict,
  WorkbenchRow,
  WorkbenchSeverity,
  WorkbenchStatus,
  WorkbenchTabId,
  WorkbenchTabState,
  WorkbenchSavedView,
  WorkbenchFilter,
} from "./workbench";

export { Process } from "./process";
export type {
  ProcessProps,
  ProcessVerdict,
  ProcessTabId,
  ProcessReadiness,
  ProcessPick,
  ProcessVariant,
  ProcessCase,
  ProcessConfigImpactRow,
} from "./process";
