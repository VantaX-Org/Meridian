"use client";

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import type { DimensionScores } from "@/types/api";

const DIMENSION_COLORS: Record<keyof DimensionScores, string> = {
  completeness: "#00D4AA",
  accuracy: "#6366F1",
  consistency: "#0891B2",
  timeliness: "#16A34A",
  uniqueness: "#D97706",
  validity: "#7C3AED",
};

const DIMENSION_LABELS: Record<keyof DimensionScores, string> = {
  completeness: "Completeness",
  accuracy: "Accuracy",
  consistency: "Consistency",
  timeliness: "Timeliness",
  uniqueness: "Uniqueness",
  validity: "Validity",
};

interface DimensionDonutProps {
  dimensions: DimensionScores;
  overallScore: number;
}

interface DonutEntry {
  name: string;
  value: number;
  color: string;
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: DonutEntry }>;
}) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg bg-[rgba(255,255,255,0.92)] backdrop-blur-xl border border-black/[0.10] px-3 py-2 shadow-lg">
      <p className="font-sans text-xs text-secondary-foreground">{d.name}</p>
      <p className="font-display text-sm font-bold" style={{ color: d.color }}>
        {d.value.toFixed(1)}%
      </p>
    </div>
  );
}

export function DimensionDonut({ dimensions, overallScore }: DimensionDonutProps) {
  const data: DonutEntry[] = (
    Object.entries(dimensions) as [keyof DimensionScores, number][]
  ).map(([key, value]) => ({
    name: DIMENSION_LABELS[key],
    value,
    color: DIMENSION_COLORS[key],
  }));

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative h-44 w-44">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={52}
              outerRadius={72}
              paddingAngle={2}
              dataKey="value"
              isAnimationActive={true}
              animationDuration={600}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        {/* Center score */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-xl font-bold text-foreground">
            {overallScore.toFixed(1)}
          </span>
        </div>
      </div>
      {/* Legend */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-1.5">
            <div
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: d.color }}
            />
            <span className="text-[11px] text-muted-foreground">{d.name}</span>
            <span className="text-[11px] font-medium text-secondary-foreground">
              {d.value.toFixed(0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
