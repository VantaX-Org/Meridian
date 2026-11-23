"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { whole } from "@/lib/v2/format";
import { Confirm } from "./Confirm";
import { Popover } from "./Popover";
import type { GridApi } from "./useGridState";

export interface Column<T> {
  key: string;
  label: string;
  /** Cell content; defaults to the row's field of the same key. */
  render?: (row: T) => ReactNode;
  /** Makes the column sortable by this value. */
  sort?: (row: T) => string | number;
  align?: "end";
  /** v2: may the user hide this column. Default true. */
  hideable?: boolean;
  /** v2: starts hidden until the user shows it. */
  defaultHidden?: boolean;
  /** v2: starting width in px. The user can resize it. */
  width?: number;
  /** The plain value a filter chip or a group matches on. Defaults to `sort`, then the row's field of the same key. */
  value?: (row: T) => string | number;
  /** May the rows be grouped by this column. */
  groupable?: boolean;
  /** Makes the cell editable: F2 (or Enter, when the table has no `onSelect` or `rowHref`) edits it, Enter commits, Escape cancels. */
  edit?: { value: (row: T) => string; onCommit: (row: T, value: string) => void; label: string };
}

/** One filter chip group: each option is a chip; chosen values narrow the rows by `column`'s value. */
export interface TableFilter { column: string; label: string; options: { value: string; label: string }[] }

export interface BulkAction { id: string; label: string; danger?: boolean; run: (keys: string[]) => void }
export interface TablePaging { page: number; pageSize: number; total: number; onPage: (page: number) => void; onPageSize: (size: number) => void }
export const PAGE_SIZES = [25, 50, 100, 250];

type Density = "compact" | "comfortable";
interface Prefs { hidden: string[]; order: string[]; widths: Record<string, number>; density: Density; sort: { key: string; dir: 1 | -1 } | null }
interface SavedView { name: string; prefs: Prefs }

const read = <V,>(k: string, d: V): V => { try { const v = window.localStorage.getItem(k); return v ? (JSON.parse(v) as V) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage may be blocked; the table still works */ } };

/**
 * A table that renders only the rows in view (fixed `rowHeight`, scroll box `height`), with a sticky header, sortable
 * columns, one selected row and arrow-key navigation (Up, Down, Home, End; Enter or Space selects).
 */
