"use client";

import { useEffect, useId, useState } from "react";

/* ── Count-up hook ────────────────────────────────────────────────── */
export function useCountUp(target: number, duration = 900, decimals = 1) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (typeof target !== "number" || !Number.isFinite(target)) return;
    let raf: number | null = null;
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(target * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [target, duration]);
  return Number(v.toFixed(decimals));
}

/* ── Sparkline (smoothed line + filled area, draws on mount) ────────── */
interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: boolean;
  showDots?: boolean;
  pulse?: boolean;
}

export function Sparkline({
  data,
  width = 120,
  height = 36,
  stroke,
  fill = true,
  showDots = false,
  pulse = false,
}: SparklineProps) {
  const gid = useId().replace(/:/g, "");
  if (!data || data.length < 2) {
    return <svg width={width} height={height} aria-hidden="true" />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = Math.max(0.0001, max - min);
  const pts = data.map((y, i) => {
    const x = (i / (data.length - 1)) * (width - 4) + 2;
    const ny = height - 4 - ((y - min) / range) * (height - 8);
    return [x, ny] as [number, number];
  });
  // smooth Catmull-Rom → Bezier
  const path = pts.reduce((acc, p, i, arr) => {
    if (i === 0) return `M ${p[0]} ${p[1]}`;
    const prev = arr[i - 1];
    const p0 = arr[i - 2] ?? prev;
    const p2 = arr[i + 1] ?? p;
    const t = 0.18;
    const c1x = prev[0] + (p[0] - p0[0]) * t;
    const c1y = prev[1] + (p[1] - p0[1]) * t;
    const c2x = p[0] - (p2[0] - prev[0]) * t;
    const c2y = p[1] - (p2[1] - prev[1]) * t;
    return `${acc} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p[0]} ${p[1]}`;
  }, "");
  const areaPath = `${path} L ${pts[pts.length - 1][0]} ${height} L ${pts[0][0]} ${height} Z`;
  const c = stroke || "var(--mn-primary)";
  const last = pts[pts.length - 1];
  return (
    <svg
      className="mn-sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`spk-${gid}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity="0.22" />
          <stop offset="100%" stopColor={c} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path className="area" d={areaPath} fill={`url(#spk-${gid})`} />}
      <path
        className="line"
        d={path}
        fill="none"
        stroke={c}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showDots && last && <circle cx={last[0]} cy={last[1]} r="2.5" fill={c} />}
      {pulse && last && (
        <g>
          <circle className="mn-spk-pulse" cx={last[0]} cy={last[1]} r="3" fill="none" stroke={c} strokeWidth="1.5" />
          <circle cx={last[0]} cy={last[1]} r="3" fill={c} />
          <circle cx={last[0]} cy={last[1]} r="1.4" fill="white" />
        </g>
      )}
    </svg>
  );
}

