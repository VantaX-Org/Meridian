/**
 * Aurora WS5 signature-moments barrel.
 *
 * Consumers import from `@/components/aurora`. These primitives layer on
 * top of WS2 atoms, WS3 data primitives, and WS4 shell — they are the
 * moments §12 of the spec calls out by name.
 */

export { VerdictCard, FixPlaybook } from "./verdict";
export type {
  VerdictCardProps,
  VerdictSemantic,
  FixPlaybookProps,
  FixStep,
  FixStepStatus,
} from "./verdict";

export {
  BulkActionPanel,
  ArrivalBanner,
  SavedViewChip,
  EmptyState,
} from "./surfaces";
export type {
  BulkActionPanelProps,
  ArrivalBannerProps,
  SavedViewChipProps,
  EmptyStateProps,
} from "./surfaces";

export { ProcessGraphEmergence } from "./process-emergence";
export type { ProcessGraphEmergenceProps } from "./process-emergence";

export { RowHoverPreview, KanbanDrop, ConnectionTestButton } from "./interactions";
export type {
  RowHoverPreviewProps,
  KanbanDropProps,
  ConnectionTestButtonProps,
  ConnectionTestState,
} from "./interactions";
