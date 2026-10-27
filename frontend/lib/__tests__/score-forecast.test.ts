import { describe, expect, it } from "vitest";
import type { DqsForecast } from "@/lib/api/analytics";
import { scoreTrendSeries } from "@/components/insight/score-trend";
import { forecastSentence, overallForecast } from "../score-forecast";

const fc = (module_id: string, over: Partial<DqsForecast> = {}): DqsForecast => ({
  module_id, current_score: 80, forecast_7d: null, forecast_30d: null, forecast_90d: null,
  trend: "stable", confidence: 80, points: 4, span_days: 12, contributing_factors: [], ...over,
});

describe("overallForecast", () => {
  it("means the objects' projections, an object without one holding its score", () => {
    const scores = new Map([["a", 70], ["b", 90]]);
    const out = overallForecast([fc("a", { forecast_7d: 74, forecast_7d_low: 70, forecast_7d_high: 78, forecast_30d: 80, forecast_30d_low: 72, forecast_30d_high: 88 })], scores);
    expect(out).toEqual([
      { days: 7, value: 82, low: 80, high: 84 },
      { days: 30, value: 85, low: 81, high: 89 },
    ]);
  });

  it("leaves out a horizon no object reaches, and gives nothing without a forecast or a score", () => {
    const scores = new Map([["a", 70]]);
    expect(overallForecast([fc("a", { forecast_7d: 72 })], scores).map((p) => p.days)).toEqual([7]);
    expect(overallForecast([], scores)).toEqual([]);
    expect(overallForecast([fc("a", { forecast_7d: 72 })], new Map())).toEqual([]);
    // a forecast for an object outside the scope is ignored
    expect(overallForecast([fc("z", { forecast_7d: 10 })], scores)).toEqual([]);
  });

  it("words the furthest horizon", () => {
    expect(forecastSentence([{ days: 7, value: 82, low: 80, high: 84 }, { days: 30, value: 85.25, low: 80.6, high: 89.4 }]))
      .toBe("Expected 85.3 in 30 days if nothing changes (range 81–89)");
    expect(forecastSentence([])).toBeNull();
  });
});

describe("scoreTrendSeries", () => {
  const points = [{ x: "r1", label: "1 Oct", y: 70, runId: "r1" }, { x: "r2", label: "8 Oct", y: 72, runId: "r2" }];

  it("is the score alone without a forecast", () => {
    expect(scoreTrendSeries(points)).toHaveLength(1);
  });

  it("continues from the last run into the forecast, its band opening from that point", () => {
    const [score, ahead] = scoreTrendSeries(points, [{ days: 7, value: 74, low: 71, high: 77 }]);
    expect(score.data).toEqual(points);
    expect(ahead.name).toBe("Forecast");
    expect(ahead.data.map((p) => [p.x, p.y])).toEqual([["r2", 72], ["+7d", 74]]);
    expect(ahead.band).toEqual([{ x: "r2", low: 72, high: 72 }, { x: "+7d", low: 71, high: 77 }]);
  });
});
