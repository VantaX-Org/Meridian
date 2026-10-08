import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as insightsApi from "@/lib/api/insights";
import ImpactPage from "../page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("run=v1"),
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("ImpactPage", () => {
  it("renders one row per feature with its value at risk", async () => {
    vi.spyOn(insightsApi, "getImpact").mockResolvedValue({
      version_id: "v1",
      rows: [
        { feature: "MIGO", status: "blocked", record_count: 42, value_per_record: 150, value_at_risk: 6300, causing_rules: ["MM-003"] },
      ],
    });
    renderWithQuery(<ImpactPage />);
    await waitFor(() => expect(screen.getByText("MIGO")).toBeInTheDocument());
    expect(screen.getByText("blocked")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText(/6[,.  ]?300/)).toBeInTheDocument();
  });

  it("shows a loading skeleton while the request is in flight", () => {
    vi.spyOn(insightsApi, "getImpact").mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQuery(<ImpactPage />);
    expect(container.querySelector("table")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no impacted features", async () => {
    vi.spyOn(insightsApi, "getImpact").mockResolvedValue({ version_id: "v1", rows: [] });
    renderWithQuery(<ImpactPage />);
    await waitFor(() => expect(screen.getByText(/no blocked or degraded features/i)).toBeInTheDocument());
  });

  it("shows an error state when the request fails", async () => {
    vi.spyOn(insightsApi, "getImpact").mockRejectedValue(new Error("network error"));
    renderWithQuery(<ImpactPage />);
    await waitFor(() => expect(screen.getByText(/network error/i)).toBeInTheDocument());
  });

  it("retries the impact request when the retry button is clicked", async () => {
    const getImpact = vi
      .spyOn(insightsApi, "getImpact")
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ version_id: "v1", rows: [] });
    renderWithQuery(<ImpactPage />);

    const retry = await screen.findByRole("button", { name: /retry/i });
    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByText(/no blocked or degraded features/i)).toBeInTheDocument());
    expect(getImpact).toHaveBeenCalledTimes(2);
  });
});
