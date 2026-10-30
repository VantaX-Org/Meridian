"use client";

import { useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref } from "react";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type VisibilityState } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { v2Locale } from "@/lib/v2/format";
import { KEYS, gridRegistry, matchKey, type GridTarget } from "@/lib/v2/keys";
import { MenuButton, type MenuEntry } from "./Menu";
import { t } from "@/lib/v2/i18n";

export interface GridColumn<T> {
  id: string;
  header: string;
  /** What the cell shows. Numbers go through `numeric` for alignment; format them here. */
  cell: (row: T, index: number) => ReactNode;
  /** Width in pixels. */
  width: number;
  /** Right-aligned, tabular figures. */
  numeric?: boolean;
  /** Sticks to the left edge while the grid scrolls sideways. One column. */
  pin?: boolean;
  /** Not offered in the column chooser. */
  locked?: boolean;
  defaultHidden?: boolean;
  /** Header tooltip. */
  title?: string;
}

export interface GridHandle {
  clear(): void;
}

export interface BulkContext<T> {
  selected: T[];
  clear: () => void;
}

export interface GridProps<T> {
  /** Names the table for column persistence (localStorage `m2:cols:<id>`) and for assistive technology. */
  id: string;
  ariaLabel: string;
  columns: GridColumn<T>[];
  rows: readonly T[];
  rowId: (row: T, index: number) => string;
  /** 28 pixel rows instead of 32. */
  compact?: boolean;
  /** The most the scroll area grows to, in pixels (default 480). A short list is only as tall as its rows. */
  height?: number;
  /** Rows drawn before the first measurement (tests, server render). */
  initialViewport?: number;
  onOpen?: (row: T) => void;
  /** The row shown in the inspector: kept highlighted. */
  openRowId?: string | null;
  selectable?: boolean;
  /** The actions inside the bulk bar. The bar itself (count, clear) is always drawn when rows are selected. */
  bulkBar?: (ctx: BulkContext<T>) => ReactNode;
  /** Above the grid, left. */
  toolbar?: ReactNode;
  emptyFrame?: ReactNode;
  /** Replaces the rows when the read failed. */
  error?: ReactNode;
  loading?: boolean;
  /** The key handler for j, k, Enter and x also works when focus is on the page. Default true. */
  primary?: boolean;
  /** Hide the column chooser. */
  fixedColumns?: boolean;
  /** Hide the bar above the grid (row count, columns): an embedded grid whose caller states the count. */
  hideBar?: boolean;
  /** A row drawn as one cell across every column (a group heading), with no checkbox. Return null for an ordinary row. */
  spanRow?: (row: T, index: number) => ReactNode | null;
  /** The count the bar states, when it is not the number of rows (group headings are rows too). */
  count?: number;
  /** Tells the caller which row is highlighted by the keyboard. */
  onActiveChange?: (row: T | undefined) => void;
  /** Lets the caller clear the selection after an action that was not started from the bulk bar (a key). */
  handleRef?: Ref<GridHandle>;
  /** How the bulk bar names the selection: "3 records" (default "3 selected"). */
  bulkLabel?: (count: number) => string;
  /** Called with the selected rows whenever the selection changes. */
  onSelectionChange?: (rows: T[]) => void;
}

const HEAD_H = 32;
const SELECT_W = 36;
const storageKey = (id: string) => `m2:cols:${id}`;

function loadHidden(id: string, columns: GridColumn<unknown>[]): VisibilityState {
  const base: VisibilityState = Object.fromEntries(columns.filter((c) => c.defaultHidden).map((c) => [c.id, false]));
  try {
    const raw = window.localStorage.getItem(storageKey(id));
    if (!raw) return base;
    const hidden: unknown = JSON.parse(raw);
    if (!Array.isArray(hidden)) return base;
    const next: VisibilityState = {};
    for (const c of columns) next[c.id] = !hidden.includes(c.id);
    return next;
  } catch {
    return base;
  }
}

function saveHidden(id: string, visibility: VisibilityState): void {
  try {
    window.localStorage.setItem(storageKey(id), JSON.stringify(Object.entries(visibility).filter(([, v]) => v === false).map(([k]) => k)));
  } catch {
    /* storage blocked: the choice lasts for this page view */
  }
}

