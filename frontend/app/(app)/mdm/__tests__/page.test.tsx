import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as analyticsApi from "@/lib/api/analytics";
import * as mdmApi from "@/lib/api/mdm-metrics";
import * as stewardshipApi from "@/lib/api/stewardship";
import * as objectsApi from "@/lib/api/v1/objects";
import type { MdmMetric, StewardshipQueueItem } from "@/types/api";
import MdmOverviewPage from "../page";

const metric: MdmMetric = {
  snapshot_date: "2026-10-01", domain: null, golden_record_count: 12480, golden_record_coverage_pct: 84, avg_match_confidence: 0.91,
  steward_sla_compliance_pct: 97, source_consistency_pct: 88, mdm_health_score: 86, backlog_count: 38, sync_coverage_pct: 75,
  ai_narrative: null, ai_projected_score: null, ai_risk_flags: null,
};

describe("MdmOverviewPage", () => {
  it("shows the health figure with its four inputs, then the match work ledger with an Open action", async () => {
    vi.spyOn(mdmApi, "getMdmDashboard").mockResolvedValue({ latest: metric, trend: [metric], active_systems_count: 4 });
    vi.spyOn(analyticsApi, "getMdmHealth").mockResolvedValue({ data: [{ snapshot_date: "2026-10-01", mdm_health_score: 86 }] } as Awaited<ReturnType<typeof analyticsApi.getMdmHealth>>);
    vi.spyOn(stewardshipApi, "getQueueItems").mockImplementation(async (f = {}) => (f.status !== "open" ? { items: [], total: 0 } : { items: [{ id: "q1", tenant_id: "t", item_type: "merge_decision", source_id: "s", domain: "material_master", priority: 1, due_at: null, assigned_to: null, status: "open", sla_hours: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ai_recommendation: null, ai_confidence: null }], total: 1 }));
    renderWithQuery(<MdmOverviewPage />);
    expect(await screen.findByText("MDM health")).toBeInTheDocument();
    for (const label of ["Coverage", "Match confidence", "Steward SLA", "Source consistency"]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("12,480 golden records, 38 waiting on a steward")).toBeInTheDocument();
    expect(await screen.findByText("Match work")).toBeInTheDocument();
    expect(await screen.findByText("Merge decision")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/inbox?type=merge_decision&focus=q1");
  });

  it("draws the health score in the insight hero, with the target and verdict from the tenant's score bands", async () => {
    vi.spyOn(mdmApi, "getMdmDashboard").mockResolvedValue({ latest: metric, trend: [metric], active_systems_count: 4 });
    vi.spyOn(analyticsApi, "getMdmHealth").mockResolvedValue({ data: [], days: 90 });
    vi.spyOn(stewardshipApi, "getQueueItems").mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "r1", objects: [], thresholds: { target: 95, warning: 80, critical: 60 } });
    renderWithQuery(<MdmOverviewPage />);
    const hero = await screen.findByRole("region", { name: "Insight" });
    expect(hero).toHaveClass("m-hero");
    // 86 is under the tenant's target of 95 and over its warning of 80: at risk, where a fixed 85 would say go.
    expect(await screen.findByText("Target 95, 38 waiting on a steward")).toBeInTheDocument();
    expect(screen.getByTestId("hero-verdict")).toHaveTextContent("At risk");
  });

  it("counts only merge decisions, in every status the inbox treats as live", async () => {
    vi.spyOn(mdmApi, "getMdmDashboard").mockResolvedValue({ latest: metric, trend: [metric], active_systems_count: 4 });
    vi.spyOn(analyticsApi, "getMdmHealth").mockResolvedValue({ data: [], days: 90 });
    const item: StewardshipQueueItem = { id: "q1", tenant_id: "t", item_type: "merge_decision", source_id: "s", domain: "material_master", priority: 1, due_at: null, assigned_to: null, status: "open", sla_hours: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ai_recommendation: null, ai_confidence: null };
    const spy = vi.spyOn(stewardshipApi, "getQueueItems").mockImplementation(async (f = {}) => (
      f.status === "escalated" ? { items: [{ ...item, id: "q2", status: "escalated" as const }], total: 2 } : f.status === "in_progress" ? { items: [], total: 3 } : { items: [item], total: 4 }
    ));
    renderWithQuery(<MdmOverviewPage />);
    expect(await screen.findByText("2 of 9 waiting")).toBeInTheDocument();
    for (const status of ["open", "in_progress", "escalated"]) expect(spy).toHaveBeenCalledWith(expect.objectContaining({ item_type: "merge_decision", status }));
    expect(screen.getByText("Escalated")).toBeInTheDocument();
  });

  it("says so when no match work is open", async () => {
    vi.spyOn(mdmApi, "getMdmDashboard").mockResolvedValue({ latest: metric, trend: [metric], active_systems_count: 4 });
    vi.spyOn(analyticsApi, "getMdmHealth").mockResolvedValue({ data: [], days: 90 });
    vi.spyOn(stewardshipApi, "getQueueItems").mockResolvedValue({ items: [], total: 0 });
    renderWithQuery(<MdmOverviewPage />);
    expect(await screen.findByText("No match work waiting")).toBeInTheDocument();
  });
});
