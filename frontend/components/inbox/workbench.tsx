"use client";

import type { ReactNode } from "react";
import { Checkbox, RankedRow, type RankedTone } from "@/design";

/** The severity bar a row carries: the severity of an item, or its SLA state mapped onto the same scale. */
export type WorkbenchTone = RankedTone;

export interface WorkbenchItem {
  id: string;
  /** The row's first line: what the item is. */
  title: ReactNode;
  /** The row's second line: where it is and how old. */
  meta?: ReactNode;
  /** Right edge of the row: usually the SLA pill. */
  aside?: ReactNode;
  tone: WorkbenchTone;
  /** Names the row for the checkbox and the selection button. */
  label: string;
}

/**
 * The inbox's list with a detail: the ranked list on the left (400px, a severity bar and a checkbox per row), the
 * selected item on the right. Below the container's reading width the two stack. The selection is the caller's
 * (the URL or the j/k focus), so the same state drives the keyboard and the pointer.
 */
export function Workbench({
  items, selectedId, onSelect, checked, onCheck, onCheckAll, bulk, listLabel, detail, empty,
}: {
  items: WorkbenchItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Ids ticked for a bulk action. */
  checked: ReadonlySet<string>;
  onCheck: (id: string, on: boolean) => void;
  /** Ticks or clears every listed row at once; shows a "Select all" box above the list when given. */
  onCheckAll?: (on: boolean) => void;
  /** The bulk bar, shown once at least one row is ticked. */
  bulk?: (ids: string[]) => ReactNode;
  listLabel: string;
  detail: ReactNode;
  /** Shown in the right pane when nothing is selected. */
  empty?: ReactNode;
}) {
  const ticked = items.filter((i) => checked.has(i.id)).map((i) => i.id);
  return (
    <div className="grid items-start gap-4 [grid-template-columns:minmax(0,1fr)] @5xl:[grid-template-columns:400px_minmax(0,1fr)]" data-testid="inbox-workbench">
      <section aria-label={listLabel} className="m-card m-card-sm flex min-w-0 flex-col gap-2">
        {onCheckAll && items.length > 1 ? (
          <label className="flex items-center gap-2 pl-3 m-text-meta m-ink-3">
            <Checkbox
              aria-label={`Select all ${items.length.toLocaleString()}`}
              checked={ticked.length === items.length}
              onChange={(e) => onCheckAll(e.target.checked)}
            />
            Select all {items.length.toLocaleString()}
          </label>
        ) : null}
        {ticked.length > 0 && bulk ? (
          <div className="flex flex-wrap items-center gap-2 [border-bottom:1px_solid_var(--m-line)] pb-2" data-testid="inbox-bulk">
            <span className="m-text-meta m-ink-3">{ticked.length.toLocaleString()} selected</span>
            {bulk(ticked)}
          </div>
        ) : null}
        <ul className="flex flex-col [max-height:calc(100vh-260px)] overflow-y-auto" aria-label={listLabel} data-tour="inbox-queue">
          {items.map((item) => (
            <RankedRow
              key={item.id}
              tone={item.tone}
              selected={item.id === selectedId}
              onSelect={() => onSelect(item.id)}
              lead={<Checkbox aria-label={`Select ${item.label}`} checked={checked.has(item.id)} onChange={(e) => onCheck(item.id, e.target.checked)} />}
              label={item.title}
              meta={item.meta}
              aside={item.aside}
            />
          ))}
        </ul>
      </section>
      <section aria-label="Selected item" className="min-w-0">
        {selectedId ? detail : empty ?? null}
      </section>
    </div>
  );
}

/** One labelled fact in a detail pane: a small label over its value. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="m-text-meta m-ink-3">{label}</dt>
      <dd className="m-text-body">{children}</dd>
    </div>
  );
}
