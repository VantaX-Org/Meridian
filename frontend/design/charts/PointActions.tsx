"use client";

// frontend/design/charts/PointActions.tsx
import { Button } from "../primitives/Button";
import type { ChartPoint } from "./theme";

/**
 * The keyboard path into a clickable chart. A chart's marks sit inside `role="img"` and answer only the mouse, so a
 * chart with `onPointClick` also renders one button per point, named with its label and value, calling the same
 * handler. The list is visually hidden until a button in it takes focus, then shows under the chart.
 */
export function ChartPointActions({
  points,
  onPointClick,
  label,
  format,
  nameOf,
}: {
  points: readonly ChartPoint[];
  onPointClick?: (point: ChartPoint) => void;
  /** The chart's name, so the list reads "Open a point in <name>". */
  label?: string;
  /** How a value reads; the raw number otherwise. */
  format?: (n: number) => string;
  /** The point's name when its label alone is ambiguous (a series in a multi-line chart). */
  nameOf?: (point: ChartPoint) => string;
}) {
  if (!onPointClick || points.length === 0) return null;
  return (
    <ul
      aria-label={label ? `Open a point in ${label}` : "Open a point"}
      className="sr-only focus-within:not-sr-only focus-within:mt-2 focus-within:flex focus-within:flex-wrap focus-within:gap-1"
      data-chart-points=""
    >
      {points.map((p, i) => (
        <li key={`${p.x}-${i}`}>
          <Button type="button" variant="secondary" size="sm" onClick={() => onPointClick(p)}>
            {`${nameOf ? nameOf(p) : p.label ?? p.x}, ${format ? format(p.y) : p.y}`}
          </Button>
        </li>
      ))}
    </ul>
  );
}
