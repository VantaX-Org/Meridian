import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as analyticsApi from "@/lib/api/analytics";
import type { DqsForecast } from "@/lib/api/analytics";
import ForecastPage, { dayLabel, openWarnings, warningMessage, forecastDetail, forecastEmptyDetail, forecastSeries, forecastTicks, headlineHorizon, horizonOf } from "../page";

// The shared InsightActions bar (Run analysis) reads the role; no auth provider is mounted here.
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/insights/forecast",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams("run=v1"),
}));
vi.mock("@/lib/api/versions", () => ({ getVersions: async () => ({ versions: [{ id: "v1", label: "Run 1", status: "complete", run_at: "2026-10-01T00:00:00Z" }] }) }));

describe("ForecastPage", () => {
  it("renders the forecast chart and early-warnings table", async () => {
    vi.spyOn(analyticsApi, "getPredictiveAnalytics").mockResolvedValue({
      forecasts: [
        {
          module_id: "material_master",
          current_score: 80,
          forecast_7d: 81,
          forecast_30d: 83,
          forecast_90d: 86,
          trend: "improving",
          confidence: 70,
          points: 12,
          span_days: 60,
          contributing_factors: [],
        },
      ],
      early_warnings: [
        { module_id: "material_master", signal: "amber", message: "Duplicate rate rising", recommended_action: "Review match rules" },
      ],
    });
    renderWithQuery(<ForecastPage />);
    await waitFor(() => expect(analyticsApi.getPredictiveAnalytics).toHaveBeenCalled());
  });

  it("lists and counts only amber and red warnings, worded with the object's name and its threshold", async () => {
    const f = (module_id: string): DqsForecast => ({ module_id, current_score: 80, forecast_7d: 81, forecast_30d: 82, forecast_90d: null, trend: "stable", confidence: 70, points: 5, span_days: 20, contributing_factors: [] });
    vi.spyOn(analyticsApi, "getPredictiveAnalytics").mockResolvedValue({
      forecasts: [f("material_master"), f("fi_gl")],
      early_warnings: [
        { module_id: "material_master", signal: "green", reason: "healthy", threshold: 75, message: "Score is healthy and stable", recommended_action: "Keep monitoring" },
        { module_id: "fi_gl", signal: "amber", reason: "projected_below_threshold", threshold: 85, message: "x", recommended_action: "Schedule a review" },
      ],
    });
    renderWithQuery(<ForecastPage />);
    expect(await screen.findByText("1 early warning is open")).toBeInTheDocument();
    expect(screen.getByText("FI general ledger is projected to drop below 85 within 30 days")).toBeInTheDocument();
    expect(screen.queryByText(/material_master|fi_gl/)).toBeNull();
    expect(screen.queryByText("Keep monitoring")).toBeNull();
  });

  it("shows the empty state when every object is green", async () => {
    vi.spyOn(analyticsApi, "getPredictiveAnalytics").mockResolvedValue({
      forecasts: [{ ...base, module_id: "ap", trend: "stable" }],
      early_warnings: [{ module_id: "ap", signal: "green", threshold: 75, message: "Score is healthy and stable", recommended_action: "Keep monitoring" }],
    });
    renderWithQuery(<ForecastPage />);
    expect(await screen.findByText("No early warnings")).toBeInTheDocument();
    expect(screen.getByText("No early warning is open")).toBeInTheDocument();
  });

  it("words a red warning with its threshold and filters green rows out", () => {
    expect(warningMessage({ module_id: "fi_gl", signal: "red", threshold: 75, message: "", recommended_action: "" })).toBe("FI general ledger is below its threshold of 75");
    expect(openWarnings([{ module_id: "a", signal: "green", message: "", recommended_action: "" }])).toEqual([]);
  });

  it("shows an empty state when there is no forecast yet", async () => {
    vi.spyOn(analyticsApi, "getPredictiveAnalytics").mockResolvedValue({ forecasts: [], early_warnings: [] });
    renderWithQuery(<ForecastPage />);
    await waitFor(() => expect(analyticsApi.getPredictiveAnalytics).toHaveBeenCalled());
    expect(await screen.findByText("Not enough runs to forecast")).toBeInTheDocument();
    expect(screen.getByText("A forecast needs runs on three different days.")).toBeInTheDocument();
  });

  it("explains the empty forecast from the API's reason, runs_seen and days_seen, under the shared action bar", async () => {
    vi.spyOn(analyticsApi, "getPredictiveAnalytics").mockResolvedValue({ forecasts: [], early_warnings: [], reason: "needs_three_days", runs_seen: 6, days_seen: 1 });
    renderWithQuery(<ForecastPage />);
    expect(await screen.findByText("A forecast needs runs on three different days; these 6 runs cover 1 day.")).toBeInTheDocument();
    // The forecast reads every object's history, not one run: the header says what the API saw and names no run.
    expect(await screen.findByText("Every object, from 6 runs on 1 day")).toBeInTheDocument();
    expect(screen.queryByTestId("run-scope")).toBeNull();
    expect(screen.getByRole("link", { name: "Review fixes" })).toBeInTheDocument();
  });

  it("forecastEmptyDetail covers no runs, too few days and the unknown case", () => {
    expect(forecastEmptyDetail({ reason: "needs_three_days", runs_seen: 1, days_seen: 1 })).toBe("A forecast needs runs on three different days; this 1 run covers 1 day.".replace("this 1 run covers", "these 1 run cover"));
    expect(forecastEmptyDetail({ reason: null, runs_seen: 0, days_seen: 0 })).toBe("A forecast needs runs on three different days; these 0 runs cover 0 days.");
    expect(forecastEmptyDetail({ reason: "other", runs_seen: 0 })).toBe("A forecast needs finished runs, and none exists yet.");
    expect(forecastEmptyDetail(undefined)).toBe("A forecast needs runs on three different days.");
  });

  it("shows the API error message and retries on click", async () => {
    vi.spyOn(analyticsApi, "getPredictiveAnalytics").mockRejectedValue(new Error("forecast service unavailable"));
    renderWithQuery(<ForecastPage />);
    await screen.findByText(/could not reach the server/i);
    const calls = (analyticsApi.getPredictiveAnalytics as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() =>
      expect((analyticsApi.getPredictiveAnalytics as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls),
    );
  });
});

const base: DqsForecast = {
  module_id: "fi_gl",
  current_score: 72,
  forecast_7d: 70.4,
  forecast_7d_low: 66.2,
  forecast_7d_high: 74.6,
  forecast_30d: null,
  forecast_30d_low: null,
  forecast_30d_high: null,
  forecast_90d: null,
  trend: "declining",
  confidence: 92,
  points: 4,
  span_days: 3,
  history: [{ day: -3, score: 76 }, { day: -2.04, score: 75 }, { day: -1, score: 73 }, { day: 0, score: 72 }],
  contributing_factors: [],
};

describe("forecast on a days axis", () => {
  it("plots history at negative days, today at 0 and each horizon at its day count, skipping null horizons", () => {
    const sr = forecastSeries(base, true);
    expect(sr.data.map((p) => p.x)).toEqual([-3, -2, -1, 0, 7]);
    expect(sr.data.map((p) => p.label)).toEqual(["3 days ago", "2 days ago", "1 day ago", "Today", "In 7 days"]);
    expect(sr.band).toEqual([{ x: 0, low: 72, high: 72 }, { x: 7, low: 66.2, high: 74.6 }]);
    expect(forecastSeries(base, false).band).toBeUndefined();
  });

  it("falls back to today's score alone when the API sends no history", () => {
    expect(forecastSeries({ ...base, history: undefined }, false).data.map((p) => p.x)).toEqual([0, 7]);
  });

  it("ticks the first day, today and every horizon a line reaches", () => {
    const long: DqsForecast = { ...base, module_id: "ap", forecast_30d: 65, forecast_30d_low: 55, forecast_30d_high: 75, history: [{ day: -21, score: 80 }, { day: 0, score: 72 }] };
    expect(forecastTicks([forecastSeries(base, false), forecastSeries(long, false)]).map((t) => t.label)).toEqual(["21 days ago", "Today", "In 7 days", "In 30 days"]);
    expect(forecastTicks([])).toEqual([]);
  });

  it("states each horizon as a range, never a confidence percentage, and says why a horizon is missing", () => {
    expect(forecastDetail(base)).toBe(
      "FI general ledger: heading down, in 7 days 70.4 (range 66–75). No 30-day point: the runs span 3 days, and 30 days needs 10. From 4 runs across 3 days.",
    );
    expect(forecastDetail(base)).not.toMatch(/%|confidence/);
    expect(headlineHorizon(base)?.days).toBe(7);
    expect(headlineHorizon({ ...base, forecast_30d: 60 })).toEqual({ days: 30, value: 60, low: 60, high: 60 });
    expect(horizonOf(base, 90)).toBeNull();
    expect(dayLabel(0.04)).toBe("Today");
  });

  it("puts the 7-day range in the situation and the detail when the API leaves 30 days out", async () => {
    vi.spyOn(analyticsApi, "getPredictiveAnalytics").mockResolvedValue({ forecasts: [base], early_warnings: [] });
    renderWithQuery(<ForecastPage />);
    expect(await screen.findByText(/is predicted at 70\.4 in 7 days \(range 66–75\)/)).toBeInTheDocument();
    expect(screen.getByText(/No 30-day point/)).toBeInTheDocument();
    expect(screen.queryByText(/% confidence/)).toBeNull();
  });
});
