/**
 * Aurora Workbench surface — WS7.
 *
 * The stewardship workspace (Part IV, §10 of the spec). Where a data
 * steward actually lives during the day: triage a finding, open the
 * record drawer, walk the Fix Playbook, hand it off. Linear Inbox +
 * Attio density + Apple Finder Quick Look on the drawer.
 *
 * This module is pure view — props in / render out. The live page wires
 * `<Workbench>` with react-query + the Aurora shell; the design-playground
 * wires it with fixtures. Tabs (Triage, Golden Records, Glossary,
 * Analyses, Reports) are owned by the consumer — this surface renders
 * whatever the active tab hands it.
 *
 * Drawer pattern:
 *   • `selected` = the currently-open record id (controlled by host).
 *   • `onSelectedChange(null)` closes; `onSelectedStep(-1 | +1)` walks
 *     through the list. Workbench does not read rows itself — it only
 *     surfaces the current `drawer` prop, so hosts can mount it
 *     lazily from a record-id to a <RecordDrawerBody> without us
 *     caring about the detail shape.
 *
 * Tabs in pass 1 surface TRIAGE + placeholders for the other four so
 * navigation reads correctly. The per-tab content slots are props, so
 * each tab can be populated independently as the live pages wire up.
 */

"use client";

import type { ReactNode } from "react";
import {
  BulkActionPanel,
  type BulkActionPanelProps,
  DataTable,
  type AuroraColumnMeta,
  Drawer,
  type DrawerProps,
  EmptyState,
  SavedViewChip,
  Stack,
  Tabs,
  type TabsItem,
  Text,
  VerdictCard,
  type VerdictSemantic,
} from "@/components/aurora";
import type { ColumnDef } from "@tanstack/react-table";
import { clsx } from "../primitives/internal";

/** A Workbench saved view — Triage filter bundle the user can return to. */
export interface WorkbenchSavedView {
  id: string;
  label: ReactNode;
  /** Count of rows matched. Rendered as a trailing badge. */
  count?: number;
  active?: boolean;
}

/** A Workbench filter chip — label + optional count + selected state. */
export interface WorkbenchFilter {
  id: string;
  label: ReactNode;
  count?: number;
  active?: boolean;
  onToggle?: () => void;
}

/* -------------------------------------------------------------- Types --- */

export interface WorkbenchVerdict {
  eyebrow?: ReactNode;
  sentence: ReactNode;
  support?: ReactNode;
  semantic: VerdictSemantic;
  actions?: ReactNode;
}

export type WorkbenchSeverity = "critical" | "high" | "medium" | "low";
export type WorkbenchStatus = "open" | "in_progress" | "resolved" | "escalated";

export interface WorkbenchRow {
  id: string;
  /** Short record label — e.g. "BP-1203187". */
  recordId: string;
  /** One-line steward-facing description. */
  headline: string;
  module: string;
  severity: WorkbenchSeverity;
  status: WorkbenchStatus;
  /** Human-readable age, e.g. "3h". Host formats. */
  age: string;
  /** Assignee display name, null when unassigned. */
  assignee: string | null;
  /** Count of findings blocking the record. */
  blocking: number;
  /** Optional score (0-100) for quality / readiness. */
  score?: number;
}

export type WorkbenchTabId =
  | "triage"
  | "golden-records"
  | "glossary"
  | "analyses"
  | "reports";

export interface WorkbenchTabState {
  id: WorkbenchTabId;
  label: ReactNode;
  count?: number;
  /** Optional body override. When absent, Triage renders the default table. */
  body?: ReactNode;
  disabled?: boolean;
}

export interface WorkbenchProps {
  verdict: WorkbenchVerdict;
  /** Tab bar items + bodies. Host owns active-tab state. */
  tabs: ReadonlyArray<WorkbenchTabState>;
  activeTab: WorkbenchTabId;
  onActiveTabChange: (tab: WorkbenchTabId) => void;
  /** Filter chips — severity / status / module pre-built by caller. */
  filters?: ReadonlyArray<WorkbenchFilter>;
  /** Optional saved view rail (pass empty to hide). */
  savedViews?: ReadonlyArray<WorkbenchSavedView>;
  onSavedViewActivate?: (view: WorkbenchSavedView) => void;
  /** Triage rows — only read when the Triage tab is active. */
  rows: ReadonlyArray<WorkbenchRow>;
  /** Row activation (Enter / click) opens the drawer. */
  onRowActivate?: (row: WorkbenchRow) => void;
  /** Currently-open record id. Null closes the drawer. */
  selected: string | null;
  onSelectedChange: (id: string | null) => void;
  /** J/K stepping — consumer resolves next/previous in the currently
   *  filtered set. Called with +1 or -1. */
  onSelectedStep?: (delta: 1 | -1) => void;
  /** Drawer body for `selected`. Host mounts the record payload. */
  drawer?: ReactNode;
  /** Drawer header for `selected`. Typically <DrawerHeader>. */
  drawerHeader?: DrawerProps["header"];
  /** Drawer footer for `selected`. Typically the sticky action row. */
  drawerFooter?: DrawerProps["footer"];
  /** Bulk action panel shown when 1+ rows selected. */
  bulkSelection?: BulkActionPanelProps;
  className?: string;
}

