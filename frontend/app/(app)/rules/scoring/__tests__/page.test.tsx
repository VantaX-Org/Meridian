import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as settingsApi from "@/lib/api/settings";
import * as findingsApi from "@/lib/api/findings";
import type { TenantSettings } from "@/types/api";
import type { FindingsAggregate } from "@/lib/api/findings";
import ScoringPage, { weightPreview, withFeatureDraft, withSeverityDraft } from "../page";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

const SETTINGS: TenantSettings = {
  name: "Acme",
  licensed_modules: ["material_master"],
  planner_config: null,
  dqs_weights: null,
  alert_thresholds: null,
  notification_config: null,
  stripe_customer_id: null,
};

const AGGREGATE: FindingsAggregate = {
  version_ids: ["v1"],
  total: 10,
  affected_records: 5,
  severity: { critical: 0, high: 1, medium: 2, low: 3 },
  by_module: [],
  by_dimension: [],
  avg_pass_rate: 0.9,
  dqs: { composite: 88.5, dimension_scores: { completeness: 90, accuracy: 85 }, modules: {} },
  previous_dqs: null,
};

describe("rules scoring page", () => {
  it("renders the settings form once loaded", async () => {
    vi.spyOn(settingsApi, "getSettings").mockResolvedValue(SETTINGS);
    vi.spyOn(findingsApi, "getFindingsAggregate").mockResolvedValue(AGGREGATE);
    renderWithQuery(<ScoringPage />);
    expect(await screen.findByText("Dimension weights", undefined, { timeout: 5000 })).toBeInTheDocument();
    // the saved weights preview as the score now, unchanged: no phantom delta on first load
    // both numerals count up from 0, so wait until both have settled
    await waitFor(() => expect(screen.getAllByText("88.5")).toHaveLength(2), { timeout: 5000 });
    expect(screen.getByText("No change")).toBeInTheDocument();
    // Two queries then a form: under full-suite load this takes longer than the 5 s default.
  }, 15_000);

  it("saves weights on the 100 scale the API stores", async () => {
    vi.spyOn(settingsApi, "getSettings").mockResolvedValue(SETTINGS);
    vi.spyOn(findingsApi, "getFindingsAggregate").mockResolvedValue(AGGREGATE);
    const save = vi.spyOn(settingsApi, "updateDqsWeights").mockResolvedValue();
    renderWithQuery(<ScoringPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Save weights" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const sent = save.mock.calls[0][0];
    expect(sent.completeness).toBeCloseTo(25);
    expect(sent.consistency).toBeCloseTo(20);
    expect(Object.values(sent).reduce((a, b) => a + b, 0)).toBeCloseTo(100);
  });

  it("reads stored weights that sum to 100 as fractions and lets them be saved", async () => {
    vi.spyOn(settingsApi, "getSettings").mockResolvedValue({
      ...SETTINGS,
      dqs_weights: { completeness: 40, accuracy: 20, consistency: 20, timeliness: 10, uniqueness: 5, validity: 5 },
    });
    vi.spyOn(findingsApi, "getFindingsAggregate").mockResolvedValue(AGGREGATE);
    renderWithQuery(<ScoringPage />);
    expect(await screen.findByLabelText("completeness weight")).toHaveValue(0.4);
    expect(screen.getByText("Sums to one")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save weights" })).toBeEnabled();
  });

  it("adds the severity cost fields from the empty cost model and saves them", async () => {
    vi.spyOn(settingsApi, "getSettings").mockResolvedValue(SETTINGS);
    vi.spyOn(findingsApi, "getFindingsAggregate").mockResolvedValue(AGGREGATE);
    vi.spyOn(settingsApi, "getCostModel").mockResolvedValue({ currency: "ZAR", severity: {}, modules: {}, rules: {}, features: {} });
    const save = vi.spyOn(settingsApi, "updateCostModel").mockResolvedValue();
    renderWithQuery(<ScoringPage />);
    const empty = (await screen.findByText("No severity costs set")).closest("[data-state='empty']") as HTMLElement;
    expect(screen.queryByRole("button", { name: "Save cost model" })).toBeNull();
    fireEvent.click(within(empty).getByRole("button", { name: "Add severity costs" }));
    const critical = await screen.findByLabelText("Critical finding cost");
    expect(screen.getByLabelText("Low finding cost")).toHaveValue(0);
    fireEvent.change(critical, { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Save cost model" }));
    // the API stores cost specs, never bare numbers
    await waitFor(() => expect(save).toHaveBeenCalledWith({
      currency: "ZAR", severity: { critical: { per_record: 500 }, high: { per_record: 0 }, medium: { per_record: 0 }, low: { per_record: 0 } },
      modules: {}, rules: {}, features: {},
    }));
  });

  it("gives an SAP feature a value per blocked record and saves it with the cost model", async () => {
    vi.spyOn(settingsApi, "getSettings").mockResolvedValue(SETTINGS);
    vi.spyOn(findingsApi, "getFindingsAggregate").mockResolvedValue(AGGREGATE);
    vi.spyOn(settingsApi, "getCostModel").mockResolvedValue({
      currency: "ZAR", severity: { critical: { per_record: 500 } }, modules: {}, rules: {}, features: { MIGO: 150 },
    });
    vi.spyOn(settingsApi, "getCostModelFeatures").mockResolvedValue([{ feature: "MIGO", l1: "procure_to_pay" }, { feature: "VA01", l1: "order_to_cash" }]);
    const save = vi.spyOn(settingsApi, "updateCostModel").mockResolvedValue();
    renderWithQuery(<ScoringPage />);
    const migo = await screen.findByLabelText("MIGO value per record");
    expect(migo).toHaveValue(150);
    fireEvent.change(migo, { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Save cost model" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({
      currency: "ZAR", severity: { critical: { per_record: 500 } }, modules: {}, rules: {}, features: { MIGO: 200 },
    }));
  });

  it("previews reweighted scores without a cap and compares like with like", () => {
    const scores = { completeness: 90, accuracy: 60 };
    const saved = { completeness: 0.5, accuracy: 0.5, consistency: 0, timeliness: 0, uniqueness: 0, validity: 0 };
    expect(weightPreview(scores, saved, saved, 70)).toEqual({ value: 70, delta: 0, hint: "No change" });
    const next = { ...saved, completeness: 0.75, accuracy: 0.25 };
    // 82.5 against 75 before caps, even though the score now (70) is capped
    expect(weightPreview(scores, saved, next, 70)).toEqual({ value: 82.5, delta: 7.5, hint: "Up 7.5 points before caps" });
    expect(weightPreview(scores, saved, next, null).hint).toBe("Needs a scored run");
  });

  it("lays drafts over the stored cost specs and feature values", () => {
    expect(withSeverityDraft({ high: { per_record: 1, factor: 2 }, low: { per_record: 3 } }, { high: 5 })).toEqual({ high: { per_record: 5, factor: 2 }, low: { per_record: 3 } });
    expect(withFeatureDraft({ MIGO: 1, VA01: 2 }, { MIGO: null, ME21N: 4 })).toEqual({ VA01: 2, ME21N: 4 });
  });

  it("shows a retryable error when settings fail to load", async () => {
    vi.spyOn(settingsApi, "getSettings").mockRejectedValue(new Error("network down"));
    vi.spyOn(findingsApi, "getFindingsAggregate").mockResolvedValue(AGGREGATE);
    renderWithQuery(<ScoringPage />);
    await waitFor(() => expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument());
  });
});
