"use client";

import type { ChartPoint, LineSeries } from "@/design";
import { Line } from "@/design/charts/Line";
import type { TrendPoint } from "@/lib/home-metrics";
import type { ScoreForecastPoint } from "@/lib/score-forecast";

/** The series behind the score trend: the score per run and, when there is one, the forecast from the last run on. */
export function scoreTrendSeries(points: readonly TrendPoint[], forecast: readonly ScoreForecastPoint[] = []): LineSeries[] {
  const score: LineSeries = { name: "Score", data: [...points] };
  const last = points[points.length - 1];
  if (!last || forecast.length === 0) return [score];
  const ahead: ChartPoint[] = forecast.map((f) => ({ x: `+${f.days}d`, y: f.value, label: `In ${f.days} days` }));
  return [
    score,
    {
      name: "Forecast",
      // Starts at the last run, so the projection reads as the line's continuation.
      data: [{ x: last.x, y: last.y, label: last.label }, ...ahead],
      band: [{ x: last.x, low: last.y, high: last.y }, ...forecast.map((f) => ({ x: `+${f.days}d`, low: f.low, high: f.high }))],
    },
  ];
}

/**
 * The score over runs with the tenant's target line and, when Insights > Forecast has one, the expected score in
 * 7 and 30 days with its likely range shaded. One chart for Home's hero and the executive summary.
 */
export function ScoreTrend({ points, target, forecast, height = 160, label, onPointClick }: {
  points: readonly TrendPoint[];
  /** The tenant's target score; no line without one. */
  target?: number;
  forecast?: readonly ScoreForecastPoint[];
  height?: number;
  label: string;
  onPointClick?: (point: ChartPoint) => void;
}) {
  const series = scoreTrendSeries(points, forecast);
  return series.length > 1 ? (
    <Line data={[]} series={series} height={height} dqsThreshold={target} label={label} onPointClick={onPointClick} />
  ) : (
    <Line data={[...points]} height={height} dqsThreshold={target} label={label} onPointClick={onPointClick} />
  );
}
