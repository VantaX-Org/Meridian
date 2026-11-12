import { isValidElement, type ReactNode } from "react";
import { t } from "@/lib/v2/i18n";

/**
 * What the grid tools export and remember (step 6c), as pure functions:
 *   nodeText        the readable text of a cell (the strings inside its elements; marks and icons say nothing)
 *   hiddenColumns   the column ids a grid hides, from the same localStorage key Grid.tsx writes (m2:cols:<id>)
 *   visibleColumns  the columns on screen, in order
 *   exportRows      the rows as {column id: text}, numbers kept as numbers when the cell is only a number
 *   columnsFromHidden / hiddenFromColumns  the /views `columns` list and Grid's hidden list, both ways
 */

export interface ToolColumn<T> {
  id: string;
  header: string;
  cell: (row: T, index: number) => ReactNode;
  numeric?: boolean;
  defaultHidden?: boolean;
}

export function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode; code?: unknown };
    if (typeof props.code === "string") return props.code; // Coded / CodeWithText: the code; its words go in their own column
    return nodeText(props.children);
  }
  return "";
}

/** The words of the first code in a cell (Coded / CodeWithText `text`), or "" when the cell holds no described code. */
export function nodeDescription(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(nodeDescription).find(Boolean) ?? "";
  if (!isValidElement(node)) return "";
  const props = node.props as { children?: ReactNode; code?: unknown; text?: unknown };
  if (typeof props.code === "string") return typeof props.text === "string" && props.text !== props.code ? props.text : "";
  return nodeDescription(props.children);
}

/** The columns to export: each column whose cells hold described codes gets a "<header> description" column beside it. */
export function exportColumns<T>(rows: readonly T[], columns: readonly ToolColumn<T>[]): ToolColumn<T>[] {
  return columns.flatMap((c) =>
    rows.some((r, i) => nodeDescription(c.cell(r, i)))
      ? [c, { id: `${c.id}__text`, header: t("{header} description", { header: c.header }), cell: (r: T, i: number) => nodeDescription(c.cell(r, i)) }]
      : [c],
  );
}

export const colsKey = (gridId: string): string => `m2:cols:${gridId}`;

export function hiddenColumns<T>(gridId: string, columns: readonly ToolColumn<T>[]): Set<string> {
  try {
    const raw = window.localStorage.getItem(colsKey(gridId));
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed.filter((x): x is string => typeof x === "string"));
    }
  } catch {
    /* storage blocked: the defaults */
  }
  return new Set(columns.filter((c) => c.defaultHidden).map((c) => c.id));
}

export function visibleColumns<T>(gridId: string, columns: readonly ToolColumn<T>[]): ToolColumn<T>[] {
  const hidden = hiddenColumns(gridId, columns);
  return columns.filter((c) => !hidden.has(c.id));
}

/** The /views `columns` list (shown ids, in order) for a hidden set. */
export const columnsFromHidden = <T,>(columns: readonly ToolColumn<T>[], hidden: ReadonlySet<string>): string[] => columns.filter((c) => !hidden.has(c.id)).map((c) => c.id);

/** Grid's hidden list for a /views `columns` list: every known column not in it. */
export const hiddenFromColumns = <T,>(columns: readonly ToolColumn<T>[], shown: readonly string[]): string[] => columns.filter((c) => !shown.includes(c.id)).map((c) => c.id);

export function writeHidden(gridId: string, hidden: readonly string[]): void {
  try {
    window.localStorage.setItem(colsKey(gridId), JSON.stringify(hidden));
  } catch {
    /* storage blocked */
  }
}

const NUMBER = /^-?[\d,  ]+(\.\d+)?$/;

export function exportRows<T>(rows: readonly T[], columns: readonly ToolColumn<T>[]): Record<string, string | number | null>[] {
  return rows.map((r, i) =>
    Object.fromEntries(
      columns.map((c) => {
        const text = nodeText(c.cell(r, i)).replace(/\s+/g, " ").trim();
        if (!text || text === "—") return [c.id, null];
        if (c.numeric && NUMBER.test(text)) return [c.id, Number(text.replace(/[,  ]/g, ""))];
        return [c.id, text];
      }),
    ),
  );
}

