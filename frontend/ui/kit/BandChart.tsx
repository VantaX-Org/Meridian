"use client";

import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** One point: the observed value (runs) or the projected point with its band (future). */
export interface BandDatum { axis: string; value?: number | null; point?: number | null; low?: number | null; high?: number | null }

/** Observed line, projected line and its band, with an optional target line (recharts). */
export function BandChart({ data, label, target, height = 160 }: { data: BandDatum[]; label: string; target?: number | null; height?: number }) {
  const rows = data.map((d) => ({ ...d, band: d.low != null && d.high != null ? [d.low, d.high] : null }));
  return (
    <div role="img" aria-label={label} className="mx-trend" style={{ blockSize: height }}>
      <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 320, height }}>
        <ComposedChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <XAxis dataKey="axis" hide />
          <YAxis domain={["auto", "auto"]} hide />
          <Tooltip />
          <Area dataKey="band" stroke="none" fill="var(--mx-aletheia)" fillOpacity={0.16} isAnimationActive={false} />
          <Line dataKey="value" stroke="var(--mx-chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line dataKey="point" stroke="var(--mx-aletheia)" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          {target != null ? <ReferenceLine y={target} stroke="var(--mx-ink-2)" strokeDasharray="2 2" /> : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
