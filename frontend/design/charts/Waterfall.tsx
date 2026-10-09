"use client";

// frontend/design/charts/Waterfall.tsx
import { BarChart, Bar as RBar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { chartTheme, type ChartPoint } from "./theme";

/** Each point's y is its delta from the running total; base/current carry no hue. */
export function Waterfall({ data, onPointClick }: { data: ChartPoint[]; onPointClick?: (point: ChartPoint) => void }) {
  const bars = data.reduce<Array<ChartPoint & { start: number; end: number; base: number; value: number }>>(
    (acc, p) => {
      const start = acc.length > 0 ? acc[acc.length - 1].end : 0;
      const end = start + p.y;
      acc.push({ ...p, start, end, base: Math.min(start, end), value: Math.abs(end - start) });
      return acc;
    },
    [],
  );
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={bars}>
        <CartesianGrid stroke={chartTheme.grid} vertical={false} />
        <XAxis dataKey="x" stroke={chartTheme.axis} fontSize={12} />
        <YAxis stroke={chartTheme.axis} fontSize={12} />
        <Tooltip />
        {/* Transparent riser so each value bar floats at its running total. */}
        <RBar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} legendType="none" />
        <RBar dataKey="value" stackId="w" onClick={(_, index) => onPointClick?.(data[index])}>
          {bars.map((p) => (
            <Cell key={p.x} fill={p.y >= 0 ? chartTheme.pass : chartTheme.critical} />
          ))}
        </RBar>
      </BarChart>
    </ResponsiveContainer>
  );
}