/** One CSV cell: a value that a spreadsheet would read as a formula is kept as text, and quotes are doubled. */
export function csvCell(v: string | number | null | undefined): string {
  const raw = v == null ? "" : String(v);
  const safe = typeof v === "string" && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Headers then rows as CSV text, every cell guarded. */
export function tableCsv(columns: readonly { key: string; header: string }[], rows: readonly Record<string, string | number | null>[]): string {
  return [columns.map((c) => csvCell(c.header)).join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(","))].join("\n");
}

/** The grid's visible columns (codes with their description column) and rows as CSV, headers first. */
export function gridCsv<T>(rows: readonly T[], shown: readonly ToolColumn<T>[]): string {
  const columns = exportColumns(rows, shown);
  return tableCsv(columns.map((c) => ({ key: c.id, header: c.header })), exportRows(rows, columns));
}

/** Saves CSV text as a file in the browser and returns its name. */
export function downloadCsv(route: string, csv: string): string {
  const name = `${route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "export"}.csv`;
  const url = window.URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
  return name;
}

export const downloadGridCsv = <T,>(route: string, rows: readonly T[], columns: readonly ToolColumn<T>[]): string => downloadCsv(route, gridCsv(rows, columns));

export interface DomTable {
  columns: { key: string; header: string; kind?: "text" | "int" }[];
  rows: Record<string, string | number | null>[];
}

const cellText = (el: Element | null): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/**
 * A rendered table as export data, read from the DOM so it holds what is on screen (the filter, the sort, the columns
 * shown). A cell holding a described code (.m2-cd) gives its code, and its words go in a "<header> description" column.
 * Numbers stay numbers only in m2-num columns. Hidden rows and header cells with no words (a checkbox or action column) are left out.
 */
export function domTable(table: HTMLTableElement): DomTable {
  const heads = [...(table.tHead?.rows[0]?.cells ?? [])].map((th, i) => ({ i, header: cellText(th) }));
  const body = [...table.tBodies].flatMap((b) => [...b.rows]).filter((tr) => !tr.hidden && tr.cells.length >= heads.length);
  const columns: DomTable["columns"] = [];
  const keep = heads.filter((h) => h.header);
  for (const h of keep) {
    const cells = body.map((tr) => tr.cells[h.i]);
    // numbers only where the table marks the column numeric (m2-num): a plant "0001" stays text
    const numeric = cells.length > 0 && cells.every((c) => c?.classList.contains("m2-num") && (!cellText(c) || cellText(c) === "—" || NUMBER.test(cellText(c))));
    if (columns.length >= 78) break; // the export route takes 80 columns
    columns.push({ key: `c${h.i}`, header: h.header.slice(0, 100), kind: numeric ? "int" : "text" });
    if (cells.some((c) => c?.querySelector(".m2-cdt"))) columns.push({ key: `c${h.i}__text`, header: t("{header} description", { header: h.header.slice(0, 80) }) });
  }
  const used = keep.filter((h) => columns.some((c) => c.key === `c${h.i}`));
  const rows = body.map((tr) =>
    Object.fromEntries(
      used.flatMap((h) => {
        const td = tr.cells[h.i];
        const cd = td?.querySelector(".m2-cd");
        const text = cd ? cellText(cd.querySelector(".m2-cdc")) : cellText(td);
        const value: string | number | null = !text || text === "—" ? null : columns.find((c) => c.key === `c${h.i}`)?.kind === "int" ? Number(text.replace(/[,  ]/g, "")) : text;
        const pair: [string, string | number | null][] = [[`c${h.i}`, value]];
        if (columns.some((c) => c.key === `c${h.i}__text`)) pair.push([`c${h.i}__text`, cd ? cellText(cd.querySelector(".m2-cdt")) || null : null]);
        return pair;
      }),
    ),
  );
  return { columns, rows };
}

/** The table's name: its aria-label or caption, else the nearest heading above it, else the page title. */
export function tableTitle(table: HTMLTableElement): string {
  const own = table.getAttribute("aria-label") || cellText(table.caption);
  if (own) return own;
  for (let el: Element | null = table; el; el = el.parentElement) {
    for (let prev = el.previousElementSibling; prev; prev = prev.previousElementSibling) {
      const h = prev.matches("h1,h2,h3,h4") ? prev : prev.querySelector("h1,h2,h3,h4");
      if (h && cellText(h)) return cellText(h);
    }
  }
  return document.title || t("Table");
}
