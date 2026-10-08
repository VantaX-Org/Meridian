// frontend/design/charts/Bar.tsx
import { BarChart, Bar as RBar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { chartTheme, type ChartPoint } from "./theme";

export function Bar({ data, onPointClick }: { data: ChartPoint[]; onPointClick?: (point: ChartPoint) => void }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data}>
        <CartesianGrid stroke={chartTheme.grid} vertical={false} />
        <XAxis dataKey="x" stroke={chartTheme.axis} fontSize={12} />
        <YAxis stroke={chartTheme.axis} fontSize={12} />
        <Tooltip />
        <RBar dataKey="y" onClick={(_, index) => onPointClick?.(data[index])}>
          {data.map((point, i) => (
            <Cell key={point.x} fill={chartTheme.series[i % chartTheme.series.length]} cursor={onPointClick ? "pointer" : "default"} />
          ))}
        </RBar>
      </BarChart>
    </ResponsiveContainer>
  );
}
