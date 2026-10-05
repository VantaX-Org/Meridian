"use client";

import Link from "next/link";

export interface OwnerRung {
  label: string;
  open: number;
  breached: number;
  href: string;
}

/** Owners ranked by open work. The bar is the share of the busiest owner; a breach count sits beside it. */
export function OwnerLadder({ rows, ariaLabel }: { rows: ReadonlyArray<OwnerRung>; ariaLabel: string }) {
  const max = Math.max(1, ...rows.map((r) => r.open));
  return (
    <ol className="ui-ladder" aria-label={ariaLabel}>
      {rows.map((r) => (
        <li key={r.label}>
          <Link href={r.href} className="ui-ladder__row aurora-focus-ring">
            <span className="ui-ladder__name">{r.label}</span>
            <span className="ui-ladder__track" aria-hidden>
              <span className="ui-ladder__fill" style={{ transform: `scaleX(${r.open / max})` }} />
            </span>
            <span className="ui-ladder__n aurora-number">{r.open.toLocaleString()}</span>
            <span className="ui-ladder__breach aurora-number" data-hot={r.breached > 0 || undefined}>
              {r.breached ? `${r.breached.toLocaleString()} breached` : ""}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