/* -------------------------------------------------------- Constants --- */

const TRIAGE_TABS_DEFAULT: ReadonlyArray<TabsItem<WorkbenchTabId>> = [
  { id: "triage", label: "Triage" },
  { id: "golden-records", label: "Golden records" },
  { id: "glossary", label: "Glossary" },
  { id: "analyses", label: "Analyses" },
  { id: "reports", label: "Reports" },
];

const SEVERITY_LABEL: Record<WorkbenchSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const STATUS_LABEL: Record<WorkbenchStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  escalated: "Escalated",
};

/* ----------------------------------------------------------- Columns --- */

const triageColumns: ColumnDef<WorkbenchRow, unknown>[] = [
  {
    id: "severity",
    header: "Severity",
    accessorKey: "severity",
    cell: ({ row }) => (
      <span
        className="aurora-workbench__severity"
        data-severity={row.original.severity}
      >
        {SEVERITY_LABEL[row.original.severity]}
      </span>
    ),
    meta: { width: 96 } satisfies AuroraColumnMeta,
  },
  {
    id: "recordId",
    header: "Record",
    accessorKey: "recordId",
    cell: ({ row }) => (
      <Text variant="text-small" numeric as="span">
        {row.original.recordId}
      </Text>
    ),
    meta: { width: 128 } satisfies AuroraColumnMeta,
  },
  {
    id: "headline",
    header: "Finding",
    accessorKey: "headline",
    cell: ({ row }) => (
      <span className="aurora-workbench__headline">
        {row.original.headline}
      </span>
    ),
  },
  {
    id: "module",
    header: "Module",
    accessorKey: "module",
    cell: ({ row }) => (
      <Text variant="text-small" tone="secondary" as="span">
        {row.original.module}
      </Text>
    ),
    meta: { width: 160 } satisfies AuroraColumnMeta,
  },
  {
    id: "assignee",
    header: "Assignee",
    accessorKey: "assignee",
    cell: ({ row }) => (
      <Text
        variant="text-small"
        tone={row.original.assignee ? "secondary" : "tertiary"}
        as="span"
      >
        {row.original.assignee ?? "Unassigned"}
      </Text>
    ),
    meta: { width: 160 } satisfies AuroraColumnMeta,
  },
  {
    id: "blocking",
    header: "Blocking",
    accessorKey: "blocking",
    cell: ({ row }) => (
      <Text variant="text-small" numeric as="span" tone="secondary">
        {row.original.blocking.toLocaleString()}
      </Text>
    ),
    meta: { width: 88, align: "end", numeric: true } satisfies AuroraColumnMeta,
  },
  {
    id: "status",
    header: "Status",
    accessorKey: "status",
    cell: ({ row }) => (
      <span
        className="aurora-workbench__status"
        data-status={row.original.status}
      >
        {STATUS_LABEL[row.original.status]}
      </span>
    ),
    meta: { width: 120 } satisfies AuroraColumnMeta,
  },
  {
    id: "age",
    header: "Age",
    accessorKey: "age",
    cell: ({ row }) => (
      <Text variant="text-small" tone="tertiary" as="span">
        {row.original.age}
      </Text>
    ),
    meta: { width: 72, align: "end" } satisfies AuroraColumnMeta,
  },
];

/* ----------------------------------------------------------- Surface --- */

