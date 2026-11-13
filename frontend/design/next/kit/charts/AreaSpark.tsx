"use client";

/** An area sparkline of a 0 to 100 trend: a 2px line over a soft fill, one hover dot per point. Fewer than 2 points draw an empty shape. */
import { t } from "@/lib/v2/i18n";
import "./charts.css";

export function AreaSpark({ values, label, width = 240, height = 64, testid }: { values: readonly (number | null)[]; label: string; width?: number; height?: number; testid?: string }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  const text = pts.length < 2 ? t("{label}: not enough runs for a trend", { label }) : t("{label}: from {a} to {b} over {n} runs", { label, a: String(Math.round(pts[0].v)), b: String(Math.round(pts[pts.length - 1].v)), n: String(pts.length) });
  const n = Math.max(values.length - 1, 1);
  const x = (i: number) => 2 + ((width - 4) * i) / n;
  const y = (v: number) => height - 4 - ((height - 8) * Math.max(0, Math.min(100, v))) / 100;
  const line = pts.map((p) => `${x(p.i)},${y(p.v)}`).join(" ");
  return (
    <figure className="nx-chart nx-area" data-testid={testid} data-empty={pts.length < 2}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label={text}>
        <title>{text}</title>
        <line x1="0" x2={width} y1={height - 1} y2={height - 1} className="nx-area-base" />
        {pts.length >= 2 ? (
          <>
            <polygon points={`${x(pts[0].i)},${height - 1} ${line} ${x(pts[pts.length - 1].i)},${height - 1}`} className="nx-area-fill" />
            <polyline points={line} className="nx-area-line" />
            {pts.map((p) => (
              <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r="3" className="nx-area-dot"><title>{String(Math.round(p.v * 10) / 10)}</title></circle>
            ))}
          </>
        ) : null}
      </svg>
      <figcaption className="nx-chart-cap">{text}</figcaption>
    </figure>
  );
}
