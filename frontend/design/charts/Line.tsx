"use client";

// frontend/design/charts/Line.tsx
import type { ActiveDotProps } from "recharts";
import { ComposedChart, Area, Line as RLine, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import { chartTheme, chartSummary, type ChartPoint } from "./theme";
import { ChartTooltip } from "./Tooltip";
import { mMotion, reducedMotion } from "../tokens";

export function Line({
  data,
  onPointClick,
  height = 240,
  draw = false,
  dqsThreshold,
  label,
  annotations,
}: {
  data: ChartPoint[];
  onPointClick?: (point: ChartPoint) => void;
  height?: number;
  draw?: boolean;
  dqsThreshold?: number;
  /** Names the chart for assistive tech; the data points are appended. */
  label?: string;
  /** Vertical markers at an x value, e.g. a rule change or a run that moved the score. */
  annotations?: { x: string | number; label: string; kind?: "change" | "event" }[];
}) {
  const animate = draw && !reducedMotion();
  return (
    <div role="img" aria-label={chartSummary(data, label)}>
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} accessibilityLayer={false}>
        <CartesianGrid stroke={chartTheme.grid} strokeDasharray="none" vertical={false} />
        <XAxis dataKey="x" axisLine={false} tickLine={false} tick={{ fill: chartTheme.axis, fontSize: 12 }} />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: chartTheme.axis, fontSize: 12 }} domain={[0, 100]} />
        <Tooltip content={<ChartTooltip />} cursor={false} />
        {dqsThreshold !== undefined && (
          <ReferenceLine
            y={dqsThreshold}
            stroke={chartTheme.threshold}
            strokeDasharray="4 4"
            label={{ value: `Target ${dqsThreshold}`, position: "insideTopRight", fill: chartTheme.threshold, fontSize: 12 }}
          />
        )}
        <Area type="monotone" dataKey="y" stroke="none" fill={chartTheme.area} isAnimationActive={false} activeDot={false} legendType="none" tooltipType="none" />
        {annotations?.map((a) => (
          <ReferenceLine
            key={`${a.x}-${a.label}`}
            x={a.x}
            stroke={a.kind === "event" ? chartTheme.high : chartTheme.axis}
            strokeDasharray="2 3"
            label={{ value: a.label, position: "insideTopRight", fontSize: 11, fill: chartTheme.axis }}
          />
        ))}
        <RLine
          type="monotone"
          dataKey="y"
          name={label ?? "Value"}
          stroke={chartTheme.series[0]}
          strokeWidth={2}
          isAnimationActive={animate}
          animationDuration={mMotion.draw}
          animationEasing="ease-out"
          dot={false}
          activeDot={(dotProps: ActiveDotProps) => (
            <circle
              key={dotProps.index}
              cx={dotProps.cx ?? 0}
              cy={dotProps.cy ?? 0}
              r={4}
              fill={chartTheme.series[0]}
              stroke={chartTheme.sheet}
              strokeWidth={2}
              style={{ cursor: onPointClick ? "pointer" : "default" }}
              onClick={() => onPointClick?.(data[dotProps.index])}
            />
          )}
        />
      </ComposedChart>
    </ResponsiveContainer>
    </div>
  );
}
