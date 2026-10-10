// frontend/design/templates/ExplorerPage.tsx
import type { ReactNode } from "react";
import { EmptyState, type EmptyStateGhost } from "../primitives/EmptyState";
import { ErrorState } from "../primitives/ErrorState";
import { Skeleton } from "../primitives/Skeleton";

export function ExplorerPage({
  filterBar,
  toolbarEnd,
  summary,
  table,
  state,
  emptyProps,
  errorProps,
  drawer,
}: {
  filterBar?: ReactNode;
  /** Right-aligned content in the filter bar row (or its own row with no filterBar), e.g. an ExportMenu. */
  toolbarEnd?: ReactNode;
  summary?: ReactNode;
  table: ReactNode;
  /** Swaps the table region for a skeleton, empty or error state. */
  state?: "loading" | "empty" | "error";
  emptyProps?: { title: string; detail?: string; action?: ReactNode; ghost?: EmptyStateGhost };
  errorProps?: { message: string; onRetry?: () => void };
  /** A drawer rendered alongside the page, e.g. a row-detail panel. */
  drawer?: ReactNode;
}) {
  let body = table;
  if (state === "loading") {
    body = (
      <div className="flex flex-col gap-2">
        <Skeleton height={32} />
        <Skeleton height={32} />
        <Skeleton height={32} />
      </div>
    );
  } else if (state === "empty") {
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
    <div className="flex flex-col gap-4 p-6">
      {toolbarEnd ? (
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">{filterBar}</div>
          {toolbarEnd}
        </div>
      ) : (
        filterBar
      )}
      {summary}
      {body}
      {drawer}
    </div>
  );
}
