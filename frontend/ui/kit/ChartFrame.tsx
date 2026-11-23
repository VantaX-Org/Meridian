"use client";

import { useState, type ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { DataTable, type Column } from "./DataTable";

/**
 * The frame every chart sits in: a one-line reading in words, the plot, and a "Show as table" switch that swaps the
 * plot for a table of the same data. `compact` charts (a sparkline in a table cell) skip the chrome.
 */
export function ChartFrame<T>({ label, reading, columns, rows, rowKey, compact, children }: {
  label: string; reading: string; columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; compact?: boolean; children: ReactNode;
}) {
  const [table, setTable] = useState(false);
  if (compact) return <>{children}</>;
  return (
    <figure className="mx-chart" aria-label={`${label}. ${reading}`}>
      <figcaption className="mx-chart-read">
        <span>{reading}</span>
        <button type="button" className="mx-btn" data-variant="ghost" aria-pressed={table} onClick={() => setTable((v) => !v)}>{table ? t("Show as chart") : t("Show as table")}</button>
      </figcaption>
      {table ? <DataTable columns={columns} rows={rows} rowKey={rowKey} label={label} height={160} /> : children}
    </figure>
  );
}
