import type { Severity } from "./SeverityStrip";

export interface BarItem { id: string; label: string; value: number; display?: string; sev?: Severity }

/** Ranked horizontal bars, scaled to the largest value (or `max`). */
export function BarList({ items, label, max }: { items: BarItem[]; label: string; max?: number }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="mx-barlist" aria-label={label}>
      {items.map((i) => (
        <li key={i.id}>
          <span className="mx-barlist-l">{i.label}</span>
          <span className="mx-barlist-v">{i.display ?? i.value}</span>
          <span className="mx-bar"><span data-sev={i.sev} style={{ inlineSize: `${Math.max(0, Math.min(100, (i.value / top) * 100))}%` }} /></span>
        </li>
      ))}
    </ul>
  );
}
