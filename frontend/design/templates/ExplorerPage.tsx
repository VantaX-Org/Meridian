// frontend/design/templates/ExplorerPage.tsx
import type { ReactNode } from "react";
import { EmptyState, type EmptyStateGhost } from "../primitives/EmptyState";
import { ErrorState } from "../primitives/ErrorState";
import { Skeleton } from "../primitives/Skeleton";

export function ExplorerPage({
  header,
  filterBar,
  toolbarEnd,
  summary,
  table,
  state,
  emptyProps,
  errorProps,
  drawer,
  dense = true,
}: {
  /** Row density of the table this page renders; sizes the loading skeleton. Matches DataTable's default. */
  dense?: boolean;
  /** Page header slot, rendered above the filter bar (usually a `PageHeader`). */
  header?: ReactNode;
  filterBar?: ReactNode;
  /** Right-aligned content in the filter bar row (or its own row with no filterBar), e.g. an ExportMenu. */
  toolbarEnd?: ReactNode;
  summary?: ReactNode;
  table: ReactNode;
  /** Swaps the table region for a skeleton, empty or error state. */
  state?: "loading" | "empty" | "error";
  /** `summary` is still read by the objects page; kept until page tasks drop it. */
  emptyProps?: { title: string; detail?: string; action?: ReactNode; ghost?: EmptyStateGhost; summary?: string };
  errorProps?: { message: string; onRetry?: () => void };
  /** A drawer rendered alongside the page, e.g. a row-detail panel. */
  drawer?: ReactNode;
}) {
  let body = table;
  let summarySlot = summary;
  if (state === "loading") {
    // Toolbar, header and seven rows at the table's real heights, so loading does not shift the layout.
    const rowH = dense ? "var(--m-row-h-dense)" : "var(--m-row-h)";
    body = (
      <div className="m-motion-stagger flex flex-col gap-1" data-state="loading">
        <div style={{ height: "var(--m-control-h)" }}><Skeleton width={320} height="100%" /></div>
        <div style={{ height: rowH }}><Skeleton height="100%" /></div>
        {Array.from({ length: 7 }, (_, i) => <div key={i} style={{ height: rowH }}><Skeleton height="100%" /></div>)}
      </div>
    );
  } else if (state === "empty") {
    if (emptyProps?.summary) {
      summarySlot = <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>{emptyProps.summary}</p>;
    }
    body = (
      <EmptyState
        title={emptyProps?.title ?? "Nothing to show"}
        detail={emptyProps?.detail}
        action={emptyProps?.action}
        ghost={emptyProps?.ghost ?? "table"}
      />
    );
  } else if (state === "error") {
    body = <ErrorState message={errorProps?.message ?? "Something went wrong"} onRetry={errorProps?.onRetry} />;
  }

  return (
    <div className="mx-auto flex w-full flex-col gap-4" style={{ padding: "var(--m-page-pad)", maxWidth: "var(--m-page-max)" }}>
      {header}
      {toolbarEnd ? (
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">{filterBar}</div>
          {toolbarEnd}
        </div>
      ) : (
        filterBar
      )}
      {summarySlot}
      {body}
      {drawer}
    </div>
  );
}
