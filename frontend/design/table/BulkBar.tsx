import type { ReactNode } from "react";

/** Floats at the bottom of the scroll parent; actions are inverted ghost buttons. */
export function BulkBar({ count, actions }: { count: number; actions: ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="sticky bottom-4 z-10 flex justify-center pointer-events-none">
      <div
        className="m-elev-3 m-motion-rise pointer-events-auto flex w-fit items-center gap-4 rounded-full px-4 py-2
          [&_.m-btn-ghost]:!text-[var(--m-sheet)] [&_.m-btn-secondary]:!bg-transparent [&_.m-btn-secondary]:!border-transparent [&_.m-btn-secondary]:!text-[var(--m-sheet)]"
        style={{ background: "var(--m-ink)", color: "var(--m-sheet)" }}
      >
        <span className="text-[13px] leading-[18px] m-numeric">{count} selected</span>
        <div className="flex gap-2">{actions}</div>
      </div>
    </div>
  );
}
