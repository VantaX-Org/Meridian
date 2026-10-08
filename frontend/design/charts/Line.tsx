// frontend/design/charts/Line.tsx
import type { DotItemDotProps } from "recharts";
import { LineChart, Line as RLine, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { chartTheme, type ChartPoint } from "./theme";

export function Line({ data, onPointClick }: { data: ChartPoint[]; onPointClick?: (point: ChartPoint) => void }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data}>
        <CartesianGrid stroke={chartTheme.grid} vertical={false} />
        <XAxis dataKey="x" stroke={chartTheme.axis} fontSize={12} />
        <YAxis stroke={chartTheme.axis} fontSize={12} />
        <Tooltip />
        <RLine
          type="monotone"
          dataKey="y"
          stroke={chartTheme.series[0]}
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
      </LineChart>
    </ResponsiveContainer>
  );
}
