import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as mdmApi from "@/lib/api/mdm-metrics";
import * as matchApi from "@/lib/api/match-review";
import * as masterApi from "@/lib/api/master-records";
import * as objectsApi from "@/lib/api/v1/objects";
import type { MdmMetric } from "@/types/api";
import MdmOverviewPage from "../page";

const metric: MdmMetric = {
  snapshot_date: "2026-10-01", domain: null, golden_record_count: 12480, golden_record_coverage_pct: 0.84, avg_match_confidence: 0.91,
  steward_sla_compliance_pct: 1, source_consistency_pct: 0.875, mdm_health_score: 86, backlog_count: 38, sync_coverage_pct: 0.75,
  ai_narrative: null, ai_projected_score: null, ai_risk_flags: null,
};

const pair = (id: string, domain = "material_master"): matchApi.ReviewPair => ({
  id, domain, a: `${id}-a`, b: `${id}-b`, total: 0.8, band: "review", auto_action: "queued", steward_decision: null, constraint: null,
  explanation: null, field_scores: {}, a_record_id: null, b_record_id: null, same_cluster: false,
});
const pairList = (pairs: matchApi.ReviewPair[], bands = { auto_merge: 0, review: pairs.length, low: 0 }): matchApi.ReviewPairList =>
  ({ pairs, total: pairs.length, bands, thresholds: { auto_merge: 0.95, review_floor: 0.3 } });
const records = (total: number) => ({ records: [], total, page: 1, per_page: 1 });

function mockLists(opts: { golden?: number; all?: number; pairs?: matchApi.ReviewPairList } = {}) {
  vi.spyOn(matchApi, "getReviewPairs").mockResolvedValue(opts.pairs ?? pairList([]));
  vi.spyOn(masterApi, "getMasterRecords").mockImplementation(async (p) => records(p?.status === "golden" ? opts.golden ?? 12480 : opts.all ?? 12480));
}

