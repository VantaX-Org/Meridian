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
  vi.spyOn(findingsApi, "getFindingsAggregate").mockResolvedValue({ severity: { critical: 2, high: 5, medium: 9, low: 1 } } as never);
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
    // One term for the count on every insight page: blocking findings.
    expect(screen.getByText("Blocking findings")).toBeInTheDocument();
    expect(screen.queryByText("Blockers")).toBeNull();
    // one run is never described as "all objects"
    expect(screen.queryByText(/all objects/i)).toBeNull();
  });

  it("shows the worst L1 and never a cross-L1 total", async () => {
    mockAll();
    mount();
    expect(await screen.findByText("Most at risk: Procure to pay")).toBeInTheDocument();
    expect(screen.getByText("3 features blocked")).toBeInTheDocument();
  });

  it("counts the run's critical and high findings, as the current state does, and keeps blocking findings in their own tile", async () => {
    mockAll();
    mount();
    // 2 critical + 5 high failing rules of the run, opening exactly those findings on the run's findings tab.
    const tile = (await screen.findByText("Critical and high findings")).closest("a");
    expect(tile).toHaveAttribute("href", "/runs/v1?tab=findings&severity=critical,high");
    expect(await within(tile as HTMLElement).findByText("7")).toBeInTheDocument();
    // The hero's sub-line compares with the previous run rather than repeating the tile.
    expect(within(screen.getByTestId("hero-verdict")).getByText("Was 70.0 in the previous run")).toBeInTheDocument();
    expect(within(screen.getByTestId("hero-verdict")).queryByText("7 critical and high findings")).toBeNull();
    expect(findingsApi.getFindingsAggregate).toHaveBeenCalledWith({ version_id: "v1", module: undefined });
    // The S/4 and critical set keeps its own name and opens the readiness view.
    expect(screen.getByText("Blocking findings").closest("a")).toHaveAttribute("href", "/insights/readiness?run=v1");
  });

  it("links Open records to the object's records tab pre-filtered by the rule, and omits a zero wave count", async () => {
    mockAll();
    vi.spyOn(insightsApi, "getOverview").mockResolvedValue({ ...overview, blockers: { count: 1, previous: null, waves: 0 } });
    vi.spyOn(insightsApi, "getRootCauses").mockResolvedValue({
      version_id: "v1",
      clusters: [{ key: "ap:LIFNR", kind: "field", module: "accounts_payable", table: "LFA1", field: "LIFNR", rules: ["AP083", "AP001"], dimension: "completeness", severity: "high", records: 12, records_estimated: false, impact: 40, auto_fix_pct: null }],
    } as never);
    mount();
    // A field failing two rules opens the object's failing records in Fix work.
    const link = await screen.findByRole("link", { name: /^Open the failing records of accounts payable/i });
    expect(link).toHaveAttribute("href", "/fix?run=v1&module=accounts_payable");
    expect(screen.getAllByText("1 blocking finding").length).toBeGreaterThan(0);
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
    const records = await screen.findAllByRole("link", { name: /^Open the failing records of rule (CO001|MM045)/ });
    expect(records.map((a) => a.getAttribute("href"))).toEqual(expect.arrayContaining([
      "/fix?run=co2&module=controlling&check=CO001",
      "/fix?run=mm1&module=material_master&check=MM045",
    ]));
    expect(screen.getByText("2 of 2, each object at its latest run")).toBeInTheDocument();
    // S/4 totals and the readiness link carry no run
    expect(await screen.findByText("2 blocking, 1 warning")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open waves" })).toHaveAttribute("href", "/insights/readiness");
    // the cleansing funnel and its batch link carry no run
    expect(screen.getByRole("group", { name: /Cleansing funnel/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create remediation batch" })).toHaveAttribute("href", "/fix?sugg=1");
    // auto-fixable records in the hero, value at risk of the worst L1 only
    expect(screen.getByText("Records with a suggested value")).toBeInTheDocument();
    expect(screen.getByText("50% of failing records")).toBeInTheDocument();
    expect(within(screen.getByTestId("current-value-at-risk")).getByText("Most at risk: Order to cash")).toBeInTheDocument();
    // only the scope=current wrappers are read, never the one-run ones
    expect(insightsApi.getCurrentOverview).toHaveBeenCalledWith();
    expect(migrationApi.getS4Readiness).not.toHaveBeenCalled();
    expect(insightsApi.getCleansing).not.toHaveBeenCalled();
    // the per-run card is reduced to links
    expect(screen.queryByText("Analysed per run")).toBeNull();
    expect(within(screen.getByTestId("per-run-list")).getAllByRole("link").length).toBe(3);
  });

  it("never opens one run's impact from a value at risk that spans several runs", async () => {
    query = "";
    mockCurrent();
    mount();
    const tiles = await screen.findByTestId("current-value-at-risk");
    expect(within(tiles).getByText("Most at risk: Order to cash").closest("a")).toBeNull();
    expect(within(tiles).getAllByText("Across 3 runs").length).toBe(2);
    // each run's own value at risk is one link away
    const perRun = within(screen.getByTestId("value-at-risk-runs")).getAllByRole("link");
    expect(perRun.map((a) => a.getAttribute("href"))).toEqual(expect.arrayContaining(["/insights/impact?run=co2", "/insights/impact?run=mm1", "/insights/impact?run=ap1"]));
  });

  it("opens the one run behind the state from value at risk, and names it", async () => {
    query = "";
    mockCurrent();
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [currentVersions[3]] } as never);
    mount();
    const tiles = await screen.findByTestId("current-value-at-risk");
    expect(within(tiles).getByText("Most at risk: Order to cash").closest("a")).toHaveAttribute("href", "/insights/impact?run=ap1");
    expect(screen.queryByTestId("value-at-risk-runs")).toBeNull();
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
    // mean of 50, 80 and 95; critical and high findings across the objects (3 + 2). Not "blocking": that word is the
    // run overview's set (critical or S/4-blocking rules, blockers.count).
    const verdict = screen.getByTestId("hero-verdict");
    expect(within(verdict).getByText("At risk")).toBeInTheDocument();
    // The sub-line compares with the target rather than repeating the Critical and high tile.
    expect(within(verdict).getByText("1 of 3 objects below target")).toBeInTheDocument();
    expect(screen.queryByText("Blocking findings")).toBeNull();
    // the tile opens the findings behind its count, not the objects below target
    expect(screen.getByText("Critical and high findings").closest("a")).toHaveAttribute("href", "/insights?severity=critical,high");
    expect(screen.getByText("DQS 75.0 across 3 objects, at risk")).toBeInTheDocument();
    expect(screen.getAllByText("1 of 3 objects is not ready for go-live, 1 at risk.").length).toBeGreaterThan(0);
    // Fix first lists each object's findings from its own latest run only (CO099 is from an older controlling run)
    expect(await screen.findByText("CO001")).toBeInTheDocument();
    expect(screen.getByText("MM045")).toBeInTheDocument();
    expect(screen.queryByText("CO099")).toBeNull();
    // the per-run analyses are offered per run, each a link that pins that run
    expect(screen.getByRole("link", { name: "material_master_25k, 16 Oct 2026" })).toHaveAttribute("href", "/insights?run=mm1");
  });

  it("narrows Fix first to the severities of ?severity=, every matching row, with a way back", async () => {
    query = "severity=critical,high";
    mockCurrent();
    mount();
    expect(await screen.findByText("CO001")).toBeInTheDocument();
    expect(findingsApi.getFindings).toHaveBeenCalledWith({ severity: "critical,high", sort: "impact", limit: 200 });
    expect(screen.getByText("Critical and high failing rules, each object at its latest run, highest impact first")).toBeInTheDocument();
    expect(screen.getByTestId("fix-first-clear")).toHaveAttribute("href", "/insights");
    // still the current state: the one-run overview is not read
    expect(insightsApi.getOverview).not.toHaveBeenCalled();
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
