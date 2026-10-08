import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as lineageApi from "@/lib/api/lineage";
import * as versionsApi from "@/lib/api/versions";
import LineagePage from "../page";

const LATEST = {
  id: "v1", label: "Run 1", status: "complete", run_at: "2026-01-01T00:00:00Z",
  dqs_summary: { material_master: 90 },
};

describe("LineagePage", () => {
  it("renders the model summary and impact rows", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [LATEST as never] });
    vi.spyOn(lineageApi, "getLineageModel").mockResolvedValue({
      model_version: 3, node_counts: {}, edge_count: 120, kpis: [], processes: [], features: [], warnings: [],
    });
    vi.spyOn(lineageApi, "getLineageImpact").mockResolvedValue({
      version_id: "v1", model_version: 3, cost_available: false,
      kpis: [{ id: "kpi:dpo", type: "kpi", label: "DPO", findings: 2, check_ids: ["AP017"], records_affected: 40, max_records: 30, worst_severity: "high", worst_impact: "degraded", min_hops: 2 }],
      processes: [], features: [], unmapped_checks: [],
    });
    vi.spyOn(lineageApi, "getLineage").mockResolvedValue({
      start: "LFB1.ZTERM", model_version: 3, nodes: [], edges: [], paths_to_kpis: [],
    });
    renderWithQuery(<LineagePage />);
    await waitFor(() => expect(lineageApi.getLineageImpact).toHaveBeenCalled());
  });

  it("shows an empty state when the model has no linked nodes for the trace", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [LATEST as never] });
    vi.spyOn(lineageApi, "getLineageModel").mockResolvedValue({
      model_version: 1, node_counts: {}, edge_count: 0, kpis: [], processes: [], features: [], warnings: [],
    });
    vi.spyOn(lineageApi, "getLineageImpact").mockResolvedValue({
      version_id: "v1", model_version: 1, cost_available: false, kpis: [], processes: [], features: [], unmapped_checks: [],
    });
    vi.spyOn(lineageApi, "getLineage").mockResolvedValue({
      start: "LFB1.ZTERM", model_version: 1, nodes: [], edges: [], paths_to_kpis: [],
    });
    renderWithQuery(<LineagePage />);
    await waitFor(() => expect(lineageApi.getLineage).toHaveBeenCalled());
  });

  it("shows the API error message for the lineage model and retries on click", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [LATEST as never] });
    vi.spyOn(lineageApi, "getLineageModel").mockRejectedValue(new Error("lineage model service unavailable"));
    renderWithQuery(<LineagePage />);
    await screen.findByText("lineage model service unavailable");
    const calls = (lineageApi.getLineageModel as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect((lineageApi.getLineageModel as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls));
  });
});