export function DataTable<T>({ columns: allColumns, rows, rowKey, label, selected: selectedProp, onSelect, height = 360, rowHeight = 32, expand, id, selection, selectedKeys, onSelectedKeys, bulkActions, matching, onSelectAllMatching, paging, footer, toolbar, grid: gridApi, filters, groupSum, stickyFirst, bulkBar, density, rowHref }: {
  columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; label: string;
  selected?: string | null; onSelect?: (row: T) => void; height?: number; rowHeight?: number;
  /** v2: a stable table id turns on the toolbar (views, columns, density) and keeps the user's choices per table. */
  id?: string;
  /** v2: `multi` adds a checkbox column. The caller owns `selectedKeys`. */
  selection?: "multi"; selectedKeys?: string[]; onSelectedKeys?: (keys: string[]) => void;
  bulkActions?: BulkAction[];
  /** v2: how many rows match in all. When above the loaded rows, a strip offers to select them all. */
  matching?: number; onSelectAllMatching?: () => void;
  /** v2: server paging. Shows the paging footer. Without it, `footer` shows only the row count. */
  paging?: TablePaging; footer?: boolean;
  /** v2: extra toolbar content, for example an ExportMenu. */
  toolbar?: ReactNode;
  /** URL state from `useGridState`: sort, filters, group and the open row. Without it the table keeps them in its own state. */
  grid?: GridApi;
  /** A chip row that narrows the rows. */
  filters?: TableFilter[];
  /** Group headers show the row count and this sum. */
  groupSum?: { label: string; value: (row: T) => number };
  /** The first column stays in view when the table scrolls sideways. */
  stickyFirst?: boolean;
  /** Extra content in the bar that appears while rows are selected. */
  bulkBar?: (keys: string[]) => ReactNode;
  /** Forces the row height; otherwise the user's saved choice applies. */
  density?: Density;
  /** Makes each row a real link: the first cell holds an anchor that fills the row, and Enter follows it. */
  rowHref?: (row: T) => string;
  /** Opens one row in place: the row with key `id` gets a full-width panel of fixed `height` under it. */
  expand?: { id: string | null; height: number; render: (row: T) => ReactNode };
}) {
  const [localSort, setLocalSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [localFilters, setLocalFilters] = useState<Record<string, string[]>>({});
  const [localGroup, setLocalGroup] = useState<string | null>(null);
  const [localOpen, setLocalOpen] = useState<string | null>(null);
  const [folded, setFolded] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ row: string; col: string; text: string } | null>(null);
  const sort = gridApi ? (gridApi.sort ? { key: gridApi.sort.key, dir: gridApi.sort.dir === "desc" ? -1 as const : 1 as const } : null) : localSort;
  const setSort = (n: { key: string; dir: 1 | -1 } | null) => (gridApi ? gridApi.setSort(n ? { key: n.key, dir: n.dir === -1 ? "desc" : "asc" } : null) : setLocalSort(n));
  const active = gridApi ? gridApi.filters : localFilters;
  const setFilter = (c: string, v: string[]) => (gridApi ? gridApi.setFilter(c, v) : setLocalFilters((f) => ({ ...f, [c]: v })));
  const groupKey = gridApi ? gridApi.groupBy : localGroup;
  const setGroup = (c: string | null) => (gridApi ? gridApi.setGroupBy(c) : setLocalGroup(c));
  const open = gridApi ? gridApi.open : localOpen;
  const selected = selectedProp !== undefined ? selectedProp : open;
  const base = useMemo<Prefs>(() => ({ hidden: allColumns.filter((c) => c.defaultHidden).map((c) => c.key), order: allColumns.map((c) => c.key), widths: {}, density: "compact", sort: null }), [allColumns]);
  const [prefs, setPrefs] = useState<Prefs>(base);
  const [views, setViews] = useState<SavedView[]>([]);
  const [view, setView] = useState<string | null>(null);
  const [ask, setAsk] = useState<BulkAction | null>(null);
  const chrome = !!(id || selection || toolbar || paging || footer || filters?.length || allColumns.some((c) => c.groupable));
  /* Hydrate saved prefs after mount: localStorage is not readable during SSR. */
  useEffect(() => {
    if (!id) return;
    const vs = read<SavedView[]>(`mx.table.${id}.views`, []);
    setViews(vs);
    const named = new URLSearchParams(window.location.search).get("view");
    const hit = named ? vs.find((v) => v.name === named) : undefined;
    const p = hit ? hit.prefs : read<Prefs>(`mx.table.${id}`, base);
    setPrefs({ ...base, ...p });
    setSort(p.sort ?? null);
    setView(hit ? hit.name : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, base]);
  const patch = (next: Partial<Prefs>) => setPrefs((p) => { const n = { ...p, ...next }; if (id) write(`mx.table.${id}`, n); return n; });
  const columns = useMemo(() => {
    const by = new Map(allColumns.map((c) => [c.key, c]));
    const ordered = [...prefs.order.filter((k) => by.has(k)), ...allColumns.map((c) => c.key).filter((k) => !prefs.order.includes(k))];
    return ordered.map((k) => by.get(k)!).filter((c) => !prefs.hidden.includes(c.key) || c.hideable === false);
  }, [allColumns, prefs.order, prefs.hidden]);
  const mode = density ?? prefs.density;
  const dense = mode === "comfortable" ? Math.max(rowHeight, 40) : rowHeight;
  rowHeight = dense;
  const [top, setTop] = useState(0);
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const val = (c: Column<T>, r: T): string | number => (c.value ?? c.sort ?? ((x: T) => String((x as Record<string, unknown>)[c.key] ?? "")))(r);
  const sorted = useMemo(() => {
    let out = rows;
    for (const [col, vs] of Object.entries(active)) {
      const c = allColumns.find((x) => x.key === col);
      if (c && vs.length) out = out.filter((r) => vs.includes(String(val(c, r))));
    }
    const c = sort && allColumns.find((x) => x.key === sort.key);
    if (!sort || !c?.sort) return out;
    const f = c.sort;
    return [...out].sort((a, b) => (f(a) < f(b) ? -sort.dir : f(a) > f(b) ? sort.dir : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, allColumns, active]);
  type Item = { kind: "row"; row: T; key: string } | { kind: "group"; key: string; count: number; sum: number | null };
  const items = useMemo<Item[]>(() => {
    const gc = groupKey ? allColumns.find((c) => c.key === groupKey) : undefined;
    if (!gc) return sorted.map((row) => ({ kind: "row", row, key: rowKey(row) }));
    const by = new Map<string, T[]>();
    for (const r of sorted) { const g = String(val(gc, r)); by.set(g, [...(by.get(g) ?? []), r]); }
    return [...by.entries()].flatMap(([g, rs]): Item[] => [
      { kind: "group", key: g, count: rs.length, sum: groupSum ? rs.reduce((a, r) => a + groupSum.value(r), 0) : null },
      ...(folded.includes(g) ? [] : rs.map((row): Item => ({ kind: "row", row, key: rowKey(row) }))),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, groupKey, allColumns, folded, groupSum]);
  const activeRow = (i: number): T | null => { const it = items[i]; return it && it.kind === "row" ? it.row : null; };

  const exp = expand?.id != null ? items.findIndex((r) => r.kind === "row" && r.key === expand.id) : -1;
  const extra = exp >= 0 && expand ? expand.height : 0;
  const per = items.length <= 200 ? items.length : Math.ceil(height / rowHeight) + 4 + Math.ceil(extra / rowHeight);
  const eff = exp >= 0 && exp * rowHeight < top ? Math.max(0, top - extra) : top;
  const first = Math.max(0, Math.min(Math.floor(eff / rowHeight) - 2, Math.max(0, items.length - per)));
  const last = Math.min(items.length, first + per);
  const cur = Math.min(at, Math.max(0, items.length - 1));

  const move = (i: number) => {
    const n = Math.max(0, Math.min(items.length - 1, i));
    setAt(n);
    const el = box.current;
    if (el) {
      const off = exp >= 0 && exp < n ? extra : 0;
      if (n * rowHeight + off < el.scrollTop) el.scrollTop = n * rowHeight + off;
      else if ((n + 1) * rowHeight + off > el.scrollTop + height - rowHeight) el.scrollTop = (n + 1) * rowHeight + off - height + rowHeight;
    }
  };
  const follow = (r: T) => {
    onSelect?.(r);
    gridApi?.setOpen(rowKey(r));
    if (!gridApi) setLocalOpen(rowKey(r));
  };
  const startEdit = (r: T): boolean => {
    const c = columns.find((x) => x.edit);
    if (!c?.edit) return false;
    setEditing({ row: rowKey(r), col: c.key, text: c.edit.value(r) });
    return true;
  };
  const commit = () => {
    if (!editing) return;
    const r = rows.find((x) => rowKey(x) === editing.row);
    const c = allColumns.find((x) => x.key === editing.col);
    if (r && c?.edit && editing.text !== c.edit.value(r)) c.edit.onCommit(r, editing.text);
    setEditing(null);
  };
  const stepTo = (i: number) => {
    move(i);
    const r = activeRow(Math.max(0, Math.min(items.length - 1, i)));
    if (r && open != null) { gridApi?.setOpen(rowKey(r)); if (!gridApi) setLocalOpen(rowKey(r)); }
  };
  const key = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (/^(input|textarea|select)$/i.test(el.tagName) && el.getAttribute("type") !== "checkbox") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const r = activeRow(cur);
    const it = items[cur];
    if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") { e.preventDefault(); stepTo(cur + 1); }
    else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") { e.preventDefault(); stepTo(cur - 1); }
    else if (e.key === "Home") { e.preventDefault(); stepTo(0); }
    else if (e.key === "End") { e.preventDefault(); stepTo(items.length - 1); }
    else if ((e.key === "x" || e.key === "X") && selection && r) { e.preventDefault(); flipOne(rowKey(r)); }
    else if (e.key === "Escape") {
      if (picked.length) { e.preventDefault(); onSelectedKeys?.([]); }
      else if (open != null) { e.preventDefault(); gridApi?.setOpen(null); if (!gridApi) setLocalOpen(null); }
    }
    else if (e.key === "F2" && r) { if (startEdit(r)) e.preventDefault(); }
    else if (e.key === "Enter" && it?.kind === "group") { e.preventDefault(); setFolded((f) => (f.includes(it.key) ? f.filter((x) => x !== it.key) : [...f, it.key])); }
    else if ((e.key === "Enter" || e.key === " ") && r) {
      e.preventDefault();
      if (e.key === "Enter" && !onSelect && !rowHref && startEdit(r)) return;
      if (e.key === "Enter" && rowHref) { document.getElementById(`mx-row-${rowKey(r)}`)?.querySelector<HTMLAnchorElement>("a.mx-dt-link")?.click(); return; }
      follow(r);
    }
  };
  const flip = (c: Column<T>) => {
    const n = sort?.key === c.key ? (sort.dir === 1 ? { key: c.key, dir: -1 as const } : null) : { key: c.key, dir: 1 as const };
    setSort(n);
    if (id) patch({ sort: n });
  };

  const picked = selectedKeys ?? [];
  const all = sorted.length > 0 && sorted.every((r) => picked.includes(rowKey(r)));
  const flipAll = () => onSelectedKeys?.(all ? [] : sorted.map(rowKey));
  const flipOne = (k: string) => onSelectedKeys?.(picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k]);
  const span = columns.length + (selection ? 1 : 0);
  const move2 = (k: string, d: -1 | 1) => {
    const o = [...prefs.order]; const i = o.indexOf(k); const j = i + d;
    if (i < 0 || j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]]; patch({ order: o });
  };
  const resize = (k: string, w: number) => patch({ widths: { ...prefs.widths, [k]: Math.max(64, w) } });
  const current = JSON.stringify({ ...prefs, sort });
  const saved = views.find((v) => v.name === view);
  const modified = id ? current !== JSON.stringify(saved ? saved.prefs : { ...base, sort: null }) : false;
  const saveView = (name: string) => {
    const n = name.trim(); if (!n || !id) return;
    const next = [...views.filter((v) => v.name !== n), { name: n, prefs: { ...prefs, sort } }];
    setViews(next); write(`mx.table.${id}.views`, next); setView(n);
    const u = new URL(window.location.href); u.searchParams.set("view", n); window.history.replaceState(null, "", u);
  };
  const pickView = (v: SavedView | null) => {
    const p = v ? v.prefs : base;
    setPrefs({ ...base, ...p }); setSort(p.sort ?? null); setView(v?.name ?? null);
    if (id) write(`mx.table.${id}`, p);
    const u = new URL(window.location.href); if (v) u.searchParams.set("view", v.name); else u.searchParams.delete("view");
    window.history.replaceState(null, "", u);
  };
  const dropView = (name: string) => {
    const next = views.filter((v) => v.name !== name); setViews(next); if (id) write(`mx.table.${id}.views`, next);
    if (view === name) pickView(null);
  };
  const run = (a: BulkAction) => { if (a.danger) setAsk(a); else a.run(picked); };

  const grid = (
    <div ref={box} className="mx-table" style={{ maxBlockSize: height }} onScroll={(e) => setTop(e.currentTarget.scrollTop)} onKeyDown={key} tabIndex={0} role="group" aria-activedescendant={activeRow(cur) ? `mx-row-${rowKey(activeRow(cur)!)}` : undefined} aria-label={label}>
      <table role="grid" aria-rowcount={items.length + 1}>
        <thead>
          <tr>
            {selection ? <th scope="col" className="mx-dt-check"><input type="checkbox" aria-label={t("Select all rows")} checked={all} onChange={flipAll} /></th> : null}
            {columns.map((c) => (
              <th key={c.key} scope="col" data-align={c.align} style={prefs.widths[c.key] ?? c.width ? { inlineSize: prefs.widths[c.key] ?? c.width } : undefined} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : c.sort ? "none" : undefined}>
                {c.sort ? <button type="button" onClick={() => flip(c)}>{c.label}</button> : c.label}
                {id ? <span className="mx-dt-grip" role="separator" aria-orientation="vertical" aria-label={t("Resize column {name}", { name: c.label })} aria-valuenow={prefs.widths[c.key] ?? c.width ?? 160} aria-valuemin={64} aria-valuemax={2000} tabIndex={0}
                  onKeyDown={(e) => { const w = prefs.widths[c.key] ?? c.width ?? 160; if (e.key === "ArrowRight") { e.preventDefault(); resize(c.key, w + 16); } else if (e.key === "ArrowLeft") { e.preventDefault(); resize(c.key, w - 16); } }}
                  onPointerDown={(e) => { const x0 = e.clientX; const w0 = prefs.widths[c.key] ?? c.width ?? (e.currentTarget.parentElement?.offsetWidth ?? 160); const mv = (ev: PointerEvent) => resize(c.key, w0 + ev.clientX - x0); const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); }; window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); }}
                  onDoubleClick={() => patch({ widths: Object.fromEntries(Object.entries(prefs.widths).filter(([k]) => k !== c.key)) })} /> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {first > 0 ? <tr aria-hidden="true" style={{ blockSize: first * rowHeight + (exp >= 0 && exp < first ? extra : 0) }} /> : null}
          {items.slice(first, last).map((it, j) => {
            if (it.kind === "group") {
              const shut = folded.includes(it.key);
              const gc = allColumns.find((c) => c.key === groupKey);
              return (
                <tr key={`g:${it.key}`} className="mx-dt-group" style={{ blockSize: rowHeight }} aria-rowindex={first + j + 2} data-active={first + j === cur ? "" : undefined}>
                  <td colSpan={span}>
                    <button type="button" aria-expanded={!shut} onClick={() => setFolded((f) => (shut ? f.filter((x) => x !== it.key) : [...f, it.key]))}>
                      <span aria-hidden="true">{shut ? "\u25B8" : "\u25BE"}</span> {gc?.label}: {it.key}
                    </button>
                    <span className="mx-dt-group-n">{t("{n} rows", { n: whole(it.count) })}{groupSum && it.sum != null ? `, ${groupSum.label} ${whole(it.sum)}` : ""}</span>
                  </td>
                </tr>
              );
            }
            const r = it.row;
            const id = it.key;
            return (
              <Fragment key={id}>
              <tr id={`mx-row-${id}`} style={{ blockSize: rowHeight }} aria-rowindex={first + j + 2} aria-selected={selected === id} data-active={first + j === cur ? "" : undefined} onClick={() => { setAt(first + j); follow(r); }}>
                {selection ? <td className="mx-dt-check" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={t("Select row")} checked={picked.includes(id)} onChange={() => flipOne(id)} /></td> : null}
                {columns.map((c, ci) => {
                  const ed = editing && editing.row === id && editing.col === c.key && c.edit ? editing : null;
                  return (
                    <td key={c.key} data-align={c.align} data-sticky={stickyFirst && ci === 0 ? "" : undefined} onDoubleClick={c.edit ? () => startEdit(r) : undefined}>
                      {ed && c.edit ? (
                        <input className="mx-input mx-dt-edit" autoFocus aria-label={c.edit.label} value={ed.text}
                          onChange={(e) => setEditing({ ...ed, text: e.target.value })}
                          onBlur={commit}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); commit(); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditing(null); } }} />
                      ) : (
                        <>
                          {rowHref && ci === 0 ? <a className="mx-dt-link" href={rowHref(r)} onClick={(e) => e.stopPropagation()} aria-label={c.sort ? String(c.sort(r)) : undefined} /> : null}
                          {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? "")}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
              {expand && expand.id === id ? <tr className="mx-expand" style={{ blockSize: expand.height }}><td colSpan={span}>{expand.render(r)}</td></tr> : null}
              </Fragment>
            );
          })}
          {last < items.length ? <tr aria-hidden="true" style={{ blockSize: (items.length - last) * rowHeight + (exp >= last ? extra : 0) }} /> : null}
        </tbody>
      </table>
    </div>
  );
  if (!chrome) return grid;

  const n = picked.length;
  const from = paging ? (paging.page - 1) * paging.pageSize + 1 : 0;
  const pages = paging ? Math.max(1, Math.ceil(paging.total / paging.pageSize)) : 1;
  return (
    <div className="mx-dt" data-density={mode}>
      {n > 0 && selection ? (
        <div className="mx-dt-bar mx-dt-bulk" role="toolbar" aria-label={t("Bulk actions")}>
          <strong>{t("{n} selected", { n: whole(n) })}</strong>
          {bulkBar?.(picked)}
          {bulkActions?.map((a) => <button key={a.id} type="button" className="mx-btn" data-danger={a.danger ? "" : undefined} onClick={() => run(a)}>{a.label}</button>)}
          <button type="button" className="mx-btn" data-variant="ghost" onClick={() => onSelectedKeys?.([])}>{t("Clear")}</button>
        </div>
      ) : (id || toolbar || filters?.length || allColumns.some((c) => c.groupable)) ? (
        <div className="mx-dt-bar" role="toolbar" aria-label={t("Table tools")}>
          {id ? (
            <Popover label={t("View")} align="start" trigger={<>{t("View")}: {view ?? t("Default")}{modified ? <span className="mx-dt-mod"> {t("Modified")}</span> : null}</>}>
              {(close) => (
                <>
                  <button type="button" className="mx-btn" data-variant="ghost" aria-pressed={view === null} onClick={() => { pickView(null); close(); }}>{t("Default")}</button>
                  {views.map((v) => (
                    <div key={v.name} className="mx-dt-view">
                      <button type="button" className="mx-btn" data-variant="ghost" aria-pressed={view === v.name} onClick={() => { pickView(v); close(); }}>{v.name}</button>
                      <button type="button" className="mx-btn" data-variant="ghost" aria-label={t("Delete view {name}", { name: v.name })} onClick={() => dropView(v.name)}>{t("Delete")}</button>
                    </div>
                  ))}
                  <form className="mx-dt-view" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget).get("name"); if (typeof f === "string") { saveView(f); close(); } }}>
                    <input name="name" className="mx-input" aria-label={t("View name")} placeholder={t("View name")} defaultValue={view ?? ""} />
                    <button type="submit" className="mx-btn">{t("Save view")}</button>
                  </form>
                </>
              )}
            </Popover>
          ) : null}
          {id ? (
            <Popover label={t("Columns")} align="start" trigger={t("Columns")}>
              {() => (
                <>
                  {prefs.order.filter((k) => allColumns.some((c) => c.key === k)).concat(allColumns.map((c) => c.key).filter((k) => !prefs.order.includes(k))).map((k) => {
                    const c = allColumns.find((x) => x.key === k)!;
                    const on = !prefs.hidden.includes(k);
                    return (
                      <div key={k} className="mx-dt-col" onKeyDown={(e) => { if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); move2(k, -1); } else if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); move2(k, 1); } }}>
                        <label><input type="checkbox" checked={on} disabled={c.hideable === false} onChange={() => patch({ hidden: on ? [...prefs.hidden, k] : prefs.hidden.filter((x) => x !== k) })} /> {c.label}</label>
                        <button type="button" className="mx-btn" data-variant="ghost" aria-label={t("Move {name} earlier", { name: c.label })} onClick={() => move2(k, -1)}>{"\u2191"}</button>
                        <button type="button" className="mx-btn" data-variant="ghost" aria-label={t("Move {name} later", { name: c.label })} onClick={() => move2(k, 1)}>{"\u2193"}</button>
                      </div>
                    );
                  })}
                  <button type="button" className="mx-btn" onClick={() => patch({ hidden: base.hidden, order: base.order, widths: {} })}>{t("Reset columns")}</button>
                </>
              )}
            </Popover>
          ) : null}
          {id ? <button type="button" className="mx-btn" aria-pressed={prefs.density === "comfortable"} onClick={() => patch({ density: prefs.density === "compact" ? "comfortable" : "compact" })}>{prefs.density === "compact" ? t("Comfortable rows") : t("Compact rows")}</button> : null}
          {allColumns.some((c) => c.groupable) ? (
            <label className="mx-dt-groupby">{t("Group by")}{" "}
              <select value={groupKey ?? ""} onChange={(e) => setGroup(e.target.value || null)}>
                <option value="">{t("None")}</option>
                {allColumns.filter((c) => c.groupable).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </label>
          ) : null}
          {filters?.map((f) => (
            <span key={f.column} className="mx-dt-chips" role="group" aria-label={f.label}>
              {f.options.map((o) => {
                const on = (active[f.column] ?? []).includes(o.value);
                return <button key={o.value} type="button" className="mx-chip-btn" data-selected={on ? "true" : undefined} aria-pressed={on} onClick={() => setFilter(f.column, on ? (active[f.column] ?? []).filter((x) => x !== o.value) : [...(active[f.column] ?? []), o.value])}>{o.label}</button>;
              })}
            </span>
          ))}
          {Object.values(active).some((v) => v.length) ? <button type="button" className="mx-btn" data-variant="ghost" onClick={() => (gridApi ? gridApi.clearFilters() : setLocalFilters({}))}>{t("Clear filters")}</button> : null}
          <span className="mx-dt-grow" />
          {toolbar}
        </div>
      ) : null}
      {selection && all && matching && matching > sorted.length && onSelectAllMatching ? (
        <div className="mx-dt-strip">
          {t("All {n} rows on this page are selected.", { n: whole(sorted.length) })}{" "}
          <button type="button" className="mx-btn" data-variant="ghost" onClick={onSelectAllMatching}>{t("Select all {n} that match", { n: whole(matching) })}</button>
        </div>
      ) : null}
      {grid}
      {paging || footer ? (
        <div className="mx-dt-foot">
          {paging ? (
            <>
              <span>{paging.total === 0 ? t("{n} rows", { n: "0" }) : t("{a} to {b} of {total}", { a: whole(from), b: whole(Math.min(paging.total, from + paging.pageSize - 1)), total: whole(paging.total) })}</span>
              <label>{t("Rows per page")} <select value={paging.pageSize} onChange={(e) => paging.onPageSize(Number(e.target.value))}>{PAGE_SIZES.map((z) => <option key={z} value={z}>{z}</option>)}</select></label>
              <button type="button" className="mx-btn" aria-label={t("Previous page")} disabled={paging.page <= 1} onClick={() => paging.onPage(paging.page - 1)}>{"\u2039"}</button>
              <span>{t("Page {p} of {n}", { p: whole(paging.page), n: whole(pages) })}</span>
              <button type="button" className="mx-btn" aria-label={t("Next page")} disabled={paging.page >= pages} onClick={() => paging.onPage(paging.page + 1)}>{"\u203A"}</button>
            </>
          ) : <span>{t("{n} rows", { n: whole(sorted.length) })}</span>}
        </div>
      ) : null}
      <Confirm open={!!ask} danger title={ask?.label ?? ""} confirmLabel={ask?.label ?? ""} cancelLabel={t("Cancel")} onCancel={() => setAsk(null)} onConfirm={() => { const a = ask; setAsk(null); a?.run(picked); }}>
        <p>{t("This applies to {n} rows.", { n: whole(n) })}</p>
      </Confirm>
    </div>
  );
}
