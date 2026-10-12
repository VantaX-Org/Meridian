import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as analyticsApi from "@/lib/api/analytics";
import * as mdmApi from "@/lib/api/mdm-metrics";
import * as stewardshipApi from "@/lib/api/stewardship";
import type { MdmMetric } from "@/types/api";
import MdmOverviewPage from "../page";

const metric: MdmMetric = {
  snapshot_date: "2026-10-01", domain: null, golden_record_count: 12480, golden_record_coverage_pct: 84, avg_match_confidence: 0.91,
  steward_sla_compliance_pct: 97, source_consistency_pct: 88, mdm_health_score: 86, backlog_count: 38, sync_coverage_pct: 75,
  ai_narrative: null, ai_projected_score: null, ai_risk_flags: null,
};

describe("MdmOverviewPage", () => {
  it("shows the stat tiles and the two queue panels, with a one-line empty for no clusters", async () => {
    vi.spyOn(mdmApi, "getMdmDashboard").mockResolvedValue({ latest: metric, trend: [metric], active_systems_count: 4 });
    vi.spyOn(analyticsApi, "getMdmHealth").mockResolvedValue({ data: [{ snapshot_date: "2026-10-01", mdm_health_score: 86 }] } as Awaited<ReturnType<typeof analyticsApi.getMdmHealth>>);
    vi.spyOn(stewardshipApi, "getQueueItems").mockImplementation(async (f) =>
      f?.item_type === "merge_decision"
        ? { items: [], total: 0 }
        : { items: [{ id: "q1", tenant_id: "t", item_type: "exception", source_id: "s", domain: "material_master", priority: 1, due_at: null, assigned_to: null, status: "open", sla_hours: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ai_recommendation: null, ai_confidence: null }], total: 1 });
    renderWithQuery(<MdmOverviewPage />);
    await waitFor(() => expect(screen.getByText("Golden records")).toBeInTheDocument());
    expect(screen.getByText("Sync coverage")).toBeInTheDocument();
    expect(screen.getByText("Active systems")).toBeInTheDocument();
    expect(await screen.findByText("Stewardship queue")).toBeInTheDocument();
    expect(await screen.findByText("No match clusters awaiting review.")).toBeInTheDocument();
    expect(screen.getByText("exception")).toBeInTheDocument();
  });
});
