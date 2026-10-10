import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as insightsApi from "@/lib/api/insights";
import ImpactPage from "../page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("run=v1"),
}));

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

function mockEmptyProvenCost() {
  return vi.spyOn(insightsApi, "getProvenCost").mockResolvedValue({
    version_id: "v1",
    currency: "USD",
    total: 0,
    rows: [],
    value_at_risk_total: 0,
  });
}

describe("ImpactPage", () => {
  it("renders one row per feature with its value at risk", async () => {
    mockEmptyProvenCost();
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

  it("renders the proven-cost panel with headline stats, row and linked check", async () => {
    vi.spyOn(insightsApi, "getImpact").mockResolvedValue({ version_id: "v1", rows: [] });
    vi.spyOn(insightsApi, "getProvenCost").mockResolvedValue({
      version_id: "v1",
      currency: "USD",
      total: 1070,
      value_at_risk_total: 5000,
      rows: [
        {
          metric: "late_po",
          label: "Late purchase orders",
          amount: 1070,
          currency: "USD",
          by_currency: { USD: 1070 },
          documents: 3,
          check_ids: ["MM140"],
          items: [{ doc_key: "4500000123", master_key: "100000", amount: 1070, detail: "Late by 12 days", check_ids: ["MM140"] }],
        },
      ],
    });
    renderWithQuery(<ImpactPage />);

    await waitFor(() => expect(screen.getByText("Proven cost")).toBeInTheDocument());
    expect(screen.getAllByText("Value at risk").length).toBeGreaterThan(0);
    expect(screen.getByText("Late purchase orders")).toBeInTheDocument();
    expect(screen.getByText("MM140")).toBeInTheDocument();
    expect(screen.getByText("MM140").closest("a")?.getAttribute("href")).toBe("/rules/MM140");
  });

  it("keeps the impact table rendered when the proven-cost request fails", async () => {
    vi.spyOn(insightsApi, "getImpact").mockResolvedValue({
      version_id: "v1",
      rows: [
        { feature: "MIGO", status: "blocked", record_count: 42, value_per_record: 150, value_at_risk: 6300, causing_rules: ["MM-003"] },
      ],
    });
    vi.spyOn(insightsApi, "getProvenCost").mockRejectedValue(new Error("proven-cost network error"));
    renderWithQuery(<ImpactPage />);

    await waitFor(() => expect(screen.getByText("MIGO")).toBeInTheDocument());
    expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument();
    expect(screen.getByText("MM-003").closest("a")?.getAttribute("href")).toBe("/rules/MM-003");
  });

  it("shows a loading skeleton while the request is in flight", () => {
    mockEmptyProvenCost();
    vi.spyOn(insightsApi, "getImpact").mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQuery(<ImpactPage />);
    expect(container.querySelector("table")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no impacted features", async () => {
    mockEmptyProvenCost();
    vi.spyOn(insightsApi, "getImpact").mockResolvedValue({ version_id: "v1", rows: [] });
    renderWithQuery(<ImpactPage />);
    await waitFor(() => expect(screen.getByText(/no impact results yet/i)).toBeInTheDocument());
  });

  it("shows an error state when the request fails", async () => {
    mockEmptyProvenCost();
    vi.spyOn(insightsApi, "getImpact").mockRejectedValue(new Error("network error"));
    renderWithQuery(<ImpactPage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
  });

  it("retries the impact request when the retry button is clicked", async () => {
    mockEmptyProvenCost();
    const getImpact = vi
      .spyOn(insightsApi, "getImpact")
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ version_id: "v1", rows: [] });
    renderWithQuery(<ImpactPage />);

    const retry = await screen.findByRole("button", { name: /retry/i });
    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByText(/no impact results yet/i)).toBeInTheDocument());
    expect(getImpact).toHaveBeenCalledTimes(2);
  });
});
