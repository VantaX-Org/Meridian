"use client";

import { ResponsiveContainer, LineChart, Line } from "recharts";

interface SparklinePoint {
  score: number;
}

interface DqsSparklineProps {
  data: SparklinePoint[];
  color?: string;
  height?: number;
}

export function DqsSparkline({
  data,
  color = "#00D4AA",
  height = 48,
}: DqsSparklineProps) {
  if (data.length < 2) return null;

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line
            type="monotone"
            dataKey="score"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={true}
            animationDuration={600}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
