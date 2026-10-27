// The analyses only the retired Insights overview had, now on the lead home: root causes, S/4 migration and the
// cleansing funnel, for the current state (or the run ?run= pins), each card failing on its own.
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as insightsApi from "@/lib/api/insights";
import * as migrationApi from "@/lib/api/migration";
import * as versionsApi from "@/lib/api/versions";
import { HomeAnalyses } from "../_analyses";

const nav = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/home/lead",
  useSearchParams: () => new URLSearchParams(nav.query),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

const dims = (score: number) => ({ completeness: score, accuracy: score, consistency: score, timeliness: score, uniqueness: score, validity: score });
const summary = (score: number) => ({
  composite_score: score, dimension_scores: dims(score), critical_count: 0, high_count: 0, medium_count: 0, low_count: 0,
  total_checks: 10, passing_checks: 10, capped: false, cap_reason: null,
});
const versions = [
  { id: "co2", label: "controlling_1k", status: "complete", run_at: "2026-10-16T05:17:00Z", dqs_summary: { controlling: summary(50) }, metadata: { modules: ["controlling"] } },
  { id: "mm1", label: "material_master_25k", status: "complete", run_at: "2026-10-16T03:05:00Z", dqs_summary: { material_master: summary(80) }, metadata: { modules: ["material_master"] } },
];
const scope = { version_id: null, scope: "current" as const, version_ids: ["co2", "mm1"], objects: [] };

function mockCurrent() {
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions } as never);
  vi.spyOn(insightsApi, "getCurrentRootCauses").mockResolvedValue({
    ...scope,
    clusters: [
      { key: "controlling:CSKS.KOSTL", kind: "field", module: "controlling", table: "CSKS", field: "KOSTL", rules: ["CO001"], dimension: "completeness", severity: "critical", records: 40, records_estimated: false, impact: 90, auto_fix_pct: null, origin: { status: "not_computed", top: null, share: null }, version_id: "co2" },
      { key: "material_master:MARA.MATKL", kind: "field", module: "material_master", table: "MARA", field: "MATKL", rules: ["MM045"], dimension: "validity", severity: "high", records: 12, records_estimated: false, impact: 30, auto_fix_pct: 25, origin: { status: "not_computed", top: null, share: null }, version_id: "mm1" },
    ],
  } as never);
  vi.spyOn(insightsApi, "getCurrentCleansing").mockResolvedValue({
    ...scope, currency: "ZAR", by_module: [], by_rule: [],
    steps: [
      { key: "failing", label: "Failing records", records: 128 }, { key: "proposed", label: "With a proposed value", records: 64 },
      { key: "high", label: "High confidence", records: 10 }, { key: "approved", label: "Approved", records: 2 }, { key: "applied", label: "Applied", records: 1 },
    ],
  } as never);
  vi.spyOn(migrationApi, "getCurrentS4Readiness").mockResolvedValue({
    ...scope, status: "red", ready: false, rules: 4, evaluated: 3, failing: 3, failing_records: 9, blocking_failing: 2, warning_failing: 1,
    areas: [{ area: "cvi", label: "Customer vendor integration", simplification_item: null, rules: 4, evaluated: 3, failing: 3, failing_records: 9, blocking_failing: 2, warning_failing: 1, status: "red", checks: [] }],
  } as never);
  vi.spyOn(insightsApi, "getRootCauses");
  vi.spyOn(insightsApi, "getCleansing");
  vi.spyOn(migrationApi, "getS4Readiness");
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><HomeAnalyses /></QueryClientProvider>);
}

afterEach(() => { vi.restoreAllMocks(); nav.query = ""; });

describe("HomeAnalyses", () => {
  it("reads root causes, S/4 migration and the cleansing funnel for the current state", async () => {
    mockCurrent();
    mount();
    const records = await screen.findAllByRole("link", { name: /^Open the failing records of rule (CO001|MM045)/ });
    expect(records.map((a) => a.getAttribute("href"))).toEqual(expect.arrayContaining([
      "/fix?run=co2&module=controlling&check=CO001",
      "/fix?run=mm1&module=material_master&check=MM045",
    ]));
    expect(screen.getByText("2 of 2. Each object at its latest run")).toBeInTheDocument();
    expect(await screen.findByText("2 blocking, 1 warning")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open waves" })).toHaveAttribute("href", "/insights/readiness");
    expect(screen.getByRole("group", { name: /Cleansing funnel/ })).toBeInTheDocument();
    // one vocabulary with Fix work: the stage is named by its key, whatever words an older API sends
    expect(within(screen.getByRole("group", { name: /Cleansing funnel/ })).getAllByText(/With a suggested value/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/With a proposed value/)).toBeNull();
    // only the scope=current wrappers are read, never the one-run ones
    expect(insightsApi.getRootCauses).not.toHaveBeenCalled();
    expect(insightsApi.getCleansing).not.toHaveBeenCalled();
    expect(migrationApi.getS4Readiness).not.toHaveBeenCalled();
  });

  it("reads the pinned run's analyses when ?run= pins one", async () => {
    nav.query = "run=co2";
    mockCurrent();
    vi.spyOn(insightsApi, "getRootCauses").mockResolvedValue({ version_id: "co2", clusters: [] });
    vi.spyOn(insightsApi, "getCleansing").mockResolvedValue({ version_id: "co2", currency: "ZAR", steps: [], by_module: [], by_rule: [] } as never);
    vi.spyOn(migrationApi, "getS4Readiness").mockResolvedValue({ version_id: "co2", status: "ok", ready: true, rules: 0, evaluated: 0, failing: 0, failing_records: 0, blocking_failing: 0, warning_failing: 0, areas: [] });
    mount();
    expect(await screen.findByText("No failing fields in this run.")).toBeInTheDocument();
    expect(insightsApi.getRootCauses).toHaveBeenCalledWith({ version_id: "co2" });
    expect(migrationApi.getS4Readiness).toHaveBeenCalledWith("co2");
    expect(insightsApi.getCurrentRootCauses).not.toHaveBeenCalled();
  });

  it("shows an honest error in each card when its endpoint fails", async () => {
    mockCurrent();
    vi.spyOn(insightsApi, "getCurrentRootCauses").mockRejectedValue(new Error("network error"));
    vi.spyOn(insightsApi, "getCurrentCleansing").mockRejectedValue(new Error("network error"));
    vi.spyOn(migrationApi, "getCurrentS4Readiness").mockRejectedValue(new Error("network error"));
    mount();
    expect(await screen.findByText(/^Root causes did not load/)).toBeInTheDocument();
    expect(await screen.findByText(/^S\/4 migration did not load/)).toBeInTheDocument();
    expect(await screen.findByText(/^Cleansing opportunity did not load/)).toBeInTheDocument();
  });

  it("renders nothing before the first scored run", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] } as never);
    const { container } = mount();
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
