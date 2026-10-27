"use client";

// frontend/design/charts/Line.tsx
import { useMemo, useState } from "react";
import type { ActiveDotProps, DotItemDotProps } from "recharts";
import { ComposedChart, Area, Line as RLine, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import { chartTheme, chartSummary, type ChartPoint } from "./theme";
import { ChartTooltip } from "./Tooltip";
import { ChartLegend, isolatedOpacity } from "./Legend";
import { ChartPointActions } from "./PointActions";
import { mMotion, reducedMotion } from "../tokens";

/** An extra named series for a multi-series Line. Colours come from the ten-hue palette in order. */
export interface LineSeries {
  name: string;
  data: ChartPoint[];
  /** An uncertainty band, low to high at each x, drawn behind the line in the series hue's fill. */
  band?: LineBand[];
}

/** One x of a series band: the range a value is expected to fall in. */
export interface LineBand {
  x: string | number;
  low: number;
  high: number;
}

type LineRow = { x: string | number } & Record<string, string | number | [number, number]>;

/**
 * The chart rows: one per x across every series (and `xDomain`), `s{i}` the value of series i and `b{i}` its band
 * as `[low, high]`. On a numeric axis the rows are sorted by x, so a line runs left to right whatever the input order.
 */
export function lineRows(
  lines: readonly LineSeries[],
  xDomain: readonly { x: string | number }[] = [],
  numericX = false,
): LineRow[] {
  const byX = new Map<string | number, LineRow>();
  const at = (x: string | number): LineRow => {
    const row = byX.get(x) ?? { x };
    byX.set(x, row);
    return row;
  };
  for (const d of xDomain) at(d.x);
  lines.forEach((sr, i) => {
    sr.data.forEach((p) => { at(p.x)[`s${i}`] = p.y; });
    sr.band?.forEach((b) => { at(b.x)[`b${i}`] = [b.low, b.high]; });
  });
  const rows = [...byX.values()];
  return numericX ? rows.sort((a, b) => Number(a.x) - Number(b.x)) : rows;
}

/**
 * The series key the chart isolates: the legend's choice when the viewer made one, else the series named by
 * `highlight` (a caller's selector), else none.
 */
export function isolationKey(lines: readonly LineSeries[], legendChoice: string | null | undefined, highlight: string | undefined): string | null {
  if (legendChoice !== undefined) return legendChoice;
  const i = highlight === undefined ? -1 : lines.findIndex((sr) => sr.name === highlight);
  return i >= 0 ? String(i) : null;
}

/** Room for the first tick label so it never sits on the y-axis "0", and for the last dot. */
const X_PADDING = { left: 16, right: 16 } as const;

/** The series point drawn on a chart row: rows span the shared x domain, so a sparse series is looked up by x, never by row index. */
export function pointAtRow<P extends { x: string | number }>(points: P[], x: string | number | undefined): P | undefined {
  return x === undefined ? undefined : points.find((p) => p.x === x);
}

/**
 * Right margin that keeps the last x tick inside the chart: the tick is centred on the last point, so half its
 * width hangs past the plot. Estimated from the label length at the 12 px axis font (about 6.8 px a character).
 */
export function lastTickMargin(lastLabel: string | undefined): number {
  return Math.max(5, Math.min(96, Math.ceil(((lastLabel ?? "").length * 6.8) / 2) - 16));
}

/**
 * The y window the data sits in, on tens, never below 0 or above 100 and at least 20 wide, so a score that holds
 * at 72 reads as a line through the middle of the chart, not a hairline over an empty block. The target line
 * stays inside the window when one is set.
 */
export function yDomain(values: readonly number[], target?: number): [number, number] {
  const all = target == null ? values : [...values, target];
  if (all.length === 0) return [0, 100];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const min = Math.max(0, Math.floor((lo - 8) / 10) * 10);
  const max = Math.min(100, Math.ceil((hi + 4) / 10) * 10);
  return [Math.min(min, Math.max(0, max - 20)), Math.max(max, Math.min(100, min + 20))];
}

/** A count axis: from 0 to the next round number above the largest value (1, 2 or 5 times a power of ten). */
export function countDomain(values: readonly number[]): [number, number] {
  const hi = Math.max(1, ...values);
  const step = 10 ** Math.floor(Math.log10(hi));
  const nice = [1, 2, 5, 10].map((m) => m * step).find((v) => v >= hi) ?? hi;
  return [0, nice];
}

/**
 * A count axis fitted to the data: from a round number under the smallest value to one over the largest (a step of
 * 1, 2 or 5 times a power of ten, about four steps across), never below 0, so a backlog that moves from 2,610 to
 * 2,540 reads as a slope, not a flat line on a 0 to 5,000 axis. `target` stays inside the window when set.
 */
export function fitCountDomain(values: readonly number[], target?: number): [number, number] {
  const all = target == null ? values : [...values, target];
  if (all.length === 0) return [0, 1];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || Math.max(1, Math.abs(hi) * 0.1);
  const raw = span / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].map((m) => m * pow).find((v) => v >= raw) ?? raw);
  const min = Math.max(0, Math.floor(lo / step) * step);
  const max = Math.ceil(hi / step) * step;
  return [min, max > min ? max : min + step];
}