export function Workbench({
  verdict,
  tabs,
  activeTab,
  onActiveTabChange,
  filters,
  savedViews,
  onSavedViewActivate,
  rows,
  onRowActivate,
  selected,
  onSelectedChange,
  onSelectedStep,
  drawer,
  drawerHeader,
  drawerFooter,
  bulkSelection,
  className,
}: WorkbenchProps) {
  const tabItems: TabsItem<WorkbenchTabId>[] = tabs.map((tab) => ({
    id: tab.id,
    label: tab.label,
    count: tab.count,
    disabled: tab.disabled,
  }));
  const resolvedTabs = tabItems.length > 0 ? tabItems : TRIAGE_TABS_DEFAULT;

  const activeTabBody = tabs.find((tab) => tab.id === activeTab)?.body;

  return (
    <div className={clsx("aurora-workbench", className)}>
      <VerdictCard
        eyebrow={verdict.eyebrow}
        verdict={verdict.sentence}
        support={verdict.support}
        semantic={verdict.semantic}
        actions={verdict.actions}
      />

      <header className="aurora-workbench__head">
        <Tabs
          items={resolvedTabs}
          value={activeTab}
          onValueChange={onActiveTabChange}
          ariaLabel="Workbench sections"
        />
        {savedViews && savedViews.length > 0 && onSavedViewActivate ? (
          <div
            className="aurora-workbench__saved-views"
            role="toolbar"
            aria-label="Saved views"
          >
            {savedViews.map((view) => (
              <SavedViewChip
                key={view.id}
                label={view.label}
                count={view.count}
                active={view.active}
                onClick={() => onSavedViewActivate(view)}
              />
            ))}
          </div>
        ) : null}
      </header>

      {filters && filters.length > 0 ? (
        <div
          className="aurora-workbench__filters"
          role="toolbar"
          aria-label="Workbench filters"
        >
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={clsx(
                "aurora-workbench__filter",
                "aurora-focus-ring",
              )}
              data-active={filter.active ? "true" : undefined}
              onClick={filter.onToggle}
            >
              <span>{filter.label}</span>
              {typeof filter.count === "number" ? (
                <span
                  className="aurora-workbench__filter-count"
                  data-numeric="true"
                >
                  {filter.count.toLocaleString()}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      <section className="aurora-workbench__body" aria-label="Workbench content">
        {activeTabBody ?? (
          activeTab === "triage" ? (
            rows.length === 0 ? (
              <EmptyState
                title="Triage queue is clear"
                body="No open findings match the current filters. Save this view to return to it quickly."
              />
            ) : (
              <DataTable
                columns={triageColumns}
                data={rows.slice()}
                getRowId={(row) => row.id}
                onRowActivate={onRowActivate}
                ariaLabel="Triage queue"
                maxHeight={560}
              />
            )
          ) : (
            <EmptyState
              title={`${resolvedTabs.find((t) => t.id === activeTab)?.label ?? "This tab"} is coming online`}
              body="Content lands in the next WS7 pass. Triage is ready now."
            />
          )
        )}
      </section>

      {bulkSelection ? <BulkActionPanel {...bulkSelection} /> : null}

      <Drawer
        open={selected !== null}
        onClose={() => onSelectedChange(null)}
        header={drawerHeader}
        footer={drawerFooter}
        ariaLabel={drawerHeader ? undefined : "Record details"}
      >
        {selected !== null ? (
          <div
            className="aurora-workbench__drawer-body"
            onKeyDown={(event) => {
              if (!onSelectedStep) return;
              if (event.key === "j" || event.key === "ArrowDown") {
                event.preventDefault();
                onSelectedStep(1);
              } else if (event.key === "k" || event.key === "ArrowUp") {
                event.preventDefault();
                onSelectedStep(-1);
              }
            }}
            tabIndex={-1}
          >
            {drawer}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

/* ------------------------------------------------- DrawerHeader helper --- */

export interface WorkbenchDrawerHeaderProps {
  recordId: ReactNode;
  title: ReactNode;
  severity: WorkbenchSeverity;
  status: WorkbenchStatus;
  /** Optional secondary line, e.g. "Business Partner · DE01 · 14m ago". */
  support?: ReactNode;
}

/**
 * Shared drawer header so the Triage drawer, Record Report modal, and
 * Process drill all render the same "record pill + verdict chip" block.
 */
export function WorkbenchDrawerHeader({
  recordId,
  title,
  severity,
  status,
  support,
}: WorkbenchDrawerHeaderProps) {
  return (
    <Stack direction="column" gap={1} className="aurora-workbench__drawer-head">
      <div className="aurora-workbench__drawer-badges">
        <span
          className="aurora-workbench__severity"
          data-severity={severity}
        >
          {SEVERITY_LABEL[severity]}
        </span>
        <span className="aurora-workbench__status" data-status={status}>
          {STATUS_LABEL[status]}
        </span>
        <Text variant="text-micro" tone="tertiary" numeric as="span">
          {recordId}
        </Text>
      </div>
      <Text variant="text-lead">{title}</Text>
      {support ? (
        <Text variant="text-small" tone="tertiary">
          {support}
        </Text>
      ) : null}
    </Stack>
  );
}
