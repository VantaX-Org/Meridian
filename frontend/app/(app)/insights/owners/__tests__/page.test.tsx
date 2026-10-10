import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as insightsApi from "@/lib/api/insights";
import OwnersPage from "../page";

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("OwnersPage", () => {
  it("renders one card per owner with score, delta, severities and digest", async () => {
    vi.spyOn(insightsApi, "getOwners").mockResolvedValue({
      owners: [
        {
          owner: "jane.doe",
          score: 82.5,
          delta: 3.2,
          open_by_severity: { critical: 1, high: 4 },
          fixed_since_baseline: 11,
          oldest_item_age_days: 40,
          digest: "3 new critical findings in material_master",
          schedule: "weekly",
          last_sent: "2026-10-01T06:00:00Z",
        },
      ],
    });
    renderWithQuery(<OwnersPage />);
    expect(await screen.findByText("jane.doe")).toBeInTheDocument();
    expect(screen.getByText("82.5")).toBeInTheDocument();
    expect(screen.getByText(/critical: 1/)).toBeInTheDocument();
    expect(screen.getByText(/3 new critical findings/)).toBeInTheDocument();
  });

  it("shows a loading skeleton while the request is in flight", () => {
    vi.spyOn(insightsApi, "getOwners").mockReturnValue(new Promise(() => {}));
    renderWithQuery(<OwnersPage />);
    expect(screen.queryByTestId("owner-card")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no owners", async () => {
    vi.spyOn(insightsApi, "getOwners").mockResolvedValue({ owners: [] });
    renderWithQuery(<OwnersPage />);
    await waitFor(() => expect(screen.getByText(/no owners scored yet/i)).toBeInTheDocument());
  });

  it("shows an error state when the request fails", async () => {
    vi.spyOn(insightsApi, "getOwners").mockRejectedValue(new Error("network error"));
    renderWithQuery(<OwnersPage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
  });

  it("retries the owners request when the retry button is clicked", async () => {
    const getOwners = vi
      .spyOn(insightsApi, "getOwners")
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ owners: [] });
    renderWithQuery(<OwnersPage />);

    const retry = await screen.findByRole("button", { name: /retry/i });
    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByText(/no owners scored yet/i)).toBeInTheDocument());
    expect(getOwners).toHaveBeenCalledTimes(2);
  });
});
