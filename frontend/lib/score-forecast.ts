// The overall score's forecast: the per-object forecasts of GET /analytics/predictive (Insights > Forecast) folded
// into the one score Home and the executive summary show, the mean of each object's composite. Pure; no fetching.
import type { DqsForecast } from "@/lib/api/analytics";
import { round1 } from "@/lib/format";

/** One projected point of the overall score: days ahead, the expected value and its likely range. */
export interface ScoreForecastPoint {
  days: 7 | 30;
  value: number;
  low: number;
  high: number;
}

const HORIZONS = [7, 30] as const;

/**
 * The overall score at 7 and 30 days if nothing changes: at each horizon, the mean over `scores` (each object's
 * current composite, by module) of the object's projected value, or its current score when the forecast does not
 * reach that far (an object without a forecast holds its score). The range is the mean of the objects' ranges, held
 * the same way. A horizon no object reaches is left out; no forecast at all gives [].
 */
export function overallForecast(forecasts: readonly DqsForecast[], scores: ReadonlyMap<string, number>): ScoreForecastPoint[] {
  if (scores.size === 0) return [];
  const byModule = new Map(forecasts.map((f) => [f.module_id, f]));
  const out: ScoreForecastPoint[] = [];
  for (const days of HORIZONS) {
    let reached = false;
    let value = 0;
    let low = 0;
    let high = 0;
    for (const [module, now] of scores) {
      const f = byModule.get(module);
      const v = f?.[`forecast_${days}d`];
      if (v == null || !f) {
        value += now; low += now; high += now;
        continue;
      }
      reached = true;
      value += v;
      low += f[`forecast_${days}d_low`] ?? v;
      high += f[`forecast_${days}d_high`] ?? v;
    }
    const n = scores.size;
    if (reached) out.push({ days, value: round1(value / n), low: round1(low / n), high: round1(high / n) });
  }
  return out;
}

/** "Expected 74.2 in 30 days (range 70–78)": the furthest horizon in words; null without a forecast. */
export function forecastSentence(points: readonly ScoreForecastPoint[]): string | null {
  const last = points[points.length - 1];
  if (!last) return null;
  return `Expected ${last.value.toFixed(1)} in ${last.days} days if nothing changes (range ${Math.round(last.low)}–${Math.round(last.high)})`;
}
