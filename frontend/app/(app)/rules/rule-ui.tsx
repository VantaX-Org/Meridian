"use client";

/**
 * Page-local building blocks for the rules pages.
 */

import type { ReactNode } from "react";
import { Mono, IconClose } from "@/design";
import { checkClassLabel } from "@/lib/format";

export type FilterChip = { key: string; label: string; clear: () => void };

/** Removable chips for every active filter, with one "Clear all". */
export function FilterChips({ chips, onClearAll }: { chips: FilterChip[]; onClearAll: () => void }) {
  // Fixed-height slot so the first chip does not shift the page.
  return (
    <div role="group" className="flex flex-wrap items-center gap-2 [min-height:24px]" aria-label="Active filters">
      {chips.length ? chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={c.clear}
          aria-label={`Remove filter ${c.label}`}
          className="m-text-meta m-motion-colors inline-flex items-center gap-1 px-2 [height:24px]! [border-radius:var(--m-radius-control)]! [background:var(--m-accent-soft)]! m-ink"
        >
          {c.label}<IconClose size={12} />
        </button>
      )) : null}
      {chips.length ? <button type="button" onClick={onClearAll} className="m-text-meta px-1 m-ink-accent">Clear all</button> : null}
    </div>
  );
}

/** Label / value rows for drawers and cards. */
export function Rows({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="m-text-body flex flex-col gap-1">
      {items.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4">
          <dt className="m-ink-3">{k}</dt>
          <dd className="text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const scalar = (v: unknown): string => (typeof v === "string" ? v : Array.isArray(v) ? v.map(scalar).join(", ") : typeof v === "object" && v !== null ? Object.entries(v).map(([k, x]) => `${k}=${scalar(x)}`).join(", ") : String(v));

/** A condition as prose ("Null check on LFA1.STCD1") plus its remaining parameters as key = value lines. */
export function ConditionList({ conditions }: { conditions: Record<string, unknown>[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {conditions.map((c, i) => {
        const { check_class: cls, field, ...rest } = c;
        const params = Object.entries(rest).filter(([, v]) => v != null && v !== "");
        return (
          <li key={i} className="m-text-body flex flex-col gap-1">
            <span>
              {typeof cls === "string" ? checkClassLabel(cls) : "Condition"}
              {typeof field === "string" ? <> on <Mono>{field}</Mono></> : null}
            </span>
            {params.length ? (
              <pre className="m-text-meta overflow-auto p-2 [font-family:var(--m-font-mono)]! [background:var(--m-sheet-raised)]! [border-radius:var(--m-radius-control)]!">
                {params.map(([k, v]) => `${k} = ${scalar(v)}`).join("\n")}
              </pre>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Threshold object as a two-column table. */
export function ThresholdTable({ thresholds }: { thresholds: object }) {
  const rows = Object.entries(thresholds);
  return (
    <table className="m-table">
      <thead>
        <tr><th>Threshold</th><th>Value</th></tr>
      </thead>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td>{k.replace(/_/g, " ")}</td>
            <td><Mono>{scalar(v)}</Mono></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
