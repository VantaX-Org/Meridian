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

  it("keeps one primary: Open anomalies in Do next, with Search now (not Open systems) as the secondary for no record links", async () => {
    query = "run=v1";
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [{ id: "v1", label: "Run 1", status: "complete", run_at: "2026-10-01T00:00:00Z" }] } as never);
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({ relationships: [], total: 0 });
    vi.spyOn(miningApi, "getMiningSummary").mockResolvedValue(summary);
    vi.spyOn(miningApi, "getMiningPatterns").mockResolvedValue({ patterns: [] });
    const mineRelationships = vi.spyOn(miningApi, "runMining").mockResolvedValue({ task_id: "t", version_id: "v1", include: ["relationship"] });
    renderWithQuery(<MiningPage />);
    const open = await screen.findByRole("button", { name: "Open anomalies" });
    expect(open).toHaveClass("m-btn-primary");
    const mine = await screen.findByRole("button", { name: "Search now" });
    expect(mine).toHaveClass("m-btn-secondary");
    expect(screen.queryByRole("link", { name: "Open systems" })).toBeNull();
    fireEvent.click(mine);
    await waitFor(() => expect(mineRelationships).toHaveBeenCalledWith("v1", ["relationship"]));
    query = "";
  });

});

describe("MiningPage anomalies", () => {
  const summary = { window_days: 30, total_patterns: 1, new_anomalies: 1, stable_patterns: 0, coverage_pct: 80, runs_total: 2, cost_usd: 0 };
  const setup = () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [{ id: "v1", label: "Run 1", status: "complete", run_at: "2026-10-01T00:00:00Z" }] } as never);
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({ relationships: [], total: 0 });
    vi.spyOn(miningApi, "getMiningSummary").mockResolvedValue(summary);
    vi.spyOn(miningApi, "getMiningPatterns").mockResolvedValue({ patterns: [] });
  };

  it("is a tab of Patterns and lists the mined anomalies, moved from Duplicates", async () => {
    query = "run=v1&tab=anomalies";
    setup();
    const get = vi.spyOn(miningApi, "getMiningAnomalies").mockResolvedValue([
      { id: "a1", version_id: "v1", module_id: "material_master", field_name: "NTGEW", field_value: 9999, record_index: 4, detection_method: "z_score", z_score: 6.2, severity: "high", detected_at: "2026-10-01T00:00:00Z" },
    ]);
    renderWithQuery(<MiningPage />);
    expect(screen.getByRole("tab", { name: "Anomalies" })).toBeInTheDocument();
    expect(await screen.findByText("NTGEW")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith({ version_id: "v1", limit: 500 });
    expect(screen.getByText("z 6.2")).toBeInTheDocument();
    // mined before the key was kept: named by its row, opening the object's fields
    expect(screen.getByText("Record 5")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Material master fields" })).toHaveAttribute("href", "/objects/material_master?run=v1&tab=fields");
    query = "";
  });

  it("names each anomaly's record in Mono with its value and usual range, and opens the record", async () => {
    query = "run=v1&tab=anomalies";
    setup();
    const row = (id: string, key: string, value: number) => ({
      id, version_id: "v1", module_id: "hcm", field_name: "PA0007.EMPCT", field_value: value, record_index: 3, record_key: key,
      detection_method: "iqr", z_score: null, lower_bound: 40, upper_bound: 100, severity: "high" as const, detected_at: "2026-10-01T00:00:00Z",
    });
    vi.spyOn(miningApi, "getMiningAnomalies").mockResolvedValue([row("a1", "PERNR=00001001|SUBTY=0001", 400), row("a2", "PERNR=00001002|SUBTY=0001", 380)]);
    renderWithQuery(<MiningPage />);
    const key = await screen.findByText("PERNR=00001001|SUBTY=0001");
    expect(key.closest("a")).toHaveAttribute("href", "/objects/hcm/records/PERNR%3D00001001%7CSUBTY%3D0001?run=v1");
    expect(screen.getByText("PERNR=00001002|SUBTY=0001")).toBeInTheDocument();
    expect(screen.getByText("400")).toBeInTheDocument();
    expect(screen.getAllByText("usual 40 to 100")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Open record PERNR=00001002|SUBTY=0001" })).toHaveAttribute("href", "/objects/hcm/records/PERNR%3D00001002%7CSUBTY%3D0001?run=v1");
    query = "";
  });

  it("starts the anomaly miner, not the learned-rules miner, from its empty state", async () => {
    query = "run=v1&tab=anomalies";
    setup();
    vi.spyOn(miningApi, "getMiningAnomalies").mockResolvedValue([]);
    const houseRules = vi.spyOn(learnedRulesApi, "mineLearnedRules").mockResolvedValue({ queued: true });
    const mine = vi.spyOn(miningApi, "runMining").mockResolvedValue({ task_id: "t1", version_id: "v1", include: ["anomaly"] });
    renderWithQuery(<MiningPage />);
    expect(await screen.findByText("No anomalies found yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Search now" }));
    await waitFor(() => expect(mine).toHaveBeenCalledWith("v1", ["anomaly"]));
    expect(houseRules).not.toHaveBeenCalled();
    query = "";
  });
});
