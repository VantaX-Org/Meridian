/**
 * Aurora <DataTable> — WS3.
 *
 * Virtualised table built on TanStack Table v8 + TanStack Virtual. Sustains
 * 60 fps on 200k rows per the Aurora spec §6.3. Rows are keyboard-navigable
 * with J / K (Linear-style); Enter opens the row via `onRowActivate`. The
 * header is sticky; columns may declare `sticky: "start"` to freeze on the
 * left edge (e.g. the record-ID column in Workbench).
 *
 * Density follows the parent `[data-density]` attribute — row heights are
 * 28 / 36 / 44 px for compact / default / comfortable.
 *
 * Consumers pass typed `columns` via `@tanstack/react-table` helpers and
 * `data` as an array. Sorting, filtering, and selection remain responsibilities
 * of the consuming page for now; group-by / tree views come in WS7.
 */

"use client";

import {
  flexRender,
  getCoreRowModel,
  type ColumnDef,
  type Row,
  type RowData,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { clsx } from "../primitives/internal";

export type AuroraColumnMeta = {
  /** Freeze to the left edge; rendered with a raised z-index and a soft rule. */
  sticky?: "start";
  /** Fixed column width in px. Leave undefined for flex. */
  width?: number;
  /** Justify cell content. Numerics should be `end`. */
  align?: "start" | "center" | "end";
  /** Render numbers tabular + lining. */
  numeric?: boolean;
};

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> extends AuroraColumnMeta {}
}

export interface DataTableProps<TRow> {
  columns: ColumnDef<TRow, unknown>[];
  data: TRow[];
  /** Stable key for each row — keeps virtualiser anchoring + focus steady. */
  getRowId: (row: TRow, index: number) => string;
  /** Fires on Enter / double-click. */
  onRowActivate?: (row: TRow) => void;
  /** Fires whenever the focused row changes (hover, J/K, click). */
  onRowFocus?: (row: TRow | null) => void;
  /** Max body height. Defaults to `64vh`. */
  maxHeight?: number | string;
  /** Empty-state slot. */
  empty?: React.ReactNode;
  className?: string;
  /** Accessible caption for screen readers. */
  ariaLabel?: string;
}

