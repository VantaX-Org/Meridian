import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as analyticsApi from "@/lib/api/analytics";
import ForecastPage from "../page";

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
