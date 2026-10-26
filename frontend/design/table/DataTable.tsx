"use client";

import { Fragment, useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import {
  type ColumnDef,
  type Row,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { QueryKey } from "@tanstack/react-query";
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
export type { TableView } from "./views";
import { barFill, columnLayoutClass, type CellMeta } from "./columns";
import { rampStep } from "../tokens";
import { readPrefs, subscribePreferences } from "../../lib/preferences";

const SEVERITIES = ["critical", "high", "medium", "low", "pass"] as const;
const DIV_STEPS = ["neg-2", "neg-1", "mid", "pos-1", "pos-2"] as const;

/** Heat class for a numeric value, or undefined when the value is not a finite number. */
export function heatClass(mode: "seq" | "div", value: unknown, range: readonly [number, number]): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const step = rampStep(value, range[0], range[1]);
  return mode === "seq" ? `m-heat-seq-${step}` : `m-heat-div-${DIV_STEPS[step - 1]}`;
}
import { canBulkEdit, usePermissionsContext } from "../../lib/permissions";
import { IconArrowDown, IconArrowUp, IconChevronRight } from "../icons";

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
  /** Upper bound of the scroll box; a short table shrinks to its rows. "auto" means unbounded. */
  maxHeight?: number | string;
  /** Alias of `maxHeight`, kept for existing call sites. */
  height?: number | string;
  /** Hides the built-in "Filter rows" search, for pages that bring their own. */
  hideSearch?: boolean;
  /** Adds a leading chevron cell; the returned node renders in a full-width panel under the row. */
  renderExpanded?: (row: T) => ReactNode;
  /** With `renderExpanded`: only rows this accepts get the chevron (and a panel); the others keep an empty cell. */
  canExpand?: (row: T) => boolean;
  /** Message and action for the single empty body row (header stays). */
  emptyMessage?: ReactNode;
  emptyAction?: ReactNode;
  /** Controlled sort state, for a caller that keeps the sort in the URL (e.g. `?sort=created_at:desc`).
   * Omit both to keep the table's own uncontrolled sort state. */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  /** Compact rows (`--m-row-h-dense`). Off by default: rows are `--m-row-h`, which the user's density preference
   * (`<html data-density>`) retunes. Initial density only; the toolbar toggle takes over from there. */
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
  /** Warms a row's route and first query on hover or focus (the page's query prefetch hook). Supersedes `rowHref` when both are given. */
  rowPrefetch?: (row: T) => RowPrefetch | undefined;
  /** Hide the views / columns / density / export toolbar. */
  hideToolbar?: boolean;
  /** `data-tour` value on the table card, so a guided tour can spotlight it (lib/help/tours.ts). */
  dataTour?: string;
  /** Accessible name of the grid, e.g. "Rules". Defaults to "Data table". */
  label?: string;
  /** Names a row for its selection checkbox ("Select <name>"). Defaults to the row's first text cell, then its id. */
  rowLabel?: (row: T) => string;
  /** The caller orders `data` itself (e.g. by the server or its own keyboard order): headers still show and set `sorting`. */
  manualSorting?: boolean;
  /** Controlled row selection (row ids), for a caller that clears it after a bulk action. */
  selection?: RowSelectionState;
  onSelectionChange?: (selection: RowSelectionState) => void;
  /** Controlled active row: highlighted and kept in view; arrow keys report the next one through `onActiveRowChange`. */
  activeRowId?: string | null;
  onActiveRowChange?: (row: T) => void;
  /** Called when the rows are scrolled (or arrowed) near their end, to load the next page. */
  onEndReached?: () => void;
  /** `data-testid` on each body row. */
  rowTestId?: string;
  /** Shipped views offered before the viewer's own; they cannot be removed. */
  presetViews?: TableView[];
  /** The page's filters, saved with a view; a page that passes them applies a view's `params` in `onApplyView`. */
  viewParams?: Record<string, string>;
  onApplyView?: (view: TableView) => void;
  /** Hides the toolbar's export menu, for a page that offers its exports beside the table. */
  hideExport?: boolean;
}

