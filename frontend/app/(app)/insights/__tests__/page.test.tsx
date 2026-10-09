// frontend/app/(app)/insights/__tests__/page.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as insightsApi from "@/lib/api/insights";
import InsightsIndexPage from "../page";

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

describe("InsightsIndexPage", () => {
  it("renders links to all five insight views", async () => {
    vi.spyOn(insightsApi, "getReadiness").mockResolvedValue({ version_id: "v1", threshold: 80, cells: [], configured: true });
    vi.spyOn(insightsApi, "getImpact").mockResolvedValue({ version_id: "v1", rows: [] });
    vi.spyOn(insightsApi, "getOwners").mockResolvedValue({ owners: [] });
    vi.spyOn(insightsApi, "getExec").mockResolvedValue({
      version_id: "v1",
      narrative: "",
      readiness_cells: [],
      waterfall: [],
      impact_rows: [],
      owner_rows: [],
    });

    renderWithQuery(<InsightsIndexPage />);

    expect(await screen.findByRole("link", { name: /readiness/i })).toHaveAttribute("href", "/insights/readiness");
    expect(screen.getByRole("link", { name: /impact/i })).toHaveAttribute("href", "/insights/impact");
    expect(screen.getByRole("link", { name: /owners/i })).toHaveAttribute("href", "/insights/owners");
    expect(screen.getByRole("link", { name: /duplicates/i })).toHaveAttribute("href", "/insights/duplicates");
    expect(screen.getByRole("link", { name: /executive summary/i })).toHaveAttribute("href", "/insights/exec");
  });

  it("shows a skeleton while a tile's query is loading", async () => {
    vi.spyOn(insightsApi, "getReadiness").mockReturnValue(new Promise(() => {}));
    vi.spyOn(insightsApi, "getImpact").mockResolvedValue({ version_id: "v1", rows: [] });
    vi.spyOn(insightsApi, "getOwners").mockResolvedValue({ owners: [] });
    vi.spyOn(insightsApi, "getExec").mockResolvedValue({
      version_id: "v1",
      narrative: "",
      readiness_cells: [],
      waterfall: [],
      impact_rows: [],
      owner_rows: [],
    });

    const { container } = renderWithQuery(<InsightsIndexPage />);

    await screen.findByRole("link", { name: /readiness/i });
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it("shows a retry control when a tile's query fails, and refetches on click", async () => {
    const getReadiness = vi
      .spyOn(insightsApi, "getReadiness")
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ version_id: "v1", threshold: 80, cells: [], configured: true });
    vi.spyOn(insightsApi, "getImpact").mockResolvedValue({ version_id: "v1", rows: [] });
    vi.spyOn(insightsApi, "getOwners").mockResolvedValue({ owners: [] });
    vi.spyOn(insightsApi, "getExec").mockResolvedValue({
      version_id: "v1",
      narrative: "",
      readiness_cells: [],
      waterfall: [],
      impact_rows: [],
      owner_rows: [],
    });

    renderWithQuery(<InsightsIndexPage />);

    const retry = await screen.findByRole("button", { name: /retry/i });
    fireEvent.click(retry);

    await waitFor(() => expect(getReadiness).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });
});
