"use client";

import Link from "next/link";
import type { PillTone } from "../primitives/Pill";

export interface ObjectMapItem {
  id: string;
  label: string;
  href?: string;
  /** DQS; null when not scored. */
  score: number | null;
  /** Record count: the tile's area. */
  records: number;
  verdict: PillTone;
  /** One short line under the label on a large tile (the blocking rule, the record count). */
  meta?: string;
}

/** A tile's grid spans from its share of the records: every object gets at least one cell. */
function spans(share: number, columns: number): [number, number] {
  const cells = Math.max(1, Math.round(share * columns * 6));
  if (cells >= 12) return [4, 3];
  if (cells >= 8) return [4, 2];
  if (cells >= 6) return [3, 2];
  if (cells >= 4) return [2, 2];
  if (cells >= 2) return [2, 1];
  return [1, 1];
}

/**
 * The object map: one tile per object, its area the record count, its colour the verdict, its number the score.
 * Reads at a glance what the objects table says in rows; every tile opens the object.
 */
export function ObjectMap({ items, columns = 8, rowHeight = 64, label = "Objects by records and verdict" }: {
  items: readonly ObjectMapItem[];
  columns?: number;
  rowHeight?: number;
  label?: string;
}) {
  const total = items.reduce((n, i) => n + Math.max(0, i.records), 0) || 1;
  const sorted = [...items].sort((a, b) => b.records - a.records);
  return (
    <ul
      className="m-omap"
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridAutoRows: rowHeight }}
    >
      {sorted.map((item) => {
        const [c, r] = spans(item.records / total, columns);
        const large = c >= 3;
        const body = (
          <>
            <span className="m-omap-label" style={large ? undefined : { fontSize: "var(--m-text-meta)", lineHeight: "var(--m-leading-meta)" }}>{item.label}</span>
            {large && item.meta && <span className="m-omap-meta">{item.meta}</span>}
            <span className="m-omap-score m-numeric" style={{ fontSize: large ? 22 : r > 1 ? 18 : 14 }}>
              {item.score == null ? "—" : item.score.toFixed(large ? 1 : 0)}
            </span>
          </>
        );
        const style = { gridColumn: `span ${c}`, gridRow: `span ${r}` };
        return (
          <li key={item.id} style={style} className="min-w-0">
            {item.href ? (
              <Link href={item.href} className="m-omap-tile" data-verdict={item.verdict} aria-label={`${item.label}, ${item.score == null ? "not scored" : item.score.toFixed(1)}, ${item.records.toLocaleString()} records`}>
                {body}
              </Link>
            ) : (
              <div className="m-omap-tile" data-verdict={item.verdict}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
