// frontend/design/templates/__tests__/FindingDrawer.test.tsx
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as findingsApi from "@/lib/api/findings";
import type { FindingDetailData } from "@/lib/api/findings";
import * as analyticsApi from "@/lib/api/analytics";
import { FindingDrawer } from "../FindingDrawer";

const finding: FindingDetailData = {
  id: "f1",
  version_id: "v1",
  module: "material_master",
  check_id: "mm_missing_desc",
  check_class: "null_check",
  severity: "high",
  dimension: "completeness",
  affected_count: 12,
  total_count: 100,
  pass_rate: 0.88,
  details: { message: "Description is blank." },
  remediation_text: "Populate MAKT-MAKTX for every affected material.",
  rule_context: {
    why_it_matters: "A missing description blocks procurement.",
    rule_authority: "sap_hard_constraint",
    sap_impact: "Purchase orders cannot be created.",
  },
  value_fix_map: null,
  record_fixes: null,
  created_at: "2026-01-01T00:00:00Z",
  context: null,
};

describe("FindingDrawer", () => {
  it("renders nothing when findingId is null", () => {
    renderWithQuery(<FindingDrawer findingId={null} onClose={() => {}} />);
    expect(screen.queryByText("What failed")).not.toBeInTheDocument();
  });

  it("renders every section for a found finding", async () => {
    vi.spyOn(findingsApi, "getFinding").mockResolvedValue(finding);
    vi.spyOn(analyticsApi, "getFindingImpact").mockResolvedValue({
      finding_id: "f1",
      finding,
      impacts: [
        { category: "procurement", annual_risk_zar: 50000, mitigated_zar: 0, finding_count: 12, calculation_method: "per-record" },
      ],
    });
    renderWithQuery(<FindingDrawer findingId="f1" versionId="v1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Description is blank.")).toBeInTheDocument());
    expect(screen.getByText(/12 of 100 records affected/i)).toBeInTheDocument();
    expect(screen.getByText("A missing description blocks procurement.")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getAllByText((_, node) => node?.tagName === "LI" && (node.textContent?.includes("at risk per year") ?? false)),
      ).toHaveLength(1),
    );
    expect(screen.getByText(/Populate MAKT-MAKTX/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open records" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open rule" })).toBeInTheDocument();
  });

  it("shows an empty state when the finding cannot be found", async () => {
    vi.spyOn(findingsApi, "getFinding").mockRejectedValue(new Error("Finding not found"));
    vi.spyOn(analyticsApi, "getFindingImpact").mockResolvedValue(null);
    renderWithQuery(<FindingDrawer findingId="missing" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/finding not found/i)).toBeInTheDocument());
  });

  it("shows a no-impact-model message when there is no impact data", async () => {
    vi.spyOn(findingsApi, "getFinding").mockResolvedValue(finding);
    vi.spyOn(analyticsApi, "getFindingImpact").mockResolvedValue(null);
    renderWithQuery(<FindingDrawer findingId="f1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/no impact model for this check/i)).toBeInTheDocument());
  });
});
