import type { ColumnDef } from "@tanstack/react-table";

/** Optional `columnDef.meta` flags read by DataTable: right-aligned numeric, or identifier rendered in Mono. */
export interface CellMeta { numeric?: boolean; mono?: boolean }

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
