"use client";

// frontend/design/charts/Sparkline.tsx
import { LineChart, Line as RLine, ResponsiveContainer } from "recharts";
import { chartTheme, type ChartPoint } from "./theme";

export function Sparkline({ data }: { data: ChartPoint[] }) {
  const last = data[data.length - 1]?.y ?? 0;
  const first = data[0]?.y ?? 0;
  const color = last >= first ? chartTheme.pass : chartTheme.critical;
  return (
    <ResponsiveContainer width={80} height={24}>
      <LineChart data={data}>
        <RLine type="monotone" dataKey="y" stroke={color} dot={false} strokeWidth={1.5} />
      </LineChart>
    </ResponsiveContainer>
  );
}
