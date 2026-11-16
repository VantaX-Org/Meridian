"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface Column<T> {
  key: string;
  label: string;
  /** Cell content; defaults to the row's field of the same key. */
  render?: (row: T) => ReactNode;
  /** Makes the column sortable by this value. */
  sort?: (row: T) => string | number;
  align?: "end";
}

/**
 * A table that renders only the rows in view (fixed `rowHeight`, scroll box `height`), with a sticky header, sortable
 * columns, one selected row and arrow-key navigation (Up, Down, Home, End; Enter or Space selects).
 */
export function DataTable<T>({ columns, rows, rowKey, label, selected, onSelect, height = 360, rowHeight = 40 }: {
  columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; label: string;
  selected?: string | null; onSelect?: (row: T) => void; height?: number; rowHeight?: number;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [top, setTop] = useState(0);
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const sorted = useMemo(() => {
    const c = sort && columns.find((x) => x.key === sort.key);
    if (!sort || !c?.sort) return rows;
    const f = c.sort;
    return [...rows].sort((a, b) => (f(a) < f(b) ? -sort.dir : f(a) > f(b) ? sort.dir : 0));
  }, [rows, sort, columns]);

  const per = Math.ceil(height / rowHeight) + 4;
  const first = Math.max(0, Math.min(Math.floor(top / rowHeight) - 2, Math.max(0, sorted.length - per)));
  const last = Math.min(sorted.length, first + per);
  const cur = Math.min(at, Math.max(0, sorted.length - 1));

  const move = (i: number) => {
    const n = Math.max(0, Math.min(sorted.length - 1, i));
    setAt(n);
    const el = box.current;
    if (el) {
      if (n * rowHeight < el.scrollTop) el.scrollTop = n * rowHeight;
      else if ((n + 1) * rowHeight > el.scrollTop + height - rowHeight) el.scrollTop = (n + 1) * rowHeight - height + rowHeight;
    }
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(cur + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(cur - 1); }
    else if (e.key === "Home") { e.preventDefault(); move(0); }
    else if (e.key === "End") { e.preventDefault(); move(sorted.length - 1); }
    else if ((e.key === "Enter" || e.key === " ") && sorted[cur]) { e.preventDefault(); onSelect?.(sorted[cur]); }
  };
  const flip = (c: Column<T>) => setSort((s) => (s?.key === c.key ? (s.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }));

  return (
    <div ref={box} className="mx-table" style={{ blockSize: height }} onScroll={(e) => setTop(e.currentTarget.scrollTop)} onKeyDown={key} tabIndex={0} role="group" aria-activedescendant={sorted[cur] ? `mx-row-${rowKey(sorted[cur])}` : undefined} aria-label={label}>
      <table role="grid" aria-rowcount={sorted.length + 1}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" data-align={c.align} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : c.sort ? "none" : undefined}>
                {c.sort ? <button type="button" onClick={() => flip(c)}>{c.label}</button> : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {first > 0 ? <tr aria-hidden="true" style={{ blockSize: first * rowHeight }} /> : null}
          {sorted.slice(first, last).map((r, j) => {
            const id = rowKey(r);
            return (
              <tr key={id} id={`mx-row-${id}`} style={{ blockSize: rowHeight }} aria-rowindex={first + j + 2} aria-selected={selected === id} data-active={first + j === cur ? "" : undefined} onClick={() => { setAt(first + j); onSelect?.(r); }}>
                {columns.map((c) => <td key={c.key} data-align={c.align}>{c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? "")}</td>)}
              </tr>
            );
          })}
          {last < sorted.length ? <tr aria-hidden="true" style={{ blockSize: (sorted.length - last) * rowHeight }} /> : null}
        </tbody>
      </table>
    </div>
  );
}
