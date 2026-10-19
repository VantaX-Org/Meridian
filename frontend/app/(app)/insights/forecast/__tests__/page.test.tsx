import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as analyticsApi from "@/lib/api/analytics";
import ForecastPage, { forecastEmptyDetail } from "../page";

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
    expect(await screen.findByText("Every object, 6 runs on 1 day")).toBeInTheDocument();
    expect(screen.queryByTestId("run-scope")).toBeNull();
    expect(screen.getByRole("link", { name: "Report library" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Auto clean" })).toBeInTheDocument();
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
