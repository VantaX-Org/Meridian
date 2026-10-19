"use client";

/** The ledger's last column: the row's one action as a link ("Open", "Edit", "Review"). Shared by the MDM, rules and admin pages. */

import type { MouseEvent } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";

const stop = (e: MouseEvent) => e.stopPropagation();

/** A link in the action column. The row's own click opens the same place, so the link keeps the click to itself. */
export function RowLink({ href, children = "Open", label }: { href: string; children?: string; label?: string }) {
  return (
    <Link href={href} onClick={stop} aria-label={label} className="m-text-body font-medium m-ink-accent-ink hover:underline">
      {children}
    </Link>
  );
}

/** A button in the action column, for a row whose action is not a route (Edit, Clear, Retry). */
export function RowButton({ onClick, children, label, disabled }: { onClick: () => void; children: string; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="m-text-body font-medium m-ink-accent-ink hover:underline disabled:opacity-50 disabled:no-underline"
    >
      {children}
    </button>
  );
}

/** The action column of a ledger: a fixed-width last column with a plain "Action" header. */
export function actionColumn<T>(cell: (row: T) => React.ReactNode, header = "Action"): ColumnDef<T> {
  return { id: "action", header, size: 120, enableSorting: false, cell: ({ row }) => cell(row.original) };
}

/** The line above a ledger: what it lists, how many, and the link to the whole list. */
export function LedgerHead({ title, meta, action }: { title: string; meta?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline gap-3">
      <h2 className="m-text-h flex-1 font-semibold m-ink">{title}</h2>
      {meta != null && <span className="m-text-meta m-ink-3">{meta}</span>}
      {action}
    </div>
  );
}

/** A settings page is one sheet: sections divided by a hairline, each with its own title and its own save. */
export function SettingsSheet({ children }: { children: React.ReactNode }) {
  return <div className="m-card flex flex-col">{children}</div>;
}

export function SettingsSection({ title, meta, hint, children }: { title: string; meta?: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 py-5 first:pt-0 last:pb-0 [&:not(:first-child)]:[border-top:1px_solid_var(--m-line)]">
      <header className="flex items-baseline gap-3">
        <h2 className="m-text-h flex-1 font-semibold m-ink">{title}</h2>
        {meta != null && <span className="m-text-meta m-ink-3">{meta}</span>}
      </header>
      {hint != null && <p className="m-text-meta m-ink-3">{hint}</p>}
      {children}
    </section>
  );
}