export function DataTable<TRow>({
  columns,
  data,
  getRowId,
  onRowActivate,
  onRowFocus,
  maxHeight = "64vh",
  empty,
  className,
  ariaLabel,
}: DataTableProps<TRow>) {
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  // Mirror of focusedIndex kept in a ref so rapid J/K repeats read the
  // latest value before React commits the next render — otherwise the
  // closure in moveFocus sees a stale index and drops intermediate steps.
  const focusedIndexRef = useRef(focusedIndex);
  useEffect(() => {
    focusedIndexRef.current = focusedIndex;
  }, [focusedIndex]);

  const scrollerRef = useRef<HTMLDivElement>(null);

  const table = useReactTable<TRow>({
    data,
    columns,
    getRowId: (row, index) => getRowId(row, index),
    getCoreRowModel: getCoreRowModel(),
  });

  const rows = table.getRowModel().rows;
  const rowHeight = useRowHeight(scrollerRef);

  const virtualiser = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
    getItemKey: (index) => rows[index].id,
  });

  const moveFocus = useCallback(
    (delta: number) => {
      if (rows.length === 0) return;
      // Read from the ref — under key-repeat the DOM fires multiple
      // keydowns before React commits the previous setState, so the
      // closure-captured focusedIndex would be stale.
      const current = focusedIndexRef.current;
      const next = Math.min(
        Math.max(current + delta, 0),
        rows.length - 1,
      );
      focusedIndexRef.current = next;
      setFocusedIndex(next);
      virtualiser.scrollToIndex(next, { align: "auto" });
      onRowFocus?.(rows[next]?.original ?? null);
    },
    [rows, virtualiser, onRowFocus],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "j" || event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === "k" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === "Enter" && focusedIndex >= 0) {
      event.preventDefault();
      const row = rows[focusedIndex];
      if (row) onRowActivate?.(row.original);
    } else if (event.key === "Home") {
      event.preventDefault();
      setFocusedIndex(0);
      virtualiser.scrollToIndex(0);
      onRowFocus?.(rows[0]?.original ?? null);
    } else if (event.key === "End") {
      event.preventDefault();
      const last = rows.length - 1;
      setFocusedIndex(last);
      virtualiser.scrollToIndex(last);
      onRowFocus?.(rows[last]?.original ?? null);
    }
  };

  if (data.length === 0 && empty) {
    return <div className={clsx("aurora-table__empty", className)}>{empty}</div>;
  }

  const headerGroups = table.getHeaderGroups();
  const virtualRows = virtualiser.getVirtualItems();
  const totalSize = virtualiser.getTotalSize();

  return (
    <div
      ref={scrollerRef}
      className={clsx("aurora-table", className)}
      tabIndex={0}
      role="grid"
      aria-rowcount={rows.length + headerGroups.length}
      aria-label={ariaLabel}
      style={{ maxHeight }}
      onKeyDown={onKeyDown}
    >
      <div className="aurora-table__inner">
        <div className="aurora-table__head" role="rowgroup">
          {headerGroups.map((group) => (
            <div key={group.id} className="aurora-table__row" role="row">
              {group.headers.map((header) => {
                const meta = header.column.columnDef.meta as
                  | AuroraColumnMeta
                  | undefined;
                return (
                  <div
                    key={header.id}
                    role="columnheader"
                    className="aurora-table__cell aurora-table__cell--header"
                    data-sticky={meta?.sticky}
                    data-align={meta?.align}
                    style={cellStyle(meta)}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div
          role="rowgroup"
          className="aurora-table__body"
          style={{ height: totalSize }}
        >
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <VirtualRow
                key={row.id}
                row={row}
                virtualStart={virtualRow.start}
                focused={virtualRow.index === focusedIndex}
                onMouseEnter={() => {
                  setFocusedIndex(virtualRow.index);
                  onRowFocus?.(row.original);
                }}
                onClick={() => {
                  setFocusedIndex(virtualRow.index);
                  onRowFocus?.(row.original);
                  onRowActivate?.(row.original);
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function VirtualRow<TRow>({
  row,
  virtualStart,
  focused,
  onMouseEnter,
  onClick,
}: {
  row: Row<TRow>;
  virtualStart: number;
  focused: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  return (
    <div
      role="row"
      className="aurora-table__row"
      data-focused={focused ? "true" : undefined}
      style={{
        transform: `translateY(${virtualStart}px)`,
      }}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      {row.getVisibleCells().map((cell) => {
        const meta = cell.column.columnDef.meta as
          | AuroraColumnMeta
          | undefined;
        return (
          <div
            key={cell.id}
            role="gridcell"
            className="aurora-table__cell"
            data-sticky={meta?.sticky}
            data-align={meta?.align}
            data-numeric={meta?.numeric ? "true" : undefined}
            style={cellStyle(meta)}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </div>
        );
      })}
    </div>
  );
}

function cellStyle(meta: AuroraColumnMeta | undefined): CSSProperties {
  if (meta?.width !== undefined) {
    return { width: meta.width, flexGrow: 0, flexShrink: 0 };
  }
  return { flex: "1 1 0", minWidth: 0 };
}

/**
 * Read the effective `--aurora-density-row` for the table's own element.
 *
 * CSS custom properties inherit, so a scoped `[data-density="compact"]`
 * ancestor overrides the document root. Reading from the scroller's own
 * computed style picks up that scoped value; reading from
 * `document.documentElement` would miss it and the virtualiser would
 * compute offsets at the root height while the CSS painted rows at the
 * scoped height, producing misalignment as the user scrolls.
 *
 * The hook does a synchronous first pass (null ref → 36 px default) so
 * SSR renders a sensible height, then re-measures after the ref attaches.
 */
function useRowHeight(
  hostRef: React.RefObject<HTMLDivElement | null>,
): number {
  const [rowHeight, setRowHeight] = useState<number>(36);
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el || typeof window === "undefined") return;
    const resolve = () => {
      const style = getComputedStyle(el);
      const raw = style.getPropertyValue("--aurora-density-row").trim();
      if (!raw) return;
      const parsed = parseFloat(raw);
      if (Number.isFinite(parsed)) setRowHeight(parsed);
    };
    resolve();
    // Re-measure when a parent flips `[data-density]` — cheap vs. a
    // full MutationObserver because density changes are rare and the
    // selector walks are shallow.
    const observer = new MutationObserver(resolve);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-density"],
      subtree: true,
    });
    return () => observer.disconnect();
  }, [hostRef]);
  return rowHeight;
}
