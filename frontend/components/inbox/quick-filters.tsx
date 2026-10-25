"use client";

import { ChoiceGroup } from "@/design";

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
    <ChoiceGroup
      label={label}
      showLabel
      labelClassName="min-w-[44px]"
      value={value}
      onChange={onChange}
      options={options.map((o) => ({ value: o.value, label: o.count === undefined ? o.label : `${o.label} (${o.count.toLocaleString()})` }))}
    />
  );
}
