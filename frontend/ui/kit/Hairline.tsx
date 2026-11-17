import type { ReactNode } from "react";

export interface HairlineItem { id: string; label: string; meta: string; /** 0 to 100; null shows an indeterminate bar. */ pct: number | null; action?: ReactNode }

/** One thin progress line per job in flight. Renders nothing for an empty list. */
export function Hairline({ items, label }: { items: HairlineItem[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <div role="status" aria-label={label} className="mx-hair-stack">
      {items.map((r) => (
        <div key={r.id} className="mx-hair">
          <div className="mx-hair-row">
            <span>{r.label}</span>
            <span className="mx-muted">{r.meta}</span>
            {r.action}
          </div>
          <div className="mx-hair-bar" role="progressbar" aria-label={r.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.pct != null ? Math.round(r.pct) : undefined}>
            <div className="mx-hair-fill" data-indeterminate={r.pct == null} style={r.pct != null ? { inlineSize: `${Math.max(2, Math.min(100, r.pct))}%` } : undefined} />
          </div>
        </div>
      ))}
    </div>
  );
}
