import type { Severity } from "./SeverityStrip";

export interface BarItem { id: string; label: string; value: number; display?: string; sev?: Severity; title?: string }

/** Ranked horizontal bars, scaled to the largest value (or `max`). With `onSelect` each row is a button that drills in. */
export function BarList({ items, label, max, onSelect, selected }: { items: BarItem[]; label: string; max?: number; onSelect?: (id: string) => void; selected?: string | null }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="mx-barlist" aria-label={label}>
      {items.map((i) => (
        <li key={i.id} data-link={onSelect ? "" : undefined} data-selected={selected === i.id ? "true" : undefined} title={i.title ?? `${i.label}: ${i.display ?? i.value}`}>
          <span className="mx-barlist-l">{onSelect ? <button type="button" className="mx-hit" aria-pressed={selected === i.id} onClick={() => onSelect(i.id)}>{i.label}</button> : i.label}</span>
          <span className="mx-barlist-v">{i.display ?? i.value}</span>
          <span className="mx-bar"><span data-sev={i.sev} style={{ inlineSize: `${Math.max(0, Math.min(100, (i.value / top) * 100))}%` }} /></span>
        </li>
      ))}
    </ul>
  );
}
