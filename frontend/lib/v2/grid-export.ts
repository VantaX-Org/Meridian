import { isValidElement, type ReactNode } from "react";

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
    const props = node.props as { children?: ReactNode; "aria-label"?: string; title?: string };
    const inner = nodeText(props.children);
    return inner || "";
  }
  return "";
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
