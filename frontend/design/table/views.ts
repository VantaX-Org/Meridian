import type { SortingState, VisibilityState } from "@tanstack/react-table";

/** A saved table view: which columns are shown, row density and sort. Per viewer, in localStorage. */
export interface TableView {
  name: string;
  visibility: VisibilityState;
  dense: boolean;
  sorting: SortingState;
}

const key = (tableId: string) => `m-table-views:${tableId}`;

export function loadViews(tableId: string): TableView[] {
  try {
    const raw = window.localStorage.getItem(key(tableId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as TableView[]).filter((v) => typeof v?.name === "string") : [];
  } catch {
    return [];
  }
}

function persist(tableId: string, views: TableView[]): void {
  try {
    window.localStorage.setItem(key(tableId), JSON.stringify(views));
  } catch {
    // storage blocked or full: the view lives for this session only
  }
}

/** Saves (or replaces by name) a view and returns the new list. */
export function saveView(tableId: string, view: TableView): TableView[] {
  const next = [...loadViews(tableId).filter((v) => v.name !== view.name), view];
  persist(tableId, next);
  return next;
}

export function deleteView(tableId: string, name: string): TableView[] {
  const next = loadViews(tableId).filter((v) => v.name !== name);
  persist(tableId, next);
  return next;
}

/** CSV text; cells starting with a formula character are quoted with a leading apostrophe. */
export function toCsv(headers: string[], rows: string[][]): string {
  const cell = (v: string) => {
    const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\n");
}
