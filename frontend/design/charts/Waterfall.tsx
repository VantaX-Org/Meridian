"use client";

// frontend/design/charts/Waterfall.tsx
import { BarChart, Bar as RBar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";
import { ChartTooltip } from "./Tooltip";
import { categoryAxisWidth } from "./Bar";
import { chartTheme, chartSummary, type ChartPoint } from "./theme";
import { ChartPointActions } from "./PointActions";
import { mMotion, reducedMotion } from "../tokens";

export interface WaterfallProps {
  data: ChartPoint[];
  onPointClick?: (point: ChartPoint) => void;
  label?: string;
  /** How a value reads in the tooltip and the text alternative (an amount with its currency); the raw number otherwise. */
  formatValue?: (n: number) => string;
  /** How a y axis tick reads (a compact amount); `formatValue` otherwise. */
  formatTick?: (n: number) => string;
  /** Bars grow on mount. On by default, off under reduced motion. */
  draw?: boolean;
}

/** Each point's y is its delta from the running total; base/current carry no hue. */
export function Waterfall({ data, onPointClick, label, formatValue, formatTick, draw = true }: WaterfallProps) {
  const animate = draw && !reducedMotion();
  const bars = data.reduce<Array<ChartPoint & { start: number; end: number; base: number; value: number }>>(
    (acc, p) => {
      const start = p.total || acc.length === 0 ? 0 : acc[acc.length - 1].end;
      const end = p.total ? p.y : start + p.y;
      acc.push({ ...p, start, end, base: Math.min(start, end), value: Math.abs(end - start) });
      return acc;
    },
    [],
  );
  const fmt = formatValue ?? ((n: number) => String(n));
  const tick = formatTick ?? formatValue;
  // The axis is as wide as its widest tick, the running total's peak, so a formatted amount is never clipped.
  const peak = bars.reduce((m, b) => Math.max(m, Math.abs(b.end), Math.abs(b.start)), 0);
  const axisWidth = tick ? categoryAxisWidth([tick(peak)], 60, 120) : undefined;
  return (
    <>
    <div role="img" aria-label={chartSummary(data, label, formatValue)}>
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={bars} accessibilityLayer={false}>
        <CartesianGrid stroke={chartTheme.grid} strokeDasharray="none" vertical={false} />
        <XAxis dataKey="x" axisLine={false} tickLine={false} tick={{ fill: chartTheme.axis, fontSize: 12 }} />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: chartTheme.axis, fontSize: 12 }} tickFormatter={tick} width={axisWidth} />
        <ReferenceLine y={0} stroke={chartTheme.axis} strokeWidth={1} />
        <Tooltip
          cursor={false}
          content={({ active, payload, label: x }) => (
            <ChartTooltip
              active={active}
              label={x}
              payload={payload?.map((p) => {
                const row = p.payload as (typeof bars)[number];
                const signed = row.total ? row.end : row.end - row.start;
                return { name: p.name, color: p.color, value: row.total || signed < 0 ? fmt(signed) : `+${fmt(signed)}` };
              })}
            />
          )}
        />
        {/* Transparent riser so each value bar floats at its running total. */}
        <RBar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} legendType="none" tooltipType="none" />
        <RBar dataKey="value" name={label ?? "Change"} stackId="w" radius={0} onClick={(_, index) => onPointClick?.(data[index])}
          isAnimationActive={animate} animationDuration={mMotion.draw} animationEasing="ease-out">
          {bars.map((p) => (
            <Cell key={p.x} fill={p.total ? chartTheme.accent : p.y >= 0 ? chartTheme.pass : chartTheme.critical} />
          ))}
        </RBar>
      </BarChart>
    </ResponsiveContainer>
    </div>
    <ChartPointActions points={data} onPointClick={onPointClick} label={label} format={formatValue} />
    </>
  );
}
