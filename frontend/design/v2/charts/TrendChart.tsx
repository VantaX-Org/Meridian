"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { useMeasuredWidth } from "../RunTimeline";
import { linear } from "./scale";
import { Readout, usePointer } from "./Frame";

/**
 * A value over time: the score trend of an object, a rule's failing records over runs. One 2 pixel line in the data hue
 * over a 10 percent wash, hairline gridlines at round values, the axis text in the chart ink, the last value named at
 * the end of the line beside a ringed end dot, reference levels (a cap) dashed and named, one marked run (the baseline)
 * as a 1 pixel rule. Drawn at the width it is shown at, so the text keeps its size on a phone. The pointer or the arrow
 * keys move a crosshair from run to run and the reading is said aloud.
 */
export interface TrendPoint {
  id: string;
  /** Short label for the axis: "16 Oct". */
  label: string;
  /** The full reading for the tooltip and the live region: "16 Oct 2026: measured 71.8". */
  title: string;
  value: number | null;
}

export interface TrendRef {
  value: number;
  /** Named at the right end: "cap 70". */
  label: string;
  testId?: string;
}

export interface TrendGeometry {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  xs: number[];
  ys: (number | null)[];
  /** The line's points, "x,y x,y", the runs with a value only. */
  points: string;
  /** The wash under the line, closed on the bottom of the plot. */
  area: string;
  gridY: { value: number; y: number }[];
  axisY: number;
  refs: { value: number; y: number; label: string; testId?: string }[];
  markerX: number | null;
}

export const TREND_H = 232;
/** Room on the right for the last value and the reference names. */
export const TREND_RIGHT = 76;

export function trendGeometry(values: readonly (number | null)[], o: { width: number; height?: number; domain: readonly [number, number]; ticks: readonly number[]; refs?: readonly TrendRef[]; marker?: number | null }): TrendGeometry {
  const height = o.height ?? TREND_H;
  const plot = { left: 40, right: o.width - TREND_RIGHT, top: 16, bottom: height - 28 };
  const n = values.length;
  const span = plot.right - plot.left;
  const xs = values.map((_, i) => Math.round((n <= 1 ? plot.left + span / 2 : plot.left + (span * i) / (n - 1)) * 100) / 100);
  const y = linear(o.domain, [plot.bottom, plot.top]);
  const ys = values.map((v) => (v == null ? null : y(v)));
  const drawn = xs.map((x, i) => (ys[i] == null ? null : `${x},${ys[i]}`)).filter((p): p is string => p !== null);
  const firstX = xs[ys.findIndex((v) => v != null)];
  const lastX = xs[ys.length - 1 - [...ys].reverse().findIndex((v) => v != null)];
  const inDomain = (v: number) => v >= Math.min(...o.domain) && v <= Math.max(...o.domain);
  return {
    width: o.width,
    height,
    plot,
    xs,
    ys,
    points: drawn.join(" "),
    area: drawn.length > 1 ? `M${firstX},${plot.bottom} L${drawn.join(" L")} L${lastX},${plot.bottom} Z` : "",
    gridY: o.ticks.filter((v) => v !== o.domain[0]).map((value) => ({ value, y: y(value) })),
    axisY: y(o.domain[0]),
    refs: (o.refs ?? []).filter((r) => inDomain(r.value)).map((r) => ({ ...r, y: y(r.value) })),
    markerX: o.marker != null && o.marker >= 0 && o.marker < n ? xs[o.marker] : null,
  };
}

export interface TrendChartProps {
  points: readonly TrendPoint[];
  domain: readonly [number, number];
  ticks: readonly number[];
  refs?: readonly TrendRef[];
  /** The index of the marked run, and its name: the baseline. */
  marker?: { index: number; label: string } | null;
  /** The chart's accessible name: what it shows, first and last value. */
  label: string;
  /** The word over the y axis: "score". */
  yLabel?: string;
  format: (v: number) => string;
  /** The width to draw at before the frame has a size (and in tests). */
  fallbackWidth?: number;
  height?: number;
  testId?: string;
  lineTestId?: string;
  children?: ReactNode;
}

