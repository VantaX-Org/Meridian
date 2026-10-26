"use client";

// frontend/design/templates/RankedRow.tsx
import type { ReactNode } from "react";
import Link from "next/link";

/** The bar's hue: a severity, or a state mapped onto the same scale (an SLA, an urgency). */
export type RankedTone = "critical" | "high" | "medium" | "low" | "pass";

export interface RankedRowProps {
  tone: RankedTone;
  /** The row's first line: what the item is. */
  label: ReactNode;
  /** Under the bar: where it is, its field, its owner. */
  meta?: ReactNode;
  /** Right of the label: the number the list is ranked by (records, open items). */
  magnitude?: ReactNode;
  /** The bar's length as a percent of the list's largest magnitude; without it the row draws no bar. */
  share?: number;
  selected?: boolean;
  /** Selecting the row navigates (the selection lives in the URL) ... */
  href?: string;
  /** ... with `replace`, so selecting rows does not stack history. */
  replace?: boolean;
  /** ... or calls back (the selection is the caller's state). */
  onSelect?: () => void;
  /** Before the row's button, outside it: a checkbox. */
  lead?: ReactNode;
  /** After the row's button, outside it: a pill. */
  aside?: ReactNode;
  /** data-testid of the row's link or button. */
  testId?: string;
}

/**
 * One row of a workbench's ranked list (400px column): the label and its magnitude, a severity bar in the
 * `--m-*-fill` hue filled to the row's share of the largest magnitude (only when the list is ranked by a magnitude,
 * so a row without `share` draws no bar), and the meta under it. The bar marks
 * severity and size; the accent marks only the selected row. Renders an `<li>`, so it sits in a `<ul>`.
 */
export function RankedRow({ tone, label, meta, magnitude, share, selected, href, replace, onSelect, lead, aside, testId }: RankedRowProps) {
  const pct = share === undefined ? null : Math.min(100, Math.max(0, Number.isFinite(share) ? share : 0));
  const body = (
    <>
      <span className="flex w-full min-w-0 items-center gap-2">
        <span className="m-text-body min-w-0 flex-1 truncate font-medium m-ink">{label}</span>
        {magnitude != null ? <span className="m-numeric shrink-0 font-medium m-ink">{magnitude}</span> : null}
      </span>
      {pct !== null ? (
        <span aria-hidden className="m-ranked-track">
          <span className="m-ranked-fill" data-tone={tone} style={{ width: `${pct}%` }} />
        </span>
      ) : null}
      {meta != null ? <span className="m-text-meta m-ink-3 flex w-full min-w-0 items-center gap-2 truncate">{meta}</span> : null}
    </>
  );
  const current = selected ? "true" : undefined;
  return (
    <li className="m-ranked-row" data-selected={selected ? "true" : undefined}>
      {lead}
      {href !== undefined ? (
        <Link href={href} replace={replace} scroll={replace ? false : undefined} aria-current={current} data-testid={testId} className="m-ranked-action">
          {body}
        </Link>
      ) : (
        <button type="button" onClick={onSelect} aria-current={current} data-testid={testId} className="m-ranked-action">
          {body}
        </button>
      )}
      {aside != null ? <span className="shrink-0">{aside}</span> : null}
    </li>
  );
}
