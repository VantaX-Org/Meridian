"use client";

import { useState, type ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { DataTable, type Column } from "./DataTable";
import { EmptyState, ErrorState } from "./states";

/** What a chart shows when it has no plot yet: loading (a shape the size of the plot), empty, or a failed request. */
export interface ChartStatus {
  state?: "loading" | "empty" | "error";
  /** One sentence for the empty state. */
  emptyText?: string;
  /** Optional single action under the empty sentence. */
  emptyAction?: ReactNode;
  /** Names the request that failed, for example "Score by run did not load." */
  errorText?: string;
  onRetry?: () => void;
}

/**
 * The frame every chart sits in: a one-line reading in words, the plot, and a "Show as table" switch that swaps the
 * plot for a table of the same data. `compact` charts (a sparkline in a table cell) skip the chrome. With a `state`
 * the frame shows a shaped skeleton, one empty sentence with one action, or the failed request with Retry; on error
 * the last good plot stays on screen under a one-line notice.
 */
export function ChartFrame<T>({ label, reading, columns, rows, rowKey, compact, height = 96, state, emptyText, emptyAction, errorText, onRetry, children }: {
  label: string; reading: string; columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; compact?: boolean; height?: number; children: ReactNode;
} & ChartStatus) {
  const [table, setTable] = useState(false);
  if (state === "loading") {
    return <div className="mx-chart-skel" role="status" aria-label={t("Loading")} style={{ blockSize: height }}><span className="mx-skel" /></div>;
  }
  if (state === "empty") return <EmptyState heading={emptyText ?? t("Nothing to show yet.")} action={emptyAction} />;
  if (state === "error" && rows.length === 0) return <ErrorState heading={errorText ?? t("This did not load.")} retryLabel={t("Retry")} onRetry={onRetry} />;
  const stale = state === "error" ? (
    <div className="mx-chart-stale" role="alert">
      <span>{errorText ?? t("This did not load.")}</span>
      {onRetry ? <button type="button" className="mx-btn" data-variant="ghost" onClick={onRetry}>{t("Retry")}</button> : null}
    </div>
  ) : null;
  if (compact) return <>{children}</>;
  return (
    <figure className="mx-chart" aria-label={`${label}. ${reading}`}>
      {stale}
      <figcaption className="mx-chart-read">
        <span>{reading}</span>
        <button type="button" className="mx-btn" data-variant="ghost" aria-pressed={table} onClick={() => setTable((v) => !v)}>{table ? t("Show as chart") : t("Show as table")}</button>
      </figcaption>
      {table ? <DataTable columns={columns} rows={rows} rowKey={rowKey} label={label} height={160} /> : children}
    </figure>
  );
}
