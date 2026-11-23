"use client";

import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fixed } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { ChartFrame } from "./ChartFrame";

export interface TrendPoint { axis: string; title: string; value: number | null }

/** Score over runs as an area chart (recharts). Fixed initial size so it also renders before layout. */
export function TrendArea({ points, height = 96, label, emptyLabel }: { points: TrendPoint[]; height?: number; label: string; emptyLabel: string }) {
  const data = points.filter((p) => p.value !== null);
  if (data.length < 2) return <p className="mx-muted">{emptyLabel}</p>;
  const first = data[0], last = data[data.length - 1];
  const reading = t("From {a} to {b} over {n} points", { a: fixed(first.value ?? 0, 1), b: fixed(last.value ?? 0, 1), n: String(data.length) });
  const plot = (
    <div role="img" aria-label={`${label}. ${reading}`} className="mx-trend" style={{ blockSize: height }}>
      <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 320, height }}>
        <AreaChart data={data} margin={{ top: 4, right: height >= 64 ? 20 : 4, bottom: 0, left: 4 }}>
          {height >= 64 ? <CartesianGrid vertical={false} stroke="var(--mx-chart-grid)" /> : null}
          <XAxis dataKey="axis" hide />
          <YAxis domain={[0, 100]} hide />
          <Tooltip formatter={(v) => [String(v), ""]} labelFormatter={(_, p) => p?.[0]?.payload?.title ?? ""} />
          <Area type="monotone" dataKey="value" stroke="var(--mx-chart-1)" fill="var(--mx-chart-1)" fillOpacity={0.16} strokeWidth={1.5} isAnimationActive={false} />
          <ReferenceDot x={last.axis} y={last.value ?? 0} r={3} fill="var(--mx-chart-1)" stroke="none" label={height >= 64 ? { value: fixed(last.value ?? 0, 1), position: "top", fill: "var(--mx-chart-axis)", fontSize: 11 } : undefined} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
  return (
    <ChartFrame label={label} reading={reading} compact={height < 64} rowKey={(p) => p.axis + p.title} rows={data}
      columns={[{ key: "title", label: t("Point"), render: (p) => p.title || p.axis }, { key: "value", label: t("Value"), align: "end", render: (p) => fixed(p.value ?? 0, 1) }]}>
      {plot}
    </ChartFrame>
  );
}
