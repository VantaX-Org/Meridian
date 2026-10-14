"use client";

// frontend/design/charts/Sparkline.tsx
import type { DotItemDotProps } from "recharts";
import { LineChart, Line as RLine, ResponsiveContainer } from "recharts";
import { chartTheme, type ChartPoint } from "./theme";

export function Sparkline({
  data,
  width = 80,
  height = 24,
  color: override,
}: {
  data: ChartPoint[];
  width?: number;
  height?: number;
  /** Stroke override (a CSS colour or token reference), used inside a Stat. Default: pass or critical by direction. */
  color?: string;
}) {
  const last = data[data.length - 1]?.y ?? 0;
  const first = data[0]?.y ?? 0;
  const color = override ?? (last >= first ? chartTheme.pass : chartTheme.critical);
  return (
    <div aria-hidden="true">
    <ResponsiveContainer width={width} height={height}>
      <LineChart data={data} accessibilityLayer={false}>
        <RLine type="monotone" dataKey="y" stroke={color} strokeWidth={1.25} dot={(d: DotItemDotProps) => (d.index === data.length - 1 ? <circle key={d.index} cx={d.cx ?? 0} cy={d.cy ?? 0} r={2} fill={color} /> : <g key={d.index} />)} />
      </LineChart>
    </ResponsiveContainer>
    </div>
  );
}
