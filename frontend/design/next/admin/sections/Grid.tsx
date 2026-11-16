"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DataTable, type Column } from "@/design/next/kit";
import { hiddenColumns } from "@/lib/v2/grid-export";

export interface GridColumn<T> {
  id: string;
  header: string;
  /** The row's index in `rows` is the second argument. */
  cell: (row: T, index: number) => ReactNode;
  /** Kept for the export and the column contract; the kit table sizes its own columns. */
  width: number;
  /** Right-aligned tabular figures. */
  numeric?: boolean;
  pin?: boolean;
  locked?: boolean;
  defaultHidden?: boolean;
  title?: string;
  /** Present means sortable. */
  compare?: (a: T, b: T) => number;
}

export interface BulkContext<T> {
  selected: T[];
  clear: () => void;
}

export interface GridProps<T> {
  /** The table id: the column choice is remembered under it (lib/v2/grid-export). */
  id: string;
  ariaLabel: string;
  columns: GridColumn<T>[];
  rows: readonly T[];
  rowId: (row: T, index: number) => string;
  compact?: boolean;
  onOpen?: (row: T) => void;
  /** The open row; the kit table has no highlight for it yet (reported as a kit gap). */
  openRowId?: string | null;
  selectable?: boolean;
  bulkBar?: (ctx: BulkContext<T>) => ReactNode;
  toolbar?: ReactNode;
  emptyFrame?: ReactNode;
  error?: ReactNode;
  loading?: boolean;
  /** The full count when `rows` is a page of it. */
  count?: number;
}

/**
 * Administration's tables: the kit DataTable, with the toolbar above it and the page's own empty and error frames in
 * place of the table when there is nothing to show. Clearing the selection re-keys the table, since the kit table keeps
 * its selection inside.
 */
export function Grid<T>({ id, ariaLabel, columns, rows, rowId, compact, onOpen, selectable, bulkBar, toolbar, emptyFrame, error, loading, count }: GridProps<T>) {
  const [nonce, setNonce] = useState(0);
  const index = useMemo(() => new Map(rows.map((r, i) => [r, i])), [rows]);
  const keyOf = (r: T) => rowId(r, index.get(r) ?? 0);
  const byKey = useMemo(() => new Map(rows.map((r, i) => [rowId(r, i), r])), [rows, rowId]);
  const kitColumns = useMemo<Column<T>[]>(() => {
    const off = typeof window === "undefined" ? new Set(columns.filter((c) => c.defaultHidden).map((c) => c.id)) : hiddenColumns(id, columns);
    return columns.map((c) => ({ id: c.id, label: c.header, cell: (r: T) => c.cell(r, index.get(r) ?? 0), align: c.numeric ? "end" : undefined, hidden: off.has(c.id) && !c.locked, compare: c.compare }));
  }, [columns, id, index]);
  const bar = toolbar ? <div className="nx-adm-acts">{toolbar}</div> : null;
  if (error) return <div data-testid={`grid-${id}`}>{bar}{error}</div>;
  if (!loading && rows.length === 0 && emptyFrame) return <div data-testid={`grid-${id}`}>{bar}{emptyFrame}</div>;
  return (
    <div data-testid={`grid-${id}`}>
      {bar}
      <DataTable<T>
        key={nonce}
        rows={rows as T[]}
        columns={kitColumns}
        rowKey={keyOf}
        rowLabel={keyOf}
        caption={ariaLabel}
        total={count}
        selectable={selectable}
        bulkActions={bulkBar ? (keys) => bulkBar({ selected: keys.map((k) => byKey.get(k)).filter((r): r is T => r !== undefined), clear: () => setNonce((n) => n + 1) }) : undefined}
        onOpenRow={onOpen}
        loading={loading}
        density={compact === false ? "comfortable" : "compact"}
      />
    </div>
  );
}
