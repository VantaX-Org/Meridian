"use client";

// frontend/design/charts/Pareto.tsx
import { Bar as RBar, CartesianGrid, ComposedChart, Line as RLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartTheme, type ChartPoint } from "./theme";
import { mMotion, reducedMotion } from "../tokens";

/** Sorts descending and adds a cumulative-share line, so the few causes behind most defects stand out. */
export function Pareto({
  data,
  onPointClick,
  height = 240,
  draw = false,
}: {
  data: ChartPoint[];
  onPointClick?: (point: ChartPoint) => void;
  height?: number;
  draw?: boolean;
}) {
  const animate = draw && !reducedMotion();
  const sorted = [...data].sort((a, b) => b.y - a.y);
  const total = sorted.reduce((n, p) => n + p.y, 0) || 1;
  const rows = sorted.map((p, i) => ({
    ...p,
    cum: Math.round((sorted.slice(0, i + 1).reduce((n, q) => n + q.y, 0) / total) * 100),
  }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows}>
        <CartesianGrid stroke={chartTheme.grid} vertical={false} />
        <XAxis dataKey="x" stroke={chartTheme.axis} fontSize={12} />
        <YAxis yAxisId="n" stroke={chartTheme.axis} fontSize={12} />
        <YAxis yAxisId="c" orientation="right" domain={[0, 100]} unit="%" stroke={chartTheme.axis} fontSize={12} />
        <Tooltip />
        <RBar
          yAxisId="n"
          dataKey="y"
          fill={chartTheme.series[0]}
          cursor={onPointClick ? "pointer" : "default"}
          onClick={(_, index) => onPointClick?.(rows[index])}
          isAnimationActive={animate}
          animationDuration={mMotion.draw}
        />
        <RLine yAxisId="c" dataKey="cum" stroke={chartTheme.high} strokeWidth={2} dot={false} isAnimationActive={animate} animationDuration={mMotion.draw} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
