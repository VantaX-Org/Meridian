import type { ColumnDef } from "@tanstack/react-table";

export function textColumn<T>(accessor: keyof T & string, header: string): ColumnDef<T> {
  return { accessorKey: accessor, header, cell: (info) => String(info.getValue() ?? "") };
}

export function numberColumn<T>(accessor: keyof T & string, header: string): ColumnDef<T> {
  return {
    accessorKey: accessor,
    header,
    cell: (info) => {
      const v = info.getValue();
      return typeof v === "number" ? v.toLocaleString() : String(v ?? "");
    },
  };
}
