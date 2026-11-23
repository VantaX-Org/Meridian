import type { ReactNode } from "react";

/** A big number with a label, an optional note and an optional proportional bar (0 to 100). */
export function StatTile({ label, value, note, bar, barTone, onSelect, title, selected }: { label: string; value: ReactNode; note?: string; bar?: number; barTone?: "pass" | "data"; onSelect?: () => void; title?: string; selected?: boolean }) {
  return (
    <div className="mx-stat" data-link={onSelect ? "" : undefined} data-selected={selected ? "true" : undefined} title={title}>
      <dt>{onSelect ? <button type="button" className="mx-hit" aria-pressed={selected} onClick={onSelect}>{label}</button> : label}</dt>
      <dd className="mx-big mx-num">{value}</dd>
      {note ? <dd className="mx-muted">{note}</dd> : null}
      {bar === undefined ? null : <dd><span className="mx-bar" aria-hidden="true"><span data-k={barTone ?? "data"} style={{ inlineSize: `${Math.max(0, Math.min(100, bar))}%` }} /></span></dd>}
    </div>
  );
}
