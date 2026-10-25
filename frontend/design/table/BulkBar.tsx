import type { ReactNode } from "react";

/**
 * Floats at the bottom of the scroll parent; actions are inverted ghost buttons. Below lg it sits above the Ask
 * Meridian launcher (fixed bottom-right, 16px in, about 40px tall) and the attribution (bottom-left), the same 64px
 * the toasts keep (`TOAST_OFFSET`), so neither covers its buttons; it wraps rather than run under them.
 */
export function BulkBar({ count, actions }: { count: number; actions: ReactNode }) {
  if (count === 0) return null;
  return (
    <div data-testid="bulk-bar" className="sticky bottom-16 lg:bottom-4 z-10 flex justify-center px-4 pointer-events-none">
      <div
        className="m-elev-3 m-motion-rise pointer-events-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-[var(--m-radius-sheet)] px-4 py-2
          [&_.m-btn-ghost]:!text-[var(--m-sheet)] [&_.m-btn-secondary]:!bg-transparent [&_.m-btn-secondary]:!border-transparent [&_.m-btn-secondary]:!text-[var(--m-sheet)]"
        style={{ background: "var(--m-ink)", color: "var(--m-sheet)" }}
      >
        <span className="m-text-body m-numeric">{count} selected</span>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>
    </div>
  );
}
