import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PairedQuality } from "../screens/PairedQuality";

vi.mock("@/lib/api/v2/migration", () => ({
  getMigrationRuns: async () => ({ runs: [{ id: "r1", status: "analysed" }] }),
  getReconciliation: async () => ({
    scores: [{ module: "material_master", source: 70, projected: 80, actual: 75, actual_reason: null,
      reasons: [{ check_id: "MM_001", description: null, severity: "high", dimension: "completeness", source_pass_rate: 0.5, target_pass_rate: 0.9, change: 4 }] }],
  }),
}));

describe("PairedQuality", () => {
  it("links each reason to its rule and shows the move from the source", async () => {
    render(<QueryClientProvider client={new QueryClient()}><PairedQuality /></QueryClientProvider>);
    const link = await screen.findByRole("link", { name: /MM_001/ });
    expect(link).toHaveAttribute("href", "/r/MM_001");
    expect(screen.getByText(/\+5\.0 from the source/)).toBeInTheDocument();
  });
});
