"use client";

/**
 * The plain grid both MDM comparisons draw (a pair side by side, a golden record against its sources): a field per
 * row, one column per record or source. A `DataTable` is a ledger with its own toolbar; these grids are read across a
 * row, so they are a bare table with the ledger's header and row geometry.
 */

import type { ReactNode } from "react";

export const TH = "m-text-label px-2 py-1.5 text-left align-bottom font-medium m-ink-3 [border-bottom:1px_solid_var(--m-line-strong)]";
export const TD = "px-2 py-2 align-top [border-bottom:1px_solid_var(--m-line)]";
/** A value that differs between the records: the at-risk status wash. */
export const TD_DIFFERS = "[background:var(--m-at-risk-soft)]";
/** The value a golden record keeps: the selection wash (survivorship selected it). */
export const TD_KEPT = "font-semibold [background:var(--m-accent-soft)] m-ink-accent-ink";

export function CompareTable({ label, head, children }: { label: string; head: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full border-collapse m-text-body" aria-label={label}>
        <thead><tr>{head}</tr></thead>
        {children}
      </table>
    </div>
  );
}
