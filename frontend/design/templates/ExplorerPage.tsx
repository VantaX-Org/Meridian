"use client";

// frontend/design/templates/ExplorerPage.tsx
import { useState, type ReactNode } from "react";
import { Async, type AsyncEmpty, type AsyncError, type AsyncState } from "../primitives/Async";
import { Skeleton, StatSkeleton } from "../primitives/Skeleton";
import { PageFrame } from "./PageFrame";
import { useLoadingTimeout } from "../hooks/useLoadingTimeout";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { Button } from "../primitives/Button";
import { Drawer } from "../primitives/Drawer";

/** Below this width the filter bar would fill the first screen, so it moves behind one "Filters" button. */
const PHONE = "(max-width: 639px)";

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
  /** Swaps the table region for a skeleton, empty or error state (`Async`); default "ready". */
  state?: AsyncState;
  /** `summary` is still read by the objects page; kept until page tasks drop it. */
  emptyProps?: AsyncEmpty & { summary?: string };
  errorProps?: AsyncError;
  /** A drawer rendered alongside the page, e.g. a row-detail panel. */
  drawer?: ReactNode;
  /** A band under the stats and above the table, e.g. the runs systems strip. */
  strip?: ReactNode;
  /** Right column beside the table: 8/4 at the 5xl container width, stacked below it. */
  aside?: ReactNode;
}) {
  const stuck = useLoadingTimeout(state === "loading");
  const phone = useMediaQuery(PHONE);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // On a phone the filter groups open in a drawer; the table stays the first thing on the screen.
  const filters = filterBar && phone ? (
    <>
      <Button variant="secondary" onClick={() => setFiltersOpen(true)}>Filters</Button>
      <Drawer open={filtersOpen} onOpenChange={setFiltersOpen} title="Filters">{filterBar}</Drawer>
    </>
  ) : filterBar;
  // Toolbar, table header (28) and twelve rows, so loading does not shift the layout.
  const rowH = dense ? "var(--m-row-h-dense)" : "var(--m-row-h)";
  const skeleton = (
    <div className="m-motion-stagger flex flex-col gap-1">
      <div style={{ height: "var(--m-control-h)" }}><Skeleton width={320} height="100%" /></div>
      <div style={{ height: 28 }}><Skeleton height="100%" /></div>
      {Array.from({ length: 12 }, (_, i) => <div key={i} style={{ height: rowH }}><Skeleton height="100%" /></div>)}
    </div>
  );
  const body = (
    <Async
      state={state}
      skeleton={skeleton}
      empty={{ ...emptyProps, title: emptyProps?.title ?? "Nothing to show", ghost: emptyProps?.ghost ?? "table" }}
      error={errorProps ?? { message: "Something went wrong" }}
    >
      {table}
    </Async>
  );
  let summarySlot = summary;
  if (state === "loading" && !stuck) {
    // A page that passes its own summary keeps it (it reserves its own loading geometry); otherwise the stat row (84).
    summarySlot = summary || <div className="m-stat-grid" data-testid="explorer-stat-skeleton">{[0, 1, 2, 3].map((i) => <StatSkeleton key={i} />)}</div>;
  } else if (state === "empty" && emptyProps?.summary) {
    summarySlot = <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>{emptyProps.summary}</p>;
  }

  return (
    <PageFrame gap={4}>
      {header}
      {toolbarEnd ? (
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">{filters}</div>
          {toolbarEnd}
        </div>
      ) : (
        filters
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
