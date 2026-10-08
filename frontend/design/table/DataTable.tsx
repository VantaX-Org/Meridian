"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Drawer } from "../primitives/Drawer";

export interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Renders the row's detail inside a Drawer. The table never refetches on open — the
   * caller's query for the row's detail (if any) is driven by whatever query key
   * `renderDrawer` reads, independent of the table's own data. */
  renderDrawer?: (row: T) => ReactNode;
  bulkActions?: ReactNode;
}

const VIRTUALIZE_ABOVE = 2000;

export function DataTable<T>({ columns, data, getRowId, onRowClick, renderDrawer }: DataTableProps<T>) {
  "use no memo";
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [openRow, setOpenRow] = useState<T | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  // TanStack Table's hook returns functions React Compiler cannot memoize; this is the single wrapper around it.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
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
    estimateSize: () => 36,
  });

  const visibleRows = useMemo(
    () => (shouldVirtualize ? virtualizer.getVirtualItems().map((v) => rowModel[v.index]) : rowModel),
    [shouldVirtualize, rowModel, virtualizer],
  );

  return (
    <div>
      <input
        placeholder="Filter..."
        value={globalFilter}
        onChange={(e) => setGlobalFilter(e.target.value)}
        className="mb-2 rounded border px-3 py-1.5 text-[13px]"
        style={{ borderColor: "var(--m-line)" }}
      />
      <div ref={parentRef} style={{ maxHeight: 600, overflow: "auto" }}>
        <table className="w-full text-[13px] leading-[18px]">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    onClick={h.column.getToggleSortingHandler()}
                    className="text-left px-2 py-1.5 cursor-pointer select-none border-b"
                    style={{ borderColor: "var(--m-line)", color: "var(--m-ink-2)" }}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {h.column.getIsSorted() === "asc" ? " ↑" : h.column.getIsSorted() === "desc" ? " ↓" : ""}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr
                key={row.id}
                onClick={() => {
                  onRowClick?.(row.original);
                  if (renderDrawer) setOpenRow(row.original);
                }}
                className="cursor-pointer border-b"
                style={{ borderColor: "var(--m-line)" }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-2 py-1.5">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {renderDrawer && (
        <Drawer open={openRow !== null} onOpenChange={(open) => !open && setOpenRow(null)} title="Detail">
          {openRow !== null && renderDrawer(openRow)}
        </Drawer>
      )}
    </div>
  );
}
