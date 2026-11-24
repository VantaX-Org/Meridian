"use client";

import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { fixed } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { ChartFrame, type ChartStatus } from "./ChartFrame";
import { PlotLayer, type PlotRange } from "./PlotLayer";

export interface TrendPoint { axis: string; title: string; value: number | null }

/**
 * Score over runs as an area chart (recharts). Fixed initial size so it also renders before layout.
 * `gates` draws the 70 and 85 lines. `onSelect` fires from a click or Enter on a point; `brush` lets a drag (or Shift
 * plus arrows) pick a range, reported through `onRange` with the first and last point, or null when cleared.
 */
export function TrendArea({ points, height = 96, label, emptyLabel, gates, onSelect, brush, onRange, ...status }: {
  points: TrendPoint[]; height?: number; label: string; emptyLabel: string; gates?: boolean;
  onSelect?: (point: TrendPoint) => void; brush?: boolean; onRange?: (r: { from: TrendPoint; to: TrendPoint } | null) => void;
} & ChartStatus) {
  const data = points.filter((p) => p.value !== null);
  if (data.length < 2 && !status.state) return <p className="mx-muted">{emptyLabel}</p>;
  const first = data[0], last = data[data.length - 1];
  const reading = data.length < 2 ? emptyLabel : t("From {a} to {b} over {n} points", { a: fixed(first.value ?? 0, 1), b: fixed(last.value ?? 0, 1), n: String(data.length) });
  const big = height >= 64;
  const describe = (i: number) => `${data[i].title || data[i].axis}: ${fixed(data[i].value ?? 0, 1)}`;
  const toRange = (r: PlotRange | null) => onRange?.(r ? { from: data[r.from], to: data[r.to] } : null);
  const chart = data.length < 2 ? null : (
    <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 320, height }}>
      <AreaChart data={data} margin={{ top: 4, right: big ? 20 : 4, bottom: 0, left: 4 }}>
        {big ? <CartesianGrid vertical={false} stroke="var(--mx-chart-grid)" /> : null}
        <XAxis dataKey="axis" hide />
        <YAxis domain={[0, 100]} hide />
        {gates ? [85, 70].map((g) => <ReferenceLine key={g} y={g} stroke="var(--mx-ink-3)" strokeDasharray="3 3" label={{ value: String(g), position: "right", fill: "var(--mx-chart-axis)", fontSize: 10 }} />) : null}
        <Area type="monotone" dataKey="value" stroke="var(--mx-chart-1)" fill="var(--mx-chart-1)" fillOpacity={0.16} strokeWidth={1.5} isAnimationActive={false} />
        <ReferenceDot x={last.axis} y={last.value ?? 0} r={3} fill="var(--mx-chart-1)" stroke="none" label={big ? { value: fixed(last.value ?? 0, 1), position: "top", fill: "var(--mx-chart-axis)", fontSize: 11 } : undefined} />
      </AreaChart>
    </ResponsiveContainer>
  );
  const img = chart && <div role="img" aria-label={`${label}. ${reading}`} className="mx-trend" style={{ blockSize: height }}>{chart}</div>;
  const interactive = big || onSelect || brush;
  const plot = img && interactive ? (
    <PlotLayer n={data.length} label={label} describe={describe} onSelect={onSelect ? (i) => onSelect(data[i]) : undefined} brush={brush} onRange={toRange} inset={{ start: 0.012, end: big ? 0.06 : 0.012 }}>{img}</PlotLayer>
  ) : img;
  return (
    <ChartFrame label={label} reading={reading} compact={height < 64} height={height} rowKey={(p) => p.axis + p.title} rows={data} {...status}
      columns={[{ key: "title", label: t("Point"), render: (p) => p.title || p.axis }, { key: "value", label: t("Value"), align: "end", render: (p) => fixed(p.value ?? 0, 1) }]}>
      {plot}
    </ChartFrame>
  );
}
