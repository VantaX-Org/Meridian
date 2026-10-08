// frontend/design/charts/Waterfall.tsx
import { BarChart, Bar as RBar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { chartTheme, type ChartPoint } from "./theme";

/** Each point's y is its delta from the running total; base/current carry no hue. */
export function Waterfall({ data, onPointClick }: { data: ChartPoint[]; onPointClick?: (point: ChartPoint) => void }) {
  const bars = data.reduce<Array<ChartPoint & { start: number; end: number }>>((acc, p) => {
    const start = acc.length > 0 ? acc[acc.length - 1].end : 0;
    acc.push({ ...p, start, end: start + p.y });
    return acc;
  }, []);
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={bars}>
        <CartesianGrid stroke={chartTheme.grid} vertical={false} />
        <XAxis dataKey="x" stroke={chartTheme.axis} fontSize={12} />
        <YAxis stroke={chartTheme.axis} fontSize={12} />
        <Tooltip />
        <RBar dataKey="y" onClick={(_, index) => onPointClick?.(data[index])}>
          {bars.map((p) => (
            <Cell key={p.x} fill={p.y >= 0 ? chartTheme.pass : chartTheme.critical} />
          ))}
        </RBar>
      </BarChart>
    </ResponsiveContainer>
  );
}
