import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as insightsApi from "@/lib/api/insights";
import ReadinessPage from "../page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("run=v1"),
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("ReadinessPage", () => {
  it("renders a verdict badge per module/wave cell", async () => {
    vi.spyOn(insightsApi, "getReadiness").mockResolvedValue({
      version_id: "v1",
      threshold: 70,
      cells: [{ module: "material_master", wave: "Wave 1", verdict: "go", blocker_count: 0, dqs: 92 }],
      configured: true,
    });
    renderWithQuery(<ReadinessPage />);
    expect(await screen.findByText("go")).toBeInTheDocument();
    expect(screen.getByText("material_master")).toBeInTheDocument();
    expect(screen.getByText("Wave 1")).toBeInTheDocument();
  });

  it("shows a loading skeleton while the request is in flight", () => {
    vi.spyOn(insightsApi, "getReadiness").mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQuery(<ReadinessPage />);
    expect(container.querySelector("table")).not.toBeInTheDocument();
  });

  it("shows an empty state when the run has no readiness cells", async () => {
    vi.spyOn(insightsApi, "getReadiness").mockResolvedValue({ version_id: "v1", threshold: 70, cells: [], configured: true });
    renderWithQuery(<ReadinessPage />);
    await waitFor(() => expect(screen.getByText(/no readiness data/i)).toBeInTheDocument());
  });

  it("shows a not-configured empty state when readiness waves aren't set", async () => {
    vi.spyOn(insightsApi, "getReadiness").mockResolvedValue({ version_id: null, threshold: 70, cells: [], configured: false });
    renderWithQuery(<ReadinessPage />);
    await waitFor(() => expect(screen.getByText(/readiness waves not set/i)).toBeInTheDocument());
    expect(screen.getByText(/settings > alert thresholds/i)).toBeInTheDocument();
  });

  it("shows an error state when the request fails", async () => {
    vi.spyOn(insightsApi, "getReadiness").mockRejectedValue(new Error("network error"));
    renderWithQuery(<ReadinessPage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
  });

  it("retries the readiness request when the retry button is clicked", async () => {
    const getReadiness = vi
      .spyOn(insightsApi, "getReadiness")
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ version_id: "v1", threshold: 70, cells: [], configured: true });
    renderWithQuery(<ReadinessPage />);

    const retry = await screen.findByRole("button", { name: /retry/i });
    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByText(/no readiness data/i)).toBeInTheDocument());
    expect(getReadiness).toHaveBeenCalledTimes(2);
  });
});
