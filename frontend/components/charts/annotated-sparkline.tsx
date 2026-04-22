"use client";

import * as React from "react";

export interface AnnotatedSparklineProps {
  /** Series in chronological order (oldest → newest). nulls render as gaps. */
  data: ReadonlyArray<number | null>;
  /** Stroke color. Defaults to Fiori Horizon blue. */
  stroke?: string;
  /** Height in pixels. Width always expands to container. */
  height?: number;
  /** Optional lower / upper band — drawn as a shaded Fiori-green region. */
  threshold?: { lower?: number; upper?: number };
  /** Enable hover tooltip + anomaly dots. Defaults to true. */
  annotated?: boolean;
  /** Optional date labels paired 1:1 with `data` for the hover tooltip. */
  labels?: ReadonlyArray<string>;
  className?: string;
  /** Aria label for assistive tech. */
  ariaLabel?: string;
}

const ID_PREFIX = "vx-spark-";

/**
 * Annotated sparkline with optional threshold band, last-point marker,
 * anomaly dots (points > 2σ from mean), and on-hover tooltip with exact
 * value + label.
 *
 * Pure SVG so it renders inside small multiples, KPI tiles, and hero KPIs
 * without pulling Recharts into tight layouts.
 */
export function AnnotatedSparkline({
  data,
  stroke = "#0070F2",
  height = 48,
  threshold,
  annotated = true,
  labels,
  className,
  ariaLabel = "Trend",
}: AnnotatedSparklineProps) {
  const gradientId = React.useId().replace(/:/g, "");
  const width = 320; // Internal viewBox width; preserveAspectRatio stretches.

  const { path, areaPath, points, anomalies, yMin, yMax } = React.useMemo(() => {
    const cleaned = data.map((d) => (typeof d === "number" && Number.isFinite(d) ? d : null));
    const nums = cleaned.filter((v): v is number => v !== null);
    if (nums.length < 2) {
      return { path: "", areaPath: "", points: [], anomalies: [], yMin: 0, yMax: 1 };
    }
    const yMin = Math.min(...nums);
    const yMax = Math.max(...nums);
    const yRange = yMax - yMin || 1;
    const pad = 2;
    const innerH = height - pad * 2;
    const n = cleaned.length;

    const xFor = (i: number) => (n === 1 ? width / 2 : (i / (n - 1)) * width);
    const yFor = (v: number) => pad + innerH - ((v - yMin) / yRange) * innerH;

    const pts = cleaned.map((v, i) => ({
      x: xFor(i),
      y: v === null ? null : yFor(v),
      v,
      i,
    }));

    // Path with gaps for nulls.
    let d = "";
    pts.forEach((p, idx) => {
      if (p.y === null) {
        d += " "; // gap — will be broken below
        return;
      }
      const prev = pts[idx - 1];
      const cmd = idx === 0 || !prev || prev.y === null ? "M" : "L";
      d += `${cmd}${p.x.toFixed(2)},${p.y.toFixed(2)} `;
    });

    // Area path (closed to baseline) for gradient fill under the line.
    const baselineY = height - pad;
    const firstValid = pts.find((p) => p.y !== null);
    const lastValid = [...pts].reverse().find((p) => p.y !== null);
    let area = "";
    if (firstValid && lastValid && firstValid.y !== null && lastValid.y !== null) {
      area = `M${firstValid.x.toFixed(2)},${baselineY.toFixed(2)} `;
      pts.forEach((p) => {
        if (p.y === null) return;
        area += `L${p.x.toFixed(2)},${p.y.toFixed(2)} `;
      });
      area += `L${lastValid.x.toFixed(2)},${baselineY.toFixed(2)} Z`;
    }

    // Anomaly detection: points > 2σ from mean.
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
    const sigma = Math.sqrt(variance);
    const anomalies = pts.filter(
      (p) => p.v !== null && sigma > 0 && Math.abs((p.v as number) - mean) > 2 * sigma,
    );

    return { path: d.trim(), areaPath: area, points: pts, anomalies, yMin, yMax };
  }, [data, height]);

  const [hover, setHover] = React.useState<{ x: number; y: number; i: number } | null>(null);

  if (!path) {
    return (
      <div
        role="img"
        aria-label={`${ariaLabel}: insufficient data`}
        className={className}
        style={{ height }}
      />
    );
  }

  const bandTop =
    threshold?.upper !== undefined
      ? ((Math.max(...data.filter((v): v is number => v !== null)) - threshold.upper) /
          (Math.max(...data.filter((v): v is number => v !== null)) -
            Math.min(...data.filter((v): v is number => v !== null)) || 1)) *
          (height - 4) +
        2
      : null;
  const bandBottom =
    threshold?.lower !== undefined
      ? ((Math.max(...data.filter((v): v is number => v !== null)) - threshold.lower) /
          (Math.max(...data.filter((v): v is number => v !== null)) -
            Math.min(...data.filter((v): v is number => v !== null)) || 1)) *
          (height - 4) +
        2
      : null;

  const lastPt = [...points].reverse().find((p) => p.y !== null);

  const hoveredPt = hover ? points[hover.i] : null;
  const hoveredValue = hoveredPt && hoveredPt.v !== null ? hoveredPt.v : null;
  const hoveredLabel = hoveredPt && labels ? labels[hoveredPt.i] : null;

  return (
    <div
      role="img"
      aria-label={`${ariaLabel}. Range ${yMin.toFixed(2)} to ${yMax.toFixed(2)}.`}
      className={className}
      style={{ position: "relative", width: "100%", height }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
        style={{ display: "block" }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          if (!annotated) return;
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const xPx = e.clientX - rect.left;
          const ratio = xPx / rect.width;
          const idx = Math.min(
            points.length - 1,
            Math.max(0, Math.round(ratio * (points.length - 1))),
          );
          const p = points[idx];
          if (p && p.y !== null) {
            setHover({ x: p.x, y: p.y, i: idx });
          }
        }}
      >
        <defs>
          <linearGradient id={`${ID_PREFIX}${gradientId}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Threshold band (where "healthy" is) */}
        {bandTop !== null && bandBottom !== null ? (
          <rect
            x="0"
            y={Math.min(bandTop, bandBottom)}
            width={width}
            height={Math.abs(bandBottom - bandTop)}
            fill="#256F3A"
            opacity={0.08}
          />
        ) : null}

        {areaPath ? <path d={areaPath} fill={`url(#${ID_PREFIX}${gradientId})`} /> : null}

        <path
          d={path}
          fill="none"
          stroke={stroke}
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Anomaly dots */}
        {annotated &&
          anomalies.map((p) =>
            p.y === null ? null : (
              <circle
                key={`a-${p.i}`}
                cx={p.x}
                cy={p.y}
                r={2.6}
                fill="#BB0000"
                stroke="#FFFFFF"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ),
          )}

        {/* Last point marker */}
        {lastPt && lastPt.y !== null ? (
          <circle
            cx={lastPt.x}
            cy={lastPt.y}
            r={2.2}
            fill={stroke}
            stroke="#FFFFFF"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

        {/* Hover marker */}
        {annotated && hoveredPt && hoveredPt.y !== null ? (
          <>
            <line
              x1={hoveredPt.x}
              x2={hoveredPt.x}
              y1={0}
              y2={height}
              stroke={stroke}
              strokeOpacity={0.35}
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={hoveredPt.x}
              cy={hoveredPt.y}
              r={3}
              fill={stroke}
              stroke="#FFFFFF"
              strokeWidth={1.4}
              vectorEffect="non-scaling-stroke"
            />
          </>
        ) : null}
      </svg>

      {annotated && hoveredPt && hoveredValue !== null ? (
        <div
          className="pointer-events-none absolute top-0 rounded-md border border-border bg-popover/95 px-2 py-1 text-[10px] shadow-lg backdrop-blur-sm"
          style={{
            left: `${(hoveredPt.x / width) * 100}%`,
            transform: "translate(-50%, -110%)",
            whiteSpace: "nowrap",
          }}
        >
          <span className="vx-num font-medium">{hoveredValue.toFixed(2)}</span>
          {hoveredLabel ? (
            <span className="ml-1.5 text-muted-foreground">{hoveredLabel}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
