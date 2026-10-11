"use client";

// frontend/design/charts/Bar.tsx
import { BarChart, Bar as RBar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts";
import { chartTheme, chartSummary, type ChartPoint } from "./theme";
import { ChartTooltip } from "./Tooltip";
import { mMotion, reducedMotion } from "../tokens";

export function Bar({
  data,
  onPointClick,
  height = 240,
  draw = false,
  dqsThreshold,
  label,
}: {
  data: ChartPoint[];
  onPointClick?: (point: ChartPoint) => void;
  height?: number;
  draw?: boolean;
  dqsThreshold?: number;
  /** Names the chart for assistive tech; the data points are appended. */
  label?: string;
}) {
  const animate = draw && !reducedMotion();
  return (
    <div role="img" aria-label={chartSummary(data, label)}>
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" barCategoryGap="40%" accessibilityLayer={false}>
        <CartesianGrid stroke={chartTheme.grid} strokeDasharray="none" horizontal={false} />
        <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: chartTheme.axis, fontSize: 12 }} />
        <YAxis type="category" dataKey="x" axisLine={false} tickLine={false} tick={{ fill: chartTheme.axis, fontSize: 12 }} />
        <Tooltip content={<ChartTooltip />} cursor={false} />
        <RBar
          dataKey="y"
          name={label ?? "Value"}
          radius={[0, 3, 3, 0]}
          activeBar={{ fill: chartTheme.accentHover }}
          onClick={(_, index) => onPointClick?.(data[index])}
          isAnimationActive={animate}
          animationDuration={mMotion.draw}
          animationEasing="ease-out"
        >
          <LabelList dataKey="y" position="right" fontSize={12} fill={chartTheme.axis} />
          {data.map((point) => (
            <Cell
              key={point.x}
              fill={dqsThreshold !== undefined && point.y < dqsThreshold ? chartTheme.high : chartTheme.series[0]}
              cursor={onPointClick ? "pointer" : "default"}
            />
          ))}
        </RBar>
      </BarChart>
    </ResponsiveContainer>
    </div>
  );
}
