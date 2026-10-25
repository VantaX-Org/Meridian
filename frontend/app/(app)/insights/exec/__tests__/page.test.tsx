// frontend/app/(app)/insights/exec/__tests__/page.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as insightsApi from "@/lib/api/insights";
import * as analyticsApi from "@/lib/api/analytics";
import * as downloadApi from "@/lib/api/download";
import ExecPage from "../page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/insights",
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams("run=v1"),
}));
vi.mock("@/lib/api/versions", () => ({ getVersions: async () => ({ versions: [] }) }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

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

    renderWithQuery(<ExecPage />);

    expect(await screen.findByText(/readiness improved three points/i)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /export/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /board pack/i }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.stringContaining("/board/v1"), "board_v1.pdf"));
    fireEvent.click(await screen.findByRole("button", { name: /export/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /run data/i }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.stringContaining("/v1/export.json"), "run_v1.json"));
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
    vi.spyOn(analyticsApi, "getRoi").mockResolvedValue({ roi: { subscription_annual: 120000, risk_mitigated: 0, roi_multiple: 0, payback_months: 0 }, cost_avoidance_history: [] });
    renderWithQuery(<ExecPage />);
    // Not the page-level empty state: the hero carries the score and the first-run sentence.
    expect(await screen.findByText("First scored run")).toBeInTheDocument();
    expect(screen.queryByText("No executive summary yet")).toBeNull();
    expect(screen.getByText("No migration wave is set up yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open migration cockpit" })).toHaveAttribute("href", "/migration");
    expect(screen.getAllByText("Nobody owns an issue yet").length).toBeGreaterThan(0);
    // The hero's figures open the same run they count, and with nothing blocked the next step is the board pack.
    expect(screen.getByText("Not ready to load").closest("a")?.getAttribute("href")).toBe("/insights/readiness?run=v1");
    const dl = vi.spyOn(downloadApi, "downloadAuthenticated").mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Download board pack" }));
    expect(dl).toHaveBeenCalledWith(expect.stringContaining("v1"), "board_v1.pdf");
    // ROI without any cost avoided says so instead of "0x" and "0 months".
    expect(await screen.findByText("No cost avoided yet")).toBeInTheDocument();
    expect(screen.queryByText("0x")).toBeNull();
    expect(screen.queryByText(/0 months/)).toBeNull();
  });

  it("shows an inline error with retry when the ROI request fails", async () => {
    vi.spyOn(insightsApi, "getExec").mockResolvedValue({ version_id: "v1", narrative: "n", readiness_cells: [{ module: "material_master", wave: "wave_1", verdict: "go", blocker_count: 0, dqs: 91, score: 100, records_blocked: 0 }], waterfall: [], impact_rows: [], owner_rows: [] });
    vi.spyOn(analyticsApi, "getRoi").mockRejectedValue(new Error("roi down"));
    renderWithQuery(<ExecPage />);
    expect(await screen.findByText(/return on investment did not load/i)).toBeInTheDocument();
  });
});
