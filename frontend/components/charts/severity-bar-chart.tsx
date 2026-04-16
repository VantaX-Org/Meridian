"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Cell, LabelList } from "recharts";

interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

interface SeverityBarChartProps {
  counts: SeverityCounts;
}

const SEVERITY_COLORS: Record<string, string> = {
  Critical: "#DC2626",
  High: "#EA580C",
  Medium: "#D97706",
  Low: "#00D4AA",
};

const SEVERITY_TEXT_COLORS: Record<string, string> = {
  Critical: "#DC2626",
  High: "#EA580C",
  Medium: "#D97706",
  Low: "#00D4AA",
};

export function SeverityBarChart({ counts }: SeverityBarChartProps) {
  const data = [
    { name: "Critical", count: counts.critical },
    { name: "High", count: counts.high },
    { name: "Medium", count: counts.medium },
    { name: "Low", count: counts.low },
  ];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: -16 }}>
        <XAxis
          dataKey="name"
          tick={{ fill: "#6B7280", fontSize: 11 }}
          axisLine={{ stroke: "rgba(0,0,0,0.08)" }}
          tickLine={false}
        />
        <YAxis hide />
        <Bar
          dataKey="count"
          radius={[4, 4, 0, 0]}
          isAnimationActive={true}
          animationDuration={600}
        >
          {data.map((entry) => (
            <Cell key={entry.name} fill={SEVERITY_COLORS[entry.name]} />
          ))}
          <LabelList
            dataKey="count"
            position="top"
            style={{ fontSize: 11, fontWeight: 600 }}
            formatter={(value) => (Number(value) > 0 ? String(value) : "")}
            fill="#4A5568"
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
