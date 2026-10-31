"use client";

import { useMemo, useRef } from "react";
import { useMeasuredWidth } from "../RunTimeline";
import { Readout, usePointer } from "./Frame";
import { bins as toBins, linear, niceTicks, type Bin } from "./scale";

/**
 * How a set of values spreads: the objects of a run by measured score. Columns of a count per bin, each no wider than
 * 24 pixels with its data end rounded and its foot square on the baseline, in one blue of the sequential scale; the
 * thresholds the reader judges by (the verdict bands) as dashed hairlines with their names; the count axis in round
 * numbers. The pointer or the arrow keys read one bin: its range, its count and what is in it.
 */
export interface DistItem {
  id: string;
  label: string;
  value: number;
}

export interface DistGeometry {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  bins: (Bin & { x: number; w: number; y: number; centre: number })[];
  ticksY: { value: number; y: number }[];
  ticksX: { value: number; x: number }[];
  refs: { value: number; x: number; label: string }[];
}

export const DIST_H = 168;

export function distGeometry(items: readonly DistItem[], o: { width: number; height?: number; domain: readonly [number, number]; binWidth: number; refs?: readonly { value: number; label: string }[] }): DistGeometry {
  const height = o.height ?? DIST_H;
  const plot = { left: 32, right: o.width - 12, top: 20, bottom: height - 24 };
  const bs = toBins(items, o.domain, o.binWidth);
  const max = Math.max(1, ...bs.map((b) => b.ids.length));
  const yTicks = niceTicks(0, max, Math.min(4, max)).filter((v) => Number.isInteger(v));
  const top = Math.max(max, yTicks[yTicks.length - 1] ?? max);
  const x = linear(o.domain, [plot.left, plot.right]);
  const y = linear([0, top], [plot.bottom, plot.top]);
  const slot = (plot.right - plot.left) / Math.max(1, bs.length);
  const w = Math.max(4, Math.min(24, slot - 2));
  return {
    width: o.width,
    height,
    plot,
    bins: bs.map((b) => {
      const centre = Math.round((x(b.from) + x(b.to)) / 2 * 100) / 100;
      return { ...b, centre, x: Math.round((centre - w / 2) * 100) / 100, w, y: y(b.ids.length) };
    }),
    ticksY: yTicks.map((v) => ({ value: v, y: y(v) })),
    ticksX: niceTicks(o.domain[0], o.domain[1], 5).map((v) => ({ value: v, x: x(v) })),
    refs: (o.refs ?? []).filter((r) => r.value > o.domain[0] && r.value < o.domain[1]).map((r) => ({ ...r, x: x(r.value) })),
  };
}

/** A column with its data end rounded (4 pixels) and its foot square on the baseline. */
function column(x: number, y: number, w: number, bottom: number): string {
  const h = bottom - y;
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${bottom} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${bottom} Z`;
}

export function Distribution({ items, domain, binWidth, refs, label, describe, fallbackWidth = 480, testId }: {
  items: readonly DistItem[];
  domain: readonly [number, number];
  binWidth: number;
  refs?: readonly { value: number; label: string }[];
  label: string;
  /** The reading of one bin, for the tooltip and the live region. */
  describe: (bin: Bin, names: string[]) => string;
  fallbackWidth?: number;
  testId?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const width = Math.max(240, useMeasuredWidth(box, fallbackWidth));
  const g = useMemo(() => distGeometry(items, { width, domain, binWidth, refs }), [items, width, domain, binWidth, refs]);
  const nav = usePointer(g.bins.length, g.bins.map((b) => b.centre));
  const nameOf = useMemo(() => new Map(items.map((i) => [i.id, i.label])), [items]);
  const a = nav.active != null ? g.bins[nav.active] : null;
  return (
    <div className="m2-viz-plot" ref={box}>
      <svg
        className="m2-chart m2-dist"
        width={g.width}
        height={g.height}
        viewBox={`0 0 ${g.width} ${g.height}`}
        role="img"
        aria-label={label}
        tabIndex={0}
        aria-roledescription="chart"
        data-testid={testId}
        onKeyDown={nav.onKeyDown}
        onPointerMove={nav.onPointerMove}
        onPointerLeave={nav.onPointerLeave}
        onBlur={nav.onPointerLeave}
      >
        {g.ticksY.map((tk) =>
          tk.value === 0 ? null : (
            <g key={tk.value}>
              <line className="m2-gl" x1={g.plot.left} x2={g.plot.right} y1={tk.y} y2={tk.y} />
              <text className="m2-ax" x={g.plot.left - 8} y={tk.y + 4} textAnchor="end">
                {tk.value}
              </text>
            </g>
          ),
        )}
        {g.refs.map((r) => (
          <g key={r.value}>
            <line className="m2-capl" x1={r.x} x2={r.x} y1={g.plot.top - 4} y2={g.plot.bottom} data-ref={r.value} />
            <text className="m2-ax" x={r.x + 4} y={g.plot.top - 8}>
              {r.label}
            </text>
          </g>
        ))}
        {g.bins.map((b, i) => (
          <path key={b.from} className="m2-col" data-on={nav.active === i ? "true" : undefined} d={column(b.x, b.y, b.w, g.plot.bottom)} data-count={b.ids.length} />
        ))}
        <line className="m2-axis" x1={g.plot.left} x2={g.plot.right} y1={g.plot.bottom} y2={g.plot.bottom} />
        {g.ticksX.map((tk, i) => (
          <text key={tk.value} className="m2-ax" x={tk.x} y={g.height - 6} textAnchor={i === 0 ? "start" : i === g.ticksX.length - 1 ? "end" : "middle"}>
            {tk.value}
          </text>
        ))}
        {g.bins.map((b) => (
          <rect key={`h${b.from}`} className="m2-hit" x={b.centre - Math.max(12, b.w / 2)} y={g.plot.top} width={Math.max(24, b.w)} height={g.plot.bottom - g.plot.top}>
            <title>{describe(b, b.ids.map((id) => nameOf.get(id) ?? id))}</title>
          </rect>
        ))}
      </svg>
      <Readout text={a ? describe(a, a.ids.map((id) => nameOf.get(id) ?? id)) : null} x={a?.centre ?? 0} y={g.plot.top} align={nav.active === 0 ? "start" : nav.active === g.bins.length - 1 ? "end" : "center"} />
    </div>
  );
}
