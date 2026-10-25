"use client";

// frontend/design/charts/Bar.tsx
import { BarChart, Bar as RBar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts";
import { chartTheme, chartSummary, type ChartPoint } from "./theme";
import { ChartTooltip } from "./Tooltip";
import { hoverBar } from "./HoverBar";
import { ChartPointActions } from "./PointActions";
import { mMotion, reducedMotion } from "../tokens";
import { formatNumber } from "../../lib/format";

/** Category axis width from the longest label (about 6.5px per character at 12px), so no label is clipped. */
export function categoryAxisWidth(labels: readonly (string | number)[], min = 60, max = 180): number {
  const longest = labels.reduce<number>((n, l) => Math.max(n, String(l).length), 0);
  return Math.min(max, Math.max(min, Math.ceil(longest * 6.5) + 12));
}

const tick = (v: number) => formatNumber(v, { maximumFractionDigits: 1 });

/**
 * The category axis: every category keeps its label (`interval` 0; recharts otherwise drops every other one when a
 * short chart, such as the radar's fallback, runs out of height), at the width of the longest label.
 */
export function categoryAxisProps(data: readonly ChartPoint[]) {
  return {
    interval: 0 as const,
    width: categoryAxisWidth(data.map((p) => p.label ?? p.x)),
    tickFormatter: (x: string | number) => data.find((p) => p.x === x)?.label ?? String(x),
  };
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
  return (
    <>
    <div role="img" aria-label={chartSummary(data, label)}>
    <ResponsiveContainer width="100%" height={height}>
      {/* The right margin keeps the value label of a full-width bar inside the chart. */}
      <BarChart data={data} layout="vertical" barCategoryGap="40%" accessibilityLayer={false} margin={{ top: 4, right: 40, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={chartTheme.grid} strokeDasharray="none" horizontal={false} />
        <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: chartTheme.axis, fontSize: 12 }} tickFormatter={tick} />
        <YAxis type="category" dataKey="x" axisLine={false} tickLine={false} tick={{ fill: chartTheme.axis, fontSize: 12 }} {...categoryAxisProps(data)} />
        <Tooltip content={<ChartTooltip />} cursor={false} />
        <RBar
          dataKey="y"
          name={label ?? "Value"}
          radius={[0, 3, 3, 0]}
          activeBar={hoverBar}
          onClick={(_, index) => onPointClick?.(data[index])}
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
