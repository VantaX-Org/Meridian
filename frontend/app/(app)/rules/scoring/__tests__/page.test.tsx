import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as settingsApi from "@/lib/api/settings";
import * as findingsApi from "@/lib/api/findings";
import type { TenantSettings } from "@/types/api";
import type { FindingsAggregate } from "@/lib/api/findings";
import ScoringPage, { toStored, weightPreview, withFeatureDraft, withSeverityDraft } from "../page";

const role = vi.hoisted(() => ({ write: true }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => role.write }) }));

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

const SCORING: settingsApi.ScoringResponse = {
  dimension_weights: { completeness: 0.25, accuracy: 0.25, consistency: 0.2, timeliness: 0.1, uniqueness: 0.1, validity: 0.1 },
  module_weights: { material_master: 2 },
  thresholds: { target: 90, warning: 75, critical: 60 },
  severity_weights: { critical: 4, high: 3, medium: 2, low: 1 },
  severity_multipliers: { critical: 2 },
  critical_tolerance: { critical: 0 },
  defaults: {
    dimension_weights: { completeness: 0.25, accuracy: 0.25, consistency: 0.2, timeliness: 0.1, uniqueness: 0.1, validity: 0.1 },
    module_weights: {}, thresholds: { target: 90, warning: 75, critical: 60 }, severity_weights: {}, severity_multipliers: {}, critical_tolerance: {},
  },
};

beforeEach(() => {
  role.write = true;
  vi.restoreAllMocks();
  vi.spyOn(settingsApi, "getScoring").mockResolvedValue(SCORING);
});

