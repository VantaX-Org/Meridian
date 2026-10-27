"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import type { ColumnDef } from "@tanstack/react-table";
import { getAuditEntries, type AuditEntry } from "../../lib/api/audit";
import { formatDate } from "../../lib/format";
import { DataTable } from "../table/DataTable";
import { Tabs, type TabItem } from "../primitives/Tabs";
import { EmptyState } from "../primitives/EmptyState";
import { ErrorState } from "../primitives/ErrorState";
import { Skeleton } from "../primitives/Skeleton";
import { usePermissionsContext } from "../../lib/permissions";
import { ExportMenu, type ExportOption } from "../primitives/ExportMenu";

/** The four tabs every detail page carries, in this order. */
export type EntityTabValue = "overview" | "related" | "history" | "audit";

export interface EntityTabsOptions {
  /** First path segment under /api/v1 that mutations on this entity go through, e.g. "systems", "rules". */
  entityType: string;
  /** The entity's id. UUIDs and numbers match audit `entity_id`; anything else matches the request path. */
  entityId: string;
  /** Related entities (links, linked tables). Omit for the designed empty state. */
  related?: ReactNode;
  /** The entity's change history, when the API has an endpoint for it. Omit for the designed empty state. */
  history?: ReactNode;
  /** Replaces the generic Audit tab for entities whose trail lives in their own log (e.g. cleaning batches). */
  audit?: ReactNode;
  /** Export options for this entity: an ExportMenu above the tabs, not a tab of its own. */
  exportOptions?: ExportOption[];
  /** False hides the ExportMenu (rbac.md §5: exports are for roles holding `export`). Omitted means shown. */
  canExport?: boolean;
  /**
   * Request-path fragment that the audit rows of this entity carry, for nested resources
   * (e.g. `/migration/waves/<id>`) where the audit middleware records no entity_id.
   * When set, the Audit tab matches on it instead of entity_type/entity_id.
   */
  auditPath?: string;
  /** Tabs the page already renders itself; they are not added again. */
  skip?: EntityTabValue[];
  /** Puts Related, History and Audit under the strip's "More" menu, for a page with tabs of its own to show. */
  overflow?: boolean;
}

const ID_LIKE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)$/i;

const AUDIT_COLUMNS: ColumnDef<AuditEntry>[] = [
  { accessorKey: "created_at", header: "When", cell: (i) => formatDate(i.getValue<string>(), "datetime") },
  { accessorKey: "actor_email", header: "Who", cell: (i) => i.getValue<string | null>() ?? "system" },
  { accessorKey: "action", header: "Action" },
  { accessorKey: "method", header: "Method", meta: { mono: true } },
  { accessorKey: "path", header: "Path", meta: { mono: true } },
  { accessorKey: "status_code", header: "Status", meta: { numeric: true } },
];

/** Audit trail for one entity from GET /audit. Roles without audit access see a designed restricted state. */
export function AuditTab({ entityType, entityId, auditPath }: { entityType: string; entityId: string; auditPath?: string }) {
  const byId = !auditPath && ID_LIKE.test(entityId);
  const q = useQuery({
    queryKey: ["audit-entries", "entity", entityType, entityId, auditPath ?? null],
    queryFn: () =>
      getAuditEntries(byId
        ? { entity_type: entityType, entity_id: entityId, limit: 100 }
        : auditPath
          ? { path_contains: auditPath, limit: 100 }
          : { entity_type: entityType, path_contains: entityId, limit: 100 }),
    retry: false,
  });
  if (q.isLoading) return <Skeleton height={120} />;
  if (q.isError) {
    if (isAxiosError(q.error) && q.error.response?.status === 403) {
      return <EmptyState variant="inline" title="Audit history is restricted" detail="Your role does not include access to the audit log. Ask an administrator for audit access." />;
    }
    return <ErrorState message="Could not load the audit trail." onRetry={() => void q.refetch()} />;
  }
  const entries = q.data?.entries ?? [];
  if (entries.length === 0) {
    return <EmptyState variant="inline" title="No changes recorded" detail="Edits, approvals and runs against this record are logged here as they happen." />;
  }
  return <DataTable columns={AUDIT_COLUMNS} data={entries} getRowId={(r) => r.id} tableId={`audit-${entityType}`} exportName={`audit-${entityType}`} height="calc(100vh - 320px)" />;
}

/** Related, History and Audit tab items. Append to a page's own tabs after its Overview. */
export function entityTabs({ entityType, entityId, related, history, auditPath, audit, skip = [], overflow = false }: EntityTabsOptions): TabItem[] {
  const items: TabItem[] = [
    {
      value: "related", label: "Related",
      content: related ?? <EmptyState variant="inline" title="No related items yet" detail="Linked rules, records and runs appear here once this record is connected." />,
    },
    {
      value: "history", label: "History",
      content: history ?? <EmptyState variant="inline" title="No history to show" detail="The Audit tab lists every logged action against this record." />,
    },
    { value: "audit", label: "Audit", content: audit ?? <AuditTab entityType={entityType} entityId={entityId} auditPath={auditPath} /> },
  ];
  return items.filter((i) => !skip.includes(i.value as EntityTabValue)).map((i) => (overflow ? { ...i, overflow: true } : i));
}

/** Overview/Related/History/Audit tab set for detail pages that have no tabs of their own. */
export function EntityTabs({ overview, extraTabs = [], exportOptions, ...opts }: EntityTabsOptions & { overview: ReactNode; extraTabs?: TabItem[] }) {
  const perms = usePermissionsContext();
  // no provider (tests, public pages) keeps the tab; inside one, the export grant decides
  const canExport = opts.canExport ?? (perms ? perms.can("export") : true);
  const [rest0, ...rest] = entityTabs(opts);
  const items: TabItem[] = [{ value: "overview", label: "Overview", content: overview }, ...(rest0 ? [rest0] : []), ...extraTabs, ...rest];
  return (
    <div className="flex flex-col gap-3">
      {canExport && exportOptions && exportOptions.length > 0 && <div className="flex justify-end"><ExportMenu options={exportOptions} /></div>}
      <Tabs items={items} />
    </div>
  );
}
