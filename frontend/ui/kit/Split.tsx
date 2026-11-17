import type { ReactNode } from "react";

/** Two columns, master left and detail right; one column under 900px. */
export function Split({ left, right, leftLabel, rightLabel }: { left: ReactNode; right: ReactNode; leftLabel?: string; rightLabel?: string }) {
  return (
    <div className="mx-split">
      <section className="mx-col" aria-label={leftLabel}>{left}</section>
      <section className="mx-col" aria-label={rightLabel}>{right}</section>
    </div>
  );
}
