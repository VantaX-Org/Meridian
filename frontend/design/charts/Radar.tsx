// frontend/design/charts/Radar.tsx
import type { DotItemDotProps } from "recharts";
import {
  RadarChart, Radar as RRadar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip,
} from "recharts";
import { chartTheme, type ChartPoint } from "./theme";

export function Radar({ data, onPointClick }: { data: ChartPoint[]; onPointClick?: (point: ChartPoint) => void }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <RadarChart data={data}>
        <PolarGrid stroke={chartTheme.grid} />
        <PolarAngleAxis dataKey="x" stroke={chartTheme.axis} fontSize={12} />
        <PolarRadiusAxis stroke={chartTheme.axis} fontSize={12} />
        <Tooltip />
        <RRadar
          dataKey="y"
          stroke={chartTheme.series[0]}
          fill={chartTheme.series[0]}
          fillOpacity={0.2}
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
