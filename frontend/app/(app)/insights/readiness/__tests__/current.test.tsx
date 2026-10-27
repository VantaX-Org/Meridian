import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as insightsApi from "@/lib/api/insights";
import * as migrationApi from "@/lib/api/migration";
import type { Version } from "@/types/api";
import ReadinessPage from "../page";

// Waves without ?run=: the current state, Home's scope (each object at its own latest run).
const scope = vi.hoisted(() => ({ mode: "current" as "current" | "run", run: "v2" as string | undefined, runs: [] as Version[] }));
vi.mock("../../_components/useInsightScope", async (orig) => ({
  ...(await orig<typeof import("../../_components/useInsightScope")>()),
  useInsightScope: () => ({ run: scope.run, mode: scope.mode, runs: scope.runs, versions: { isLoading: false }, scope: { run: null, versions: [] }, error: null, refetch: () => {} }),
}));
const summary = (score: number) => ({ composite_score: score, dimension_scores: {}, critical_count: 0, high_count: 0, medium_count: 0, low_count: 0, total_checks: 1 });
const v1 = { id: "v1", label: "controlling_1k", status: "complete", run_at: "2026-10-16T05:17:00Z", dqs_summary: { controlling: summary(70) } } as unknown as Version;
const v2 = { id: "v2", label: "material", status: "complete", run_at: "2026-10-16T05:18:00Z", metadata: { system_id: "s2" }, dqs_summary: { material_master: summary(80), accounts_payable: summary(95) } } as unknown as Version;
vi.mock("../../_components/useCurrentState", () => ({
  useCurrentState: () => ({ objects: [
    { module: "accounts_payable", summary: v2.dqs_summary!.accounts_payable, run: v2 },
    { module: "controlling", summary: v1.dqs_summary!.controlling, run: v1 },
    { module: "material_master", summary: v2.dqs_summary!.material_master, run: v2 },
  ], modules: null, runs: [v2, v1], finished: [v2, v1], newest: v2, loading: false, error: null, refetch: () => {} }),
}));
vi.mock("@/hooks/use-score-bands", () => ({ useScoreBands: () => ({ bands: { target: 90, warning: 75, critical: 50 }, loaded: true }) }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/insights/readiness",
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/hooks/use-day-one", () => ({
  useDayOne: () => ({ status: "ready", step: null, error: null, refetch: () => {} }),
  DayOneAction: () => null,
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ReadinessPage /></QueryClientProvider>);
}

const S4 = {
  version_id: null, scope: "current" as const, version_ids: ["v2", "v1"], status: "ok", ready: false, rules: 30, evaluated: 30, failing: 12, failing_records: 90,
  blocking_failing: 9, warning_failing: 2,
  areas: [
    { area: "bp", label: "Business partner / CVI", simplification_item: null, rules: 20, evaluated: 20, failing: 8, failing_records: 60, blocking_failing: 7, warning_failing: 1, status: "x", checks: [] },
    { area: "qm", label: "Quality management", simplification_item: null, rules: 10, evaluated: 10, failing: 4, failing_records: 30, blocking_failing: 2, warning_failing: 1, status: "x", checks: [] },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
  scope.mode = "current";
  scope.run = "v2";
  scope.runs = [];
});

describe("Waves on the current state", () => {
  it("reads readiness and S/4 blockers with scope=current, so its counts match Home's", async () => {
    const readiness = vi.spyOn(insightsApi, "getReadiness").mockResolvedValue({ version_id: null, threshold: 75, cells: [], configured: true, scope: "current", version_ids: ["v2", "v1"] });
    const current = vi.spyOn(migrationApi, "getCurrentS4Readiness").mockResolvedValue(S4);
    const oneRun = vi.spyOn(migrationApi, "getS4Readiness");
    renderPage();
    // Home's S/4 card: 9 blocking (7 + 2), 3 warning (failing minus blocking).
    expect(await screen.findByText("9 rules would block an S/4 load, and no wave is set up yet")).toBeInTheDocument();
    expect(readiness).toHaveBeenCalledWith({ scope: "current" });
    expect(current).toHaveBeenCalled();
    expect(oneRun).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("s4-strip")).toHaveTextContent("Blockers9Warnings3"));
    // Each object gets Home's go-live verdict even before a wave exists.
    expect(screen.getByText("1 of 3 objects is not ready for go-live, 1 at risk; no wave groups them for loading yet")).toBeInTheDocument();
    expect(screen.queryByText(/no object gets a go or no-go/)).toBeNull();
    // No single previous run is compared, and nothing claims one could not be read.
    expect(screen.getByText(/Every object at its own latest run/)).toBeInTheDocument();
    expect(screen.queryByText("The previous run could not be read")).toBeNull();
  });

  it("names the current state when nothing blocks", async () => {
    vi.spyOn(insightsApi, "getReadiness").mockResolvedValue({ version_id: null, threshold: 75, cells: [], configured: true, scope: "current", version_ids: ["v2"] });
    vi.spyOn(migrationApi, "getCurrentS4Readiness").mockResolvedValue({ ...S4, areas: [] });
    renderPage();
    expect(await screen.findByText("No blockers in any object's latest run")).toBeInTheDocument();
    expect(screen.queryByText("No blockers in this run")).toBeNull();
  });

  it("with one run pinned, says the previous run could not be read only when it failed to load", async () => {
    scope.mode = "run";
    scope.run = "v2";
    const prev = { ...v2, id: "v0", run_at: "2026-10-15T05:18:00Z" } as Version;
    scope.runs = [v2, prev];
    vi.spyOn(migrationApi, "getS4Readiness").mockResolvedValue({ ...S4, version_id: "v2", scope: null, version_ids: null });
    vi.spyOn(insightsApi, "getReadiness").mockImplementation(async (p) => {
      if (p?.version_id === "v0") throw new Error("boom");
      return { version_id: "v2", threshold: 75, cells: [], configured: true };
    });
    renderPage();
    expect(await screen.findByText("The previous run could not be read")).toBeInTheDocument();
  });

  it("with one run pinned and no wave in either run, compares nothing and claims no failure", async () => {
    scope.mode = "run";
    const prev = { ...v2, id: "v0", run_at: "2026-10-15T05:18:00Z" } as Version;
    scope.runs = [v2, prev];
    vi.spyOn(migrationApi, "getS4Readiness").mockResolvedValue({ ...S4, version_id: "v2", scope: null, version_ids: null });
    vi.spyOn(insightsApi, "getReadiness").mockResolvedValue({ version_id: "v2", threshold: 75, cells: [], configured: true });
    renderPage();
    expect(await screen.findByText("No wave is set up, so there is nothing to compare")).toBeInTheDocument();
    expect(screen.queryByText("The previous run could not be read")).toBeNull();
    // The shown run's objects: material master 80 (at risk), accounts payable 95 (ready).
    expect(screen.getByText("1 of 2 objects is at risk for go-live; no wave groups them for loading yet")).toBeInTheDocument();
  });
});
