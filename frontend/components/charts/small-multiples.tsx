"use client";

import { ResponsiveContainer, LineChart, Line, YAxis, Tooltip } from "recharts";
import { cn } from "@/lib/utils";

export interface SmallMultipleSeries {
  key: string;
  label: string;
  /** Ordered time-series points (oldest → newest). `x` can be a date-string or index. */
  data: ReadonlyArray<{ x: string | number; y: number | null }>;
  /** Optional headline value (e.g. latest score). */
  value?: string | number;
  /** Optional delta vs. prior period for the tile header. */
  delta?: number;
  color?: string;
}

export interface SmallMultiplesChartProps {
  series: ReadonlyArray<SmallMultipleSeries>;
  /** When true, every spark shares the same y-axis domain derived from all series. */
  normaliseY?: boolean;
  /** CSS grid column count at `lg` breakpoint. Defaults to 3 (classic 3×N). */
  columns?: 2 | 3 | 4 | 6;
  className?: string;
  /** Tile height — entire tile including header. Defaults to 84. */
  height?: number;
}

const COLS: Record<number, string> = {
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  6: "lg:grid-cols-6",
};

function TooltipContent({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const v = payload[0]?.value;
  if (v === undefined || v === null) return null;
  return (
    <div className="rounded-md bg-foreground px-2 py-0.5 text-[11px] font-medium text-background shadow">
      {Number(v).toFixed(1)}
    </div>
  );
}

/**
 * Small-multiples grid of sparklines — a 3×N matrix of tiny trend charts that
 * lets a reader compare across many dimensions at a glance.
 *
 * When `normaliseY` is true (default false) every tile shares the same y
 * domain so heights are directly comparable. Leave it off when the absolute
 * scale varies wildly across series (e.g. counts vs. percentages).
 */
export function SmallMultiplesChart({
  series,
  normaliseY = false,
  columns = 3,
  className,
  height = 84,
}: SmallMultiplesChartProps) {
  const allY = series.flatMap((s) => s.data.map((p) => p.y ?? NaN)).filter((n) => Number.isFinite(n));
  const sharedDomain: [number, number] | undefined = normaliseY && allY.length > 0
    ? [Math.min(...allY), Math.max(...allY)]
    : undefined;

  return (
    <div
      role="group"
      aria-label="Small multiples"
      className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3", COLS[columns], className)}
    >
      {series.map((s) => {
        const color = s.color ?? "#0070F2";
        const hasData = s.data.length > 1;
        const tone =
          s.delta === undefined
            ? "text-muted-foreground"
            : s.delta > 0
              ? "text-[#256F3A]"
              : s.delta < 0
                ? "text-[#BB0000]"
                : "text-muted-foreground";
        return (
          <div
            key={s.key}
            className="vx-card flex flex-col gap-1 px-3 py-2"
            style={{ height }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {s.label}
              </span>
              {s.delta !== undefined ? (
                <span className={cn("text-[11px] font-semibold tabular-nums", tone)}>
                  {s.delta > 0 ? "+" : ""}
                  {s.delta.toFixed(1)}
                </span>
              ) : null}
            </div>
            <div className="flex items-end justify-between gap-2">
              {s.value !== undefined ? (
                <span className="font-display text-sm font-semibold text-foreground tabular-nums">
                  {s.value}
                </span>
              ) : null}
              <div className="min-w-0 flex-1" style={{ height: height - 40 }}>
                {hasData ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={[...s.data]} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
                      <YAxis hide domain={sharedDomain ?? ["auto", "auto"]} />
                      <Tooltip
                        cursor={false}
                        content={<TooltipContent />}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="y"
                        stroke={color}
                        strokeWidth={1.5}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
                    no data
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