/**
 * The data grid: TanStack Table for the column model and visibility, TanStack Virtual for the rows. Rows are a fixed
 * 32 pixels (28 compact) and absolutely placed, so scrolling never moves anything else; the header and the first
 * column stick; numbers are right-aligned tabular figures. Keyboard: j, k and the arrow keys move, Enter opens,
 * x selects, Shift extends. The column choice is remembered per table id.
 */
export function Grid<T>(props: GridProps<T>) {
  const { id, ariaLabel, columns, rows, rowId, compact, height = 480, initialViewport, onOpen, openRowId, selectable, bulkBar, toolbar, emptyFrame, error, loading, primary = true, fixedColumns, hideBar, spanRow, count, onActiveChange, onSelectionChange, bulkLabel, handleRef } = props;
  const rowH = compact ? 28 : 32;
  const gid = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const [visibility, setVisibility] = useState<VisibilityState>(() => (typeof window === "undefined" ? {} : loadHidden(id, columns as GridColumn<unknown>[])));
  const [active, setActive] = useState(-1);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef(-1);

  const tableColumns = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((c) => ({
        id: c.id,
        header: c.header,
        size: c.width,
        cell: ({ row }) => c.cell(row.original, row.index),
        meta: c,
      })),
    [columns],
  );
  const table = useReactTable<T>({
    data: rows as T[],
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    state: { columnVisibility: visibility },
    onColumnVisibilityChange: (updater) =>
      setVisibility((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        saveHidden(id, next);
        return next;
      }),
  });
  // Only the header and column model are asked of the table: no row objects are built, so 100,000 rows cost nothing here.
  const leaf = table.getVisibleLeafColumns();
  const pinned = columns.find((c) => c.pin)?.id;
  const widths = leaf.map((c) => c.getSize());
  const total = widths.reduce((a, b) => a + b, 0) + (selectable ? SELECT_W : 0);
  const template = `${selectable ? `${SELECT_W}px ` : ""}${widths.map((w) => `${w}px`).join(" ")}`;
  const selectedCount = selected.size;

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowH,
    overscan: 8,
    scrollMargin: HEAD_H,
    initialRect: { width: 800, height: initialViewport ?? height },
    getItemKey: (i) => i,
  });

  const rowsRef = useRef(rows);
  const stateRef = useRef({ active, selected });
  const spanRef = useRef(spanRow);
  useEffect(() => {
    rowsRef.current = rows;
    stateRef.current = { active, selected };
    spanRef.current = spanRow;
  });
  useEffect(() => {
    onActiveChange?.(active >= 0 ? rows[active] : undefined);
    // Only a change of the highlighted row is announced, not every render of the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const selectIndex = useCallback(
    (indexes: number[], on: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const i of indexes) {
          const r = rowsRef.current[i];
          if (r === undefined || spanRef.current?.(r, i) != null) continue;
          const key = rowId(r, i);
          if (on) next.add(key);
          else next.delete(key);
        }
        return next;
      });
    },
    [rowId],
  );

  const move = useCallback(
    (dir: 1 | -1, extend: boolean) => {
      const n = rowsRef.current.length;
      if (!n) return;
      const prev = stateRef.current.active;
      const next = prev < 0 ? (dir > 0 ? 0 : n - 1) : Math.max(0, Math.min(n - 1, prev + dir));
      if (extend && selectable) selectIndex(prev >= 0 ? [prev, next] : [next], true);
      stateRef.current.active = next;
      setActive(next);
      virt.scrollToIndex(next, { align: "auto" });
    },
    [selectable, selectIndex, virt],
  );
  const target = useMemo<GridTarget>(
    () => ({
      move,
      open: () => {
        const r = rowsRef.current[stateRef.current.active];
        if (r !== undefined) onOpen?.(r);
      },
      toggle: () => {
        const i = stateRef.current.active;
        const r = rowsRef.current[i];
        if (r === undefined || !selectable) return;
        selectIndex([i], !stateRef.current.selected.has(rowId(r, i)));
      },
    }),
    [move, onOpen, selectable, selectIndex, rowId],
  );
  useEffect(() => {
    if (!primary) return;
    gridRegistry.set(target);
    return () => gridRegistry.clear(target);
  }, [primary, target]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && (e.target as HTMLElement).closest("input,button,a,select,textarea")) return;
    for (const def of KEYS) {
      if (def.scope !== "grid" || !def.run) continue;
      for (const spec of def.keys) {
        if (!matchKey(spec, e)) continue;
        if (def.run({ grid: target }, e.nativeEvent)) {
          e.preventDefault();
          return;
        }
      }
    }
    if (e.key === "Escape" && selectedCount > 0) {
      e.preventDefault();
      setSelected(new Set());
    }
  };

  const clear = useCallback(() => setSelected(new Set()), []);
  useImperativeHandle(handleRef, () => ({ clear }), [clear]);
  const selectedRows = useMemo(() => {
    if (selected.size === 0) return [] as T[];
    return rows.filter((r, i) => selected.has(rowId(r, i)));
  }, [selected, rows, rowId]);
  const selectableCount = useMemo(() => (spanRow ? rows.filter((r, i) => spanRow(r, i) == null).length : rows.length), [rows, spanRow]);
  useEffect(() => {
    onSelectionChange?.(selectedRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRows]);

  const chooser: MenuEntry[] = [
    { kind: "heading", label: t("Columns") },
    ...columns
      .filter((c) => !c.locked && !c.pin)
      .map<MenuEntry>((c) => ({
        kind: "item",
        id: c.id,
        label: c.header,
        checked: visibility[c.id] !== false,
        variant: "checkbox",
        keepOpen: true,
        onSelect: () => table.getColumn(c.id)?.toggleVisibility(visibility[c.id] === false),
      })),
    { kind: "separator" },
    { kind: "item", id: "all", label: t("Show all columns"), keepOpen: true, onSelect: () => table.resetColumnVisibility(true) },
  ];

  const showRows = !error && !loading && rows.length > 0;
  const scrollH = showRows ? Math.min(height, HEAD_H + rows.length * rowH + 2) : undefined;
  const items = virt.getVirtualItems();
  const activeId = active >= 0 && active < rows.length ? `${gid}-r${active}` : undefined;

  return (
    <div className="m2-gridwrap" data-testid="grid" data-grid={id}>
      {hideBar ? null : (
      <div className="m2-gridbar">
        <div className="m2-gridbar-l">{toolbar}</div>
        <div className="m2-gridbar-r">
          <span className="m2-meta" aria-live="polite">
            {(count ?? rows.length).toLocaleString(v2Locale())} {t("{count, plural, one {row} other {rows}}", { count: (count ?? rows.length) })}
          </span>
          {fixedColumns ? null : (
            <MenuButton label={t("Choose columns")} buttonLabel={t("Choose columns")} entries={chooser} className="m2-btn m2-sm" align="end">
              {t("Columns")}
            </MenuButton>
          )}
        </div>
      </div>
      )}
      <div
        ref={scroller}
        className="m2-grid"
        role="grid"
        aria-label={ariaLabel}
        aria-rowcount={rows.length + 1}
        aria-colcount={leaf.length + (selectable ? 1 : 0)}
        aria-multiselectable={selectable ? true : undefined}
        aria-activedescendant={activeId}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={(e) => {
          if (e.target === e.currentTarget && stateRef.current.active < 0 && rows.length > 0) {
            stateRef.current.active = 0;
            setActive(0);
          }
        }}
        style={{ height: scrollH, maxHeight: height }}
      >
        <div role="rowgroup" className="m2-ghead" style={{ width: total, height: HEAD_H }}>
          <div role="row" aria-rowindex={1} className="m2-ghead-row" style={{ gridTemplateColumns: template, height: HEAD_H }}>
            {selectable ? (
              <div role="columnheader" className="m2-gcell m2-gpin m2-gsel" style={{ left: 0 }}>
                <input
                  type="checkbox"
                  aria-label={t("Select all rows")}
                  checked={selectableCount > 0 && selectedCount === selectableCount}
                  ref={(el) => {
                    if (el) el.indeterminate = selectedCount > 0 && selectedCount < selectableCount;
                  }}
                  onChange={(e) => (e.target.checked ? selectIndex(rows.map((_, i) => i), true) : clear())}
                />
              </div>
            ) : null}
            {table.getHeaderGroups()[0]?.headers.map((h) => {
              const meta = h.column.columnDef.meta as GridColumn<T>;
              return (
                <div
                  key={h.id}
                  role="columnheader"
                  title={meta.title}
                  className={`m2-gcell${meta.numeric ? " m2-gnum" : ""}${meta.id === pinned ? " m2-gpin" : ""}`}
                  style={meta.id === pinned ? { left: selectable ? SELECT_W : 0 } : undefined}
                >
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </div>
              );
            })}
          </div>
        </div>
        {error ? (
          <div className="m2-gstate">{error}</div>
        ) : loading ? (
          <div role="rowgroup" className="m2-gbody" aria-busy="true" style={{ width: total, height: rowH * 8 }}>
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} role="row" className="m2-grow m2-grow-skel" style={{ gridTemplateColumns: template, height: rowH, transform: `translateY(${i * rowH}px)` }}>
                {leaf.map((c) => (
                  <div key={c.id} role="gridcell" className="m2-gcell">
                    <span className="m2-skel" style={{ width: Math.max(24, c.getSize() - 32), height: 12 }} aria-hidden="true" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="m2-gstate">{emptyFrame}</div>
        ) : (
          <div role="rowgroup" className="m2-gbody" style={{ width: total, height: virt.getTotalSize() }}>
            {items.map((v) => {
              const row = rows[v.index];
              if (row === undefined) return null;
              const key = rowId(row, v.index);
              const isSel = selected.has(key);
              const span = spanRow?.(row, v.index) ?? null;
              if (span != null) {
                return (
                  <div
                    key={key}
                    id={`${gid}-r${v.index}`}
                    role="row"
                    aria-rowindex={v.index + 2}
                    data-active={v.index === active ? "true" : undefined}
                    className="m2-grow m2-grow-span"
                    style={{ height: rowH, transform: `translateY(${v.start - HEAD_H}px)`, width: total }}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("input,a,button")) return;
                      stateRef.current.active = v.index;
                      setActive(v.index);
                      onOpen?.(row);
                    }}
                  >
                    <div role="gridcell" aria-colspan={leaf.length + (selectable ? 1 : 0)} className="m2-gcell m2-gspan">
                      {span}
                    </div>
                  </div>
                );
              }
              return (
                <div
                  key={key}
                  id={`${gid}-r${v.index}`}
                  role="row"
                  aria-rowindex={v.index + 2}
                  aria-selected={selectable ? isSel : undefined}
                  data-active={v.index === active ? "true" : undefined}
                  data-open={openRowId === key ? "true" : undefined}
                  data-selected={isSel ? "true" : undefined}
                  className="m2-grow"
                  style={{ gridTemplateColumns: template, height: rowH, transform: `translateY(${v.start - HEAD_H}px)` }}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("input,a,button")) return;
                    stateRef.current.active = v.index;
                    setActive(v.index);
                    anchor.current = v.index;
                    onOpen?.(row);
                  }}
                >
                  {selectable ? (
                    <div role="gridcell" className="m2-gcell m2-gpin m2-gsel" style={{ left: 0 }}>
                      <input
                        type="checkbox"
                        aria-label={t("Select row {count}", { count: v.index + 1 })}
                        checked={isSel}
                        onChange={(e) => {
                          const shift = (e.nativeEvent as MouseEvent).shiftKey;
                          if (shift && anchor.current >= 0) {
                            const [a, b] = [Math.min(anchor.current, v.index), Math.max(anchor.current, v.index)];
                            selectIndex(Array.from({ length: b - a + 1 }, (_, k) => a + k), e.target.checked);
                          } else selectIndex([v.index], e.target.checked);
                          anchor.current = v.index;
                        }}
                      />
                    </div>
                  ) : null}
                  {leaf.map((c) => {
                    const meta = c.columnDef.meta as GridColumn<T>;
                    return (
                      <div
                        key={c.id}
                        role="gridcell"
                        className={`m2-gcell${meta.numeric ? " m2-gnum" : ""}${meta.id === pinned ? " m2-gpin" : ""}`}
                        style={meta.id === pinned ? { left: selectable ? SELECT_W : 0 } : undefined}
                      >
                        {meta.cell(row, v.index)}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {selectedCount > 0 ? (
        <div className="m2-bulk" role="region" aria-label={t("Bulk actions")} data-testid="bulk-bar">
          <span>{bulkLabel ? bulkLabel(selectedCount) : t("{selectedCount} selected", { selectedCount: selectedCount.toLocaleString(v2Locale()) })}</span>
          {bulkBar?.({ selected: selectedRows, clear })}
          <button type="button" className="m2-btn m2-sm m2-ghost" onClick={clear}>
            {t("Clear selection")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
