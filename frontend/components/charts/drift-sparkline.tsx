"use client";

import { ResponsiveContainer, LineChart, Line, ReferenceArea, YAxis } from "recharts";

export interface DriftSparklineProps {
  /** Ordered time-series values (oldest → newest). Gaps accepted as `null`. */
  data: ReadonlyArray<number | null>;
  /** Optional acceptable band — shaded behind the line. */
  band?: { min: number; max: number };
  stroke?: string;
  height?: number;
  /** When true, sparkline is full width; otherwise a fixed 96px. */
  fullWidth?: boolean;
}

/**
 * Tiny drift sparkline with optional baseline band.
 *
 * Intended for table cells and KpiRail tiles — renders with no axes or
 * tooltips so it stays readable at ~24px tall.
 */
export function DriftSparkline({
  data,
  band,
  stroke = "#0D5639",
  height = 24,
  fullWidth = false,
}: DriftSparklineProps) {
  if (data.length < 2) {
    return <div className="h-[1px]" style={{ height }} aria-hidden />;
  }

  const points = data.map((y, x) => ({ x, y: y ?? null }));
  const numeric = data.filter((d): d is number => d !== null && Number.isFinite(d));
  const min = band ? Math.min(band.min, ...numeric) : Math.min(...numeric);
  const max = band ? Math.max(band.max, ...numeric) : Math.max(...numeric);

  return (
    <div style={{ width: fullWidth ? "100%" : 96, height }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <YAxis hide domain={[min, max]} />
          {band && (
            <ReferenceArea
              y1={band.min}
              y2={band.max}
              fill={stroke}
              fillOpacity={0.08}
              stroke="none"
            />
          )}
          <Line
            type="monotone"
            dataKey="y"
            stroke={stroke}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
