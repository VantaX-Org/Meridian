import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as analytics from "@/lib/api/v2/analytics";
import * as insights from "@/lib/api/v2/insights";
import * as records from "@/lib/api/v2/object-records";
import { DuplicateCluster, ImpactPortfolio, MdmHealthScorecard, RecordSheetFallback, SprintPlanner } from "../screens/ExtraPanels";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const snap = (over: Partial<analytics.MdmHealthSnapshot> = {}): analytics.MdmHealthSnapshot => ({
  snapshot_date: "2026-11-07", mdm_health_score: 84.2, golden_record_coverage_pct: 67, avg_match_confidence: 0.88,
  steward_sla_compliance_pct: 93, source_consistency_pct: 94, backlog_count: 450,
  ai_projected_score: null, ai_narrative: null, ai_risk_flags: null, ...over,
});

describe("extra panels", () => {
  it("says the Aletheia projection is missing when the ai fields are null", async () => {
    vi.spyOn(analytics, "getMdmHealthSeries").mockResolvedValue({ data: [snap()], days: 56 });
    renderWithQuery(<MdmHealthScorecard />);
    expect(await screen.findByTestId("mdm-aletheia")).toHaveTextContent("The Aletheia projection is not available to your role or has not been computed.");
  });

  it("shows the Aletheia projection when it is present", async () => {
    vi.spyOn(analytics, "getMdmHealthSeries").mockResolvedValue({ data: [snap({ ai_projected_score: 86.5, ai_narrative: "Backlog is falling." })], days: 56 });
    renderWithQuery(<MdmHealthScorecard />);
    expect(await screen.findByText("Backlog is falling.")).toBeInTheDocument();
  });

  it("says so when the impact list is empty", async () => {
    vi.spyOn(analytics, "getImpactPortfolio").mockResolvedValue({ impacts: [], roi: { subscription_annual: 0, risk_mitigated: 0, roi_multiple: 0, payback_months: 0, currency: "ZAR" } } as unknown as analytics.ImpactPortfolio);
    renderWithQuery(<ImpactPortfolio categoryName={() => undefined} />);
    expect(await screen.findByTestId("val-portfolio")).toBeInTheDocument();
  });

  it("re-reads the plan when the sprint hours change", async () => {
    const spy = vi.spyOn(analytics, "getSprintPlan");
    renderWithQuery(<SprintPlanner />);
    const sel = await screen.findByTestId("fc-sprint-hours");
    fireEvent.change(sel, { target: { value: "80" } });
    await waitFor(() => expect(spy).toHaveBeenCalledWith(80));
  });

  it("shows the duplicate cluster pairs with their match score", async () => {
    renderWithQuery(<DuplicateCluster object="business_partner" recordId="100234" />);
    expect(await screen.findByText("0.93")).toBeInTheDocument();
  });

  it("hides the duplicate cluster when the record has none", async () => {
    vi.spyOn(insights, "getDuplicateCluster").mockRejectedValue(Object.assign(new Error("none"), { status: 404 }));
    const { container } = renderWithQuery(<DuplicateCluster object="business_partner" recordId="x" />);
    await waitFor(() => expect(insights.getDuplicateCluster).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector("[data-testid=record-cluster]")).toBeNull());
  });

  it("falls back to the not-found text when the record sheet is missing", async () => {
    vi.spyOn(records, "getRecordSheet").mockRejectedValue(Object.assign(new Error("none"), { status: 404 }));
    vi.spyOn(records, "getRecordFindings").mockRejectedValue(Object.assign(new Error("none"), { status: 404 }));
    renderWithQuery(<RecordSheetFallback object="material_master" recordKey="MATNR=1" notFound="Nothing here." />);
    expect(await screen.findByText("Nothing here.")).toBeInTheDocument();
  });
});