/**
 * A tick reads short: no year when every point shares one, minutes not seconds, no "#2" twin suffix. The tooltip
 * keeps the full label.
 */
export function tickText(label: string, dropYear: boolean, seconds = false): string {
  let s = label.replace(/ #\d+$/, "");
  if (dropYear) s = s.replace(/ \d{4}(?=,|$)/, "");
  return seconds ? s : s.replace(/(\d{1,2}:\d{2}):\d{2}/, "$1");
}

/**
 * Each x's tick text in ONE format for the whole axis: the short text (`text`, minutes) when every point reads
 * differently by it, else the finer text (`finer`, the time to the second) for every point. A point whose tick
 * would still repeat one already on the axis is left blank; the tooltip still names it in full. Never an ordinal
 * ("#3 #2 #3" read as run numbers), never "16 Oct, 03:01" beside "16 Oct, 03:01:48".
 */
export function uniqueTicks(
  xs: readonly (string | number)[],
  text: (x: string | number) => string,
  finer?: (x: string | number) => string,
): Map<string | number, string> {
  const coarse = xs.map(text);
  const pick = new Set(coarse).size === coarse.length || !finer ? coarse : xs.map(finer);
  const used = new Set<string>();
  const out = new Map<string | number, string>();
  xs.forEach((x, i) => {
    const t = pick[i];
    out.set(x, used.has(t) ? "" : t);
    used.add(t);
  });
  return out;
}

export function Line({
  data,
  onPointClick,
  height = 240,
  draw = true,
  dqsThreshold,
  label,
  annotations,
  series,
  xDomain,
  counts = false,
  numericX = false,
  highlight,
  thresholdLabel,
}: {
  data: ChartPoint[];
  onPointClick?: (point: ChartPoint) => void;
  height?: number;
  /** Draw-in on mount over `mMotion.draw`. On by default, off under reduced motion. */
  draw?: boolean;
  dqsThreshold?: number;
  /** Names the chart for assistive tech; the data points are appended. */
  label?: string;
  /** Vertical markers at an x value, e.g. a rule change or a run that moved the score. */
  annotations?: { x: string | number; label: string; kind?: "change" | "event" }[];
  /** Multi-series mode: up to ten series on the viz palette, with a legend that isolates a series on click. `data` is ignored for the lines. */
  series?: LineSeries[];
  /** Every x the axis must show, so sibling charts share one domain even where this series has no value. */
  xDomain?: { x: string | number; label?: string }[];
  /**
   * Counts, not scores: the y axis runs from 0 to a round number above the largest value; "fit" fits it to the
   * data instead (`fitCountDomain`), for a count that moves little against its size.
   */
  counts?: boolean | "fit";
  /** With `dqsThreshold`, the reference line's label; defaults to "Target {value}". */
  thresholdLabel?: string;
  /**
   * A numeric x axis: points sit at their x value (e.g. days from today), not at equal steps. Ticks are the
   * `xDomain` values when given; labels come from `xDomain` and point labels as on a category axis.
   */
  numericX?: boolean;
  /** Multi-series mode: the name of the series to isolate, e.g. from a selector beside the chart. The legend can still change it. */
  highlight?: string;
}) {
  const animate = draw && !reducedMotion();
  // undefined: follow `highlight`; null or a key: the viewer's legend choice, until `highlight` changes.
  const [legendChoice, setLegendChoice] = useState<string | null | undefined>(undefined);
  const [choiceFor, setChoiceFor] = useState(highlight);
  if (choiceFor !== highlight) {
    setChoiceFor(highlight);
    setLegendChoice(undefined);
  }
  const multi = series && series.length > 0 ? series : null;
  const lines = useMemo<LineSeries[]>(() => multi ?? [{ name: label ?? "Value", data }], [multi, label, data]);
  const isolated = isolationKey(lines, legendChoice, multi ? highlight : undefined);
  const rows = useMemo<LineRow[]>(() => lineRows(lines, xDomain, numericX), [lines, xDomain, numericX]);
  const hasBand = lines.some((sr) => sr.band && sr.band.length > 0);
  // A point keyed by an id (a run id) carries its display text in `label`; ticks and the tooltip show that, never the key.
  const labelOf = useMemo(() => {
    const m = new Map<string | number, string>();
    for (const d of xDomain ?? []) if (d.label) m.set(d.x, d.label);
    for (const p of multi ? multi.flatMap((sr) => sr.data) : data) if (p.label) m.set(p.x, p.label);
    return (x: string | number) => m.get(x) ?? String(x);
  }, [multi, data, xDomain]);
  const years = new Set(rows.map((r) => /\b(\d{4})\b/.exec(labelOf(r.x))?.[1]).filter(Boolean));
  const ticks = uniqueTicks(
    rows.map((r) => r.x),
    (x) => tickText(labelOf(x), years.size === 1),
    (x) => tickText(labelOf(x), years.size === 1, true),
  );
  const tickOf = (x: string | number) => ticks.get(x) ?? tickText(labelOf(x), years.size === 1);
  const rightMargin = lastTickMargin(rows.length ? tickOf(rows[rows.length - 1].x) : undefined);
  const values = rows
    .flatMap((r) => Object.entries(r).filter(([k]) => k !== "x").flatMap(([, v]) => (Array.isArray(v) ? v : [Number(v)])))
    .filter(Number.isFinite);
  const domain = counts === "fit" ? fitCountDomain(values, dqsThreshold) : counts ? countDomain(values) : yDomain(values, dqsThreshold);
  const summaryData = multi ? multi.flatMap((sr) => sr.data.map((p) => ({ ...p, x: `${sr.name} ${p.label ?? p.x}`, label: undefined }))) : data;
  // The keyboard path: one button per point, named by series in a multi-series chart.
  const pointSeries = new Map<ChartPoint, string>(multi ? multi.flatMap((sr) => sr.data.map((p) => [p, sr.name] as const)) : []);
  return (
    <div>
    <div role="img" aria-label={chartSummary(summaryData, label)}>
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} accessibilityLayer={false} margin={{ top: 5, right: rightMargin, bottom: 5, left: 5 }}>
        <CartesianGrid stroke={chartTheme.grid} strokeDasharray="none" vertical={false} />
        <XAxis
          dataKey="x"
          axisLine={false}
          tickLine={false}
          tick={{ fill: chartTheme.axis, fontSize: 12 }}
          tickFormatter={tickOf}
          minTickGap={24}
          padding={X_PADDING}
          interval="preserveStartEnd"
          {...(numericX ? { type: "number" as const, domain: ["dataMin", "dataMax"], ticks: xDomain?.map((d) => d.x) } : {})}
        />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: chartTheme.axis, fontSize: 12 }} domain={domain} tickCount={5} />
        <Tooltip content={<ChartTooltip />} cursor={false} labelFormatter={(x) => labelOf(x as string | number)} />
        {dqsThreshold !== undefined && (
          <ReferenceLine
            y={dqsThreshold}
            stroke={chartTheme.axis}
            strokeDasharray="4 4"
            label={{ value: thresholdLabel ?? `Target ${dqsThreshold}`, position: "insideTopRight", fill: chartTheme.axis, fontSize: 12 }}
          />
        )}
        {/* Area under the first series only, unless the chart draws bands: then each band is the only fill. */}
        {!hasBand && (
          <Area type="linear" dataKey="s0" baseValue={domain[0]} stroke="none" fill={chartTheme.area} isAnimationActive={false} activeDot={false} legendType="none" tooltipType="none" />
        )}
        {lines.map((sr, i) =>
          sr.band && sr.band.length > 0 ? (
            <Area
              key={`b${i}`}
              type="linear"
              dataKey={`b${i}`}
              stroke="none"
              fill={chartTheme.seriesFill[i % chartTheme.seriesFill.length]}
              fillOpacity={isolated == null || isolated === String(i) ? 1 : 0}
              connectNulls
              isAnimationActive={false}
              activeDot={false}
              legendType="none"
              tooltipType="none"
            />
          ) : null,
        )}
        {annotations?.map((a) => (
          <ReferenceLine
            key={`${a.x}-${a.label}`}
            x={a.x}
            stroke={a.kind === "event" ? chartTheme.high : chartTheme.axis}
            strokeDasharray="2 3"
            label={{ value: a.label, position: "insideTopRight", fontSize: 11, fill: chartTheme.axis }}
          />
        ))}
        {lines.map((sr, i) => {
          const color = chartTheme.series[i % chartTheme.series.length];
          const key = `s${i}`;
          return (
            <RLine
              key={key}
              // Straight segments between measured points: a smoothed curve would draw values no run produced.
              type="linear"
              dataKey={key}
              name={sr.name}
              stroke={color}
              strokeWidth={2}
              strokeOpacity={isolatedOpacity(String(i), isolated)}
              connectNulls
              isAnimationActive={animate}
              animationDuration={mMotion.draw}
              animationEasing="ease-out"
              // A dot at the last point only, r 3 with a 2px sheet ring.
              dot={(d: DotItemDotProps) =>
                d.index === rows.length - 1 ? (
                  <circle key={d.index} cx={d.cx ?? 0} cy={d.cy ?? 0} r={3} fill={color} stroke={chartTheme.sheet} strokeWidth={2} opacity={isolatedOpacity(String(i), isolated)} />
                ) : (
                  <g key={d.index} />
                )
              }
              activeDot={(dotProps: ActiveDotProps) => (
                <circle
                  key={dotProps.index}
                  cx={dotProps.cx ?? 0}
                  cy={dotProps.cy ?? 0}
                  r={4}
                  fill={color}
                  stroke={chartTheme.sheet}
                  strokeWidth={2}
                  style={{ cursor: onPointClick ? "pointer" : "default" }}
                  // Rows span the shared x domain; a sparse series is shorter, so find the point by its x key.
                  onClick={() => {
                    const point = pointAtRow(multi ? sr.data : data, (dotProps.payload as LineRow | undefined)?.x ?? rows[dotProps.index ?? -1]?.x);
                    if (point) onPointClick?.(point);
                  }}
                />
              )}
            />
          );
        })}
      </ComposedChart>
    </ResponsiveContainer>
    </div>
    <ChartPointActions
      points={multi ? multi.flatMap((sr) => sr.data) : data}
      onPointClick={onPointClick}
      label={label}
      nameOf={multi ? (p) => `${pointSeries.get(p) ?? ""} ${labelOf(p.x)}`.trim() : (p) => labelOf(p.x)}
    />
    {/* The legend's isolate buttons sit outside the image, which would otherwise hide them from assistive tech. */}
    {multi && multi.length > 1 && (
      <ChartLegend
        items={multi.map((sr, i) => ({ key: String(i), name: sr.name, color: chartTheme.series[i % chartTheme.series.length] }))}
        isolated={isolated}
        onIsolate={setLegendChoice}
      />
    )}
    </div>
  );
}
