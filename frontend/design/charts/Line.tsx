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

/** Room for the first tick label so it never sits on the y-axis "0", and for the last dot. */
const X_PADDING = { left: 16, right: 16 } as const;

/** The series point drawn on a chart row: rows span the shared x domain, so a sparse series is looked up by x, never by row index. */
export function pointAtRow<P extends { x: string | number }>(points: P[], x: string | number | undefined): P | undefined {
  return x === undefined ? undefined : points.find((p) => p.x === x);
}

/**
 * Right margin that keeps the last x tick inside the chart: the tick is centred on the last point, so half its
 * width hangs past the plot. Estimated from the label length at the 12 px axis font (about 6.8 px a character).
 */
export function lastTickMargin(lastLabel: string | undefined): number {
  return Math.max(5, Math.min(96, Math.ceil(((lastLabel ?? "").length * 6.8) / 2) - 16));
}

export function Line({
  data,
  onPointClick,
  height = 240,
  draw = true,
  dqsThreshold,
  label,
  annotations,
  series,
  xDomain,
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
  /** Every x the axis must show, so sibling charts share one domain even where this series has no value. */
  xDomain?: { x: string | number; label?: string }[];
}) {
  const animate = draw && !reducedMotion();
  const [isolated, setIsolated] = useState<string | null>(null);
  const multi = series && series.length > 0 ? series : null;
  const lines = multi ?? [{ name: label ?? "Value", data }];
  const rows = useMemo<LineRow[]>(() => {
    const byX = new Map<string | number, LineRow>();
    for (const d of xDomain ?? []) byX.set(d.x, { x: d.x });
    if (!multi) data.forEach((p) => byX.set(p.x, { ...(byX.get(p.x) ?? { x: p.x }), s0: p.y }));
    else multi.forEach((sr, i) => sr.data.forEach((p) => byX.set(p.x, { ...(byX.get(p.x) ?? { x: p.x }), [`s${i}`]: p.y })));
    return [...byX.values()];
  }, [multi, data, xDomain]);
  // A point keyed by an id (a run id) carries its display text in `label`; ticks and the tooltip show that, never the key.
  const labelOf = useMemo(() => {
    const m = new Map<string | number, string>();
    for (const d of xDomain ?? []) if (d.label) m.set(d.x, d.label);
    for (const p of multi ? multi.flatMap((sr) => sr.data) : data) if (p.label) m.set(p.x, p.label);
    return (x: string | number) => m.get(x) ?? String(x);
  }, [multi, data, xDomain]);
  const rightMargin = lastTickMargin(rows.length ? labelOf(rows[rows.length - 1].x) : undefined);
  const summaryData = multi ? multi.flatMap((sr) => sr.data.map((p) => ({ ...p, x: `${sr.name} ${p.label ?? p.x}`, label: undefined }))) : data;
  return (
    <div role="img" aria-label={chartSummary(summaryData, label)}>
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} accessibilityLayer={false} margin={{ top: 5, right: rightMargin, bottom: 5, left: 5 }}>
        <CartesianGrid stroke={chartTheme.grid} strokeDasharray="none" vertical={false} />
        <XAxis dataKey="x" axisLine={false} tickLine={false} tick={{ fill: chartTheme.axis, fontSize: 12 }} tickFormatter={labelOf} minTickGap={24} padding={X_PADDING} interval="preserveStartEnd" />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: chartTheme.axis, fontSize: 12 }} domain={[0, 100]} />
        <Tooltip content={<ChartTooltip />} cursor={false} labelFormatter={(x) => labelOf(x as string | number)} />
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
                  // Rows span the shared x domain; a sparse series is shorter, so find the point by its x key.
                  onClick={() => {
                    const point = pointAtRow(multi ? sr.data : data, (dotProps.payload as LineRow | undefined)?.x ?? rows[dotProps.index ?? -1]?.x);
                    if (point) onPointClick?.(point);
                  }}
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
