"use client";

// frontend/design/templates/ExplorerPage.tsx
import type { ReactNode } from "react";
import { EmptyState, type EmptyStateGhost } from "../primitives/EmptyState";
import { ErrorState } from "../primitives/ErrorState";
import { Skeleton, StatSkeleton } from "../primitives/Skeleton";
import { PageFrame } from "./PageFrame";
import { useLoadingTimeout } from "../hooks/useLoadingTimeout";

const SLOW = "This is taking longer than expected.";

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
  strip,
  aside,
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
  /** A band under the stats and above the table, e.g. the runs systems strip. */
  strip?: ReactNode;
  /** Right column beside the table: 8/4 at the 5xl container width, stacked below it. */
  aside?: ReactNode;
}) {
  const stuck = useLoadingTimeout(state === "loading");
  let body = table;
  let summarySlot = summary;
  if (state === "loading" && stuck) {
    // A skeleton that never resolves gives way to an error with Retry.
    body = <ErrorState title={SLOW} message="The server has not answered. Retry, or check the job tray." onRetry={errorProps?.onRetry ?? (() => window.location.reload())} />;
  } else if (state === "loading") {
    // Stat row (84), toolbar, table header (28) and twelve rows (30), so loading does not shift the layout.
    const rowH = dense ? "var(--m-row-h-dense)" : "var(--m-row-h)";
    body = (
      <div className="m-motion-stagger flex flex-col gap-1" data-state="loading">
        <div style={{ height: "var(--m-control-h)" }}><Skeleton width={320} height="100%" /></div>
        <div style={{ height: 28 }}><Skeleton height="100%" /></div>
        {Array.from({ length: 12 }, (_, i) => <div key={i} style={{ height: rowH }}><Skeleton height="100%" /></div>)}
      </div>
    );
    // A page that passes its own summary keeps it (it reserves its own loading geometry).
    summarySlot = summary || <div className="m-stat-grid" data-testid="explorer-stat-skeleton">{[0, 1, 2, 3].map((i) => <StatSkeleton key={i} />)}</div>;
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
    <PageFrame gap={4}>
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
      {strip}
      {aside ? (
        <div className="grid gap-4 @5xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0">{body}</div>
          <div className="min-w-0">{aside}</div>
        </div>
      ) : body}
      {drawer}
    </PageFrame>
  );
}
