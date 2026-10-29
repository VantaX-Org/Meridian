import type { ColumnDef } from "@tanstack/react-table";

/** Optional `columnDef.meta` flags read by DataTable: right-aligned numeric, or identifier rendered in Mono. */
export interface CellMeta {
  numeric?: boolean;
  mono?: boolean;
  /** The cell value is a severity (critical, high, medium, low, pass): the row gets a 3px tone bar on its first cell. */
  severity?: boolean;
  /** Numeric cells are filled from the sequential or diverging ramp; the header shows a legend strip. */
  heat?: "seq" | "div";
  /** Value range for the ramp. Defaults to the column's min and max (div: symmetric around 0). */
  heatRange?: readonly [number, number];
  /** Draws a 56x6 inline bar (aria-hidden) beside the number. `seq` fills by quintile of value/max, `rate` by pass-rate tone (value/max: >= 0.95 pass, >= 0.8 medium, else critical). */
  bar?: { max: number; tone?: "seq" | "rate" };
  /** Pins the column while the table scrolls sideways: "start" to the left edge (the row's name), "end" to the right edge (the row's action). */
  sticky?: "start" | "end";
  /** "low": the column hides below 640px so a phone keeps the row's name, its key figure and its action in view. */
  priority?: "low";
}

/** Column ids that hold a row's action ("Open", "Fix"): DataTable pins them to the right edge unless told otherwise. */
const ACTION_COLUMN_IDS = new Set(["action", "actions"]);

/** Column ids that hold a row's status or verdict: they stay in view on a phone, whatever a page marks as low priority. */
const STATUS_COLUMN_IDS = /^(status|verdict|state|severity|outcome|health)$/i;

/** True for the row's action column (id `action` or `actions`). */
export function isActionColumn(id: string): boolean {
  return ACTION_COLUMN_IDS.has(id);
}

/** True for the column that holds the row's status or verdict: a severity column, or one named like a status. */
export function isStatusColumn(id: string, meta: CellMeta | undefined): boolean {
  return !!meta?.severity || STATUS_COLUMN_IDS.test(id);
}

/**
 * A column's meta as DataTable lays it out: an action column (id `action` or `actions`) is pinned to the right
 * edge by default, so on a phone a table wider than its card scrolls under the action and never clips it ("Ope").
 * The action and the status or verdict column are never low priority: a phone always keeps what the row says and
 * what to do about it.
 */
export function layoutMeta(id: string, meta: CellMeta | undefined): CellMeta | undefined {
  let out = meta;
  if (ACTION_COLUMN_IDS.has(id) && out?.sticky === undefined) out = { ...out, sticky: "end" };
  if (out?.priority === "low" && (isActionColumn(id) || isStatusColumn(id, out))) {
    const { priority: dropped, ...rest } = out;
    void dropped;
    out = rest;
  }
  return out;
}

/**
 * Classes DataTable puts on a column's header and body cells for `sticky` and `priority`. A pinned action keeps to
 * one line, so "Open" never breaks or wraps beside a long name.
 */
export function columnLayoutClass(meta: CellMeta | undefined): string {
  return [
    meta?.sticky === "start" ? "sticky left-0" : meta?.sticky === "end" ? "sticky right-0 whitespace-nowrap" : "",
    meta?.priority === "low" ? "max-[640px]:hidden" : "",
  ].filter(Boolean).join(" ");
}

/** Bar fill percentage (0 to 100) and the data attribute the fill carries. */
export function barFill(value: unknown, bar: NonNullable<CellMeta["bar"]>): { pct: number; attr: { "data-tone"?: string; "data-step"?: number } } | null {
  if (typeof value !== "number" || !Number.isFinite(value) || bar.max <= 0) return null;
  const t = Math.min(1, Math.max(0, value / bar.max));
  if (bar.tone === "rate") return { pct: t * 100, attr: { "data-tone": t >= 0.95 ? "pass" : t >= 0.8 ? "medium" : "critical" } };
  return { pct: t * 100, attr: { "data-step": Math.min(5, Math.floor(t * 5) + 1) } };
}

export function idColumn<T>(accessor: keyof T & string, header: string): ColumnDef<T> {
  return { accessorKey: accessor, header, meta: { mono: true } satisfies CellMeta, cell: (info) => String(info.getValue() ?? "") };
}

export function textColumn<T>(accessor: keyof T & string, header: string): ColumnDef<T> {
  return { accessorKey: accessor, header, cell: (info) => String(info.getValue() ?? "") };
}

export function numberColumn<T>(accessor: keyof T & string, header: string): ColumnDef<T> {
  return {
    accessorKey: accessor,
    header,
    meta: { numeric: true } satisfies CellMeta,
    cell: (info) => {
      const v = info.getValue();
      return typeof v === "number" ? v.toLocaleString() : String(v ?? "");
    },
  };
}
