// Backend features surfaced on the object page: rule coverage (Rules), the projection (History), confirming a
// dependency (Fields) and what a failing rule blocks (the rule's records).
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as objectsApi from "@/lib/api/v1/objects";
import * as versionsApi from "@/lib/api/versions";
import * as rulesApi from "@/lib/api/rules";
import * as fieldProfileApi from "@/lib/api/field-profile";
import * as analyticsApi from "@/lib/api/analytics";
import * as findingsApi from "@/lib/api/findings";
import * as workApi from "@/lib/api/work";
import type { Finding, FindingList, Version } from "@/types/api";
import ObjectDetailPage from "../page";

let searchParams = new URLSearchParams("run=v1");
const granted = vi.hoisted(() => ({ manage: true }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ object: "material_master" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => searchParams,
  usePathname: () => "/objects/material_master",
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => (a === "manage_rules" ? granted.manage : true) }) }));
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("@/design", async () => {
  const actual = await vi.importActual<typeof import("@/design")>("@/design");
  return { ...actual, toast: Object.assign((...a: Parameters<typeof actual.toast>) => actual.toast(...a), actual.toast, { success: toastSuccess }) };
});

const VERSION: Version = {
  id: "v1", label: "Oct 8", status: "complete", run_at: "2026-10-08T00:00:00Z", dqs_summary: null,
  metadata: { modules: ["material_master"], file_name: "f.csv", row_count: 1, system_id: "sys-1" },
};
const OBJECT: objectsApi.ObjectDetail = {
  module: "material_master", label: "Material master", composite_score: 72.5, readiness: "warn", failing_checks: 1, affected_records: 120,
  dimension_scores: { completeness: 80 },
  rules: [{ check_id: "mm_missing_desc", severity: "high", dimension: "completeness", affected_count: 42, total_count: 100, pass_rate: 0.58 }],
};
const stats = { rows: 100, table_rows: 100, sampled: false, blank: 0, blank_pct: 0, distinct: 4, min_length: 4, max_length: 4, ddic_type: "CHAR", ddic_length: 4,
  description: null, numeric: null, dates: null, shapes: [], shape_count: 0, masked: false, mask_reason: null, top_values: null };
const dep = (over: Partial<fieldProfileApi.FieldDependency> = {}): fieldProfileApi.FieldDependency => ({
  table: "MARA", determinant: "MTART", dependent: "MBRSH", support: 0.97, rows: 100, violations: 3, sample_keys: [], accepted: false, ...over,
});
const profile = (dependencies: fieldProfileApi.FieldDependency[]): fieldProfileApi.VersionProfile => ({
  version_id: "v1", object: "material_master", objects: ["material_master"], dependencies,
  tables: [{ table: "MARA", rows: 100, table_rows: 100, sampled: false, fields: [{ field: "MBRSH", stats }, { field: "MTART", stats }] }],
});
const coverage = (rules: number, never_run: number): rulesApi.ModuleCoverage => ({
  module: "material_master", has_view_map: false, object: { module: "material_master", by_dimension: {}, total: rules, never_run }, views: [],
  dimension_by_view: {}, totals: { rules, never_run, views: 0, views_total: 0, tables: 0 },
});

beforeEach(() => {
  vi.restoreAllMocks();
  toastSuccess.mockClear();
  granted.manage = true;
  searchParams = new URLSearchParams("run=v1");
  vi.spyOn(versionsApi, "getVersion").mockResolvedValue(VERSION);
  vi.spyOn(objectsApi, "getObject").mockResolvedValue(OBJECT);
  vi.spyOn(rulesApi, "getRuleHistoryBatch").mockResolvedValue({ version_id: "v1", module: "material_master", history: {} });
  vi.spyOn(rulesApi, "getModuleCoverage").mockResolvedValue(coverage(40, 6));
  vi.spyOn(analyticsApi, "getModuleForecast").mockResolvedValue({ module_id: "material_master", forecast: null, history: [], message: "Need at least 3 data points for forecasting (have 2)" });
  vi.spyOn(fieldProfileApi, "getProfileByVersion").mockResolvedValue(profile([]));
  vi.spyOn(versionsApi, "getFindingRecords").mockResolvedValue({ version_id: "v1", check_id: "mm_missing_desc", total: 0, records: [] });
  vi.spyOn(workApi, "getWorkSummary").mockResolvedValue({ version_id: "v1", scope: "s", built: true, objects: [], totals: { records: 0, open: 0, issues: 0, critical: 0, proposed: 0, overdue: 0 } });
  vi.spyOn(workApi, "getWorkGroups").mockResolvedValue({ version_id: "v1", built: true, total: 0, groups: [] });
  vi.spyOn(workApi, "getWorkRecords").mockResolvedValue({ version_id: "v1", total: 0, total_capped: false, next: null, items: [] });
});

describe("Rules tab coverage", () => {
  it("says how many catalogue rules ran, with a link to the catalogue", async () => {
    searchParams = new URLSearchParams("run=v1&tab=rules");
    renderWithQuery(<ObjectDetailPage />);
    const line = await screen.findByTestId("rules-coverage");
    expect(line).toHaveTextContent("34 of 40 catalogue rules ran");
    expect(rulesApi.getModuleCoverage).toHaveBeenCalledWith("material_master");
    expect(within(line).getByRole("link", { name: "Open the catalogue" })).toHaveAttribute("href", "/rules?module=material_master");
  });

  it("shows no line when the object has no catalogue rules (404)", async () => {
    vi.spyOn(rulesApi, "getModuleCoverage").mockRejectedValue(new Error("Module has no rules"));
    searchParams = new URLSearchParams("run=v1&tab=rules");
    renderWithQuery(<ObjectDetailPage />);
    await screen.findByText("mm_missing_desc");
    expect(screen.queryByTestId("rules-coverage")).toBeNull();
  });
});