describe("rules scoring page", () => {
  it("is titled Scoring, links to Alerts and has no alert controls", async () => {
    vi.spyOn(settingsApi, "getSettings").mockResolvedValue(SETTINGS);
    vi.spyOn(findingsApi, "getFindingsAggregate").mockResolvedValue(AGGREGATE);
    renderWithQuery(<ScoringPage />);
    await screen.findByText("Dimension weights");
    expect(screen.getByRole("heading", { name: "Scoring" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Alerts" })).toHaveAttribute("href", "/admin/alerts");
    expect(screen.getByText("Score bands")).toBeInTheDocument();
    for (const gone of ["When to alert", "Reports by email and Teams", "Score floors per object", "Critical failing rules", "Save thresholds", "Save notifications", "Teams webhook"]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });

  it("renders the settings form once loaded", async () => {
    vi.spyOn(settingsApi, "getSettings").mockResolvedValue(SETTINGS);
    vi.spyOn(findingsApi, "getFindingsAggregate").mockResolvedValue(AGGREGATE);
    renderWithQuery(<ScoringPage />);
    expect(await screen.findByText("Dimension weights", undefined, { timeout: 5000 })).toBeInTheDocument();
    // the saved weights have nothing to preview: one score, and "No change" in place of a second, identical ruler
    await waitFor(() => expect(screen.getAllByText("88.5")).toHaveLength(1), { timeout: 12_000 });
    expect(screen.getByTestId("preview-unchanged")).toHaveTextContent("No change");
    expect(screen.getAllByTestId("score-hero")).toHaveLength(1);
    // Two queries then a form: under full-suite load this takes longer than the 5 s default.
  }, 25_000);

  it("saves weights through PUT /settings/scoring on the 100 scale, keeping the rest of the config", async () => {
    vi.spyOn(settingsApi, "getSettings").mockResolvedValue(SETTINGS);
    vi.spyOn(findingsApi, "getFindingsAggregate").mockResolvedValue(AGGREGATE);
    const save = vi.spyOn(settingsApi, "putScoring").mockResolvedValue();
    renderWithQuery(<ScoringPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Save weights" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const sent = save.mock.calls[0][0];
    expect(sent.dimension_weights.completeness).toBeCloseTo(25);
    expect(sent.dimension_weights.consistency).toBeCloseTo(20);
    expect(Object.values(sent.dimension_weights).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);
    expect(sent.module_weights).toEqual({ material_master: 2 });
    expect(sent.thresholds).toEqual({ target: 90, warning: 75, critical: 60 });
    expect(sent.severity_multipliers).toEqual({ critical: 2 });
  });

  it("saves the bands and refuses an order the API would reject", async () => {
    vi.spyOn(settingsApi, "getSettings").mockResolvedValue(SETTINGS);
    vi.spyOn(findingsApi, "getFindingsAggregate").mockResolvedValue(AGGREGATE);
    const save = vi.spyOn(settingsApi, "putScoring").mockResolvedValue();
    renderWithQuery(<ScoringPage />);
    fireEvent.change(await screen.findByLabelText("Warning"), { target: { value: "95" } });
    expect(screen.getByRole("button", { name: "Save bands" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Warning"), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: "Save bands" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0].thresholds).toEqual({ target: 90, warning: 80, critical: 60 });
    expect(save.mock.calls[0][0].dimension_weights).toEqual(SCORING.dimension_weights);
  });

  it("rounds weights to exactly 100 for the API", () => {
    const third = { completeness: 1 / 3, accuracy: 1 / 3, consistency: 1 / 3, timeliness: 0, uniqueness: 0, validity: 0 };
    expect(Object.values(toStored(third)).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 8);
  });

  it("reads the normalised weights from /settings/scoring and lets them be saved", async () => {
    vi.spyOn(settingsApi, "getSettings").mockResolvedValue(SETTINGS);
    vi.spyOn(settingsApi, "getScoring").mockResolvedValue({
      ...SCORING, dimension_weights: { completeness: 0.4, accuracy: 0.2, consistency: 0.2, timeliness: 0.1, uniqueness: 0.05, validity: 0.05 },
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
    // the saved weights: the figure is the same sum the contribution table prints (75), not the capped score now (70)
    expect(weightPreview(scores, saved, saved, 70)).toEqual({ value: 75, delta: 0, hint: "No change" });
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

describe("rules scoring page, caps and read-only", () => {
  const CAPPED: FindingsAggregate = {
    ...AGGREGATE,
    dqs: { composite: 71.8, raw: 79.8, capped: true, dimension_scores: { completeness: 87.4, accuracy: 85, consistency: 64.3, timeliness: 65.4, uniqueness: 86.3, validity: 86.4 }, modules: {} },
  };

  it("says that the contributions are before caps and why the score now is lower", async () => {
    vi.spyOn(settingsApi, "getSettings").mockResolvedValue(SETTINGS);
    vi.spyOn(findingsApi, "getFindingsAggregate").mockResolvedValue(CAPPED);
    renderWithQuery(<ScoringPage />);
    const note = await screen.findByTestId("caps-note");
    expect(note).toHaveTextContent("The contributions below add up to 79.8, the score before caps.");
    expect(note).toHaveTextContent("The score now is 71.8 because critical failures hold some objects at a cap");
    expect(screen.getByText("After caps. Before caps 79.8")).toBeInTheDocument();
  });

  it("draws the preview ruler only once a weight differs", async () => {
    vi.spyOn(settingsApi, "getSettings").mockResolvedValue({ ...SETTINGS });
    vi.spyOn(findingsApi, "getFindingsAggregate").mockResolvedValue(CAPPED);
    renderWithQuery(<ScoringPage />);
    fireEvent.change(await screen.findByLabelText("completeness weight"), { target: { value: "0.4" } });
    expect(await screen.findByText("With these weights, before caps")).toBeInTheDocument();
    expect(screen.queryByTestId("preview-unchanged")).toBeNull();
  });

  it("disables every input and offers no save when the settings are read only", async () => {
    role.write = false;
    vi.spyOn(settingsApi, "getSettings").mockResolvedValue(SETTINGS);
    vi.spyOn(findingsApi, "getFindingsAggregate").mockResolvedValue(CAPPED);
    renderWithQuery(<ScoringPage />);
    expect(await screen.findByText("These settings are read only for your role")).toBeInTheDocument();
    for (const name of ["completeness weight", "accuracy weight"]) expect(screen.getByLabelText(name)).toBeDisabled();
    expect(screen.getByLabelText("Warning")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save weights" })).toBeNull();
  });
});
