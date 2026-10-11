"use client";

// frontend/design/charts/Waterfall.tsx
import { BarChart, Bar as RBar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { ChartTooltip } from "./Tooltip";
import { chartTheme, type ChartPoint } from "./theme";

/** Each point's y is its delta from the running total; base/current carry no hue. */
export function Waterfall({ data, onPointClick }: { data: ChartPoint[]; onPointClick?: (point: ChartPoint) => void }) {
  const bars = data.reduce<Array<ChartPoint & { start: number; end: number; base: number; value: number }>>(
    (acc, p) => {
      const start = p.total || acc.length === 0 ? 0 : acc[acc.length - 1].end;
      const end = p.total ? p.y : start + p.y;
      acc.push({ ...p, start, end, base: Math.min(start, end), value: Math.abs(end - start) });
      return acc;
    },
    [],
  );
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={bars}>
        <CartesianGrid stroke={chartTheme.grid} strokeDasharray="none" vertical={false} />
        <XAxis dataKey="x" axisLine={false} tickLine={false} tick={{ fill: chartTheme.axis, fontSize: 12 }} />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: chartTheme.axis, fontSize: 12 }} />
        <Tooltip content={<ChartTooltip />} cursor={false} />
        {/* Transparent riser so each value bar floats at its running total. */}
        <RBar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} legendType="none" />
        <RBar dataKey="value" stackId="w" radius={[3, 3, 0, 0]} onClick={(_, index) => onPointClick?.(data[index])}>
          {bars.map((p) => (
            <Cell key={p.x} fill={p.total ? chartTheme.threshold : p.y >= 0 ? chartTheme.pass : chartTheme.critical} />
          ))}
        </RBar>
      </BarChart>
    </ResponsiveContainer>
  );
}
