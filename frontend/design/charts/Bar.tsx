"use client";

// frontend/design/charts/Bar.tsx
import { BarChart, Bar as RBar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts";
import { chartTheme, chartSummary, type ChartPoint } from "./theme";
import { ChartTooltip } from "./Tooltip";
import { hoverBar } from "./HoverBar";
import { ChartPointActions } from "./PointActions";
import { mMotion, reducedMotion } from "../tokens";
import { formatNumber } from "../../lib/format";
import { useMediaQuery } from "../hooks/useMediaQuery";

/** Category axis width from the longest label (about 7px per character at 12px), so no label is clipped. */
export function categoryAxisWidth(labels: readonly (string | number)[], min = 60, max = 180): number {
  const longest = labels.reduce<number>((n, l) => Math.max(n, String(l).length), 0);
  return Math.min(max, Math.max(min, Math.ceil(longest * 7) + 12));
}

/**
 * A zero bar has no width, and recharts draws no value label on it, so "0" read as a missing value: a hair of
 * width (far under a pixel, so no bar shows) keeps its "0" label.
 */
export const zeroBarMinSize = (value: number | null | undefined): number => (value === 0 ? 0.01 : 0);

const tick = (v: number) => formatNumber(v, { maximumFractionDigits: 1 });

/** Characters a category label line holds on a wide chart (up to three lines) and on a phone-width one (one line). */
export const LABEL_LINE_CHARS = 24;
export const NARROW_LABEL_CHARS = 18;
/** The phone viewport, where category labels keep to one line with an ellipsis; every wider screen wraps them. */
export const PHONE = "(max-width: 639px)";

const cut = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

/**
 * A category label as the lines its tick draws: on a wide chart up to `lines` (three) lines of `max` characters, broken
 * between words, the last line cut with an ellipsis only when the name still does not fit; on a narrow one, one
 * line cut with an ellipsis. The tooltip and the point's actions keep the whole name.
 */
export const WIDE_LABEL_LINES = 3;
export function wrapCategoryLabel(label: string, narrow = false, max = narrow ? NARROW_LABEL_CHARS : LABEL_LINE_CHARS, lines = narrow ? 1 : WIDE_LABEL_LINES): string[] {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let i = 0;
  while (i < words.length && out.length < lines - 1) {
    let line = words[i++];
    while (i < words.length && `${line} ${words[i]}`.length <= max) line = `${line} ${words[i++]}`;
    out.push(cut(line, max));
  }
  // The last line takes what is left, cut with an ellipsis only when it still does not fit.
  if (i < words.length) out.push(cut(words.slice(i).join(" "), max));
  return out.length ? out : [""];
}

/**
 * The category axis: every category keeps its label (`interval` 0; recharts otherwise drops every other one when a
 * short chart, such as the radar's fallback, runs out of height), at the width of the longest label line. A long
 * name wraps to up to three lines on a wide chart; on a narrow one it is cut to one line with an ellipsis.
 * `rowHeight` is the height a category needs for its tallest label (40px for two lines, 52px for three).
 */
export function categoryAxisProps(data: readonly ChartPoint[], narrow = false) {
  const text = (x: string | number) => data.find((p) => p.x === x)?.label ?? String(x);
  const lines = (x: string | number) => wrapCategoryLabel(text(x), narrow);
  return {
    interval: 0 as const,
    width: categoryAxisWidth(data.flatMap((p) => lines(p.x)), 60, 180),
    tickFormatter: (x: string | number) => lines(x).join(" "),
    lines,
    wraps: data.some((p) => lines(p.x).length > 1),
    rowHeight: data.some((p) => lines(p.x).length > 2) ? 52 : 40,
  };
}

/** A category tick drawn as its label lines, right-aligned to the axis and centred on the bar. */
function CategoryTick({ x, y, payload, lines }: { x?: number; y?: number; payload?: { value: string | number }; lines: (x: string | number) => string[] }) {
  const rows = payload ? lines(payload.value) : [];
  const lineHeight = 14;
  return (
    <text x={x} y={y} textAnchor="end" fill={chartTheme.axis} fontSize={12}>
      {rows.map((r, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 4 - ((rows.length - 1) * lineHeight) / 2 : lineHeight}>{r}</tspan>
      ))}
    </text>
  );
}

export function Bar({
  data,
  onPointClick,
  height = 240,
  draw = true,
  dqsThreshold,
  label,
}: {
  data: ChartPoint[];
  onPointClick?: (point: ChartPoint) => void;
  height?: number;
  /** Bars grow from the baseline on mount. On by default, off under reduced motion. */
  draw?: boolean;
  dqsThreshold?: number;
  /** Names the chart for assistive tech; the data points are appended. */
  label?: string;
}) {
  const animate = draw && !reducedMotion();
  const narrow = useMediaQuery(PHONE);
  const { lines, wraps, rowHeight, ...axis } = categoryAxisProps(data, narrow);
  // Wrapped labels need a taller row so they never touch the next category's.
  const chartHeight = wraps ? Math.max(height, data.length * rowHeight) : height;
  return (
    <>
    <div role="img" aria-label={chartSummary(data, label)} data-labels={narrow ? "one-line" : "wrap"}>
    <ResponsiveContainer width="100%" height={chartHeight}>
      {/* The right margin keeps the value label of a full-width bar inside the chart. */}
      <BarChart data={data} layout="vertical" barCategoryGap="40%" accessibilityLayer={false} margin={{ top: 4, right: 40, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={chartTheme.grid} strokeDasharray="none" horizontal={false} />
        <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: chartTheme.axis, fontSize: 12 }} tickFormatter={tick} />
        <YAxis type="category" dataKey="x" axisLine={false} tickLine={false} tick={<CategoryTick lines={lines} />} {...axis} />
        <Tooltip content={<ChartTooltip />} cursor={false} />
        <RBar
          dataKey="y"
          name={label ?? "Value"}
          radius={[0, 3, 3, 0]}
          activeBar={hoverBar}
          onClick={(_, index) => onPointClick?.(data[index])}
          minPointSize={zeroBarMinSize}
          isAnimationActive={animate}
          animationDuration={mMotion.draw}
          animationEasing="ease-out"
        >
          <LabelList dataKey="y" position="right" fontSize={12} fill={chartTheme.axis} formatter={(v: unknown) => (typeof v === "number" ? tick(v) : String(v ?? ""))} />
          {data.map((point) => (
            <Cell
              key={point.x}
              fill={dqsThreshold !== undefined && point.y < dqsThreshold ? chartTheme.high : point.domain ? chartTheme.domain(point.domain) : chartTheme.series[0]}
              cursor={onPointClick ? "pointer" : "default"}
            />
          ))}
        </RBar>
      </BarChart>
    </ResponsiveContainer>
    </div>
    <ChartPointActions points={data} onPointClick={onPointClick} label={label} format={tick} />
    </>
  );
}
