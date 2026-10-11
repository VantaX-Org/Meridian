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
  /** `summary`: a one-sentence line shown in the summary slot in `--m-ink-3` (spec 7.16). */
  emptyProps?: { title: string; detail?: string; action?: ReactNode; ghost?: EmptyStateGhost; summary?: string };
  errorProps?: { message: string; onRetry?: () => void };
  /** A drawer rendered alongside the page, e.g. a row-detail panel. */
  drawer?: ReactNode;
}) {
  let body = table;
  let summarySlot = summary;
  if (state === "loading") {
    // Spec 7.15 / screens.md: header + rows at table row height, staggered in.
    body = (
      <div className="m-motion-stagger flex flex-col gap-1" data-state="loading">
        {Array.from({ length: 7 }, (_, i) => <Skeleton key={i} height={36} />)}
      </div>
    );
  } else if (state === "empty") {
    if (emptyProps?.summary) {
      summarySlot = <p className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink-3)" }}>{emptyProps.summary}</p>;
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
