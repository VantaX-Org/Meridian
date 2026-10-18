// frontend/app/(app)/insights/__tests__/page.test.tsx
import fs from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as insightsApi from "@/lib/api/insights";
import * as migrationApi from "@/lib/api/migration";
import * as versionsApi from "@/lib/api/versions";
import * as findingsApi from "@/lib/api/findings";
import * as objectsApi from "@/lib/api/v1/objects";
import InsightsOverviewPage from "../page";

let query = "run=v1";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/insights",
  useSearchParams: () => new URLSearchParams(query),
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

afterEach(() => {
  vi.restoreAllMocks();
  query = "run=v1";
});

describe("InsightsOverviewPage", () => {
  it("renders the narrative, one hero and no in-page h1", async () => {
    mockAll();
    mount();
    expect(await screen.findByText("Four blocking gaps remain.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getAllByTestId("insight-hero-stats")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /^Reports/ })).toBeInTheDocument();
    // The hero names what it counts (config-impact blocking gaps), so it never contradicts Readiness's "Blockers".
    expect(screen.getByText("Blocking gaps")).toBeInTheDocument();
    expect(screen.queryByText("Blockers")).toBeNull();
    // one run is never described as "all objects"
    expect(screen.queryByText(/all objects/i)).toBeNull();
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

const dims = (score: number) => ({ completeness: score, accuracy: score, consistency: score, timeliness: score, uniqueness: score, validity: score });
const summary = (score: number, critical: number, high: number) => ({
  composite_score: score, dimension_scores: dims(score), critical_count: critical, high_count: high, medium_count: 0, low_count: 0,
  total_checks: 10, passing_checks: 10 - critical - high, capped: false, cap_reason: null,
});
// The newest run of the tenant measured controlling only; material master and accounts payable come from older runs.
const currentVersions = [
  { id: "co2", label: "controlling_1k", status: "complete", run_at: "2026-10-16T05:17:00Z", dqs_summary: { controlling: summary(50, 2, 1) }, metadata: { modules: ["controlling"] } },
  { id: "co1", label: "controlling_1k", status: "complete", run_at: "2026-10-15T05:17:00Z", dqs_summary: { controlling: summary(40, 3, 0) }, metadata: { modules: ["controlling"] } },
  { id: "mm1", label: "material_master_25k", status: "complete", run_at: "2026-10-16T03:05:00Z", dqs_summary: { material_master: summary(80, 0, 2) }, metadata: { modules: ["material_master"] } },
  { id: "ap1", label: "accounts_payable_p02", status: "complete", run_at: "2026-10-16T03:01:00Z", dqs_summary: { accounts_payable: summary(95, 0, 0) }, metadata: { modules: ["accounts_payable"] } },
];

describe("InsightsOverviewPage without ?run= (current state)", () => {
  function mockCurrent() {
    mockAll();
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: currentVersions } as never);
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "co2", objects: [], thresholds: { target: 90, warning: 75, critical: 60 } } as never);
    vi.spyOn(findingsApi, "getFindings").mockResolvedValue({
      findings: [
        { id: "f1", version_id: "co2", module: "controlling", check_id: "CO001", severity: "critical", dimension: "completeness", affected_count: 40, total_count: 100, pass_rate: 60, details: {} },
        { id: "f0", version_id: "co1", module: "controlling", check_id: "CO099", severity: "critical", dimension: "completeness", affected_count: 99, total_count: 100, pass_rate: 1, details: {} },
        { id: "f2", version_id: "mm1", module: "material_master", check_id: "MM045", severity: "high", dimension: "validity", affected_count: 12, total_count: 100, pass_rate: 88, details: {} },
      ],
      total: 3,
    } as never);
  }

  it("describes every object at its latest run, never the newest run alone", async () => {
    query = "";
    mockCurrent();
    mount();
    expect(await screen.findByTestId("run-scope")).toHaveTextContent("Current state of 3 objects, latest run 16 Oct 2026");
    expect(screen.queryByText(/Scope: all objects/)).toBeNull();
    // the one-run overview endpoints are not read for a cross-object page
    expect(insightsApi.getOverview).not.toHaveBeenCalled();
    expect(insightsApi.getRootCauses).not.toHaveBeenCalled();
    // mean of 50, 80 and 95; blocking findings are critical and high across the objects (3 + 2)
    const verdict = screen.getByTestId("hero-verdict");
    expect(within(verdict).getByText("At risk")).toBeInTheDocument();
    expect(within(verdict).getByText("5 blocking findings in 2 objects")).toBeInTheDocument();
    expect(screen.getByText("DQS 75.0 across 3 objects, at risk")).toBeInTheDocument();
    expect(screen.getAllByText("1 of 3 objects is not ready for go-live.").length).toBeGreaterThan(0);
    // Fix first lists each object's findings from its own latest run only (CO099 is from an older controlling run)
    expect(await screen.findByText("CO001")).toBeInTheDocument();
    expect(screen.getByText("MM045")).toBeInTheDocument();
    expect(screen.queryByText("CO099")).toBeNull();
    // the per-run analyses are offered per run, each a link that pins that run
    expect(screen.getByRole("link", { name: "material_master_25k, 16 Oct 2026" })).toHaveAttribute("href", "/insights?run=mm1");
  });

  it("lays the verdict out with a wrapping basis so it never shrinks to a word per line", async () => {
    query = "";
    mockCurrent();
    mount();
    const verdict = await screen.findByTestId("hero-verdict");
    expect(verdict).toHaveClass("m-hero-verdict");
    expect(verdict.className).not.toMatch(/\bflex-1\b|\bmin-w-0\b/);
    expect(verdict.parentElement).toHaveClass("m-hero-lead");
    const css = fs.readFileSync(path.join(process.cwd(), "design", "tokens.css"), "utf8");
    const rule = /\.m-hero-verdict\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    // a non-zero basis: the verdict wraps under the score rather than shrinking beside it
    expect(rule).toMatch(/flex:\s*1 1 \d+(\.\d+)?rem/);
    expect(/\.m-hero-lead\s*\{([^}]*)\}/.exec(css)?.[1] ?? "").toMatch(/flex-wrap:\s*wrap/);
  });

  it("uses the same verdict layout in one-run mode", async () => {
    mockAll();
    mount();
    expect(await screen.findByTestId("hero-verdict")).toHaveClass("m-hero-verdict");
  });
});
