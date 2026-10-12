"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Popover } from "@base-ui/react/popover";
import { Drawer } from "../primitives/Drawer";
import { Button } from "../primitives/Button";
import { Checkbox } from "../primitives/Checkbox";
import { Field } from "../primitives/Field";
import { Input } from "../primitives/Input";
import { usePrefetch } from "../hooks/usePrefetch";
import { BulkBar } from "./BulkBar";
import { Mono } from "../primitives/Mono";
import { Menu } from "../primitives/Menu";
import { exportOptionLabel, runExportOption, type ExportOption } from "../primitives/ExportMenu";
import { deleteView, loadViews, saveView, toCsv, type TableView } from "./views";
import type { CellMeta } from "./columns";
import { canBulkEdit, usePermissionsContext } from "../../lib/permissions";

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
  /** Compact rows (`--m-row-h-dense`). Initial density; the toolbar toggle takes over from there. */
  dense?: boolean;
  /** Key for saved views (per viewer, localStorage). Defaults to the column ids joined, so two tables
   * with the same columns share views; pass an explicit id when that matters. */
  tableId?: string;
  /** Server-side export options (e.g. an endpoint's xlsx). A client-side CSV of the filtered rows
   * and visible columns is always offered unless one of these is already a csv. */
  exportOptions?: ExportOption[];
  /** File name (without extension) for the client-side CSV. */
  exportName?: string;
  /** Title of the row drawer. Defaults to "Detail" for call sites that have not named it yet. */
  drawerTitle?: ReactNode;
  /** Route to warm (router.prefetch) when a row is hovered or focused. */
  rowHref?: (row: T) => string | undefined;
  /** Hide the views / columns / density / export toolbar. */
  hideToolbar?: boolean;
}

const ROW_H = 44;
const ROW_H_DENSE = 36;
const VIRTUALIZE_ABOVE = 200;
const SELECT_COLUMN_ID = "__select";

function PrefetchRow({ href, children, ...rest }: { href?: string } & React.ComponentProps<"tr">) {
  const prefetch = usePrefetch(href);
  return <tr {...rest} {...(href ? prefetch : {})}>{children}</tr>;
}

