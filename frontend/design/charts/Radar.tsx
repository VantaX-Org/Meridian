"use client";

// frontend/design/charts/Radar.tsx
import type { DotItemDotProps } from "recharts";
import {
  RadarChart, Radar as RRadar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip,
} from "recharts";
import { ChartTooltip } from "./Tooltip";
import { chartTheme, chartSummary, type ChartPoint } from "./theme";

export function Radar({ data, onPointClick, label }: { data: ChartPoint[]; onPointClick?: (point: ChartPoint) => void; label?: string }) {
  return (
    <div role="img" aria-label={chartSummary(data, label)}>
    <ResponsiveContainer width="100%" height={280}>
      <RadarChart data={data} accessibilityLayer={false}>
        <PolarGrid stroke={chartTheme.grid} />
        <PolarAngleAxis dataKey="x" tick={{ fill: chartTheme.axis, fontSize: 12 }} />
        <PolarRadiusAxis axisLine={false} tickLine={false} tick={{ fill: chartTheme.axis, fontSize: 12 }} />
        <Tooltip content={<ChartTooltip />} />
        <RRadar
          dataKey="y"
          name={label ?? "Score"}
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
    </div>
  );
}
