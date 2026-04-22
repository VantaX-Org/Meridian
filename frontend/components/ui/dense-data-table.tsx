"use client";

import { useRef } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ChevronsUpDown, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export type DenseColumnDef<T> = ColumnDef<T, unknown>;

export interface DenseDataTableProps<T> {
  data: ReadonlyArray<T>;
  columns: ReadonlyArray<DenseColumnDef<T>>;
  /** Callback when a row is clicked. Omit to make rows non-interactive. */
  onRowClick?: (row: T) => void;
  /** Controlled sort state. Leave undefined for uncontrolled sort. */
  sorting?: SortingState;
  onSortingChange?: (next: SortingState) => void;
  /** Turn on virtualization when `data.length >= threshold`. Defaults to 500. */
  virtualizeThreshold?: number;
  /** Row height in pixels — must be stable across all rows. Defaults to 40. */
  rowHeight?: number;
  /** Visible body height when virtualized. Defaults to 520. */
  maxHeight?: number;
  /** Skeleton rows while loading. */
  loading?: boolean;
  loadingRows?: number;
  /** Empty-state message. */
  emptyLabel?: string;
  /** Optional getter so keyboard nav can resolve a stable row ID. */
  getRowId?: (row: T, index: number) => string;
  className?: string;
}

/**
 * Dense, keyboard-navigable data table.
 *
 * - Sticky header, zebra rows, tabular-nums by default.
 * - Sortable columns via TanStack Table.
 * - Automatically virtualizes the body when `data.length >= virtualizeThreshold`.
 * - When `onRowClick` is provided, rows become keyboard-focusable and respond
 *   to `Enter` / `Space`.
 *
 * Strict TS — no `any`. Wide data shapes should define their own
 * `DenseColumnDef<T>` in the page module and hand them to this component.
 */
export function DenseDataTable<T>({
  data,
  columns,
  onRowClick,
  sorting,
  onSortingChange,
  virtualizeThreshold = 500,
  rowHeight = 40,
  maxHeight = 520,
  loading = false,
  loadingRows = 10,
  emptyLabel = "No data",
  getRowId,
  className,
}: DenseDataTableProps<T>) {
  const mutableColumns = columns as ColumnDef<T, unknown>[];
  const mutableData = data as T[];

  const table = useReactTable<T>({
    data: mutableData,
    columns: mutableColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: sorting ? { sorting } : undefined,
    onSortingChange: onSortingChange
      ? (updater) => {
          const next =
            typeof updater === "function" ? updater(sorting ?? []) : updater;
          onSortingChange(next);
        }
      : undefined,
    getRowId: getRowId ? (row, index) => getRowId(row, index) : undefined,
  });

  const rows = table.getRowModel().rows;
  const shouldVirtualize = rows.length >= virtualizeThreshold;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
    enabled: shouldVirtualize,
  });
  const virtualRows = virtualizer.getVirtualItems();

  const handleRowActivate = (row: T) => {
    onRowClick?.(row);
  };

  return (
    <div
      ref={scrollRef}
      className={cn(
        "relative overflow-auto rounded-xl border border-black/[0.06] bg-white/[0.60]",
        className,
      )}
      style={shouldVirtualize ? { maxHeight } : undefined}
      role="region"
      aria-label="Data table"
    >
      <table className="w-full border-collapse text-xs tabular-nums">
        <thead className="sticky top-0 z-10 border-b border-black/[0.08] bg-white/[0.92] backdrop-blur">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const isSortable = header.column.getCanSort();
                const sortDir = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    scope="col"
                    style={{
                      width: header.getSize() !== 150 ? header.getSize() : undefined,
                    }}
                    className="h-9 whitespace-nowrap px-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {header.isPlaceholder ? null : (
                      <button
                        type="button"
                        onClick={
                          isSortable ? header.column.getToggleSortingHandler() : undefined
                        }
                        className={cn(
                          "inline-flex items-center gap-1 text-left",
                          isSortable && "hover:text-foreground focus-visible:text-foreground focus-visible:outline-none",
                        )}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {isSortable ? (
                          sortDir === "asc" ? (
                            <ArrowUp className="h-3 w-3" aria-hidden />
                          ) : sortDir === "desc" ? (
                            <ArrowDown className="h-3 w-3" aria-hidden />
                          ) : (
                            <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden />
                          )
                        ) : null}
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>

        {loading ? (
          <tbody>
            {Array.from({ length: loadingRows }).map((_, i) => (
              <tr key={i} className="border-b border-black/[0.04]">
                {mutableColumns.map((_c, j) => (
                  <td key={j} className="px-2.5 py-1.5">
                    <Skeleton className="h-4 w-full" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ) : rows.length === 0 ? (
          <tbody>
            <tr>
              <td
                colSpan={mutableColumns.length}
                className="px-4 py-10 text-center text-xs text-muted-foreground"
              >
                <Inbox className="mx-auto mb-2 h-5 w-5" aria-hidden />
                {emptyLabel}
              </td>
            </tr>
          </tbody>
        ) : shouldVirtualize ? (
          <tbody style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualRows.map((virt) => {
              const row = rows[virt.index];
              return (
                <VirtualRow
                  key={row.id}
                  row={row}
                  top={virt.start}
                  rowHeight={rowHeight}
                  clickable={Boolean(onRowClick)}
                  onActivate={handleRowActivate}
                />
              );
            })}
          </tbody>
        ) : (
          <tbody>
            {rows.map((row) => (
              <StaticRow
                key={row.id}
                row={row}
                clickable={Boolean(onRowClick)}
                onActivate={handleRowActivate}
              />
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
}

function StaticRow<T>({
  row,
  clickable,
  onActivate,
}: {
  row: Row<T>;
  clickable: boolean;
  onActivate: (row: T) => void;
}) {
  return (
    <tr
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={() => clickable && onActivate(row.original)}
      onKeyDown={(e) => {
        if (!clickable) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate(row.original);
        }
      }}
      className={cn(
        "border-b border-black/[0.04] transition-colors",
        clickable &&
          "cursor-pointer hover:bg-primary/[0.04] focus-visible:bg-primary/[0.06] focus-visible:outline-none",
      )}
    >
      {row.getVisibleCells().map((cell) => (
        <td key={cell.id} className="whitespace-nowrap px-2.5 py-1.5 text-foreground">
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );
}

function VirtualRow<T>({
  row,
  top,
  rowHeight,
  clickable,
  onActivate,
}: {
  row: Row<T>;
  top: number;
  rowHeight: number;
  clickable: boolean;
  onActivate: (row: T) => void;
}) {
  return (
    <tr
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={() => clickable && onActivate(row.original)}
      onKeyDown={(e) => {
        if (!clickable) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate(row.original);
        }
      }}
      style={{
        position: "absolute",
        top,
        left: 0,
        width: "100%",
        height: rowHeight,
        display: "table",
        tableLayout: "fixed",
      }}
      className={cn(
        "border-b border-black/[0.04] transition-colors",
        clickable &&
          "cursor-pointer hover:bg-primary/[0.04] focus-visible:bg-primary/[0.06] focus-visible:outline-none",
      )}
    >
      {row.getVisibleCells().map((cell) => (
        <td key={cell.id} className="whitespace-nowrap px-2.5 py-1.5 text-foreground">
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );
}
