"use client";

/** The ledger's last column: the row's one action, drawn by `@/design` so every table's action reads the same. */

import { RowAction, RowActionButton, actionColumn } from "@/design";

export { actionColumn };
export const RowLink = RowAction;
export const RowButton = RowActionButton;

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
