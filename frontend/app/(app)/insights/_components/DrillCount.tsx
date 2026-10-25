"use client";

import type { ReactNode } from "react";
import Link from "next/link";

/**
 * A number, name or row cell that opens the records it stands for. A real link (keyboard reachable) whose accessible
 * name says what opens; a zero or a missing target renders as plain text, since there is nothing to open.
 */
export function DrillCount({ href, label, count, children }: {
  href?: string;
  /** The accessible name, e.g. "Open the 1,204 critical records of material master". */
  label: string;
  /** When given and zero, nothing is linked. */
  count?: number | null;
  children: ReactNode;
}) {
  if (!href || count === 0) return <>{children}</>;
  return (
    <Link href={href} aria-label={label} className="m-numeric m-ink-accent underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}>
      {children}
    </Link>
  );
}
