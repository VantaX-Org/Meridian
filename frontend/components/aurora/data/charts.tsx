/**
 * Aurora chart family — WS3.
 *
 * Recharts wrappers that read their colours, axes, and tooltips from the
 * Aurora theme. Every chart in the product flows through these wrappers;
 * raw `<Line>` + `<XAxis>` + `<Tooltip>` composition happens inside these
 * components so consumers never hand-wire axis ink or grid tones.
 *
 * Charts included:
 *   • <LineChart>     — single or multi-series time series.
 *   • <BarChart>      — categorical counts.
 *   • <AreaChart>     — cumulative / stacked distributions.
 *   • <DonutChart>    — categorical share (only viable when ≤ 6 slices).
 *   • <Sparkline>     — inline trend, zero chrome, used in stats + tables.
 *
 * Sankey + treemap live separately — they need ECharts and are heavier;
 * lazy-load them where they're actually used.
 */

"use client";

import {
  Area,
  AreaChart as RcAreaChart,
  Bar,
  BarChart as RcBarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart as RcLineChart,
  Pie,
  PieChart as RcPieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useMemo, useRef, useState } from "react";
import { resolveChartTokens, type ChartTokens } from "./chart-theme";
import { clsx } from "../primitives/internal";

export interface SeriesDef {
  /** Key on each datum. */
  key: string;
  /** Legend label. */
  label: string;
  /** Optional colour override; default iterates `categorical`. */
  color?: string;
}

export interface LineChartProps<
  TDatum extends Record<string, number | string>,
> {
  data: TDatum[];
  /** Key for the x-axis datum. */
  xKey: Extract<keyof TDatum, string>;
  series: SeriesDef[];
  height?: number;
  className?: string;
  yFormatter?: (value: number) => string;
  ariaLabel?: string;
}

/**
 * Resolve Aurora chart tokens for the chart's host element so the nearest
 * [data-theme] ancestor wins — matching the CSS cascade. We resolve once
 * with `null` (root) on first render so SSR has a value, then re-resolve
 * post-mount when the ref is attached so scoped themes take effect.
 */
function useTokens(hostRef: React.RefObject<HTMLDivElement | null>): ChartTokens {
  const initial = useMemo(() => resolveChartTokens(null), []);
  const [tokens, setTokens] = useState<ChartTokens>(initial);
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const next = resolveChartTokens(el);
    setTokens(next);
  }, [hostRef]);
  return tokens;
}

const TOOLTIP_STYLE_BASE = {
  borderRadius: 8,
  padding: "8px 12px",
  fontFamily: "var(--aurora-font-ui)",
  fontSize: 12,
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
};

export function LineChart<
  TDatum extends Record<string, number | string>,
