import type { SortingState, VisibilityState } from "@tanstack/react-table";
import { readPrefs, setPreferences } from "../../lib/preferences";

/** A saved table view: which columns are shown, row density and sort. Kept in the user's preferences (`saved_views`, by table id). */
export interface TableView {
  name: string;
  visibility: VisibilityState;
  dense: boolean;
  sorting: SortingState;
  /** The page's own filters (its URL parameters) when the table was saved with `viewParams`; the page applies them. */
  params?: Record<string, string>;
}

/** Where views lived before they moved into the preferences document; read once as a fallback, removed on the next write. */
const legacyKey = (tableId: string) => `m-table-views:${tableId}`;

function valid(parsed: unknown): TableView[] {
  return Array.isArray(parsed) ? (parsed as TableView[]).filter((v) => typeof v?.name === "string") : [];
}

export function loadViews(tableId: string): TableView[] {
  const stored = readPrefs().saved_views?.[tableId];
  if (stored) return valid(stored);
  try {
    const raw = window.localStorage.getItem(legacyKey(tableId));
    return valid(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

function persist(tableId: string, views: TableView[]): void {
  try {
    window.localStorage.removeItem(legacyKey(tableId));
  } catch {
    // storage blocked: nothing to clean up
  }
  setPreferences({ saved_views: { [tableId]: views.length > 0 ? views : null } });
}

/** Removes every saved view, in the preferences document and in any pre-sync localStorage key. */
export function resetSavedViews(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith("m-table-views:")) stale.push(k);
    }
    stale.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // storage blocked: nothing to clean up
  }
  setPreferences({ saved_views: null });
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
