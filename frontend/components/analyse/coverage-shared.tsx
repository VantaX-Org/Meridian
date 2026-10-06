"use client";

import Link from "next/link";

export const RULES = "/settings/rules";
export const qs = (o: Record<string, string>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v)).toString();
export const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;

/** A count that opens the rules behind it. Zero is an en dash, a thin cell (under five) is muted. */
export function Count({ n, href, label, thin = true }: { n: number; href: string; label: string; thin?: boolean }) {
  return (
    <td data-thin={thin && n > 0 && n < 5 ? "" : undefined} data-zero={n === 0 ? "" : undefined}>
      {n === 0 ? <span aria-label={`No ${label}`}>{"–"}</span> : <Link className="ui-link" href={href} aria-label={`${plural(n, "rule")}, ${label}`}>{n.toLocaleString()}</Link>}
    </td>
  );
}

