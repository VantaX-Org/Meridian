"use client";

/**
 * The object's projected score on its History tab: the daily scores so far, today's, and where the score is expected
 * to be in 7, 30 and 90 days if nothing changes, with the 95% range as a band. GET /analytics/forecast/{module}: a
 * deterministic fit on the daily scores, so the card says it is a projection and never draws it as a measurement.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, Line, type LineSeries } from "@/design";
import { getModuleForecast, type DqsForecast } from "@/lib/api/analytics";
import { formatModuleName, plural } from "@/lib/format";

const HORIZONS = [7, 30, 90] as const;
type Horizon = (typeof HORIZONS)[number];

const TREND_WORDS: Record<string, string> = { improving: "heading up", stable: "holding steady", declining: "heading down", critical: "falling fast" };

/** A point on the days axis as words: "Today", "4 days ago", "In 30 days". */
function dayLabel(day: number): string {
  const n = Math.round(Math.abs(day));
  if (n === 0) return "Today";
  return day < 0 ? `${plural(n, "day")} ago` : `In ${plural(n, "day")}`;
}

/** One projected horizon: the point and its 95% range, or null when the history is too short to project that far. */
export function horizonOf(f: DqsForecast, days: Horizon): { days: Horizon; value: number; low: number; high: number } | null {
  const value = f[`forecast_${days}d`];
  if (value == null) return null;
  return { days, value, low: f[`forecast_${days}d_low`] ?? value, high: f[`forecast_${days}d_high`] ?? value };
}

/** The object's line on a days axis (negative days are the scores so far, 0 today, positive the projection) with its range band. */
export function projectionSeries(f: DqsForecast): LineSeries {
  const past = (f.history ?? []).filter((h) => h.day < 0).map((h) => {
    const x = Math.round(h.day * 10) / 10;
    return { x, y: h.score, label: dayLabel(x) };
  });
  const ahead = HORIZONS.map((d) => horizonOf(f, d)).filter((h): h is NonNullable<typeof h> => h !== null);
  return {
    name: formatModuleName(f.module_id),
    data: [...past, { x: 0, y: f.current_score, label: dayLabel(0) }, ...ahead.map((h) => ({ x: h.days, y: h.value, label: dayLabel(h.days) }))],
    band: ahead.length ? [{ x: 0, low: f.current_score, high: f.current_score }, ...ahead.map((h) => ({ x: h.days, low: h.low, high: h.high }))] : undefined,
  };
}

export function ObjectForecast({ object }: { object: string }) {
  const q = useQuery({ queryKey: ["analytics", "forecast", object], queryFn: () => getModuleForecast(object), retry: false, meta: { ignoreError: true } });
  const f = q.data?.forecast;
  if (q.isLoading || q.isError) return null; // the score history above stands on its own
  if (!f) {
    return (
      <Card title="Projection" meta="Where the score is heading">
        <p className="m-text-body m-ink-2">{q.data?.message ?? "A projection needs scores on three different days."}</p>
      </Card>
    );
  }
  const series = projectionSeries(f);
  const ticks = [...new Set([Math.min(0, ...series.data.map((p) => Number(p.x))), 0, ...HORIZONS.filter((d) => horizonOf(f, d))])]
    .sort((a, b) => a - b)
    .map((x) => ({ x, label: dayLabel(x) }));
  const shown = HORIZONS.map((d) => horizonOf(f, d)).filter((h): h is NonNullable<typeof h> => h !== null);
  return (
    <Card title="Projection" meta="Expected score if nothing changes. A projection from the runs so far, not a measurement; the shaded band is the range it is likely to fall in">
      <div className="flex flex-col gap-3">
        <Line data={[]} series={[series]} numericX xDomain={ticks} annotations={[{ x: 0, label: "Projected" }]} label={`${formatModuleName(object)} projected score by day`} />
        <p className="m-text-body m-ink-2">
          {`${TREND_WORDS[f.trend] ?? f.trend}: ${shown.map((h) => `in ${h.days} days ${Math.round(h.value)} (range ${Math.round(h.low)} to ${Math.round(h.high)})`).join("; ")}. From ${plural(f.points, "run")} across ${plural(f.span_days, "day")}.`}
        </p>
      </div>
    </Card>
  );
}
