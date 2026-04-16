"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface BarDataPoint {
  date: string;
  label: string;
  score: number;
}

interface DqsBarChartProps {
  data: BarDataPoint[];
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: BarDataPoint; value: number }>;
  label?: string;
}) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg bg-[rgba(255,255,255,0.92)] backdrop-blur-xl border border-black/[0.10] px-3 py-2 shadow-lg">
      <p className="font-sans text-xs text-muted-foreground">{d.date}</p>
      {d.label && (
        <p className="font-sans text-xs text-secondary-foreground">{d.label}</p>
      )}
      <p className="font-display text-sm font-bold text-primary">
        {d.score.toFixed(1)}
      </p>
    </div>
  );
}

export function DqsBarChart({ data }: DqsBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="rgba(0,0,0,0.06)"
          vertical={false}
        />
        <XAxis
          dataKey="date"
          tick={{ fill: "#6B7280", fontSize: 11 }}
          axisLine={{ stroke: "rgba(0,0,0,0.08)" }}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: "#6B7280", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        <Bar
          dataKey="score"
          fill="#00D4AA"
          radius={[4, 4, 0, 0]}
          isAnimationActive={true}
          animationDuration={600}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