/* ── DQS bar chart with mean line + min/max annotations ─────────────── */
interface DQSBarsProps {
  data: number[];
  labels: string[];
  height?: number;
}
export function DQSBars({ data, labels, height = 240 }: DQSBarsProps) {
  const w = 800;
  const h = height;
  const padL = 36,
    padR = 78,
    padT = 20,
    padB = 30;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const min = 70;
  const max = 100;
  const barW = (innerW / data.length) * 0.62;
  const gap = (innerW / data.length) * 0.38;

  const ticks = [70, 80, 90, 100];
  const yFor = (v: number) => padT + innerH - ((v - min) / (max - min)) * innerH;
  const mean = data.reduce((a, b) => a + b, 0) / data.length;
  const maxIdx = data.indexOf(Math.max(...data));
  const minIdx = data.indexOf(Math.min(...data));
  const meanLineEnd = padL + innerW + 4;
  const labelX = meanLineEnd + 4;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="mn-bar-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--mn-primary)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--mn-primary)" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      {ticks.map((t) => {
        const y = yFor(t);
        return (
          <g key={t}>
            <line x1={padL} x2={padL + innerW} y1={y} y2={y} stroke="rgba(15,23,42,0.06)" strokeDasharray="3 4" />
            <text x={padL - 8} y={y + 4} fontSize="10.5" textAnchor="end" fill="var(--mn-ink-300)" fontFamily="JetBrains Mono, monospace">
              {t}
            </text>
          </g>
        );
      })}
      <line
        x1={padL}
        x2={meanLineEnd}
        y1={yFor(mean)}
        y2={yFor(mean)}
        stroke="var(--mn-primary)"
        strokeOpacity="0.5"
        strokeWidth="1"
        strokeDasharray="2 3"
      />
      <rect x={labelX} y={yFor(mean) - 9} width="68" height="18" rx="3" fill="var(--mn-primary)" />
      <text
        x={labelX + 34}
        y={yFor(mean) + 2}
        fontSize="9.5"
        textAnchor="middle"
        fill="white"
        fontFamily="JetBrains Mono, monospace"
        fontWeight="700"
        letterSpacing="0.08em"
      >
        MEAN {mean.toFixed(1)}
      </text>
      {data.map((v, i) => {
        const x = padL + i * (barW + gap) + gap / 2;
        const bh = ((v - min) / (max - min)) * innerH;
        const y = padT + innerH - bh;
        const last = i === data.length - 1;
        const isMax = i === maxIdx;
        const isMin = i === minIdx;
        const fill = last
          ? "url(#mn-bar-grad)"
          : isMin
            ? "color-mix(in srgb, var(--mn-warn) 35%, white)"
            : "color-mix(in srgb, var(--mn-primary) 22%, white)";
        return (
          <g key={i} className="mn-bar" style={{ animationDelay: `${i * 35}ms`, transformOrigin: `${x}px ${padT + innerH}px` }}>
            <rect x={x} y={y} width={barW} height={bh} rx="2" fill={fill} />
            {(last || isMax || isMin) && (
              <text
                x={x + barW / 2}
                y={y - 6}
                fontSize="11"
                fontWeight="700"
                textAnchor="middle"
                fill={isMin ? "var(--mn-warn)" : "var(--mn-ink-900)"}
                fontFamily="JetBrains Mono, monospace"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {v.toFixed(1)}
              </text>
            )}
            <text
              x={x + barW / 2}
              y={h - 10}
              fontSize="9.5"
              textAnchor="middle"
              fill={last ? "var(--mn-ink-700)" : "var(--mn-ink-400)"}
              fontFamily="JetBrains Mono, monospace"
              fontWeight={last ? 700 : 500}
              letterSpacing="0.04em"
            >
              {labels[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ── Radial Gauge for hero ─────────────────────────────────────────── */
interface RadialGaugeProps {
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
}
export function RadialGauge({ value, max = 100, size = 96, stroke = 9 }: RadialGaugeProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = useCountUp(value, 1100, 1);
  const off = c - (Math.min(value, max) / max) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <defs>
        <linearGradient id="mn-gauge-grad" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--mn-primary)" />
          <stop offset="100%" stopColor="color-mix(in srgb, var(--mn-primary) 70%, #8B5CF6 30%)" />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(15,23,42,0.07)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="url(#mn-gauge-grad)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={off}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 1100ms cubic-bezier(.2,.7,.2,1)" }}
      />
      <text
        x={size / 2}
        y={size / 2 + 5}
        textAnchor="middle"
        fontSize="20"
        fontWeight="700"
        fontFamily="Inter Tight"
        fill="var(--mn-ink-900)"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {v.toFixed(1)}
      </text>
    </svg>
  );
}

/* ── Dimension half-rings (replaces donut) ─────────────────────────── */
interface DimensionRingsProps {
  dimensions: Record<string, number>;
  overall: number;
}
export function DimensionRings({ dimensions, overall }: DimensionRingsProps) {
  const entries = Object.entries(dimensions);
  const colors = ["var(--mn-primary)", "#8B5CF6", "#0EA5A4", "#F59E0B", "#EC4899", "#14B8A6"];
  const v = useCountUp(overall, 1100, 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center" }}>
      <div style={{ position: "relative", width: 168, height: 168 }}>
        <svg width="168" height="168" viewBox="0 0 168 168" aria-hidden="true">
          {entries.map(([k, value], i) => {
            const r = 76 - i * 10;
            const c = 2 * Math.PI * r;
            const off = c - (value / 100) * c;
            return (
              <g key={k}>
                <circle cx="84" cy="84" r={r} fill="none" stroke="rgba(15,23,42,0.05)" strokeWidth="6" />
                <circle
                  cx="84"
                  cy="84"
                  r={r}
                  fill="none"
                  stroke={colors[i % colors.length]}
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={c}
                  strokeDashoffset={off}
                  transform="rotate(-90 84 84)"
                  style={{ transition: `stroke-dashoffset 900ms cubic-bezier(.2,.7,.2,1) ${i * 60}ms` }}
                />
              </g>
            );
          })}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", pointerEvents: "none" }}>
          <div>
            <div
              style={{
                font: "600 26px/1 'Inter Tight'",
                color: "var(--mn-ink-900)",
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-0.02em",
              }}
            >
              {v.toFixed(1)}
            </div>
            <div
              style={{
                fontSize: 10.5,
                color: "var(--mn-ink-400)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginTop: 4,
                fontWeight: 600,
              }}
            >
              Overall
            </div>
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 18px", width: "100%" }}>
        {entries.map(([k, value], i) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: colors[i % colors.length] }} />
            <span style={{ color: "var(--mn-ink-500)", textTransform: "capitalize", flex: 1 }}>{k}</span>
            <span className="mn-tabular" style={{ color: "var(--mn-ink-900)", fontWeight: 600 }}>
              {value.toFixed(0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Severity horizontal bars ──────────────────────────────────────── */
interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}
export function SeverityBars({ counts }: { counts: SeverityCounts }) {
  const total = counts.critical + counts.high + counts.medium + counts.low || 1;
  const rows = [
    { key: "critical", label: "Critical", value: counts.critical, color: "var(--mn-neg)", bg: "var(--mn-neg-bg)" },
    { key: "high", label: "High", value: counts.high, color: "var(--mn-warn)", bg: "var(--mn-warn-bg)" },
    { key: "medium", label: "Medium", value: counts.medium, color: "var(--mn-primary)", bg: "var(--mn-primary-50)" },
    { key: "low", label: "Low", value: counts.low, color: "#0EA5A4", bg: "rgba(14,165,164,0.10)" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {rows.map((r, i) => {
        const pct = (r.value / total) * 100;
        return (
          <div key={r.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--mn-ink-700)", fontWeight: 600 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color }} />
                {r.label}
              </span>
              <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span className="mn-tabular" style={{ fontWeight: 700, color: "var(--mn-ink-900)" }}>
                  {r.value.toLocaleString()}
                </span>
                <span className="mn-tabular" style={{ fontSize: 11, color: "var(--mn-ink-400)" }}>
                  {pct.toFixed(0)}%
                </span>
              </span>
            </div>
            <div style={{ height: 8, background: r.bg, borderRadius: 6, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  background: r.color,
                  borderRadius: 6,
                  transition: `width 900ms cubic-bezier(.2,.7,.2,1) ${i * 90 + 200}ms`,
                  animation: `mn-fade-in 360ms ease ${i * 60}ms both`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Small multiples (6 dimensions) ────────────────────────────────── */
interface SmallMultiplesProps {
  series: Record<string, number[]>;
}
export function SmallMultiples({ series }: SmallMultiplesProps) {
  const colors: Record<string, string> = {
    completeness: "var(--mn-primary)",
    accuracy: "#8B5CF6",
    consistency: "#0EA5A4",
    timeliness: "#F59E0B",
    uniqueness: "#EC4899",
    validity: "#14B8A6",
  };
  return (
    <div className="mn-multi-grid">
      {Object.entries(series).map(([k, data]) => {
        const last = data[data.length - 1] ?? 0;
        const first = data[0] ?? 0;
        const delta = last - first;
        const pos = delta >= 0;
        return (
          <div key={k} className="mn-multi-cell">
            <div className="mn-multi-head">
              <span className="mn-multi-label">{k}</span>
              <span
                className={`mn-delta ${pos ? "pos" : "neg"}`}
                style={{ padding: "2px 6px 2px 4px", fontSize: 10.5 }}
              >
                {pos ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}
              </span>
            </div>
            <div className="mn-multi-value mn-tabular">{last.toFixed(1)}</div>
            <Sparkline data={data} width={160} height={28} stroke={colors[k] ?? "var(--mn-primary)"} />
          </div>
        );
      })}
    </div>
  );
}

/* ── Drift sparkline (table rows) ──────────────────────────────────── */
export function DriftSpark({ data }: { data: number[] }) {
  if (data.length < 2) return <span style={{ color: "var(--mn-ink-300)" }}>—</span>;
  const last = data[data.length - 1];
  const first = data[0];
  const pos = last >= first;
  return (
    <Sparkline
      data={data}
      width={100}
      height={24}
      stroke={pos ? "var(--mn-pos)" : "var(--mn-neg)"}
      fill={false}
      showDots
    />
  );
}
