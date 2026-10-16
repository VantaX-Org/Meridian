// frontend/app/(app)/insights/__tests__/page.test.tsx
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as insightsApi from "@/lib/api/insights";
import * as migrationApi from "@/lib/api/migration";
import * as versionsApi from "@/lib/api/versions";
import InsightsOverviewPage from "../page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/insights",
  useSearchParams: () => new URLSearchParams("run=v1"),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("@/hooks/use-day-one", () => ({
  useDayOne: () => ({ status: "ready", step: null }),
  DayOneAction: () => null,
}));

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><InsightsOverviewPage /></QueryClientProvider>);
}

const overview = {
  version_id: "v1", run_label: "Run 1", run_at: null, previous_version_id: null,
  dqs: { composite: 72, previous: 70, delta: 2, tier: "at_risk", capped: false, cap_reason: null },
  blockers: { count: 4, previous: null, waves: 2 },
  auto_fixable: { records: 120, failing_records: 400, pct: 30, high_confidence: 80 },
  value_at_risk: { worst_l1: "procure_to_pay", worst_l1_amount: 5000, currency: "USD", features_blocked: 3 },
  narrative: [{ text: "Four blocking gaps remain." }],
};

function mockAll() {
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [{ id: "v1", label: "Run 1", status: "complete" }] } as never);
  vi.spyOn(insightsApi, "getOverview").mockResolvedValue(overview);
  vi.spyOn(insightsApi, "getRootCauses").mockResolvedValue({ version_id: "v1", clusters: [] });
  vi.spyOn(insightsApi, "getRuleRanking").mockResolvedValue({ version_id: "v1", rows: [] });
  vi.spyOn(insightsApi, "getTrends").mockResolvedValue({ lineage: "l", runs: [], annotations: [] });
  vi.spyOn(insightsApi, "getHeatmap").mockResolvedValue({ version_id: "v1", dimensions: [], rows: [] });
  vi.spyOn(insightsApi, "getCleansing").mockResolvedValue({ version_id: "v1", currency: "USD", steps: [], by_module: [], by_rule: [] } as never);
  vi.spyOn(migrationApi, "getS4Readiness").mockResolvedValue({ version_id: "v1", status: "ok", ready: true, rules: 0, evaluated: 0, failing: 0, failing_records: 0, blocking_failing: 0, warning_failing: 0, areas: [] });
}

afterEach(() => vi.restoreAllMocks());

describe("InsightsOverviewPage", () => {
  it("renders the narrative, one hero and no in-page h1", async () => {
    mockAll();
    mount();
    expect(await screen.findByText("Four blocking gaps remain.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getAllByTestId("insight-hero-stats")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /^Reports/ })).toBeInTheDocument();
  });

  it("shows the worst L1 and never a cross-L1 total", async () => {
    mockAll();
    mount();
    expect(await screen.findByText(/Procure to pay, 3 features blocked/i)).toBeInTheDocument();
  });

  it("links Open records to the object's records tab pre-filtered by the rule, and omits a zero wave count", async () => {
    mockAll();
    vi.spyOn(insightsApi, "getOverview").mockResolvedValue({ ...overview, blockers: { count: 1, previous: null, waves: 0 } });
    vi.spyOn(insightsApi, "getRootCauses").mockResolvedValue({
      version_id: "v1",
      clusters: [{ key: "ap:LIFNR", kind: "field", module: "accounts_payable", table: "LFA1", field: "LIFNR", rules: ["AP083", "AP001"], dimension: "completeness", severity: "high", records: 12, records_estimated: false, impact: 40, auto_fix_pct: null }],
    } as never);
    mount();
    const link = await screen.findByRole("link", { name: "Open records" });
    expect(link).toHaveAttribute("href", "/objects/accounts_payable?tab=records&run=v1&check=AP083");
    expect(screen.getAllByText("1 blocking gap").length).toBeGreaterThan(0);
    expect(screen.queryByText(/across 0 waves/)).toBeNull();
    expect(screen.getByText("No wave defined")).toBeInTheDocument();
  });

  it("shows a section error with retry when one query fails", async () => {
    mockAll();
    vi.spyOn(insightsApi, "getRootCauses").mockRejectedValue(new Error("network error"));
    mount();
    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByText("Four blocking gaps remain.")).toBeInTheDocument();
  });

  it("shows the page error when the overview fails", async () => {
    mockAll();
    vi.spyOn(insightsApi, "getOverview").mockRejectedValue(new Error("network error"));
    mount();
    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
