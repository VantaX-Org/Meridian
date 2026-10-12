import Link from "next/link";
import { barFill } from "../table/columns";
import { formatScore } from "../../lib/format";

export interface DimensionBarItem {
  key: string;
  label: string;
  /** Null renders an en dash and an empty track: the dimension was not measured. */
  score: number | null;
  href?: string;
}

/** Six-row inline bar list: label, a 6px track filled by pass-rate tone, and the score. One row is 28px. */
export function DimensionBars({ items, label = "Dimension scores" }: { items: DimensionBarItem[]; label?: string }) {
  return (
    <ul aria-label={label} className="flex flex-col" data-testid="dimension-bars">
      {items.map((d) => {
        const fill = d.score === null ? null : barFill(d.score, { max: 100, tone: "rate" });
        const row = (
          <>
            <span className="w-28 shrink-0 truncate text-[13px] leading-[18px]" style={{ color: "var(--m-ink-2)" }}>{d.label}</span>
            <span className="m-bar-track" aria-hidden="true" style={{ flex: 1, width: "auto" }}>
              {fill && <span className="m-bar-fill" {...fill.attr} style={{ width: `${fill.pct}%` }} />}
            </span>
            <span className="m-numeric w-10 shrink-0 text-right text-[13px] leading-[18px]" style={{ color: d.score === null ? "var(--m-ink-4)" : "var(--m-ink)" }}>
              {d.score === null ? "–" : formatScore(d.score)}
            </span>
          </>
        );
        return (
          <li key={d.key} style={{ height: 28 }}>
            {d.href ? (
              <Link href={d.href} className="flex h-full items-center gap-3 hover:bg-[var(--m-sheet-raised)]">{row}</Link>
            ) : (
              <div className="flex h-full items-center gap-3">{row}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
