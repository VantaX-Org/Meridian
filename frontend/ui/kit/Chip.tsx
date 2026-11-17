import type { ReactNode } from "react";

/** A toggle chip for filters. `selected` sets aria-pressed. */
export function Chip({ selected, onClick, children, count }: { selected: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return (
    <button type="button" className="mx-chip-btn" aria-pressed={selected} data-selected={selected} onClick={onClick}>
      {children}{count !== undefined ? <span className="mx-chip-n">{count}</span> : null}
    </button>
  );
}
