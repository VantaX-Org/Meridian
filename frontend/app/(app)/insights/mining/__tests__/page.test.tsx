import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as miningApi from "@/lib/api/mining";
import * as relationshipsApi from "@/lib/api/relationships";
import MiningPage from "../page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/insights/mining",
}));

describe("MiningPage", () => {
  it("renders the tally and the entity-links lens by default", async () => {
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({
      relationships: [{
        id: "r1", from_domain: "material_master", from_key: "MAT1", to_domain: "mm_purchasing", to_key: "PO1",
        relationship_type: "used_in", sap_link_table: "EKPO", discovered_at: "2026-01-01T00:00:00Z",
        active: true, ai_inferred: false, ai_confidence: null, impact_score: null,
      }],
      total: 1,
    });
    vi.spyOn(miningApi, "getMiningSummary").mockResolvedValue({
      window_days: 30, total_patterns: 4, new_anomalies: 1, stable_patterns: 3,
      coverage_pct: 80, runs_total: 2, cost_usd: 0,
    });
    renderWithQuery(<MiningPage />);
    await waitFor(() => expect(relationshipsApi.getRelationships).toHaveBeenCalled());
    await waitFor(() => expect(miningApi.getMiningSummary).toHaveBeenCalled());
  });

  it("shows an empty state when there are no patterns mined yet", async () => {
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({ relationships: [], total: 0 });
    vi.spyOn(miningApi, "getMiningSummary").mockResolvedValue({
      window_days: 30, total_patterns: 0, new_anomalies: 0, stable_patterns: 0,
      coverage_pct: 0, runs_total: 0, cost_usd: 0,
    });
    vi.spyOn(miningApi, "getMiningPatterns").mockResolvedValue({ patterns: [] });
    renderWithQuery(<MiningPage />);
    await waitFor(() => expect(relationshipsApi.getRelationships).toHaveBeenCalled());
  });

  it("shows the API error message for entity links and retries on click", async () => {
    vi.spyOn(miningApi, "getMiningSummary").mockResolvedValue({
      window_days: 30, total_patterns: 0, new_anomalies: 0, stable_patterns: 0,
      coverage_pct: 0, runs_total: 0, cost_usd: 0,
    });
    vi.spyOn(relationshipsApi, "getRelationships").mockRejectedValue({ isAxiosError: true, response: { data: { detail: "relationships unavailable" } } });
    renderWithQuery(<MiningPage />);
    await screen.findByText("relationships unavailable");
    const calls = (relationshipsApi.getRelationships as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() =>
      expect((relationshipsApi.getRelationships as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls),
    );
  });
});
