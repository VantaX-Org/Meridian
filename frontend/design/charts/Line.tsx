"use client";

// frontend/design/charts/Line.tsx
import { useMemo, useState } from "react";
import type { ActiveDotProps, DotItemDotProps } from "recharts";
import { ComposedChart, Area, Line as RLine, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import { chartTheme, chartSummary, type ChartPoint } from "./theme";
import { ChartTooltip } from "./Tooltip";
import { ChartLegend, isolatedOpacity } from "./Legend";
import { mMotion, reducedMotion } from "../tokens";

/** An extra named series for a multi-series Line. Colours come from the ten-hue palette in order. */
export interface LineSeries {
  name: string;
  data: ChartPoint[];
}

type LineRow = { x: string | number } & Record<string, string | number>;

export function Line({
  data,
  onPointClick,
  height = 240,
  draw = true,
  dqsThreshold,
  label,
  annotations,
  series,
}: {
  data: ChartPoint[];
  onPointClick?: (point: ChartPoint) => void;
  height?: number;
  /** Draw-in on mount over `mMotion.draw`. On by default, off under reduced motion. */
  draw?: boolean;
  dqsThreshold?: number;
  /** Names the chart for assistive tech; the data points are appended. */
  label?: string;
  /** Vertical markers at an x value, e.g. a rule change or a run that moved the score. */
  annotations?: { x: string | number; label: string; kind?: "change" | "event" }[];
  /** Multi-series mode: up to ten series on the viz palette, with a legend that isolates a series on click. `data` is ignored for the lines. */
  series?: LineSeries[];
}) {
  const animate = draw && !reducedMotion();
  const [isolated, setIsolated] = useState<string | null>(null);
  const multi = series && series.length > 0 ? series : null;
  const lines = multi ?? [{ name: label ?? "Value", data }];
  const rows = useMemo<LineRow[]>(() => {
    if (!multi) return data.map((p) => ({ x: p.x, s0: p.y }));
    const byX = new Map<string | number, LineRow>();
    multi.forEach((sr, i) => sr.data.forEach((p) => byX.set(p.x, { ...(byX.get(p.x) ?? { x: p.x }), [`s${i}`]: p.y })));
    return [...byX.values()];
  }, [multi, data]);
  const summaryData = multi ? multi.flatMap((sr) => sr.data.map((p) => ({ ...p, x: `${sr.name} ${p.x}` }))) : data;
  return (
    <div role="img" aria-label={chartSummary(summaryData, label)}>
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} accessibilityLayer={false}>
        <CartesianGrid stroke={chartTheme.grid} strokeDasharray="none" vertical={false} />
        <XAxis dataKey="x" axisLine={false} tickLine={false} tick={{ fill: chartTheme.axis, fontSize: 12 }} />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: chartTheme.axis, fontSize: 12 }} domain={[0, 100]} />
        <Tooltip content={<ChartTooltip />} cursor={false} />
        {dqsThreshold !== undefined && (
          <ReferenceLine
            y={dqsThreshold}
            stroke={chartTheme.axis}
            strokeDasharray="4 4"
            label={{ value: `Target ${dqsThreshold}`, position: "insideTopRight", fill: chartTheme.axis, fontSize: 12 }}
          />
        )}
        {/* Area under the first series only. */}
        <Area type="monotone" dataKey="s0" stroke="none" fill={chartTheme.area} isAnimationActive={false} activeDot={false} legendType="none" tooltipType="none" />
        {annotations?.map((a) => (
          <ReferenceLine
            key={`${a.x}-${a.label}`}
            x={a.x}
            stroke={a.kind === "event" ? chartTheme.high : chartTheme.axis}
            strokeDasharray="2 3"
            label={{ value: a.label, position: "insideTopRight", fontSize: 11, fill: chartTheme.axis }}
          />
        ))}
        {lines.map((sr, i) => {
          const color = chartTheme.series[i % chartTheme.series.length];
          const key = `s${i}`;
          return (
            <RLine
              key={key}
              type="monotone"
              dataKey={key}
              name={sr.name}
              stroke={color}
              strokeWidth={2}
              strokeOpacity={isolatedOpacity(String(i), isolated)}
              connectNulls
              isAnimationActive={animate}
              animationDuration={mMotion.draw}
              animationEasing="ease-out"
              // A dot at the last point only, r 3 with a 2px sheet ring.
              dot={(d: DotItemDotProps) =>
                d.index === rows.length - 1 ? (
                  <circle key={d.index} cx={d.cx ?? 0} cy={d.cy ?? 0} r={3} fill={color} stroke={chartTheme.sheet} strokeWidth={2} opacity={isolatedOpacity(String(i), isolated)} />
                ) : (
                  <g key={d.index} />
                )
              }
              activeDot={(dotProps: ActiveDotProps) => (
                <circle
                  key={dotProps.index}
                  cx={dotProps.cx ?? 0}
                  cy={dotProps.cy ?? 0}
                  r={4}
                  fill={color}
                  stroke={chartTheme.sheet}
                  strokeWidth={2}
                  style={{ cursor: onPointClick ? "pointer" : "default" }}
                  onClick={() => onPointClick?.((multi ? sr.data : data)[dotProps.index])}
                />
              )}
            />
          );
        })}
      </ComposedChart>
    </ResponsiveContainer>
    {multi && multi.length > 1 && (
      <ChartLegend
        items={multi.map((sr, i) => ({ key: String(i), name: sr.name, color: chartTheme.series[i % chartTheme.series.length] }))}
        isolated={isolated}
        onIsolate={setIsolated}
      />
    )}
    </div>
  );
}
