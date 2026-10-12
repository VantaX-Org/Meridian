"use client";

// frontend/design/charts/Pareto.tsx
import { Bar as RBar, Cell, CartesianGrid, ComposedChart, Line as RLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartTheme, chartSummary, type ChartPoint } from "./theme";
import { hoverBar } from "./HoverBar";
import { mMotion, reducedMotion } from "../tokens";

/** Sorts descending and adds a cumulative-share line, so the few causes behind most defects stand out. */
export function Pareto({
  data,
  label,
  onPointClick,
  height = 240,
  draw = true,
}: {
  data: ChartPoint[];
  /** Accessible name; the chart reads out its largest bars. */
  label?: string;
  onPointClick?: (point: ChartPoint) => void;
  height?: number;
  draw?: boolean;
}) {
  const animate = draw && !reducedMotion();
  const sorted = [...data].sort((a, b) => b.y - a.y);
  const total = sorted.reduce((n, p) => n + p.y, 0) || 1;
  const rows = sorted.map((p, i) => ({
    ...p,
    cum: Math.round((sorted.slice(0, i + 1).reduce((n, q) => n + q.y, 0) / total) * 100),
  }));
  return (
    <div role="img" aria-label={chartSummary(sorted, label ?? "Pareto chart")}>
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows}>
        <CartesianGrid stroke={chartTheme.grid} vertical={false} />
        <XAxis dataKey="x" stroke={chartTheme.axis} fontSize={12} />
        <YAxis yAxisId="n" stroke={chartTheme.axis} fontSize={12} />
        <YAxis yAxisId="c" orientation="right" domain={[0, 100]} unit="%" stroke={chartTheme.axis} fontSize={12} />
        <Tooltip />
        <RBar
          yAxisId="n"
          dataKey="y"
          fill={chartTheme.series[0]}
          activeBar={hoverBar}
          cursor={onPointClick ? "pointer" : "default"}
          onClick={(_, index) => onPointClick?.(rows[index])}
          isAnimationActive={animate}
          animationDuration={mMotion.draw}
        >
          {rows.map((p) => (
            <Cell key={p.x} fill={p.domain ? chartTheme.domain(p.domain) : chartTheme.series[0]} />
          ))}
        </RBar>
        <RLine yAxisId="c" dataKey="cum" stroke={chartTheme.ink} strokeWidth={1.5} dot={false} isAnimationActive={animate} animationDuration={mMotion.draw} />
      </ComposedChart>
    </ResponsiveContainer>
    </div>
  );
}
