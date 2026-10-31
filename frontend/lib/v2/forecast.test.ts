import { describe, expect, it } from "vitest";
import type { DqsForecast } from "@/lib/api/v2/analytics";
import { courseOf, fitLine, maxHorizon, readAt } from "./forecast";

const base = (over: Partial<DqsForecast> = {}): DqsForecast => ({
  module_id: "fi_gl",
  current_score: 70,
  forecast_7d: 77,
  forecast_7d_low: 75,
  forecast_7d_high: 79,
  forecast_30d: 100,
  forecast_30d_low: 96,
  forecast_30d_high: 100,
  forecast_90d: null,
  forecast_90d_low: null,
  forecast_90d_high: null,
  trend: "improving",
  confidence: 96,
  points: 4,
  span_days: 15,
  // score = 70 + 1 * day
  history: [-15, -10, -5, 0].map((day) => ({ day, score: 70 + day })),
  contributing_factors: [],
  ...over,
});

describe("forecast", () => {
  it("refits the backend line from the history", () => {
    const l = fitLine(base().history);
    expect(l?.slope).toBeCloseTo(1);
    expect(l?.intercept).toBeCloseTo(70);
  });

  it("reads the line at go-live and the day it crosses the target", () => {
    const r = readAt(base(), 10, 85);
    expect(r.score).toBeCloseTo(80);
    expect(r.low).toBeLessThan(80);
    expect(r.high).toBeGreaterThan(80);
    expect(r.crossing).toBeCloseTo(15);
  });

  it("gives no score past the furthest stored horizon", () => {
    expect(maxHorizon(base())).toBe(30);
    expect(readAt(base(), 45, 85).score).toBeNull();
  });

  it("never crosses on a falling line and is already there above target", () => {
    const falling = base({ history: [-15, -10, -5, 0].map((day) => ({ day, score: 70 - day })) });
    expect(readAt(falling, 5, 90).crossing).toBeNull();
    expect(readAt(base(), 5, 60).crossing).toBe(0);
  });

  it("calls the course off on any short module, unknown on any gap", () => {
    expect(courseOf([readAt(base(), 10, 85)], 85)).toBe("off");
    expect(courseOf([readAt(base(), 20, 85)], 85)).toBe("on");
    expect(courseOf([readAt(base(), 20, 85), readAt(base(), 45, 85)], 85)).toBe("unknown");
    expect(courseOf([], 85)).toBe("unknown");
  });
});
