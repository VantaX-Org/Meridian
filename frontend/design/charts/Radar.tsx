"use client";

// frontend/design/charts/Radar.tsx
import type { DotItemDotProps } from "recharts";
import {
  RadarChart, Radar as RRadar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip,
} from "recharts";
import { ChartTooltip } from "./Tooltip";
import { chartTheme, type ChartPoint } from "./theme";

export function Radar({ data, onPointClick }: { data: ChartPoint[]; onPointClick?: (point: ChartPoint) => void }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <RadarChart data={data}>
        <PolarGrid stroke={chartTheme.grid} />
        <PolarAngleAxis dataKey="x" tick={{ fill: chartTheme.axis, fontSize: 12 }} />
        <PolarRadiusAxis axisLine={false} tickLine={false} tick={{ fill: chartTheme.axis, fontSize: 12 }} />
        <Tooltip content={<ChartTooltip />} />
        <RRadar
          dataKey="y"
          stroke={chartTheme.series[0]}
          fill={chartTheme.area}
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
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
