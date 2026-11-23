"use client";

import { fixed } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { ChartFrame } from "./ChartFrame";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** One point: the observed value (runs) or the projected point with its band (future). */
export interface BandDatum { axis: string; value?: number | null; point?: number | null; low?: number | null; high?: number | null }

/** Observed line, projected line and its band, with an optional target line (recharts). */
export function BandChart({ data, label, target, height = 160 }: { data: BandDatum[]; label: string; target?: number | null; height?: number }) {
  const rows = data.map((d) => ({ ...d, band: d.low != null && d.high != null ? [d.low, d.high] : null }));
  const seen = data.filter((d) => d.value != null);
  const reading = seen.length ? t("Latest {v}, with {n} points shown", { v: fixed(seen[seen.length - 1].value ?? 0, 1), n: String(data.length) }) : t("{n} points shown", { n: String(data.length) });
  const n = (v: number | null | undefined) => (v == null ? "" : fixed(v, 1));
  const plot = (
    <div role="img" aria-label={`${label}. ${reading}`} className="mx-trend" style={{ blockSize: height }}>
      <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 320, height }}>
        <ComposedChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--mx-chart-grid)" />
          <XAxis dataKey="axis" hide />
          <YAxis domain={["auto", "auto"]} hide />
          <Tooltip />
          <Area dataKey="band" stroke="none" fill="var(--mx-aletheia)" fillOpacity={0.16} isAnimationActive={false} />
          <Line dataKey="value" stroke="var(--mx-chart-1)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line dataKey="point" stroke="var(--mx-aletheia)" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          {target != null ? <ReferenceLine y={target} stroke="var(--mx-ink-2)" strokeDasharray="2 2" /> : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
  return (
    <ChartFrame label={label} reading={reading} rowKey={(d) => d.axis} rows={data}
      columns={[
        { key: "axis", label: t("Point") },
        { key: "value", label: t("Value"), align: "end", render: (d) => n(d.value) },
        { key: "point", label: t("Projected"), align: "end", render: (d) => n(d.point) },
        { key: "low", label: t("Low"), align: "end", render: (d) => n(d.low) },
        { key: "high", label: t("High"), align: "end", render: (d) => n(d.high) },
      ]}>
      {plot}
    </ChartFrame>
  );
}
