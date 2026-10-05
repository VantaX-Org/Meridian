/**
 * Aurora WS6+ surfaces — composed home-workspace-level views.
 *
 * Surfaces are opinionated compositions of primitives / data / shell /
 * moments — e.g. the Command Centre verse home, the Workbench triage
 * table with drawer, the Process map. They are pure-view (props in /
 * render out); page files wire data via react-query.
 */

export {
  Admin,
  AdminDoctorCard,
  AdminAuditLogTable,
  AdminDestructiveConfirm,
} from "./admin";
export type {
  AdminProps,
  AdminTabId,
  AdminTabState,
  AdminDoctorCardProps,
  AdminDoctorItem,
  AdminAuditLogTableProps,
  AdminAuditLogEntry,
  AdminDestructiveConfirmProps,
} from "./admin";