export interface RowPrefetch {
  href?: string;
  queryKey?: QueryKey;
  queryFn?: () => Promise<unknown>;
}

// Fallbacks when the --m-row-h tokens cannot be read (tests, SSR); tokens.css owns the real values.
const ROW_H_FALLBACK = 40;
const ROW_H_DENSE_FALLBACK = 32;
const VIRTUALIZE_ABOVE = 200;

/** True while the page is being printed: paper needs every row, not the virtualised window. */
function subscribePrint(cb: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const mq = window.matchMedia("print");
  mq.addEventListener?.("change", cb);
  return () => mq.removeEventListener?.("change", cb);
}
function printSnapshot(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("print").matches;
}
function usePrintMedia(): boolean {
  return useSyncExternalStore(subscribePrint, printSnapshot, () => false);
}

function readPx(name: string, fallback: number): number {
  if (typeof document === "undefined") return fallback;
  const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
const SELECT_COLUMN_ID = "__select";
/** `m-td`: below 640px an identifier in a cell (rule ID, record key) keeps one line and truncates instead of breaking at its hyphens (globals.css). */
const MONO_NARROW = "m-td";
const EXPAND_COLUMN_ID = "__expand";

function PrefetchRow({ prefetchInfo, children, ...rest }: { prefetchInfo?: RowPrefetch } & React.ComponentProps<"tr">) {
  const prefetch = usePrefetch(prefetchInfo?.href, prefetchInfo?.queryKey, prefetchInfo?.queryFn);
  return <tr {...rest} {...(prefetchInfo ? prefetch : {})}>{children}</tr>;
}

export function DataTable<T>({
  columns, data, getRowId, onRowClick, renderDrawer, bulkActions: bulkActionsProp, maxHeight: maxHeightProp, height: heightProp, hideSearch = false, renderExpanded, canExpand, emptyMessage, emptyAction,
  sorting: sortingProp, onSortingChange: onSortingChangeProp, dense: denseProp = false,
  tableId, exportOptions = [], exportName = "export", hideToolbar = false, drawerTitle, rowHref, rowPrefetch, dataTour,
  label = "Data table", rowLabel, manualSorting = false, selection: selectionProp, onSelectionChange, activeRowId, onActiveRowChange,
  onEndReached, rowTestId, presetViews = [], viewParams, onApplyView, hideExport = false,
}: DataTableProps<T>) {
  "use no memo";
  const maxHeight = maxHeightProp ?? heightProp ?? "calc(100vh - 240px)";
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
  // Views live in the user's preferences (client-only storage, synced from the server after sign-in), so they load
  // after mount and again whenever this table's saved views change.
  const savedViews = useSyncExternalStore(subscribePreferences, () => readPrefs().saved_views?.[viewsKey], () => undefined);
  useEffect(() => setViews(loadViews(viewsKey)), [viewsKey, savedViews]);
  const [globalFilter, setGlobalFilter] = useState("");
  // An embedded table (hideToolbar) shows its filter box only once it has eight rows or a filter is typed; a bare
  // box above three rows is noise. Full explorer tables always keep it.
  const showSearch = !hideSearch && (!hideToolbar || data.length >= 8 || globalFilter !== "");
  const [internalSelection, setInternalSelection] = useState<RowSelectionState>({});
  const rowSelection = selectionProp ?? internalSelection;
  const setRowSelection = onSelectionChange
    ? (updater: RowSelectionState | ((old: RowSelectionState) => RowSelectionState)) =>
        onSelectionChange(typeof updater === "function" ? updater(rowSelection) : updater)
    : setInternalSelection;
  const [openRow, setOpenRow] = useState<T | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // The active row is tracked by id so sorting, filtering and data refreshes cannot move it to another row.
  const [internalActiveId, setActiveId] = useState<string | null>(null);
  const activeId = activeRowId !== undefined ? activeRowId : internalActiveId;
  const [rowHeights, setRowHeights] = useState({ comfortable: ROW_H_FALLBACK, dense: ROW_H_DENSE_FALLBACK });
  useEffect(() => {
    const read = () => setRowHeights({ comfortable: readPx("--m-row-h", ROW_H_FALLBACK), dense: readPx("--m-row-h-dense", ROW_H_DENSE_FALLBACK) });
    read();
    // The density preference lands on <html data-density> (presentation mode on data-present): re-read the tiers.
    if (typeof MutationObserver === "undefined") return;
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-density", "data-present"] });
    return () => mo.disconnect();
  }, []);
  const rowH = dense ? rowHeights.dense : rowHeights.comfortable;
  const uid = useId();
  const parentRef = useRef<HTMLDivElement>(null);

  // A checkbox reads "Select Plant 1000", never "Select row 3f2a…": the caller's name, else the first text cell.
  const nameOfRow = (row: Row<T>): string => {
    const named = rowLabel?.(row.original);
    if (named) return named;
    for (const cell of row.getVisibleCells()) {
      if (cell.column.id === SELECT_COLUMN_ID || cell.column.id === EXPAND_COLUMN_ID) continue;
      const v = cell.getValue();
      // A raw timestamp names nothing a reader would say aloud; the next text cell does.
      if (typeof v === "string" && v.trim() && !/^\d{4}-\d{2}-\d{2}(T|$)/.test(v)) return v;
    }
    return `row ${row.id}`;
  };

  const selectColumn: ColumnDef<T> = {
    id: SELECT_COLUMN_ID,
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all rows"
        checked={table.getIsAllPageRowsSelected()}
        onChange={table.getToggleAllPageRowsSelectedHandler()}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label={`Select ${nameOfRow(row)}`}
        checked={row.getIsSelected()}
        onChange={row.getToggleSelectedHandler()}
        onClick={(e) => e.stopPropagation()}
      />
    ),
    enableSorting: false,
  };

  const expandColumn: ColumnDef<T> = {
    id: EXPAND_COLUMN_ID,
    size: 32,
    header: () => <span className="sr-only">Expand</span>,
    cell: ({ row }) => canExpand && !canExpand(row.original) ? null : (
      <button
        type="button"
        className="m-motion-colors flex items-center justify-center"
        style={{ width: 24, height: 24, color: "var(--m-ink-3)" }}
        aria-label={expanded[row.id] ? "Collapse row" : "Expand row"}
        aria-expanded={!!expanded[row.id]}
        onClick={(e) => { e.stopPropagation(); setExpanded((x) => ({ ...x, [row.id]: !x[row.id] })); }}
      >
        <IconChevronRight size={16} style={{ transform: expanded[row.id] ? "rotate(90deg)" : undefined }} className="m-motion-colors" />
      </button>
    ),
    enableSorting: false,
  };
  const allColumns = [...(bulkActions ? [selectColumn] : []), ...(renderExpanded ? [expandColumn] : []), ...columns];

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
    manualSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: (row) => getRowId(row),
  });

  const rowModel = table.getRowModel().rows;
  const printing = usePrintMedia();
  const shouldVirtualize = !printing && rowModel.length > VIRTUALIZE_ABOVE;
  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? rowModel.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowH,
    // The sticky thead covers the top rowH pixels of the scroll area; keep scrolled-to rows below it.
    scrollPaddingStart: rowH,
  });

  const virtualItems = shouldVirtualize ? virtualizer.getVirtualItems() : null;
  const visibleRows = virtualItems ? virtualItems.map((v) => rowModel[v.index]) : rowModel;
  const padTop = virtualItems && virtualItems.length > 0 ? virtualItems[0].start : 0;
  const padBottom = virtualItems && virtualItems.length > 0 ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end : 0;
  const activeIndex = activeId === null ? -1 : rowModel.findIndex((r) => r.id === activeId);
  const activeRendered = activeIndex >= 0 && (!virtualItems || virtualItems.some((v) => v.index === activeIndex));
  const firstTextColumnId = table.getAllLeafColumns().find((c) => c.id !== SELECT_COLUMN_ID && c.id !== EXPAND_COLUMN_ID && !(c.columnDef.meta as CellMeta | undefined)?.numeric)?.id;
  const severityColumnId = table.getAllLeafColumns().find((c) => (c.columnDef.meta as CellMeta | undefined)?.severity)?.id;
  const heatRanges = new Map<string, readonly [number, number]>();
  for (const c of table.getAllLeafColumns()) {
    const m = c.columnDef.meta as CellMeta | undefined;
    if (!m?.heat) continue;
    if (m.heatRange) { heatRanges.set(c.id, m.heatRange); continue; }
    const vals = rowModel.map((r) => r.getValue(c.id)).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const lo = vals.length ? Math.min(...vals) : 0;
    const hi = vals.length ? Math.max(...vals) : 1;
    const abs = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    heatRanges.set(c.id, m.heat === "div" ? [-abs, abs] : [lo, hi]);
  }
  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);

  const dataColumns = table.getAllLeafColumns().filter((c) => c.id !== SELECT_COLUMN_ID && c.id !== EXPAND_COLUMN_ID);
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
    onApplyView?.(v);
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
    setActiveId(rowModel[next].id);
    onActiveRowChange?.(rowModel[next].original);
    if (shouldVirtualize) virtualizer.scrollToIndex(next);
    if (next === rowModel.length - 1) onEndReached?.();
  };

  // A controlled active row that moves (the page's own keys, a click) is scrolled into view once, when it changes: rows
  // loading or re-sorting around it move its index but must not yank the scroll back to it. The first active row (the
  // one the table mounts with, or the caller's auto-selection) is never scrolled to: on a phone that would scroll the
  // page past its title and filters before the viewer has done anything.
  const followedId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (activeRowId === undefined || activeRowId === null || activeIndex < 0 || followedId.current === activeRowId) return;
    const first = followedId.current === undefined;
    followedId.current = activeRowId;
    if (first) return;
    if (shouldVirtualize) virtualizer.scrollToIndex(activeIndex);
    else document.getElementById(rowDomId(activeIndex))?.scrollIntoView?.({ block: "nearest" });
  });

  const onScroll = onEndReached
    ? (e: React.UIEvent<HTMLDivElement>) => {
        const el = e.currentTarget;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < rowH * 10) onEndReached();
      }
    : undefined;
  const onGridKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    if (e.target !== e.currentTarget) return;
    const last = rowModel.length - 1;
    if (last < 0) return;
    const cur = activeIndex;
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

  const prefetchFor = (row: T): RowPrefetch | undefined => {
    if (rowPrefetch) return rowPrefetch(row);
    const href = rowHref?.(row);
    return href ? { href } : undefined;
  };

  // Escape works from any focus inside the table, including a row checkbox or a header sort button.
  const onRegionKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    table.resetRowSelection();
    setOpenRow(null);
  };

  return (
    <div>
      {(showSearch || !hideToolbar) && (
        <div className="m-text-meta mb-2 flex flex-wrap items-center gap-2" style={{ minHeight: 32 }}>
          {showSearch && (
            <Input
              aria-label="Filter rows"
              placeholder="Type to filter rows"
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              style={{ width: 240 }}
            />
          )}
          {!hideToolbar && (
            <div className="ml-auto flex flex-wrap items-center gap-2" role="toolbar" aria-label="Table options">
          <Menu
            trigger={<button type="button" className="m-btn m-btn-secondary m-btn-sm">Columns</button>}
            items={dataColumns.map((c) => ({ label: colLabel(c), checked: c.getIsVisible(), onSelect: () => c.toggleVisibility() }))}
          />
          <Popover.Root>
            <Popover.Trigger className="m-btn m-btn-secondary m-btn-sm">Views{views.length + presetViews.length > 0 ? ` (${views.length + presetViews.length})` : ""}</Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner sideOffset={4} className="z-50">
                <Popover.Popup className="m-popup min-w-56 p-2">
                  {presetViews.map((v) => (
                    <div key={`preset-${v.name}`} className="py-1">
                      <button type="button" onClick={() => applyView(v)} className="text-left">{v.name}</button>
                    </div>
                  ))}
                  {views.length === 0 && presetViews.length === 0 && <p className="py-1" style={{ color: "var(--m-ink-3)" }}>No saved views yet.</p>}
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
                      setViews(saveView(viewsKey, { name, visibility: columnVisibility, dense, sorting, ...(viewParams ? { params: viewParams } : {}) }));
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
          {!hideExport && (!perms || perms.can("export")) && (
            <Menu
              trigger={<button type="button" className="m-btn m-btn-secondary m-btn-sm">Export table</button>}
              items={allExport.map((o) => ({ label: exportOptionLabel(o), onSelect: () => void runExportOption(o) }))}
            />
          )}
            </div>
          )}
        </div>
      )}
      <div className="m-card m-table-card" style={{ padding: 0, overflow: "hidden" }} onKeyDown={onRegionKeyDown} data-tour={dataTour}>
      <div ref={parentRef} className="m-table-scroll" onScroll={onScroll} style={{ maxHeight: maxHeight === "auto" ? undefined : maxHeight, overflow: "auto" }}>
        <table
          className="m-text-body w-full"
          style={{ color: "var(--m-ink)" }}
          role="grid"
          tabIndex={0}
          aria-label={label}
          aria-rowcount={rowModel.length + 1}
          aria-activedescendant={activeRendered ? rowDomId(activeIndex) : undefined}
          onKeyDown={onGridKeyDown}
        >
          <thead className="sticky top-0 z-[2]">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} aria-rowindex={1}>
                {hg.headers.map((h) => {
                  const sortable = h.column.getCanSort();
                  const sorted = h.column.getIsSorted();
                  const headMeta = h.column.columnDef.meta as CellMeta | undefined;
                  const headHeat = headMeta?.heat;
                  return (
                    <th
                      key={h.id}
                      aria-sort={sortable ? (sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none") : undefined}
                      className={`m-text-label px-2 font-medium border-b ${headMeta?.numeric ? "text-right" : "text-left"} ${columnLayoutClass(headMeta)}`}
                      style={{
                        height: 28, background: "var(--m-sheet)", borderColor: "var(--m-line-strong)",
                        color: sorted ? "var(--m-ink)" : "var(--m-ink-3)",
                        width: h.column.columnDef.size !== undefined ? h.getSize() : undefined,
                      }}
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          // A numeric header sits over right-aligned figures: the button fills the cell and packs to the right.
                          className={`flex items-center gap-1 select-none ${headMeta?.numeric ? "w-full justify-end" : ""}`}
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sorted === "asc" ? <IconArrowUp size={12} /> : sorted === "desc" ? <IconArrowDown size={12} /> : null}
                          {headHeat && <span aria-hidden className={`m-legend-strip m-legend-strip-${headHeat} ml-1`} />}
                        </button>
                      ) : (
                        <>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {headHeat && <span aria-hidden className={`m-legend-strip m-legend-strip-${headHeat} ml-1`} />}
                        </>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rowModel.length === 0 && (
              <tr style={{ height: 72 }}>
                <td colSpan={Math.max(1, table.getVisibleLeafColumns().length)} className="px-2 text-center" style={{ color: "var(--m-ink-3)" }}>
                  {globalFilter ? (
                    <>
                      <span className="mr-2">No rows match this filter</span>
                      <Button variant="ghost" size="sm" onClick={() => setGlobalFilter("")}>Clear filter</Button>
                    </>
                  ) : (
                    <>
                      <span className="mr-2">{emptyMessage ?? "No rows"}</span>
                      {emptyAction}
                    </>
                  )}
                </td>
              </tr>
            )}
            {padTop > 0 && (
              <tr aria-hidden="true" style={{ height: padTop }}>
                <td colSpan={Math.max(1, table.getVisibleLeafColumns().length)} style={{ padding: 0, border: 0 }} />
              </tr>
            )}
            {visibleRows.map((row, i) => {
              const index = virtualItems ? virtualItems[i].index : i;
              const sevValue = severityColumnId ? String(row.getValue(severityColumnId) ?? "").toLowerCase() : "";
              const sevClass = (SEVERITIES as readonly string[]).includes(sevValue) ? `m-row-severity-${sevValue}` : "";
              const activate = onRowClick || renderDrawer
                ? () => {
                    setActiveId(row.id);
                    onRowClick?.(row.original);
                    if (renderDrawer) setOpenRow(row.original);
                  }
                : undefined;
              return (
                <Fragment key={row.id}>
                <PrefetchRow
                  id={rowDomId(index)}
                  aria-rowindex={index + 2}
                  aria-selected={bulkActions ? row.getIsSelected() : undefined}
                  data-testid={rowTestId}
                  prefetchInfo={prefetchFor(row.original)}
                  className={`group border-b m-motion-colors ${row.getIsSelected() ? "bg-[var(--m-accent-soft)]" : "hover:bg-[var(--m-sheet-raised)]"} ${index === activeIndex ? "m-row-active" : ""} ${sevClass}`}
                  onClick={activate}
                  style={{
                    borderColor: "var(--m-line)",
                    height: rowH,
                    cursor: activate ? "pointer" : undefined,
                  }}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta as CellMeta | undefined;
                    const content = flexRender(cell.column.columnDef.cell, cell.getContext());
                    const heat = meta?.heat ? heatClass(meta.heat, cell.getValue(), heatRanges.get(cell.column.id) ?? [0, 1]) : undefined;
                    const firstText = onRowClick && cell.column.id === firstTextColumnId;
                    const bar = meta?.bar ? barFill(cell.getValue(), meta.bar) : null;
                    return (
                      <td
                        key={cell.id}
                        title={meta?.mono && typeof cell.getValue() === "string" ? (cell.getValue() as string) : undefined}
                        className={`px-2 ${MONO_NARROW} ${meta?.numeric ? "text-right m-numeric" : ""} ${firstText ? "m-motion-colors group-hover:text-[var(--m-accent)]" : ""} ${heat ?? ""} ${meta?.sticky ? `z-[1] ${row.getIsSelected() ? "bg-[var(--m-accent-soft)]" : "bg-[var(--m-sheet)] group-hover:bg-[var(--m-sheet-raised)]"}` : ""} ${columnLayoutClass(meta)}`}
                      >
                        {bar ? (
                          <span className="flex items-center justify-end gap-2">
                            {content}
                            <span aria-hidden className="m-bar-track"><span className="m-bar-fill" style={{ width: `${bar.pct}%` }} {...bar.attr} /></span>
                          </span>
                        ) : meta?.mono ? <Mono>{content}</Mono> : content}
                      </td>
                    );
                  })}
                </PrefetchRow>
                {renderExpanded && expanded[row.id] && (!canExpand || canExpand(row.original)) && (
                  <tr aria-label="Row detail">
                    <td colSpan={Math.max(1, table.getVisibleLeafColumns().length)} style={{ padding: 0 }}>
                      <div className="m-row-expand">{renderExpanded(row.original)}</div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
            {padBottom > 0 && (
              <tr aria-hidden="true" style={{ height: padBottom }}>
                <td colSpan={Math.max(1, table.getVisibleLeafColumns().length)} style={{ padding: 0, border: 0 }} />
              </tr>
            )}
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
