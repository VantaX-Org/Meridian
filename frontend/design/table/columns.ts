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
