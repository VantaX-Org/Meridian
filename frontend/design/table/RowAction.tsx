"use client";

import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import type { CellMeta } from "./columns";

const stop = (e: MouseEvent) => e.stopPropagation();

/** The one style of a row's action, link or button: medium accent ink, underlined on hover. */
export const ROW_ACTION_CLASS = "m-text-body font-medium m-ink-accent-ink underline-offset-2 hover:underline";

/**
 * The row's one action as a link ("Open", "Fix", "Review"). The row's own click opens the same place, so the link
 * keeps the click to itself. Every ledger draws its action through this, so "Open" reads the same on every table.
 */
export function RowAction({ href, children = "Open", label }: { href: string; children?: ReactNode; label?: string }) {
  return (
    <Link href={href} onClick={stop} aria-label={label} className={ROW_ACTION_CLASS}>
      {children}
    </Link>
  );
}

/** A button in the action column, for a row whose action is not a route (Edit, Clear, Retry). */
export function RowActionButton({ onClick, children, label, disabled }: { onClick: () => void; children: ReactNode; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`${ROW_ACTION_CLASS} disabled:opacity-50 disabled:no-underline`}
    >
      {children}
    </button>
  );
}

/** The action column of a ledger: a fixed-width last column with a plain "Action" header, pinned to the right edge when the table scrolls sideways. */
export function actionColumn<T>(cell: (row: T) => ReactNode, header = "Action"): ColumnDef<T> {
  return { id: "action", header, size: 120, enableSorting: false, meta: { sticky: "end" } satisfies CellMeta, cell: ({ row }) => cell(row.original) };
}