describe("What this blocks on a rule's records", () => {
  it("reads the impact of the rule's finding beside its failing records", async () => {
    searchParams = new URLSearchParams("run=v1&tab=rules&check_id=mm_missing_desc");
    vi.spyOn(versionsApi, "getFindingRecords").mockResolvedValue({
      version_id: "v1", check_id: "mm_missing_desc", total: 1,
      records: [{ record_key: "MATNR=100001", grain: "MATNR", module: "material_master", field_values: null }],
    });
    vi.spyOn(findingsApi, "getFindings").mockResolvedValue({ findings: [{ id: "f-1" } as Finding] } as FindingList);
    vi.spyOn(analyticsApi, "getFindingImpact").mockResolvedValue({
      finding_id: "f-1", finding: {} as Finding,
      impacts: [{ category: "inventory_write_off", annual_risk: 1200, mitigated: 300, finding_count: 1, calculation_method: "m", currency: "ZAR" }],
    });
    renderWithQuery(<ObjectDetailPage />);
    expect(await screen.findByText("What this blocks")).toBeInTheDocument();
    expect(await screen.findByText("Inventory write off")).toBeInTheDocument();
    expect(analyticsApi.getFindingImpact).toHaveBeenCalledWith("f-1");
  });
});

describe("History tab projection", () => {
  const run = (id: string, at: string) => ({ version_id: id, run_at: at, system_id: "sys-1", scoring_recorded: true, at_the_time: { composite: 70, tier: "warn" as const, scoring: null }, under_current: { composite: 70, tier: "warn" as const, modules: {} } });
  beforeEach(() => {
    vi.spyOn(findingsApi, "getScoreHistory").mockResolvedValue({
      history: [run("v1", "2026-10-08T00:00:00Z"), run("v0", "2026-10-01T00:00:00Z")],
      modules: { material_master: [{ version_id: "v1", composite: 72, at_the_time: 72 }, { version_id: "v0", composite: 61, at_the_time: 61 }] },
    });
    searchParams = new URLSearchParams("run=v1&tab=history");
  });

  it("labels the forecast as a projection and gives each horizon with its range", async () => {
    vi.spyOn(analyticsApi, "getModuleForecast").mockResolvedValue({
      module_id: "material_master", history: [],
      forecast: {
        module_id: "material_master", current_score: 72, forecast_7d: 74, forecast_7d_low: 70, forecast_7d_high: 78,
        forecast_30d: 80, forecast_30d_low: 71, forecast_30d_high: 89, forecast_90d: null, trend: "improving", confidence: 80,
        points: 8, span_days: 14, history: [{ day: -14, score: 61 }, { day: -7, score: 66 }], contributing_factors: [],
      },
    });
    renderWithQuery(<ObjectDetailPage />);
    const card = (await screen.findByText("Projection")).closest(".m-card") as HTMLElement;
    expect(within(card).getByText(/A projection from the runs so far, not a measurement/)).toBeInTheDocument();
    expect(card).toHaveTextContent("heading up: in 7 days 74 (range 70 to 78); in 30 days 80 (range 71 to 89). From 8 runs across 14 days.");
    expect(analyticsApi.getModuleForecast).toHaveBeenCalledWith("material_master");
  });

  it("says why there is no projection yet", async () => {
    renderWithQuery(<ObjectDetailPage />);
    expect(await screen.findByText("Need at least 3 data points for forecasting (have 2)")).toBeInTheDocument();
  });
});

describe("Fields tab Confirm dependency", () => {
  beforeEach(() => { searchParams = new URLSearchParams("run=v1&tab=fields"); });

  it("confirms the dependent field's dependency as a check on this object", async () => {
    vi.spyOn(fieldProfileApi, "getProfileByVersion").mockResolvedValue(profile([dep()]));
    const accept = vi.spyOn(fieldProfileApi, "acceptDependency").mockResolvedValue({ id: "r1", name: "HR-1" });
    renderWithQuery(<ObjectDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm dependency: MTART decides MBRSH" }));
    await waitFor(() => expect(accept).toHaveBeenCalledWith({ module: "material_master", determinant: "MTART", dependent: "MBRSH" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Dependency confirmed. It runs as a check from the next analysis"));
    // only the dependent field's row carries the action
    expect(screen.getAllByRole("button", { name: /Confirm dependency/ })).toHaveLength(1);
  });

  it("marks a dependency that is already a check, and offers nothing to someone who cannot manage rules", async () => {
    vi.spyOn(fieldProfileApi, "getProfileByVersion").mockResolvedValue(profile([dep({ accepted: true })]));
    renderWithQuery(<ObjectDetailPage />);
    expect(await screen.findByText("Check added")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirm dependency/ })).toBeNull();
  });

  it("hides the action without manage_rules", async () => {
    granted.manage = false;
    vi.spyOn(fieldProfileApi, "getProfileByVersion").mockResolvedValue(profile([dep()]));
    renderWithQuery(<ObjectDetailPage />);
    await screen.findByText("MARA.MBRSH");
    expect(screen.queryByRole("button", { name: /Confirm dependency/ })).toBeNull();
  });
});
