"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { Button } from "./Button";
import { Icon } from "../Icon";
import { cx } from "./cx";
import { ErrorState } from "./ErrorState";
import { EmptyState } from "./EmptyState";
import { Skeleton } from "./Skeleton";

export interface Column<R> {
  id: string;
  label: string;
  cell: (row: R) => ReactNode;
  /** Present means sortable. Returns a negative, zero or positive number as Array.sort does. */
  compare?: (a: R, b: R) => number;
  align?: "end";
  /** Off by default; the column chooser turns it on. */
  hidden?: boolean;
}

export interface DataTableProps<R> {
  rows: R[];
  columns: Column<R>[];
  rowKey: (row: R) => string;
  /** The row's name, for checkbox labels and the row's accessible name ("Select material 100-200"). */
  rowLabel: (row: R) => string;
  caption: string;
  /** The full count when rows is a page of it. */
  total?: number;
  selectable?: boolean;
  /** Rendered in the bulk bar when rows are selected. */
  bulkActions?: (selectedKeys: string[]) => ReactNode;
  onOpenRow?: (row: R) => void;
  loading?: boolean;
  error?: { sentence: string; onRetry?: () => void };
  empty?: { heading: string; text?: string; action?: ReactNode };
  density?: "compact" | "comfortable";
}

type Sort = { id: string; dir: "asc" | "desc" } | null;

/**
 * Sortable (aria-sort), column chooser, sticky header, named row selection with a bulk bar, keyboard rows
 * (Up and Down move, Enter opens, Space selects). The row count is announced after the table settles, not per keystroke.
 */
