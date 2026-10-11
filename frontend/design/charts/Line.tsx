"use client";

// frontend/design/charts/Line.tsx
import type { ActiveDotProps } from "recharts";
import { ComposedChart, Area, Line as RLine, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import { chartTheme, type ChartPoint } from "./theme";
import { ChartTooltip } from "./Tooltip";
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
      <ComposedChart data={data}>
        <CartesianGrid stroke={chartTheme.grid} strokeDasharray="none" vertical={false} />
        <XAxis dataKey="x" axisLine={false} tickLine={false} tick={{ fill: chartTheme.axis, fontSize: 12 }} />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: chartTheme.axis, fontSize: 12 }} domain={[0, 100]} />
        <Tooltip content={<ChartTooltip />} cursor={false} />
        {dqsThreshold !== undefined && (
          <ReferenceLine
            y={dqsThreshold}
            stroke={chartTheme.threshold}
            strokeDasharray="4 4"
            label={{ value: `Target ${dqsThreshold}`, position: "insideTopRight", fill: chartTheme.threshold, fontSize: 12 }}
          />
        )}
        <Area type="monotone" dataKey="y" stroke="none" fill={chartTheme.area} isAnimationActive={false} activeDot={false} legendType="none" tooltipType="none" />
        <RLine
          type="monotone"
          dataKey="y"
          stroke={chartTheme.series[0]}
          strokeWidth={2}
          isAnimationActive={animate}
          animationDuration={mMotion.draw}
          animationEasing="ease-out"
          dot={false}
          activeDot={(dotProps: ActiveDotProps) => (
            <circle
              key={dotProps.index}
              cx={dotProps.cx ?? 0}
              cy={dotProps.cy ?? 0}
              r={4}
              fill={chartTheme.series[0]}
              stroke={chartTheme.sheet}
              strokeWidth={2}
              style={{ cursor: onPointClick ? "pointer" : "default" }}
              onClick={() => onPointClick?.(data[dotProps.index])}
            />
          )}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
