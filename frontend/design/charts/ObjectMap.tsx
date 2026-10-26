"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PillTone } from "../primitives/Pill";
import { SeverityDot } from "../primitives/SeverityDot";
import type { Severity } from "../tokens";

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

/** The verdict's shape before the score, so a tile never says its verdict by tint alone. */
const VERDICT_SHAPE: Partial<Record<PillTone, Severity>> = { "no-go": "critical", "at-risk": "medium", go: "pass" };

/** The narrowest tile in px: room for a one-line label (ellipsed past that) and the score. */
const MIN_TILE = 112;
/** Matches `.m-omap { gap }` in globals.css. */
const GAP = 4;
/** The tallest tile, in rows. */
const MAX_ROWS = 4;

export interface MapLayout {
  /** Columns the grid draws at this width. */
  columns: number;
  /** Each item's [column span, row span], in the items' order. */
  spans: [number, number][];
}

/**
 * Grid spans whose areas follow the records. The column count drops at a narrow width so a one-cell tile stays at
 * least `MIN_TILE` wide (never under 2 columns). The map aims at `columns x 4` cells (more when there are many
 * objects); each tile gets its share of those cells, rounded, never less than one minimum tile, and is shaped as
 * close to that area as the grid allows. Only the floor bends proportion: an object too small for a readable tile
 * is drawn at the minimum.
 */
export function mapLayout(records: readonly number[], columns: number, width: number | null): MapLayout {
  const maxCols = Math.max(2, columns);
  const cols = width && width > 0 ? Math.max(2, Math.min(maxCols, Math.floor((width + GAP) / (MIN_TILE / 2 + GAP)))) : maxCols;
  const cellW = width && width > 0 ? (width - GAP * (cols - 1)) / cols : MIN_TILE / 2;
  const minC = Math.min(cols, Math.max(1, Math.ceil((MIN_TILE + GAP) / (cellW + GAP))));
  const total = records.reduce((n, r) => n + Math.max(0, r), 0) || 1;
  const budget = Math.max(cols * MAX_ROWS, Math.ceil(records.length * minC * 1.25));
  const spans = records.map((r): [number, number] => {
    const cells = Math.max(minC, Math.round((Math.max(0, r) / total) * budget));
    let best: [number, number] = [minC, 1];
    let bestErr = Number.POSITIVE_INFINITY;
    for (let rows = 1; rows <= MAX_ROWS; rows++) {
      const c = Math.min(cols, Math.max(minC, Math.round(cells / rows)));
      const err = Math.abs(c * rows - cells);
      if (err < bestErr) { best = [c, rows]; bestErr = err; }
    }
    return best;
  });
  return { columns: cols, spans };
}

/** What a tile's `records` counts: distinct records, or rule failures (one record can fail several rules). */
export type ObjectMapUnit = "records" | "rule failures";
const UNIT_ONE: Record<ObjectMapUnit, string> = { records: "record", "rule failures": "rule failure" };

/**
 * The object map: one tile per object, its area the record count (above a minimum readable tile), its tint and shape
 * the verdict, its number the score. Reads at a glance what the objects table says in rows; every tile opens the object.
 */
export function ObjectMap({ items, columns = 8, rowHeight = 64, label = "Objects by records and verdict", unit = "records" }: {
  items: readonly ObjectMapItem[];
  /** The most columns the map draws; fewer at a narrow width. */
  columns?: number;
  rowHeight?: number;
  label?: string;
  /** The unit each tile's aria-label counts in; it follows what sizes the map. */
  unit?: ObjectMapUnit;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const sorted = [...items].sort((a, b) => b.records - a.records);
  const layout = mapLayout(sorted.map((i) => i.records), columns, width);
  return (
    <ul
      ref={ref}
      className="m-omap"
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, gridAutoRows: rowHeight }}
    >
      {sorted.map((item, i) => {
        const [c, r] = layout.spans[i];
        const large = r >= 2 && c * r >= 6;
        const shape = item.score == null ? undefined : VERDICT_SHAPE[item.verdict];
        const score = item.score == null ? "—" : item.score.toFixed(1);
        const body = (
          <>
            <span className="m-omap-label" style={large ? undefined : { fontSize: "var(--m-text-meta)", lineHeight: "var(--m-leading-meta)" }}>{item.label}</span>
            {large && item.meta && <span className="m-omap-meta">{item.meta}</span>}
            <span className="m-omap-score m-numeric" style={{ fontSize: large ? "var(--m-text-verdict)" : r > 1 ? "var(--m-text-section)" : "var(--m-text-body)" }}>
              {shape && <span aria-hidden className="m-omap-shape"><SeverityDot severity={shape} /></span>}
              {score}
            </span>
          </>
        );
        const style = { gridColumn: `span ${c}`, gridRow: `span ${r}` };
        const name = `${item.label}, ${item.score == null ? "not scored" : score}, ${item.records.toLocaleString()} ${item.records === 1 ? UNIT_ONE[unit] : unit}`;
        return (
          <li key={item.id} style={style} className="min-w-0">
            {item.href ? (
              <Link href={item.href} className="m-omap-tile" data-verdict={item.verdict} aria-label={name} title={item.label}>
                {body}
              </Link>
            ) : (
              <div className="m-omap-tile" data-verdict={item.verdict} title={item.label}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
