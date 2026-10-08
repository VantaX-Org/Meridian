// frontend/app/(app)/insights/__tests__/page.test.tsx
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as insightsApi from "@/lib/api/insights";
import InsightsIndexPage from "../page";

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("InsightsIndexPage", () => {
  it("renders links to all five insight views", async () => {
    vi.spyOn(insightsApi, "getReadiness").mockResolvedValue({ version_id: "v1", threshold: 80, cells: [] });
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
});
