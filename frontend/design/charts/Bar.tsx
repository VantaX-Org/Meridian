"use client";

// frontend/design/charts/Bar.tsx
import { BarChart, Bar as RBar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts";
import { chartTheme, type ChartPoint } from "./theme";
import { mMotion, reducedMotion } from "../tokens";

export function Bar({
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
      <BarChart data={data} layout="vertical" barSize={20} barGap={8}>
        <CartesianGrid stroke={chartTheme.grid} horizontal={false} />
        <XAxis type="number" stroke={chartTheme.axis} fontSize={12} />
        <YAxis type="category" dataKey="x" stroke={chartTheme.axis} fontSize={12} />
        <Tooltip />
        <RBar
          dataKey="y"
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
  );
}