export function TrendChart({ points, domain, ticks, refs, marker, label, yLabel, format, fallbackWidth = 560, height, testId, lineTestId }: TrendChartProps) {
  const box = useRef<HTMLDivElement>(null);
  const width = Math.max(240, useMeasuredWidth(box, fallbackWidth));
  const g = useMemo(() => trendGeometry(points.map((p) => p.value), { width, height, domain, ticks, refs, marker: marker?.index }), [points, width, height, domain, ticks, refs, marker]);
  const nav = usePointer(points.length, g.xs);
  // Name as many dates as fit (about one per 56 pixels), the last one always.
  const every = Math.max(1, Math.ceil((points.length * 56) / Math.max(1, g.plot.right - g.plot.left)));
  const lastIdx = (() => {
    for (let i = g.ys.length - 1; i >= 0; i--) if (g.ys[i] != null) return i;
    return -1;
  })();
  const last = lastIdx >= 0 ? points[lastIdx] : null;
  const endX = g.plot.right + 8;
  const a = nav.active;
  const tipX = a != null ? g.xs[a] : 0;
  return (
    <div className="m2-viz-plot" ref={box}>
      <svg
        className="m2-chart"
        viewBox={`0 0 ${g.width} ${g.height}`}
        width={g.width}
        height={g.height}
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
        {g.gridY.map((l) => (
          <g key={l.value}>
            <line className="m2-gl" x1={g.plot.left} x2={endX} y1={l.y} y2={l.y} />
            <text className="m2-ax" x={g.plot.left - 8} y={l.y + 4} textAnchor="end">
              {l.value}
            </text>
          </g>
        ))}
        <line className="m2-axis" x1={g.plot.left} x2={endX} y1={g.axisY} y2={g.axisY} />
        <text className="m2-ax" x={g.plot.left - 8} y={g.axisY + 4} textAnchor="end">
          {domain[0]}
        </text>
        {yLabel ? (
          <text className="m2-ax" x={g.plot.left - 8} y={g.plot.top - 10} textAnchor="end">
            {yLabel}
          </text>
        ) : null}
        {points.map((p, i) =>
          (points.length - 1 - i) % every === 0 ? (
            <text key={p.id} className="m2-ax" x={g.xs[i]} y={g.height - 8} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>
              {p.label}
            </text>
          ) : null,
        )}
        {g.markerX != null && marker ? (
          <>
            <line className="m2-vbar" x1={g.markerX} x2={g.markerX} y1={g.plot.top} y2={g.axisY} data-testid="baseline-rule" />
            <text className="m2-ax" x={g.markerX + 4} y={g.plot.top + 10}>
              {marker.label}
            </text>
          </>
        ) : null}
        {g.refs.map((r) => (
          <g key={r.value}>
            <line className="m2-capl" x1={g.plot.left} x2={endX} y1={r.y} y2={r.y} data-level={r.value} data-testid={r.testId} />
            <text className="m2-ax" x={endX + 4} y={r.y + 4}>
              {r.label}
            </text>
          </g>
        ))}
        {g.area ? <path className="m2-area" d={g.area} /> : null}
        {g.points.split(" ").length > 1 ? <polyline className="m2-ln" points={g.points} data-testid={lineTestId} /> : null}
        {a != null ? <line className="m2-xh" x1={tipX} x2={tipX} y1={g.plot.top} y2={g.axisY} /> : null}
        {last && lastIdx >= 0 && g.ys[lastIdx] != null ? (
          <>
            <circle className="m2-end" cx={g.xs[lastIdx]} cy={g.ys[lastIdx] ?? 0} r={4} />
            <text className="m2-lab" x={endX + 4} y={(g.ys[lastIdx] ?? 0) - 6}>
              {last.value != null ? format(last.value) : ""}
            </text>
          </>
        ) : null}
        {a != null && g.ys[a] != null && a !== lastIdx ? <circle className="m2-pt" cx={tipX} cy={g.ys[a] ?? 0} r={4} /> : null}
        {points.map((p, i) => (
          <rect key={`h${p.id}`} className="m2-hit" x={g.xs[i] - 14} y={g.plot.top} width={28} height={g.axisY - g.plot.top}>
            <title>{p.title}</title>
          </rect>
        ))}
      </svg>
      <Readout text={a != null ? points[a]?.title ?? null : null} x={tipX} y={g.plot.top} align={a === 0 ? "start" : a === points.length - 1 ? "end" : "center"} />
    </div>
  );
}
