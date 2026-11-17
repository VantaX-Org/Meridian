"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface TrendPoint { axis: string; title: string; value: number | null }

/** Score over runs as an area chart (recharts). Fixed initial size so it also renders before layout. */
export function TrendArea({ points, height = 96, label, emptyLabel }: { points: TrendPoint[]; height?: number; label: string; emptyLabel: string }) {
  const data = points.filter((p) => p.value !== null);
  if (data.length < 2) return <p className="mx-muted">{emptyLabel}</p>;
  return (
    <div role="img" aria-label={label} className="mx-trend" style={{ blockSize: height }}>
      <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 320, height }}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <XAxis dataKey="axis" hide />
          <YAxis domain={[0, 100]} hide />
          <Tooltip formatter={(v) => [String(v), ""]} labelFormatter={(_, p) => p?.[0]?.payload?.title ?? ""} />
          <Area type="monotone" dataKey="value" stroke="var(--mx-chart-1)" fill="var(--mx-chart-1)" fillOpacity={0.16} strokeWidth={2} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
