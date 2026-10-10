// frontend/app/(app)/insights/exec/__tests__/page.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as insightsApi from "@/lib/api/insights";
import * as downloadApi from "@/lib/api/download";
import ExecPage from "../page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("run=v1"),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

// useDayOne() needs LocalAuthProvider context, which this test does not set up;
// mock it wholesale so the page renders without an auth provider.
vi.mock("@/hooks/use-day-one", () => ({
  useDayOne: () => ({ status: "ready", step: null }),
  DayOneAction: () => null,
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("ExecPage", () => {
  it("renders the narrative and exports the PDF via the export menu", async () => {
    vi.spyOn(insightsApi, "getExec").mockResolvedValue({
      version_id: "v1",
      narrative: "Readiness improved three points since last run.",
      readiness_cells: [{ module: "material_master", wave: "wave_1", verdict: "go", blocker_count: 0, dqs: 91, score: 100, records_blocked: 0 }],
      waterfall: [{ x: "baseline", y: 70 }, { x: "current", y: 20 }],
      impact_rows: [{ feature: "Invoice posting", status: "blocked", record_count: 12, value_per_record: 100, value_at_risk: 1200, causing_rules: [] }],
      owner_rows: [{ owner: "me", score: 91, delta: 3, open_by_severity: {}, fixed_since_baseline: 2, oldest_item_age_days: 1, digest: "ok", schedule: "weekly", last_sent: null }],
    });
    const download = vi.spyOn(downloadApi, "downloadAuthenticated").mockResolvedValue();

    renderWithQuery(<ExecPage />);

    expect(await screen.findByText(/readiness improved three points/i)).toBeInTheDocument();
    const exportButton = await screen.findByRole("button", { name: /export/i });
    fireEvent.click(exportButton);
    await waitFor(() => expect(download).toHaveBeenCalledWith("/api/v1/reports/executive/v1.pdf", "executive_v1.pdf"));
  });

  it("shows an error state when the exec request fails", async () => {
    vi.spyOn(insightsApi, "getExec").mockRejectedValue(new Error("network error"));
    renderWithQuery(<ExecPage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
  });

  it("retries the exec request when the retry button is clicked", async () => {
    const getExec = vi
      .spyOn(insightsApi, "getExec")
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({
        version_id: "v1",
        narrative: "Recovered after retry.",
        readiness_cells: [],
        waterfall: [],
        impact_rows: [],
        owner_rows: [],
      });
    renderWithQuery(<ExecPage />);

    const retry = await screen.findByRole("button", { name: /retry/i });
    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByText(/recovered after retry/i)).toBeInTheDocument());
    expect(getExec).toHaveBeenCalledTimes(2);
  });
});
