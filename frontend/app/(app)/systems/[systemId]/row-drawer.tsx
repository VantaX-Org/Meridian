"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Drawer } from "@/design";

/**
 * A ledger whose rows open in a drawer, with the row's one action written out as a last "Open" column
 * (a row click and Enter open it too). Pass `open` as the table's `onRowClick` and render `drawer` beside it.
 */
export function useRowDrawer<T>(title: ReactNode, render: (row: T) => ReactNode) {
  const [row, setRow] = useState<T | null>(null);
  const open = useCallback((r: T) => setRow(() => r), []);
  const column = useMemo<ColumnDef<T, unknown>>(() => ({
    id: "open",
    header: "",
    size: 80,
    cell: ({ row: r }) => (
      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setRow(() => r.original); }}>Open</Button>
    ),
  }), []);
  const drawer = (
    <Drawer open={row !== null} onOpenChange={(o) => { if (!o) setRow(null); }} title={title}>
      {row !== null ? render(row) : null}
    </Drawer>
  );
  return { open, drawer, column };
}
