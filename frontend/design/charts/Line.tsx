"use client";

// frontend/design/charts/Line.tsx
import type { DotItemDotProps } from "recharts";
import { LineChart, Line as RLine, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import { chartTheme, type ChartPoint } from "./theme";
import { mMotion, reducedMotion } from "../tokens";

export function Line({
  data,
  onPointClick,
  height = 240,
  draw = false,
  dqsThreshold,
}: {
  data: ChartPoint[];
  onPointClick?: (point: ChartPoint) => void;
  height?: number;
  draw?: boolean;
  dqsThreshold?: number;
}) {
  const animate = draw && !reducedMotion();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <CartesianGrid stroke={chartTheme.grid} vertical={false} />
        <XAxis dataKey="x" stroke={chartTheme.axis} fontSize={12} />
        <YAxis stroke={chartTheme.axis} fontSize={12} domain={[0, 100]} />
        <Tooltip />
        {dqsThreshold !== undefined && (
          <ReferenceLine y={dqsThreshold} stroke={chartTheme.axis} strokeDasharray="4 4" />
        )}
        <RLine
          type="monotone"
          dataKey="y"
          stroke={chartTheme.series[0]}
          strokeWidth={2}
          isAnimationActive={animate}
          animationDuration={mMotion.draw}
          animationEasing="ease-out"
          dot={(dotProps: DotItemDotProps) => (
            <circle
              key={dotProps.index}
              cx={dotProps.cx ?? 0}
              cy={dotProps.cy ?? 0}
              r={3}
              fill={chartTheme.series[0]}
              style={{ cursor: onPointClick ? "pointer" : "default" }}
              onClick={() => onPointClick?.(data[dotProps.index])}
            />
          )}
          activeDot={{ r: 5, fill: "var(--m-accent)" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
