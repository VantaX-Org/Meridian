"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Drawer } from "../primitives/Drawer";
import { BulkBar } from "./BulkBar";
import { Mono } from "../primitives/Mono";
import type { CellMeta } from "./columns";

export interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Renders the row's detail inside a Drawer. The table never refetches on open — the
   * caller's query for the row's detail (if any) is driven by whatever query key
   * `renderDrawer` reads, independent of the table's own data. */
  renderDrawer?: (row: T) => ReactNode;
  /** Rendered in a BulkBar above the table once at least one row is selected. */
  bulkActions?: (selected: T[]) => ReactNode;
  /** Scroll parent height; the virtualised branch needs a bounded container to scroll in. */
  height?: number | string;
  /** Controlled sort state, for a caller that keeps the sort in the URL (e.g. `?sort=created_at:desc`).
   * Omit both to keep the table's own uncontrolled sort state. */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  /** Compact rows (`--m-row-h-dense`). */
  dense?: boolean;
}

const ROW_H = "var(--m-row-h)";
const ROW_H_DENSE = "var(--m-row-h-dense)";
const VIRTUALIZE_ABOVE = 2000;
const SELECT_COLUMN_ID = "__select";

export function DataTable<T>({
  columns, data, getRowId, onRowClick, renderDrawer, bulkActions, height = "calc(100vh - 240px)",
  sorting: sortingProp, onSortingChange: onSortingChangeProp, dense = false,
}: DataTableProps<T>) {
  "use no memo";
  const [internalSorting, setInternalSorting] = useState<SortingState>([]);
  const sorting = sortingProp ?? internalSorting;
  const setSorting = onSortingChangeProp
    ? (updater: SortingState | ((old: SortingState) => SortingState)) =>
        onSortingChangeProp(typeof updater === "function" ? updater(sorting) : updater)
    : setInternalSorting;
  const [globalFilter, setGlobalFilter] = useState("");
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [openRow, setOpenRow] = useState<T | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const selectColumn: ColumnDef<T> = {
    id: SELECT_COLUMN_ID,
    header: ({ table }) => (
      <input
        type="checkbox"
        aria-label="Select all rows"
        checked={table.getIsAllRowsSelected()}
        onChange={table.getToggleAllRowsSelectedHandler()}
      />
    ),
    cell: ({ row }) => (
      <input
        type="checkbox"
        aria-label={`Select row ${row.id}`}
        checked={row.getIsSelected()}
        onChange={row.getToggleSelectedHandler()}
        onClick={(e) => e.stopPropagation()}
      />
    ),
    enableSorting: false,
  };

  const allColumns = bulkActions ? [selectColumn, ...columns] : columns;

  // TanStack Table's hook returns functions React Compiler cannot memoize; this is the single wrapper around it.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns: allColumns,
    state: { sorting, globalFilter, rowSelection },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: !!bulkActions,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: (row) => getRowId(row),
  });

  const rowModel = table.getRowModel().rows;
  const shouldVirtualize = rowModel.length > VIRTUALIZE_ABOVE;
  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? rowModel.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (dense ? 30 : 36),
  });

  const virtualItems = shouldVirtualize ? virtualizer.getVirtualItems() : null;
  const visibleRows = virtualItems ? virtualItems.map((v) => rowModel[v.index]) : rowModel;
  const firstTextColumnId = table.getAllLeafColumns().find((c) => c.id !== SELECT_COLUMN_ID && !(c.columnDef.meta as CellMeta | undefined)?.numeric)?.id;
  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);

  return (
    <div>
      <label>
        <span className="sr-only">Filter rows</span>
        <input
          aria-label="Filter rows"
          placeholder="Type to filter rows"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="mb-2 rounded border px-3 py-1.5 text-[13px]"
          style={{ borderColor: "var(--m-line)" }}
        />
      </label>
      <div className="m-card" style={{ padding: 0, overflow: "hidden" }}>
      <div ref={parentRef} style={{ height, overflow: "auto" }}>
        <table className="w-full text-[13px] leading-[18px]" style={{ color: "var(--m-ink)" }}>
          <thead className="sticky top-0 z-[1]">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sortable = h.column.getCanSort();
                  const sorted = h.column.getIsSorted();
                  return (
                    <th
                      key={h.id}
                      aria-sort={sortable ? (sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none") : undefined}
                      className={`px-2 text-[11px] leading-[14px] font-medium border-b ${(h.column.columnDef.meta as CellMeta | undefined)?.numeric ? "text-right" : "text-left"}`}
                      style={{
                        height: 36, background: "var(--m-sheet-raised)", borderColor: "var(--m-line-strong)",
                        color: sorted ? "var(--m-ink)" : "var(--m-ink-3)",
                      }}
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          className="flex items-center gap-1 select-none"
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sorted === "asc" ? <ArrowUp size={12} aria-hidden /> : sorted === "desc" ? <ArrowDown size={12} aria-hidden /> : null}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody style={shouldVirtualize ? { position: "relative", height: virtualizer.getTotalSize() } : undefined}>
            {visibleRows.map((row, i) => {
              const virtualRow = virtualItems?.[i];
              const activate = onRowClick || renderDrawer
                ? () => {
                    onRowClick?.(row.original);
                    if (renderDrawer) setOpenRow(row.original);
                  }
                : undefined;
              return (
                <tr
                  key={row.id}
                  className={`group border-b m-motion-colors ${row.getIsSelected() ? "bg-[var(--m-accent-soft)]" : "hover:bg-[var(--m-sheet-raised)]"}`}
                  aria-selected={bulkActions ? row.getIsSelected() : undefined}
                  tabIndex={activate ? 0 : undefined}
                  onClick={activate}
                  onKeyDown={
                    activate
                      ? (e) => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            activate();
                          }
                        }
                      : undefined
                  }
                  style={{
                    borderColor: "var(--m-line)",
                    height: dense ? ROW_H_DENSE : ROW_H,
                    cursor: activate ? "pointer" : undefined,
                    ...(virtualRow
                      ? { position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${virtualRow.start}px)` }
                      : {}),
                  }}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta as CellMeta | undefined;
                    const content = flexRender(cell.column.columnDef.cell, cell.getContext());
                    const firstText = onRowClick && cell.column.id === firstTextColumnId;
                    return (
                      <td
                        key={cell.id}
                        className={`px-2 ${meta?.numeric ? "text-right m-numeric" : ""} ${firstText ? "m-motion-colors group-hover:text-[var(--m-accent)]" : ""}`}
                      >
                        {meta?.mono ? <Mono>{content}</Mono> : content}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>
      {bulkActions && selectedRows.length > 0 && (
        <BulkBar count={selectedRows.length} actions={bulkActions(selectedRows)} />
      )}
      {renderDrawer && (
        <Drawer open={openRow !== null} onOpenChange={(open) => !open && setOpenRow(null)} title="Detail">
          {openRow !== null && renderDrawer(openRow)}
        </Drawer>
      )}
    </div>
  );
}