describe("MdmOverviewPage", () => {
  it("shows the health figure with its four inputs, then the match work ledger with an Open action", async () => {
    vi.spyOn(mdmApi, "getMdmDashboard").mockResolvedValue({ latest: metric, trend: [metric], active_systems_count: 4 });
    const history = vi.spyOn(mdmApi, "getMdmHistory").mockResolvedValue({ history: [metric] });
    mockLists({ pairs: pairList([pair("p1")]) });
    renderWithQuery(<MdmOverviewPage />);
    expect(await screen.findByText("MDM health")).toBeInTheDocument();
    for (const label of ["Coverage", "Match confidence", "Steward SLA", "Source consistency"]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(await screen.findByText(/12,480 golden records of 12,480 master records/)).toBeInTheDocument();
    expect(await screen.findByText("Match work")).toBeInTheDocument();
    expect(await screen.findByText("1 pair waiting")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/mdm/golden/merge?pair=p1");
    // The trend reads the aggregate snapshot history of the last eight weeks.
    expect(history).toHaveBeenCalledWith({ days: 56 });
    expect(screen.getByText("Health over time")).toBeInTheDocument();
  });

  it("links the open stewardship tasks to the inbox", async () => {
    vi.spyOn(mdmApi, "getMdmDashboard").mockResolvedValue({ latest: metric, trend: [metric], active_systems_count: 4 });
    vi.spyOn(mdmApi, "getMdmHistory").mockResolvedValue({ history: [] });
    mockLists();
    renderWithQuery(<MdmOverviewPage />);
    const links = await screen.findAllByRole("link", { name: "38 stewardship tasks open" });
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toHaveAttribute("href", "/inbox");
  });

  it("draws the health score in the insight hero, with the target and verdict from the tenant's score bands", async () => {
    vi.spyOn(mdmApi, "getMdmDashboard").mockResolvedValue({ latest: metric, trend: [metric], active_systems_count: 4 });
    vi.spyOn(mdmApi, "getMdmHistory").mockResolvedValue({ history: [] });
    mockLists();
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "r1", objects: [], thresholds: { target: 95, warning: 80, critical: 60 } });
    renderWithQuery(<MdmOverviewPage />);
    const hero = await screen.findByRole("region", { name: "Insight" });
    expect(hero).toHaveClass("m-hero");
    // 86 is under the tenant's target of 95 and over its warning of 80: at risk, where a fixed 85 would say go.
    expect(await screen.findByText(/^Target 95,/)).toBeInTheDocument();
    expect(screen.getByTestId("hero-verdict")).toHaveTextContent("At risk");
  });

  it("counts the pairs Match review lists, across every band that is waiting", async () => {
    vi.spyOn(mdmApi, "getMdmDashboard").mockResolvedValue({ latest: metric, trend: [metric], active_systems_count: 4 });
    vi.spyOn(mdmApi, "getMdmHistory").mockResolvedValue({ history: [] });
    mockLists({ pairs: pairList([pair("p1"), pair("p2")], { auto_merge: 3, review: 2, low: 4 }) });
    renderWithQuery(<MdmOverviewPage />);
    expect(await screen.findByText("2 of 9 pairs waiting")).toBeInTheDocument();
  });

  it("reads the golden records count from the master records, not the daily snapshot", async () => {
    vi.spyOn(mdmApi, "getMdmDashboard").mockResolvedValue({ latest: { ...metric, golden_record_count: 0 }, trend: [metric], active_systems_count: 4 });
    vi.spyOn(mdmApi, "getMdmHistory").mockResolvedValue({ history: [] });
    mockLists({ golden: 40, all: 139190 });
    renderWithQuery(<MdmOverviewPage />);
    expect(await screen.findByText(/40 golden records of 139,190 master records/)).toBeInTheDocument();
  });

  it("says setup has not started, with the steps, instead of a red no-go", async () => {
    const empty: MdmMetric = { ...metric, golden_record_count: 0, golden_record_coverage_pct: 0, avg_match_confidence: 0, source_consistency_pct: 0, mdm_health_score: 20, backlog_count: 3 };
    vi.spyOn(mdmApi, "getMdmDashboard").mockResolvedValue({ latest: empty, trend: [empty], active_systems_count: 0 });
    vi.spyOn(mdmApi, "getMdmHistory").mockResolvedValue({ history: [] });
    mockLists({ golden: 0, all: 0 });
    renderWithQuery(<MdmOverviewPage />);
    expect(await screen.findByTestId("hero-verdict")).toHaveTextContent("Not started");
    expect(screen.queryByText("No-go")).toBeNull();
    expect(screen.getByRole("link", { name: "Set the match rules" })).toHaveAttribute("href", "/mdm/match-rules");
    expect(screen.getByRole("link", { name: "Set the survivorship rules" })).toHaveAttribute("href", "/mdm/survivorship");
  });

  it("prints the four inputs, which the API sends as fractions, as percents", async () => {
    vi.spyOn(mdmApi, "getMdmDashboard").mockResolvedValue({ latest: metric, trend: [metric], active_systems_count: 4 });
    vi.spyOn(mdmApi, "getMdmHistory").mockResolvedValue({ history: [] });
    mockLists();
    renderWithQuery(<MdmOverviewPage />);
    expect(await screen.findByText("100%")).toBeInTheDocument();
    for (const v of ["84%", "91%", "88%"]) expect(screen.getByText(v)).toBeInTheDocument();
    expect(screen.queryByText("1%")).toBeNull();
  });

  it("says so when no match work is open", async () => {
    vi.spyOn(mdmApi, "getMdmDashboard").mockResolvedValue({ latest: metric, trend: [metric], active_systems_count: 4 });
    vi.spyOn(mdmApi, "getMdmHistory").mockResolvedValue({ history: [] });
    mockLists();
    renderWithQuery(<MdmOverviewPage />);
    expect(await screen.findByText("No match work waiting")).toBeInTheDocument();
  });
});
