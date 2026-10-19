"use client";

// frontend/design/charts/Radar.tsx
import { useEffect, useRef, useState } from "react";
import type { DotItemDotProps } from "recharts";
import {
  RadarChart, Radar as RRadar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip,
} from "recharts";
import { ChartTooltip } from "./Tooltip";
import { Bar } from "./Bar";
import { chartTheme, chartSummary, type ChartPoint } from "./theme";

/** Under this width the angle labels ("Accuracy", "Validity") would be clipped, so the radar yields to bars. */
export const RADAR_MIN_WIDTH = 300;

export function Radar({ data, onPointClick, label, height = 280 }: { data: ChartPoint[]; onPointClick?: (point: ChartPoint) => void; label?: string; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = width !== null && width > 0 && width < RADAR_MIN_WIDTH;
  return (
    <div ref={box} data-radar={narrow ? "bars" : "radar"}>
      {narrow ? (
        <Bar data={data} onPointClick={onPointClick} label={label} height={Math.max(160, data.length * 28)} />
      ) : (
        <div role="img" aria-label={chartSummary(data, label)}>
          <ResponsiveContainer width="100%" height={height}>
            {/* 70 percent leaves a ring for the angle labels at every width above the fallback. */}
            <RadarChart data={data} accessibilityLayer={false} outerRadius="70%">
              <PolarGrid stroke={chartTheme.grid} />
              <PolarAngleAxis dataKey="x" tick={{ fill: chartTheme.axis, fontSize: 12 }} />
              <PolarRadiusAxis axisLine={false} tickLine={false} tick={{ fill: chartTheme.axis, fontSize: 12 }} />
              <Tooltip content={<ChartTooltip />} />
              <RRadar
                dataKey="y"
                name={label ?? "Score"}
                stroke={chartTheme.series[0]}
                strokeWidth={2}
                fill={chartTheme.seriesFill[0]}
                dot={(dotProps: DotItemDotProps) => (
                  <circle
                    key={dotProps.index}
                    cx={dotProps.cx ?? 0}
                    cy={dotProps.cy ?? 0}
                    r={3}
                    fill={chartTheme.series[0]}
                    style={{ cursor: onPointClick ? "pointer" : "default" }}
                    onClick={() => onPointClick?.(data[dotProps.index])}
                  />
                )}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
