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
  it("renders one hero, no in-page h1 and no summary card restating the hero", async () => {
    mockAll();
    mount();
    expect(await screen.findByTestId("hero-verdict")).toBeInTheDocument();
    expect(screen.queryByText("Four blocking gaps remain.")).toBeNull();
    expect(screen.queryByText("Summary", { selector: "h2, h3, [class*=title]" })).toBeNull();
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
    expect(screen.getByTestId("hero-verdict")).toBeInTheDocument();
  });

  it("keeps the other sections when the overview fails", async () => {
    mockAll();
    vi.spyOn(insightsApi, "getOverview").mockRejectedValue(new Error("network error"));
    mount();
    expect(await screen.findByText(/The score did not load/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(await screen.findByText("No failing fields in this run.")).toBeInTheDocument();
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
    const scope = { version_id: null, scope: "current" as const, version_ids: ["co2", "mm1", "ap1"], objects: [] };
    vi.spyOn(insightsApi, "getCurrentOverview").mockResolvedValue({
      ...overview, ...scope, previous_version_id: null,
      auto_fixable: { records: 64, failing_records: 128, pct: 50, high_confidence: 10 },
      value_at_risk: { worst_l1: "order_to_cash", worst_l1_amount: 7000, currency: "ZAR", features_blocked: 2 },
    });
    vi.spyOn(insightsApi, "getCurrentRootCauses").mockResolvedValue({
      ...scope,
      clusters: [
        { key: "controlling:CSKS.KOSTL", kind: "field", module: "controlling", table: "CSKS", field: "KOSTL", rules: ["CO001"], dimension: "completeness", severity: "critical", records: 40, records_estimated: false, impact: 90, auto_fix_pct: null, origin: { status: "not_computed", top: null, share: null }, version_id: "co2" },
        { key: "material_master:MARA.MATKL", kind: "field", module: "material_master", table: "MARA", field: "MATKL", rules: ["MM045"], dimension: "validity", severity: "high", records: 12, records_estimated: false, impact: 30, auto_fix_pct: 25, origin: { status: "not_computed", top: null, share: null }, version_id: "mm1" },
      ],
    });
    vi.spyOn(insightsApi, "getCurrentCleansing").mockResolvedValue({
      ...scope, currency: "ZAR", by_module: [], by_rule: [],
      steps: [
        { key: "failing", label: "Failing records", records: 128 }, { key: "proposed", label: "With a proposed value", records: 64 },
        { key: "high", label: "High confidence", records: 10 }, { key: "approved", label: "Approved", records: 2 }, { key: "applied", label: "Applied", records: 1 },
      ],
    });
    vi.spyOn(migrationApi, "getCurrentS4Readiness").mockResolvedValue({
      ...scope, status: "red", ready: false, rules: 4, evaluated: 3, failing: 3, failing_records: 9, blocking_failing: 2, warning_failing: 1,
      areas: [{ area: "cvi", label: "Customer vendor integration", simplification_item: null, rules: 4, evaluated: 3, failing: 3, failing_records: 9, blocking_failing: 2, warning_failing: 1, status: "red", checks: [] }],
    });
  }

  it("reads root causes, S/4, cleansing, auto-fixable and value at risk for the current state", async () => {
    query = "";
    mockCurrent();
    mount();
    // root causes of the current state, each linking into the run it was computed in
    const records = await screen.findAllByRole("link", { name: "Open records" });
    expect(records.map((a) => a.getAttribute("href"))).toEqual([
      "/objects/controlling?tab=records&run=co2&check=CO001",
      "/objects/material_master?tab=records&run=mm1&check=MM045",
    ]);
    expect(screen.getByText("2 of 2, each object at its latest run")).toBeInTheDocument();
    // S/4 totals and the readiness link carry no run
    expect(await screen.findByText("2 blocking, 1 warning")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open readiness" })).toHaveAttribute("href", "/insights/readiness");
    // the cleansing funnel and its batch link carry no run
    expect(screen.getByRole("group", { name: /Cleansing funnel/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create remediation batch" })).toHaveAttribute("href", "/fix?source=rule&confidence=high");
    // auto-fixable records in the hero, value at risk of the worst L1 only
    expect(screen.getByText("Auto-fixable records")).toBeInTheDocument();
    expect(screen.getByText("50% of failing records")).toBeInTheDocument();
    expect(within(screen.getByTestId("current-value-at-risk")).getByText("Worst L1, Order to cash")).toBeInTheDocument();
    // only the scope=current wrappers are read, never the one-run ones
    expect(insightsApi.getCurrentOverview).toHaveBeenCalledWith();
    expect(migrationApi.getS4Readiness).not.toHaveBeenCalled();
    expect(insightsApi.getCleansing).not.toHaveBeenCalled();
    // the per-run card is reduced to links
    expect(screen.queryByText("Analysed per run")).toBeNull();
    expect(within(screen.getByTestId("per-run-list")).getAllByRole("link").length).toBe(3);
  });

  it("shows an honest error in each current-state card when its endpoint fails, and keeps the page", async () => {
    query = "";
    mockCurrent();
    for (const fn of ["getCurrentOverview", "getCurrentRootCauses", "getCurrentCleansing"] as const) {
      vi.spyOn(insightsApi, fn).mockRejectedValue(new Error("network error"));
    }
    vi.spyOn(migrationApi, "getCurrentS4Readiness").mockRejectedValue(new Error("network error"));
    mount();
    expect(await screen.findByText(/^Root causes did not load/)).toBeInTheDocument();
    expect(await screen.findByText(/^S\/4 migration did not load/)).toBeInTheDocument();
    expect(await screen.findByText(/^Cleansing opportunity did not load/)).toBeInTheDocument();
    expect(await screen.findByText(/^Value at risk did not load/)).toBeInTheDocument();
    // the hero still reads the current state from the runs' scores
    expect(screen.getByText("DQS 75.0 across 3 objects, at risk")).toBeInTheDocument();
    expect(screen.getByTestId("per-run-list")).toBeInTheDocument();
  });

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