export function DataTable<R>(props: DataTableProps<R>) {
  const { rows, columns, rowKey, rowLabel, caption, total, selectable, bulkActions, onOpenRow, loading, error, empty, density = "compact" } = props;
  const [sort, setSort] = useState<Sort>(null);
  const [off, setOff] = useState<Set<string>>(() => new Set(columns.filter((c) => c.hidden).map((c) => c.id)));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [chooser, setChooser] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [focusRow, setFocusRow] = useState(0);
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);
  const chooserId = useId();
  const visible = columns.filter((c) => !off.has(c.id));

  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.id === sort.id);
    if (!sort || !col?.compare) return rows;
    const out = [...rows].sort(col.compare);
    return sort.dir === "desc" ? out.reverse() : out;
  }, [rows, columns, sort]);

  useEffect(() => {
    if (loading || error) return;
    const id = setTimeout(() => setAnnounce(total !== undefined && total !== rows.length ? t("Showing {n} of {m}", { n: formatInt(rows.length), m: formatInt(total) }) : t("{n} rows", { n: formatInt(rows.length) })), 400);
    return () => clearTimeout(id);
  }, [rows.length, total, loading, error]);

  const colSpan = visible.length + (selectable ? 1 : 0);
  const allKeys = sorted.map(rowKey);
  const allOn = allKeys.length > 0 && allKeys.every((k) => picked.has(k));
  const toggle = (k: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, i: number, row: R) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = Math.max(0, Math.min(sorted.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
      setFocusRow(n);
      rowRefs.current[n]?.focus();
    } else if (e.key === "Enter" && onOpenRow) {
      e.preventDefault();
      onOpenRow(row);
    } else if (e.key === " " && selectable) {
      e.preventDefault();
      toggle(rowKey(row));
    }
  };

  const cycleSort = (id: string) =>
    setSort((s) => (!s || s.id !== id ? { id, dir: "asc" } : s.dir === "asc" ? { id, dir: "desc" } : null));

  let body: ReactNode;
  if (loading) body = <tr><td colSpan={colSpan} aria-colspan={colSpan}><Skeleton lines={4} /></td></tr>;
  else if (error) body = <tr><td colSpan={colSpan} aria-colspan={colSpan}><ErrorState sentence={error.sentence} onRetry={error.onRetry} /></td></tr>;
  else if (sorted.length === 0) body = <tr><td colSpan={colSpan} aria-colspan={colSpan}><EmptyState heading={empty?.heading ?? t("Nothing to show")} action={empty?.action}>{empty?.text}</EmptyState></td></tr>;
  else
    body = sorted.map((row, i) => {
      const k = rowKey(row);
      const on = picked.has(k);
      return (
        <tr
          key={k}
          ref={(el) => {
            rowRefs.current[i] = el;
          }}
          tabIndex={i === focusRow ? 0 : -1}
          aria-selected={selectable ? on : undefined}
          aria-label={rowLabel(row)}
          className={cx("nx-tr", on && "nx-tr-on", onOpenRow && "nx-tr-open")}
          onKeyDown={(e) => onRowKey(e, i, row)}
          onFocus={(e) => e.target === e.currentTarget && setFocusRow(i)}
          onClick={(e) => {
            if (onOpenRow && !(e.target as HTMLElement).closest("input,button,a")) onOpenRow(row);
          }}
        >
          {selectable ? (
            <td className="nx-td-check">
              <input type="checkbox" className="nx-check" checked={on} onChange={() => toggle(k)} aria-label={t("Select {name}", { name: rowLabel(row) })} />
            </td>
          ) : null}
          {visible.map((c) => (
            <td key={c.id} className={cx("nx-td", c.align === "end" && "nx-end")}>{c.cell(row)}</td>
          ))}
        </tr>
      );
    });

  return (
    <div className="nx-table-wrap">
      <div className="nx-table-bar">
        <div className="nx-table-count" aria-hidden="true">
          {total !== undefined && total !== rows.length ? t("Showing {n} of {m}", { n: formatInt(rows.length), m: formatInt(total) }) : t("{n} rows", { n: formatInt(rows.length) })}
        </div>
        <div className="nx-chooser">
          <Button variant="quiet" size={32} icon="columns" aria-expanded={chooser} aria-controls={chooserId} onClick={() => setChooser((v) => !v)}>
            {t("Columns")}
          </Button>
          {chooser ? (
            <div id={chooserId} role="group" aria-label={t("Choose columns")} className="nx-menu nx-chooser-menu" onKeyDown={(e) => e.key === "Escape" && setChooser(false)}>
              {columns.map((c) => (
                <label key={c.id} className="nx-chooser-row">
                  <input
                    type="checkbox"
                    className="nx-check"
                    checked={!off.has(c.id)}
                    disabled={!off.has(c.id) && visible.length === 1}
                    onChange={() =>
                      setOff((o) => {
                        const n = new Set(o);
                        if (n.has(c.id)) n.delete(c.id);
                        else n.add(c.id);
                        return n;
                      })
                    }
                  />
                  {c.label}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {selectable && picked.size > 0 ? (
        <div className="nx-bulk" role="region" aria-label={t("Selection")}>
          <strong>{t("{n} selected", { n: formatInt(picked.size) })}</strong>
          {bulkActions?.([...picked])}
          <Button variant="quiet" size={32} onClick={() => setPicked(new Set())}>{t("Clear selection")}</Button>
        </div>
      ) : null}
      <div className="nx-table-scroll">
        <table className={cx("nx-table", density === "comfortable" && "nx-table-roomy")} aria-rowcount={total ?? rows.length}>
          <caption className="nx-sr">{caption}</caption>
          <thead>
            <tr>
              {selectable ? (
                <th scope="col" className="nx-th nx-td-check">
                  <input
                    type="checkbox"
                    className="nx-check"
                    checked={allOn}
                    onChange={() => setPicked(allOn ? new Set() : new Set(allKeys))}
                    aria-label={t("Select all {n} rows", { n: formatInt(allKeys.length) })}
                  />
                </th>
              ) : null}
              {visible.map((c) => {
                const dir = sort?.id === c.id ? sort.dir : null;
                return (
                  <th key={c.id} scope="col" className={cx("nx-th", c.align === "end" && "nx-end")} aria-sort={c.compare ? (dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none") : undefined}>
                    {c.compare ? (
                      <button type="button" className="nx-th-btn" onClick={() => cycleSort(c.id)}>
                        {c.label}
                        <Icon name={dir === "desc" ? "arrow-down" : dir === "asc" ? "arrow-up" : "chevron-down"} />
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>
      <div role="status" aria-live="polite" className="nx-sr">{announce}</div>
    </div>
  );
}
