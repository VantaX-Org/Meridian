"use client";

import { Button } from "@/design";

export interface QuickFilterOption {
  value: string;
  label: string;
  /** Shown after the label as "(n)"; omitted when undefined. */
  count?: number;
}

/**
 * One row of toggle pills for a single filter dimension (who, when). Rows stack: each narrows the list further,
 * so "Mine" plus "Overdue" reads as my overdue work. The pressed pill carries the accent; nothing here is a primary button.
 */
export function QuickFilters({ label, options, value, onChange }: {
  label: string;
  options: QuickFilterOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      <span className="m-text-meta m-ink-3 min-w-[44px]">{label}</span>
      {options.map((o) => (
        <Button
          key={o.value}
          variant="secondary"
          size="sm"
          aria-pressed={value === o.value}
          className="aria-pressed:[color:var(--m-accent-ink)] aria-pressed:[border-color:var(--m-accent)] aria-pressed:[background:var(--m-accent-soft)]"
          onClick={() => onChange(o.value)}
        >
          {o.count === undefined ? o.label : `${o.label} (${o.count.toLocaleString()})`}
        </Button>
      ))}
    </div>
  );
}