export function DataTable<T>({
  columns, data, getRowId, onRowClick, renderDrawer, bulkActions: bulkActionsProp, height = "calc(100vh - 240px)",
  sorting: sortingProp, onSortingChange: onSortingChangeProp, dense: denseProp = false,
  tableId, exportOptions = [], exportName = "export", hideToolbar = false, drawerTitle, rowHref,
}: DataTableProps<T>) {
  "use no memo";
  // Ruling 4: no BulkBar (or selection column) for users who can change nothing, e.g. viewer and auditor.
  // Outside a PermissionsProvider (component tests) the table is ungated.
  const perms = usePermissionsContext();
  const bulkActions = perms && !canBulkEdit(perms.can) ? undefined : bulkActionsProp;
  const [internalSorting, setInternalSorting] = useState<SortingState>([]);
  const sorting = sortingProp ?? internalSorting;
  const setSorting = onSortingChangeProp
    ? (updater: SortingState | ((old: SortingState) => SortingState)) =>
        onSortingChangeProp(typeof updater === "function" ? updater(sorting) : updater)
    : setInternalSorting;
  const [dense, setDense] = useState(denseProp);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const viewsKey = tableId ?? columns.map((c, i) => c.id ?? ("accessorKey" in c ? String(c.accessorKey) : String(i))).join("|");
  const [views, setViews] = useState<TableView[]>([]);
  const [viewName, setViewName] = useState("");
  // localStorage is client-only, so views load after mount rather than during render.
  useEffect(() => setViews(loadViews(viewsKey)), [viewsKey]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [openRow, setOpenRow] = useState<T | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const uid = useId();
  const parentRef = useRef<HTMLDivElement>(null);

  const selectColumn: ColumnDef<T> = {
    id: SELECT_COLUMN_ID,
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all rows"
        checked={table.getIsAllRowsSelected()}
        onChange={table.getToggleAllRowsSelectedHandler()}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
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
    state: { sorting, globalFilter, rowSelection, columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
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
    estimateSize: () => (dense ? ROW_H_DENSE : ROW_H),
  });

  const virtualItems = shouldVirtualize ? virtualizer.getVirtualItems() : null;
  const visibleRows = virtualItems ? virtualItems.map((v) => rowModel[v.index]) : rowModel;
  const firstTextColumnId = table.getAllLeafColumns().find((c) => c.id !== SELECT_COLUMN_ID && !(c.columnDef.meta as CellMeta | undefined)?.numeric)?.id;
  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);

  const dataColumns = table.getAllLeafColumns().filter((c) => c.id !== SELECT_COLUMN_ID);
  const colLabel = (c: (typeof dataColumns)[number]) => (typeof c.columnDef.header === "string" ? c.columnDef.header : c.id);
  const exportCsv = async () => {
    const cols = dataColumns.filter((c) => c.getIsVisible());
    const body = table.getFilteredRowModel().rows.map((r) => cols.map((c) => String(r.getValue(c.id) ?? "")));
    const blob = new Blob([toCsv(cols.map(colLabel), body)], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportName}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };
  const allExport: ExportOption[] = exportOptions.some((o) => o.format === "csv")
    ? exportOptions
    : [{ format: "csv", run: exportCsv }, ...exportOptions];
  const applyView = (v: TableView) => {
    setColumnVisibility(v.visibility);
    setDense(v.dense);
    setSorting(v.sorting);
  };

  const rowDomId = (i: number) => `${uid}-row-${rowModel[i]?.id}`;
  const openAt = (i: number) => {
    const row = rowModel[i];
    if (!row || !(onRowClick || renderDrawer)) return;
    onRowClick?.(row.original);
    if (renderDrawer) setOpenRow(row.original);
  };
  const moveTo = (i: number) => {
    const next = Math.max(0, Math.min(rowModel.length - 1, i));
    setActiveIndex(next);
    if (shouldVirtualize) virtualizer.scrollToIndex(next);
  };
  const onGridKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    if (e.target !== e.currentTarget) return;
    const last = rowModel.length - 1;
    if (e.key === "Escape") {
      table.resetRowSelection();
      setOpenRow(null);
      return;
    }
    if (last < 0) return;
    const cur = Math.min(activeIndex, last);
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); moveTo(cur < 0 ? 0 : cur + 1); break;
      case "ArrowUp": e.preventDefault(); moveTo(cur < 0 ? 0 : cur - 1); break;
      case "Home": e.preventDefault(); moveTo(0); break;
      case "End": e.preventDefault(); moveTo(last); break;
      case "Enter": if (cur >= 0) { e.preventDefault(); openAt(cur); } break;
      case " ": if (cur >= 0 && bulkActions) { e.preventDefault(); rowModel[cur].toggleSelected(); } break;
      case "x": if (cur >= 0 && bulkActions) { e.preventDefault(); rowModel[cur].toggleSelected(); } break;
    }
  };

  return (
    <div>
      {!hideToolbar && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]" role="toolbar" aria-label="Table options">
          <Menu
            trigger={<button type="button" className="m-btn m-btn-secondary m-btn-sm">Columns</button>}
            items={dataColumns.map((c) => ({ label: colLabel(c), checked: c.getIsVisible(), onSelect: () => c.toggleVisibility() }))}
          />
          <Popover.Root>
            <Popover.Trigger className="m-btn m-btn-secondary m-btn-sm">Views{views.length > 0 ? ` (${views.length})` : ""}</Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner sideOffset={4}>
                <Popover.Popup className="m-popup min-w-56 p-2">
                  {views.length === 0 && <p className="py-1" style={{ color: "var(--m-ink-3)" }}>No saved views yet.</p>}
                  {views.map((v) => (
                    <div key={v.name} className="flex items-center justify-between gap-2 py-1">
                      <button type="button" onClick={() => applyView(v)} className="text-left">{v.name}</button>
                      <button type="button" aria-label={`Delete view ${v.name}`} onClick={() => setViews(deleteView(viewsKey, v.name))}>Remove</button>
                    </div>
                  ))}
                  <form
                    className="mt-1 flex items-end gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const name = viewName.trim();
                      if (!name) return;
                      setViews(saveView(viewsKey, { name, visibility: columnVisibility, dense, sorting }));
                      setViewName("");
                    }}
                  >
                    <Field label="View name">
                      <Input placeholder="Name this view" value={viewName} onChange={(e) => setViewName(e.target.value)} />
                    </Field>
                    <Button type="submit" variant="secondary" size="sm">Save view</Button>
                  </form>
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
          <button type="button" className="m-btn m-btn-secondary m-btn-sm" aria-pressed={dense} onClick={() => setDense((d) => !d)}>
            {dense ? "Comfortable rows" : "Compact rows"}
          </button>
          {(!perms || perms.can("export")) && (
            <Menu
              trigger={<button type="button" className="m-btn m-btn-secondary m-btn-sm">Export table</button>}
              items={allExport.map((o) => ({ label: exportOptionLabel(o), onSelect: () => void runExportOption(o) }))}
            />
          )}
        </div>
      )}
      <div className="mb-2" style={{ maxWidth: 320 }}>
        <Field label="Filter rows">
          <Input placeholder="Type to filter rows" value={globalFilter} onChange={(e) => setGlobalFilter(e.target.value)} />
        </Field>
      </div>
      <div className="m-card" style={{ padding: 0, overflow: "hidden" }}>
      <div ref={parentRef} style={{ height, overflow: "auto" }}>
        <table
          className="w-full text-[13px] leading-[18px]"
          style={{ color: "var(--m-ink)" }}
          role="grid"
          tabIndex={0}
          aria-label="Data table"
          aria-activedescendant={activeIndex >= 0 && activeIndex < rowModel.length ? rowDomId(activeIndex) : undefined}
          onKeyDown={onGridKeyDown}
        >
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
                        height: dense ? ROW_H_DENSE : ROW_H, background: "var(--m-sheet-raised)", borderColor: "var(--m-line-strong)",
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
            {rowModel.length === 0 && globalFilter && (
              <tr>
                <td colSpan={Math.max(1, table.getVisibleLeafColumns().length)} className="px-2 py-6 text-center" style={{ color: "var(--m-ink-3)" }}>
                  <span className="mr-2">No rows match this filter</span>
                  <Button variant="ghost" size="sm" onClick={() => setGlobalFilter("")}>Clear filter</Button>
                </td>
              </tr>
            )}
            {visibleRows.map((row, i) => {
              const virtualRow = virtualItems?.[i];
              const index = virtualRow ? virtualRow.index : i;
              const activate = onRowClick || renderDrawer
                ? () => {
                    setActiveIndex(index);
                    onRowClick?.(row.original);
                    if (renderDrawer) setOpenRow(row.original);
                  }
                : undefined;
              return (
                <PrefetchRow
                  key={row.id}
                  id={rowDomId(index)}
                  href={rowHref?.(row.original)}
                  className={`group border-b m-motion-colors ${row.getIsSelected() ? "bg-[var(--m-accent-soft)]" : "hover:bg-[var(--m-sheet-raised)]"} ${index === activeIndex ? "m-row-active" : ""}`}
                  onClick={activate}
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
                </PrefetchRow>
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
        <Drawer open={openRow !== null} onOpenChange={(open) => !open && setOpenRow(null)} title={drawerTitle ?? "Detail"}>
          {openRow !== null && renderDrawer(openRow)}
        </Drawer>
      )}
    </div>
  );
}
