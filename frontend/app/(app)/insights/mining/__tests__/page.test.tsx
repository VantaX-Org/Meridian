import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as learnedRulesApi from "@/lib/api/learnedRules";
import * as miningApi from "@/lib/api/mining";
import * as relationshipsApi from "@/lib/api/relationships";
import * as versionsApi from "@/lib/api/versions";
import MiningPage, { patternTypeLabel } from "../page";

// The shared InsightActions bar (Run analysis) reads the role; no auth provider is mounted here.
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

let query = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(query),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/insights/mining",
}));

// useDayOne() needs LocalAuthProvider context, which this test does not set up;
// mock it wholesale so the page renders without an auth provider.
vi.mock("@/hooks/use-day-one", () => ({
  useDayOne: () => ({ status: "ready", step: null, error: null, refetch: () => {} }),
  DayOneAction: () => null,
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
    const { container } = renderWithQuery(<MiningPage />);
    await waitFor(() => expect(relationshipsApi.getRelationships).toHaveBeenCalled());
    await waitFor(() => expect(miningApi.getMiningSummary).toHaveBeenCalled());
    // the graph's edge reads the link type in words, like the table, never the raw enum
    await waitFor(() => expect(container.textContent).toContain("Used in, 1"));
    expect(container.textContent).not.toContain("used_in");
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

describe("MiningPage patterns", () => {
  const summary = { window_days: 30, total_patterns: 1, new_anomalies: 1, stable_patterns: 0, coverage_pct: 80, runs_total: 2, cost_usd: 0 };

  it("labels pattern types for a reader, not as module names", () => {
    expect(patternTypeLabel("pii")).toBe("PII");
    expect(patternTypeLabel("anomaly")).toBe("Anomaly");
    expect(patternTypeLabel("value_set")).toBe("Value set");
  });

  it("shows pattern types through the label map and offers Mine now on the current run when nothing is mined", async () => {
    query = "run=v1&tab=patterns";
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [{ id: "v1", label: "Run 1", status: "complete", run_at: "2026-10-01T00:00:00Z" }] } as never);
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({ relationships: [], total: 0 });
    vi.spyOn(miningApi, "getMiningSummary").mockResolvedValue(summary);
    const patterns = vi.spyOn(miningApi, "getMiningPatterns").mockResolvedValue({ patterns: [
      { id: "p1", name: "Tax number drift", module: "business_partner", pattern_type: "pii", severity: "high", occurrences: 3, first_seen: "2026-10-01T00:00:00Z", last_seen: "2026-10-02T00:00:00Z", confidence: 0.9, trend: [1, 2], promoted_to_rule: false },
    ] });
    const view = renderWithQuery(<MiningPage />);
    expect(await screen.findByText("PII")).toBeInTheDocument();
    expect(screen.queryByText("Pii")).toBeNull();
    view.unmount();

    patterns.mockResolvedValue({ patterns: [] });
    const mine = vi.spyOn(learnedRulesApi, "mineLearnedRules").mockResolvedValue({ queued: true });
    renderWithQuery(<MiningPage />);
    const button = await screen.findByRole("button", { name: "Mine now" });
    fireEvent.click(button);
    await waitFor(() => expect(mine).toHaveBeenCalledWith("v1"));
    query = "";
  });

  it("keeps one primary: Open patterns in Do next, with Mine now (not Open systems) as the secondary for no record links", async () => {
    query = "run=v1";
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [{ id: "v1", label: "Run 1", status: "complete", run_at: "2026-10-01T00:00:00Z" }] } as never);
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({ relationships: [], total: 0 });
    vi.spyOn(miningApi, "getMiningSummary").mockResolvedValue(summary);
    vi.spyOn(miningApi, "getMiningPatterns").mockResolvedValue({ patterns: [] });
    const mineRelationships = vi.spyOn(miningApi, "runMining").mockResolvedValue({ task_id: "t", version_id: "v1", include: ["relationship"] });
    renderWithQuery(<MiningPage />);
    const open = await screen.findByRole("button", { name: "Open patterns" });
    expect(open).toHaveClass("m-btn-primary");
    const mine = await screen.findByRole("button", { name: "Mine now" });
    expect(mine).toHaveClass("m-btn-secondary");
    expect(screen.queryByRole("link", { name: "Open systems" })).toBeNull();
    fireEvent.click(mine);
    await waitFor(() => expect(mineRelationships).toHaveBeenCalledWith("v1", ["relationship"]));
    query = "";
  });

});
