"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import type { ConfigImpactSummary } from "@/types/api";

const COLORS: Record<string, string> = {
  Blocked: "#BB0000",
  Degraded: "#E76500",
  OK: "#256F3A",
};

interface ConfigImpactChartProps {
  summary: ConfigImpactSummary;
}

export function ConfigImpactChart({ summary }: ConfigImpactChartProps) {
  const data = [
    { name: "Blocked", count: summary.features_blocked },
    { name: "Degraded", count: summary.features_degraded },
    { name: "OK", count: summary.features_ok },
  ];

  if (data.every((d) => d.count === 0)) {
    return null;
  }

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: -16 }}>
          <XAxis
            dataKey="name"
            tick={{ fill: "#6B7280", fontSize: 11 }}
            axisLine={{ stroke: "rgba(0,0,0,0.08)" }}
            tickLine={false}
          />
          <YAxis hide allowDecimals={false} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} barSize={48}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={COLORS[entry.name]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
