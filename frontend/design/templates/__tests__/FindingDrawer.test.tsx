// frontend/design/templates/__tests__/FindingDrawer.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as findingsApi from "@/lib/api/findings";
import type { FindingDetailData } from "@/lib/api/findings";
import * as analyticsApi from "@/lib/api/analytics";
import * as configApi from "@/lib/api/config-intelligence";
import * as exceptionsApi from "@/lib/api/exceptions";
import * as settingsApi from "@/lib/api/settings";
import { FindingDrawer } from "../FindingDrawer";
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

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
        { category: "procurement", annual_risk_zar: 50000, mitigated_zar: 0, finding_count: 12, calculation_method: "per-record", currency: "ZAR" },
      ],
    });
    // A EUR tenant: the buckets are priced in rand, so they print as ZAR, never relabelled with the tenant's currency.
    vi.spyOn(settingsApi, "getCostModel").mockResolvedValue({ currency: "EUR" } as Awaited<ReturnType<typeof settingsApi.getCostModel>>);
    renderWithQuery(<FindingDrawer findingId="f1" versionId="v1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Description is blank.")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/ZAR\s50,000 a year at risk/)).toBeInTheDocument());
    expect(screen.queryByText(/EUR/)).toBeNull();
    expect(screen.getByText(/12 of 100 records affected/i)).toBeInTheDocument();
    expect(screen.getByText("A missing description blocks procurement.")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getAllByText((_, node) => node?.tagName === "LI" && (node.textContent?.includes("a year at risk") ?? false)),
      ).toHaveLength(1),
    );
    expect(screen.queryByText(/per-record/)).toBeNull();
    expect(screen.getByText(/Populate MAKT-MAKTX/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open records" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open rule" })).toBeInTheDocument();
  });

  it("prints sample records as a field and value table", async () => {
    vi.spyOn(findingsApi, "getFinding").mockResolvedValue({ ...finding, details: { message: "Description is blank.", sample_failing_records: [{ MATNR: "100001", MAKTX: null }] } });
    vi.spyOn(analyticsApi, "getFindingImpact").mockResolvedValue(null);
    renderWithQuery(<FindingDrawer findingId="f1" versionId="v1" onClose={() => {}} />);
    expect(await screen.findByText("MATNR")).toBeInTheDocument();
    expect(screen.getByText("100001")).toBeInTheDocument();
    expect(screen.getByText("MAKTX")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Field" })).toBeInTheDocument();
    expect(screen.queryByText(/\{"MATNR"/)).toBeNull();
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

  it("shows the root cause when the finding has one", async () => {
    vi.spyOn(findingsApi, "getFinding").mockResolvedValue(finding);
    vi.spyOn(analyticsApi, "getFindingImpact").mockResolvedValue(null);
    const rc = vi.spyOn(configApi, "getConfigRootCause").mockResolvedValue({
      finding_id: "mm_missing_desc",
      root_cause_type: "bad_data_and_config",
      data_issue: "Value not found in configuration inventory",
      config_issue: "Configuration issue, review SPRO settings",
      process_issue: null,
      recommendation: "Review both configuration and process completeness",
    });
    renderWithQuery(<FindingDrawer findingId="f1" versionId="v1" onClose={() => {}} />);
    expect(await screen.findByText("Bad data and bad configuration")).toBeInTheDocument();
    expect(screen.getByText("Value not found in configuration inventory")).toBeInTheDocument();
    expect(screen.getByText("Review both configuration and process completeness")).toBeInTheDocument();
    expect(rc).toHaveBeenCalledWith("mm_missing_desc", "v1");
  });

  it("omits the root cause section when the finding has none", async () => {
    vi.spyOn(findingsApi, "getFinding").mockResolvedValue(finding);
    vi.spyOn(analyticsApi, "getFindingImpact").mockResolvedValue(null);
    vi.spyOn(configApi, "getConfigRootCause").mockRejectedValue(new Error("404"));
    renderWithQuery(<FindingDrawer findingId="f1" versionId="v1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/no impact model for this check/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByTestId("root-cause")).not.toBeInTheDocument());
  });

  it("raises an exception linked to the finding and then links to it", async () => {
    vi.spyOn(findingsApi, "getFinding").mockResolvedValue(finding);
    vi.spyOn(analyticsApi, "getFindingImpact").mockResolvedValue({ finding_id: "f1", finding, impacts: [] });
    const create = vi.spyOn(exceptionsApi, "createException").mockResolvedValue({ id: "e9", status: "open" });
    renderWithQuery(<FindingDrawer findingId="f1" versionId="v1" onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Raise exception" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      type: "dq_rule", severity: "high", linked_finding_id: "f1", title: "mm_missing_desc fails on 12 records",
    })));
    expect(await screen.findByRole("link", { name: "Open exception" })).toHaveAttribute("href", "/inbox?kind=exception&focus=e9");
  });
});