>({
  data,
  xKey,
  series,
  height = 240,
  className,
  yFormatter,
  ariaLabel,
}: LineChartProps<TDatum>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const t = useTokens(hostRef);
  return (
    <div
      ref={hostRef}
      className={clsx("aurora-chart", className)}
      style={{ width: "100%", height }}
      role="img"
      aria-label={ariaLabel}
    >
      <ResponsiveContainer>
        <RcLineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={t.gridInk} vertical={false} strokeDasharray="2 4" />
          <XAxis
            dataKey={xKey as string}
            stroke={t.axisLine}
            tick={{ fill: t.axisInk, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke={t.axisLine}
            tick={{ fill: t.axisInk, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={yFormatter}
            width={48}
          />
          <Tooltip
            cursor={{ stroke: t.axisLine, strokeWidth: 1 }}
            contentStyle={{
              ...TOOLTIP_STYLE_BASE,
              background: t.tooltipBg,
              border: `1px solid ${t.tooltipLine}`,
              color: t.tooltipInk,
            }}
            labelStyle={{ color: t.axisInk, fontSize: 11 }}
          />
          {series.length > 1 ? (
            <Legend
              verticalAlign="top"
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12, color: t.axisInk }}
            />
          ) : null}
          {series.map((s, index) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={s.color ?? t.categorical[index % t.categorical.length]}
              strokeWidth={1.75}
              dot={false}
              activeDot={{ r: 3 }}
              name={s.label}
              isAnimationActive={false}
            />
          ))}
        </RcLineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ----------------------------------------------------------------- Bar --- */

export interface BarChartProps<
  TDatum extends Record<string, number | string>,
> {
  data: TDatum[];
  xKey: Extract<keyof TDatum, string>;
  series: SeriesDef[];
  /** Stack bars rather than grouping side-by-side. */
  stacked?: boolean;
  height?: number;
  className?: string;
  yFormatter?: (value: number) => string;
  ariaLabel?: string;
}

export function BarChart<
  TDatum extends Record<string, number | string>,
>({
  data,
  xKey,
  series,
  stacked,
  height = 240,
  className,
  yFormatter,
  ariaLabel,
}: BarChartProps<TDatum>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const t = useTokens(hostRef);
  const stackId = stacked ? "stack" : undefined;
  return (
    <div
      ref={hostRef}
      className={clsx("aurora-chart", className)}
      style={{ width: "100%", height }}
      role="img"
      aria-label={ariaLabel}
    >
      <ResponsiveContainer>
        <RcBarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={t.gridInk} vertical={false} strokeDasharray="2 4" />
          <XAxis
            dataKey={xKey as string}
            stroke={t.axisLine}
            tick={{ fill: t.axisInk, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke={t.axisLine}
            tick={{ fill: t.axisInk, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={yFormatter}
            width={48}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            contentStyle={{
              ...TOOLTIP_STYLE_BASE,
              background: t.tooltipBg,
              border: `1px solid ${t.tooltipLine}`,
              color: t.tooltipInk,
            }}
          />
          {series.length > 1 ? (
            <Legend
              verticalAlign="top"
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12, color: t.axisInk }}
            />
          ) : null}
          {series.map((s, index) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId={stackId}
              fill={s.color ?? t.categorical[index % t.categorical.length]}
              radius={[3, 3, 0, 0]}
              name={s.label}
              isAnimationActive={false}
            />
          ))}
        </RcBarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------------------------------------------------------- Area --- */

export interface AreaChartProps<
  TDatum extends Record<string, number | string>,
> extends Omit<LineChartProps<TDatum>, "series"> {
  series: SeriesDef[];
  stacked?: boolean;
}

export function AreaChart<
  TDatum extends Record<string, number | string>,
>({
  data,
  xKey,
  series,
  height = 240,
  stacked,
  className,
  yFormatter,
  ariaLabel,
}: AreaChartProps<TDatum>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const t = useTokens(hostRef);
  const stackId = stacked ? "stack" : undefined;
  return (
    <div
      ref={hostRef}
      className={clsx("aurora-chart", className)}
      style={{ width: "100%", height }}
      role="img"
      aria-label={ariaLabel}
    >
      <ResponsiveContainer>
        <RcAreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={t.gridInk} vertical={false} strokeDasharray="2 4" />
          <XAxis
            dataKey={xKey as string}
            stroke={t.axisLine}
            tick={{ fill: t.axisInk, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke={t.axisLine}
            tick={{ fill: t.axisInk, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={yFormatter}
            width={48}
          />
          <Tooltip
            contentStyle={{
              ...TOOLTIP_STYLE_BASE,
              background: t.tooltipBg,
              border: `1px solid ${t.tooltipLine}`,
              color: t.tooltipInk,
            }}
          />
          {series.map((s, index) => {
            const color =
              s.color ?? t.categorical[index % t.categorical.length];
            return (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stackId={stackId}
                stroke={color}
                fill={color}
                fillOpacity={0.18}
                strokeWidth={1.5}
                name={s.label}
                isAnimationActive={false}
              />
            );
          })}
        </RcAreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* --------------------------------------------------------------- Donut --- */

export interface DonutSlice {
  name: string;
  value: number;
  color?: string;
}

export interface DonutChartProps {
  data: DonutSlice[];
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
  className?: string;
  ariaLabel?: string;
}

export function DonutChart({
  data,
  height = 180,
  innerRadius = 48,
  outerRadius = 72,
  className,
  ariaLabel,
}: DonutChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const t = useTokens(hostRef);
  return (
    <div
      ref={hostRef}
      className={clsx("aurora-chart", className)}
      style={{ width: "100%", height }}
      role="img"
      aria-label={ariaLabel}
    >
      <ResponsiveContainer>
        <RcPieChart>
          <Tooltip
            contentStyle={{
              ...TOOLTIP_STYLE_BASE,
              background: t.tooltipBg,
              border: `1px solid ${t.tooltipLine}`,
              color: t.tooltipInk,
            }}
          />
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={1.25}
            stroke="var(--aurora-canvas-base)"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {data.map((entry, index) => (
              <Cell
                key={entry.name}
                fill={
                  entry.color ?? t.categorical[index % t.categorical.length]
                }
              />
            ))}
          </Pie>
        </RcPieChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ----------------------------------------------------------- Sparkline --- */

export interface SparklineProps<
  TDatum extends Record<string, number | string>,
> {
  data: TDatum[];
  xKey: Extract<keyof TDatum, string>;
  yKey: Extract<keyof TDatum, string>;
  height?: number;
  width?: number | string;
  color?: string;
  fill?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function Sparkline<
  TDatum extends Record<string, number | string>,
>({
  data,
  xKey,
  yKey,
  height = 28,
  width = "100%",
  color,
  fill = true,
  className,
  ariaLabel,
}: SparklineProps<TDatum>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const t = useTokens(hostRef);
  const stroke = color ?? t.accent;
  return (
    <div
      ref={hostRef}
      className={clsx("aurora-sparkline", className)}
      style={{ width, height }}
      role="img"
      aria-label={ariaLabel}
    >
      <ResponsiveContainer>
        <RcAreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
          <XAxis dataKey={xKey as string} hide />
          <YAxis hide domain={["auto", "auto"]} />
          <Area
            type="monotone"
            dataKey={yKey as string}
            stroke={stroke}
            fill={fill ? stroke : "transparent"}
            fillOpacity={fill ? 0.14 : 0}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        </RcAreaChart>
      </ResponsiveContainer>
    </div>
  );
}
