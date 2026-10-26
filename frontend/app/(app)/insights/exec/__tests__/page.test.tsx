// frontend/app/(app)/insights/exec/__tests__/page.test.tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as insightsApi from "@/lib/api/insights";
import * as analyticsApi from "@/lib/api/analytics";
import * as downloadApi from "@/lib/api/download";
import * as findingsApi from "@/lib/api/findings";
import * as migrationApi from "@/lib/api/migration";
import ExecPage from "../page";

const h = vi.hoisted(() => ({ qs: "run=v1", path: "/insights", versions: [] as unknown[] }));
vi.mock("next/navigation", () => ({
  usePathname: () => h.path,
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(h.qs),
}));
vi.mock("@/lib/api/versions", () => ({ getVersions: async () => ({ versions: h.versions }), getVersion: async () => null }));
// The tenant's score bands, read from the objects list as Home and the Insights overview read them.
vi.mock("@/lib/api/v1/objects", () => ({ getObjects: async () => ({ run_id: "latest", objects: [], thresholds: { target: 90, warning: 75, critical: 60 } }) }));

const TODAY = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();

afterEach(() => {
  h.qs = "run=v1";
  h.path = "/insights";
  h.versions = [];
  vi.restoreAllMocks();
});
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

// useDayOne() needs LocalAuthProvider context, which this test does not set up;
// mock it wholesale so the page renders without an auth provider.
vi.mock("@/hooks/use-day-one", () => ({
  useDayOne: () => ({ status: "ready", step: null, error: null, refetch: () => {} }),
  DayOneAction: () => null,
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("ExecPage", () => {
  it("renders the narrative and exports the PDF", async () => {
    vi.spyOn(insightsApi, "getExec").mockResolvedValue({
      version_id: "v1",
      narrative: "Readiness improved three points since last run.",
      readiness_cells: [{ module: "material_master", wave: "wave_1", verdict: "go", blocker_count: 0, dqs: 91, score: 100, records_blocked: 0 }],
      waterfall: [{ x: "baseline", y: 70 }, { x: "current", y: 20 }],
      impact_rows: [{ feature: "Invoice posting", status: "blocked", record_count: 12, value_per_record: 100, value_at_risk: 1200, causing_rules: [] }],
      owner_rows: [{ owner: "me", score: 91, delta: 3, open_by_severity: {}, fixed_since_baseline: 2, oldest_item_age_days: 1, digest: "ok", schedule: "weekly", last_sent: null }],
    });
    vi.spyOn(insightsApi, "getRuleRanking").mockResolvedValue({ version_id: "v1", rows: [] } as never);
    const download = vi.spyOn(downloadApi, "downloadAuthenticated").mockResolvedValue();
    h.versions = [{ id: "v1", label: "ECC PRD", status: "complete", run_at: "2026-10-20T08:00:00Z", metadata: {}, dqs_summary: {} }];

    renderWithQuery(<ExecPage />);

    expect(await screen.findByText(/readiness improved three points/i)).toBeInTheDocument();
    // Files are named by the report, the run and the day, never the run id.
    fireEvent.click(await screen.findByRole("button", { name: /export/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /board pack/i }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.stringContaining("/board/v1"), `Meridian board pack – ECC PRD – ${TODAY}.pdf`));
    fireEvent.click(await screen.findByRole("button", { name: /export/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /run data/i }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.stringContaining("/v1/export.json"), `Meridian run data – ECC PRD – ${TODAY}.json`));
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getAllByRole("grid").length).toBeGreaterThan(0);
  });

  it("shows an error state when the exec request fails", async () => {
    vi.spyOn(insightsApi, "getExec").mockRejectedValue(new Error("network error"));
    renderWithQuery(<ExecPage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
  });

  it("retries the exec request when the retry button is clicked", async () => {
    const getExec = vi
      .spyOn(insightsApi, "getExec")
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({
        version_id: "v1",
        narrative: "Recovered after retry.",
        readiness_cells: [{ module: "material_master", wave: "wave_1", verdict: "go", blocker_count: 0, dqs: 91, score: 100, records_blocked: 0 }],
        waterfall: [],
        impact_rows: [],
        owner_rows: [],
      });
    renderWithQuery(<ExecPage />);

    const retry = await screen.findByRole("button", { name: /retry/i });
    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByText(/recovered after retry/i)).toBeInTheDocument());
    expect(getExec).toHaveBeenCalledTimes(2);
  });

  it("renders the score, Fix first and ROI for a scored run with no waves, owners or priced features", async () => {
    vi.spyOn(insightsApi, "getExec").mockResolvedValue({ version_id: "v1", narrative: "", readiness_cells: [], waterfall: [], impact_rows: [], owner_rows: [] });
    vi.spyOn(insightsApi, "getOverview").mockResolvedValue({
      version_id: "v1", run_label: "Run 1", run_at: null, previous_version_id: null,
      dqs: { composite: 70, previous: null, delta: null, tier: "at_risk", capped: false, cap_reason: null },
      blockers: { count: 0, previous: null, waves: 0 }, auto_fixable: { records: 0, failing_records: 0, pct: null, high_confidence: 0 },
      value_at_risk: { worst_l1: null, worst_l1_amount: 0, currency: "ZAR", features_blocked: 0 }, narrative: [],
    });
    vi.spyOn(insightsApi, "getRuleRanking").mockResolvedValue({ version_id: "v1", rows: [] } as never);
    vi.spyOn(analyticsApi, "getRoi").mockResolvedValue({ roi: { subscription_annual: null, risk_mitigated: 0, roi_multiple: null, payback_months: null, currency: "ZAR" }, cost_avoidance_history: [] });
    renderWithQuery(<ExecPage />);
    // Not the page-level empty state: the hero carries the score and the first-run sentence.
    expect(await screen.findByText("First scored run")).toBeInTheDocument();
    expect(screen.queryByText("No executive summary yet")).toBeNull();
    expect(screen.getByText("No migration wave is set up yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open migration cockpit" })).toHaveAttribute("href", "/migration");
    expect(screen.getAllByText("Nobody owns an issue yet").length).toBeGreaterThan(0);
    // The hero's figures open the same run they count, and with nothing blocked the next step is the board pack.
    expect(screen.getByText("Objects blocked in a wave").closest("a")?.getAttribute("href")).toBe("/insights/readiness?run=v1");
    const dl = vi.spyOn(downloadApi, "downloadAuthenticated").mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Download board pack" }));
    expect(dl).toHaveBeenCalledWith(expect.stringContaining("v1"), `Meridian board pack – ${TODAY}.pdf`);
    // No subscription is configured, so no fee is printed.
    expect(screen.queryByText("Annual subscription")).toBeNull();
    // ROI without any cost avoided says so instead of "0x" and "0 months".
    expect(await screen.findByText("No cost avoided yet")).toBeInTheDocument();
    expect(screen.queryByText("0x")).toBeNull();
    expect(screen.queryByText(/0 months/)).toBeNull();
  });

  it("leads Do next with the cap when the exec payload carries one, and reads the cap from the API", async () => {
    vi.spyOn(insightsApi, "getExec").mockResolvedValue({ version_id: "v1", narrative: "", readiness_cells: [], waterfall: [], impact_rows: [], owner_rows: [], cap: 70, cap_reason: "MM001: material type missing — score capped at 70" } as never);
    vi.spyOn(insightsApi, "getOverview").mockResolvedValue({
      version_id: "v1", run_label: "Run 1", run_at: null, previous_version_id: null,
      dqs: { composite: 70, previous: null, delta: null, tier: "no_go", capped: true, cap_reason: null },
      blockers: { count: 0, previous: null, waves: 0 }, auto_fixable: { records: 0, failing_records: 0, pct: null, high_confidence: 0 },
      value_at_risk: { worst_l1: null, worst_l1_amount: 0, currency: "ZAR", features_blocked: 0 }, narrative: [],
    });
    vi.spyOn(insightsApi, "getRuleRanking").mockResolvedValue({ version_id: "v1", rows: [] } as never);
    renderWithQuery(<ExecPage />);
    expect(await screen.findByText("Lift the cap: fix MM001")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open failing rules" })).toHaveAttribute("href", "/insights/rules?run=v1&severity=critical");
    expect(screen.getByText("Capped at 70")).toBeInTheDocument();
  });

  it("shows an inline error with retry when the ROI request fails", async () => {
    vi.spyOn(insightsApi, "getExec").mockResolvedValue({ version_id: "v1", narrative: "n", readiness_cells: [{ module: "material_master", wave: "wave_1", verdict: "go", blocker_count: 0, dqs: 91, score: 100, records_blocked: 0 }], waterfall: [], impact_rows: [], owner_rows: [] });
    vi.spyOn(analyticsApi, "getRoi").mockRejectedValue(new Error("roi down"));
    renderWithQuery(<ExecPage />);
    expect(await screen.findByText(/return on investment did not load/i)).toBeInTheDocument();
  });

  it("shows the current state, not an empty page, and exports the latest run", async () => {
    h.qs = "";
    h.path = "/insights/exec";
    // The current state scores as Home does: each object at its latest run, the mean of their composites (64.0 here,
    // where the exec API's own aggregation says 64.4) and the cap they share.
    const capped = { composite_score: 64, dimension_scores: {}, critical_count: 1, high_count: 0, medium_count: 0, low_count: 0, total_checks: 10, passing_checks: 9, capped: true, cap_reason: "MM001: material type missing — score capped at 64" };
    h.versions = [
      { id: "v2", label: "ECC PRD", status: "complete", run_at: "2026-10-24T08:00:00Z", metadata: {}, dqs_summary: { material_master: capped } },
      { id: "v1", label: "Uploads", status: "complete", run_at: "2026-10-01T08:00:00Z", metadata: {}, dqs_summary: {} },
    ];
    const getExec = vi.spyOn(insightsApi, "getExec").mockResolvedValue({
      version_id: null, latest_version_id: "v2", scope: "current", composite: 64.4, cap: 64, cap_reason: "MM001: material type missing",
      narrative: "Current state narrative.", readiness_cells: [], waterfall: [], impact_rows: [], owner_rows: [],
    });
    const overview = vi.spyOn(insightsApi, "getCurrentOverview").mockResolvedValue({
      dqs: { composite: 64, previous: null, delta: null, tier: "no_go", capped: true, cap_reason: "MM001: material type missing" },
    } as never);
    vi.spyOn(insightsApi, "getRuleRanking").mockResolvedValue({ version_id: "v2", rows: [] } as never);
    const download = vi.spyOn(downloadApi, "downloadAuthenticated").mockResolvedValue();
    renderWithQuery(<ExecPage />);

    expect(await screen.findByText("Current state narrative.")).toBeInTheDocument();
    expect(screen.queryByText("No executive summary yet")).toBeNull();
    expect(getExec).toHaveBeenCalledWith({ scope: "current" });
    expect(overview).toHaveBeenCalled();
    // The hero reads the same current-state score, cap and verdict as Home and Insights, never the exec API's composite.
    expect(await screen.findByText("Capped at 64")).toBeInTheDocument();
    expect(screen.getByLabelText("64.0")).toBeInTheDocument();
    expect(screen.queryByLabelText("64.4")).toBeNull();
    // A raw "fail" tier reads in the one vocabulary.
    expect(within(screen.getByTestId("hero-verdict")).getByText("No-go")).toBeInTheDocument();
    expect(screen.queryByText("Fail")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /export/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /board pack, latest run/i }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.stringContaining("/board/v2"), `Meridian board pack – ECC PRD – ${TODAY}.pdf`));
  });

  it("ranks Fix first from each object's current findings and shows the current state's delta", async () => {
    h.qs = "";
    h.path = "/insights/exec";
    const sum = (score: number) => ({ composite_score: score, dimension_scores: {}, critical_count: 1, high_count: 0, medium_count: 0, low_count: 0, total_checks: 10, passing_checks: 9, capped: false, cap_reason: null });
    h.versions = [
      { id: "co2", label: "controlling_1k", status: "complete", run_at: "2026-10-16T05:00:00Z", metadata: { modules: ["controlling"] }, dqs_summary: { controlling: sum(60) } },
      { id: "co1", label: "controlling_1k", status: "complete", run_at: "2026-10-15T05:00:00Z", metadata: { modules: ["controlling"] }, dqs_summary: { controlling: sum(50) } },
      { id: "mm1", label: "material_master_25k", status: "complete", run_at: "2026-10-16T03:00:00Z", metadata: { modules: ["material_master"] }, dqs_summary: { material_master: sum(80) } },
    ];
    vi.spyOn(insightsApi, "getExec").mockResolvedValue({
      version_id: null, latest_version_id: "co2", scope: "current", composite: 70, cap: null, cap_reason: null,
      narrative: "", readiness_cells: [], waterfall: [], impact_rows: [], owner_rows: [],
    });
    vi.spyOn(insightsApi, "getCurrentOverview").mockResolvedValue({ dqs: { composite: 70, previous: null, delta: null, tier: "at_risk", capped: false, cap_reason: null } } as never);
    const ranking = vi.spyOn(insightsApi, "getRuleRanking").mockResolvedValue({ version_id: "co2", rows: [] } as never);
    vi.spyOn(findingsApi, "getFindingsAggregate").mockRejectedValue(new Error("not under test"));
    vi.spyOn(findingsApi, "getFindings").mockResolvedValue({
      findings: [
        { id: "f1", version_id: "co2", module: "controlling", check_id: "CO001", severity: "critical", dimension: "completeness", affected_count: 40, total_count: 100, pass_rate: 60, details: {} },
        { id: "f0", version_id: "co1", module: "controlling", check_id: "CO099", severity: "critical", dimension: "completeness", affected_count: 99, total_count: 100, pass_rate: 1, details: {} },
        { id: "f2", version_id: "mm1", module: "material_master", check_id: "MM045", severity: "high", dimension: "validity", affected_count: 12, total_count: 100, pass_rate: 88, details: {} },
      ],
      total: 3,
    } as never);
    renderWithQuery(<ExecPage />);
    // every object at its latest run, not the newest run's rules alone; CO099 is from an older controlling run
    expect(await screen.findByText("CO001")).toBeInTheDocument();
    expect(screen.getByText("MM045")).toBeInTheDocument();
    expect(screen.queryByText("CO099")).toBeNull();
    expect(ranking).not.toHaveBeenCalled();
    // (60 + 80) / 2 against (50 + 80) / 2: up 5 with the latest run, as Home and the overview say
    expect(within(screen.getByTestId("hero-verdict")).getByText("Up 5 with the latest run")).toBeInTheDocument();
  });

  it("is empty only when the tenant has no run at all", async () => {
    h.qs = "";
    h.path = "/insights/exec";
    h.versions = [{ id: "v1", label: "ECC PRD", status: "complete", run_at: "2026-10-24T08:00:00Z", metadata: {}, dqs_summary: {} }];
    vi.spyOn(insightsApi, "getExec").mockResolvedValue({
      version_id: null, latest_version_id: null, scope: "current", composite: null, cap: null, cap_reason: null,
      narrative: "", readiness_cells: [], waterfall: [], impact_rows: [], owner_rows: [],
    });
    renderWithQuery(<ExecPage />);
    expect(await screen.findByText("No executive summary yet")).toBeInTheDocument();
  });

  it("prints ROI amounts in the currency the API states", async () => {
    vi.spyOn(insightsApi, "getExec").mockResolvedValue({ version_id: "v1", narrative: "", readiness_cells: [], waterfall: [], impact_rows: [], owner_rows: [] });
    vi.spyOn(insightsApi, "getRuleRanking").mockResolvedValue({ version_id: "v1", rows: [] } as never);
    vi.spyOn(insightsApi, "getProvenCost").mockResolvedValue({ currency: "EUR" } as never);
    vi.spyOn(analyticsApi, "getRoi").mockResolvedValue({ roi: { subscription_annual: 180000, risk_mitigated: 540000, roi_multiple: 3, payback_months: 4, currency: "ZAR" }, cost_avoidance_history: [] });
    renderWithQuery(<ExecPage />);
    expect(await screen.findByText(/ZAR\s540,000/)).toBeInTheDocument();
    expect(screen.getByText(/ZAR\s180,000/)).toBeInTheDocument();
    expect(screen.queryByText(/EUR\s540,000/)).toBeNull();
  });

  it("states only the cost avoided when no subscription is configured", async () => {
    vi.spyOn(insightsApi, "getExec").mockResolvedValue({ version_id: "v1", narrative: "", readiness_cells: [], waterfall: [], impact_rows: [], owner_rows: [] });
    vi.spyOn(insightsApi, "getRuleRanking").mockResolvedValue({ version_id: "v1", rows: [] } as never);
    vi.spyOn(insightsApi, "getProvenCost").mockResolvedValue({ currency: "ZAR" } as never);
    vi.spyOn(analyticsApi, "getRoi").mockResolvedValue({ roi: { subscription_annual: null, risk_mitigated: 540000, roi_multiple: null, payback_months: null, currency: "ZAR" }, cost_avoidance_history: [] });
    renderWithQuery(<ExecPage />);
    expect(await screen.findByText(/ZAR\s540,000/)).toBeInTheDocument();
    expect(screen.getByText("Cost avoided")).toBeInTheDocument();
    expect(screen.queryByText("ROI multiple")).toBeNull();
    expect(screen.queryByText("Payback")).toBeNull();
    expect(screen.queryByText("Annual subscription")).toBeNull();
  });

  it("names waterfall steps by feature and captions the total and the top feature", async () => {
    vi.spyOn(insightsApi, "getExec").mockResolvedValue({
      version_id: "v1", narrative: "", readiness_cells: [], impact_rows: [], owner_rows: [],
      waterfall: [
        { x: "invoice_posting", y: 5672930, l1: "procure_to_pay" },
        { x: "MIGO", y: 1200, l1: "procure_to_pay" },
      ],
    });
    vi.spyOn(insightsApi, "getRuleRanking").mockResolvedValue({ version_id: "v1", rows: [] } as never);
    vi.spyOn(insightsApi, "getProvenCost").mockResolvedValue({ currency: "ZAR" } as never);
    renderWithQuery(<ExecPage />);
    const caption = await screen.findByText(/at risk across 2 priced features/);
    expect(caption.textContent).toMatch(/ZAR\s5,674,130 at risk across 2 priced features; Invoice posting carries the most, ZAR\s5,672,930$/);
    const chart = screen.getByRole("img", { name: /Value at risk by feature/ });
    expect(chart.getAttribute("aria-label")).toMatch(/Invoice posting ZAR\s5,672,930, MIGO ZAR\s1,200/);
  });

  it("compares the board pack with the run before, draws one score, and counts migration gaps into the wave", async () => {
    vi.spyOn(insightsApi, "getExec").mockResolvedValue({
      version_id: "v1",
      narrative: "One wave is blocked.",
      composite: 72,
      readiness_cells: [{ module: "material_master", wave: "Wave 1", verdict: "no_go", blocker_count: 2, dqs: 70, score: 40, records_blocked: 5 }],
      waterfall: [],
      impact_rows: [],
      owner_rows: [],
    } as never);
    vi.spyOn(insightsApi, "getRuleRanking").mockResolvedValue({ version_id: "v1", rows: [] } as never);
    vi.spyOn(migrationApi, "getWaves").mockResolvedValue([{ id: "w1", name: "Wave 1" }] as never);
    const aggregate = vi.spyOn(findingsApi, "getFindingsAggregate");
    const download = vi.spyOn(downloadApi, "downloadAuthenticated").mockResolvedValue();
    h.versions = [
      { id: "v1", label: "ECC PRD", status: "complete", run_at: "2026-10-20T08:00:00Z", metadata: { modules: ["material_master"] }, dqs_summary: {} },
      { id: "v0", label: "ECC PRD", status: "complete", run_at: "2026-10-10T08:00:00Z", metadata: { modules: ["material_master"] }, dqs_summary: {} },
    ];
    renderWithQuery(<ExecPage />);
    expect(await screen.findByText("One wave is blocked.")).toBeInTheDocument();
    // One score: the hero with a way to how it is scored, no second ring from the findings aggregate.
    expect(screen.getByTestId("how-scored")).toHaveAttribute("href", "/rules/scoring");
    expect(aggregate).not.toHaveBeenCalled();
    // blocker_count is migration gaps, opened on the wave's gap view.
    expect(screen.getByRole("columnheader", { name: /Migration gaps/ })).toBeInTheDocument();
    expect(screen.queryByText("Blocking rules")).toBeNull();
    expect(await screen.findByRole("link", { name: "Open the 2 migration gaps of Material master in Wave 1" })).toHaveAttribute("href", "/migration/w1?tab=blockers");
    // The board pack's deltas are against the run before in the lineage.
    fireEvent.click(await screen.findByRole("button", { name: /export/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /board pack/i }));
    await waitFor(() => expect(download).toHaveBeenCalledWith("/api/v1/reports/board/v1.pdf?compare=v0", expect.any(String)));
  });
});
