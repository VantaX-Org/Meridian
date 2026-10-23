import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as settingsApi from "@/lib/api/settings";
import * as findingsApi from "@/lib/api/findings";
import type { TenantSettings } from "@/types/api";
import type { FindingsAggregate } from "@/lib/api/findings";
import ScoringPage from "../page";

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
    await waitFor(() => expect(screen.getByText("Dimension weights")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("88.5")).toBeInTheDocument());
  });

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
    await waitFor(() => expect(save).toHaveBeenCalledWith({
      currency: "ZAR", severity: { critical: 500, high: 0, medium: 0, low: 0 }, modules: {}, rules: {}, features: {},
    }));
  });

  it("shows a retryable error when settings fail to load", async () => {
    vi.spyOn(settingsApi, "getSettings").mockRejectedValue(new Error("network down"));
    vi.spyOn(findingsApi, "getFindingsAggregate").mockResolvedValue(AGGREGATE);
    renderWithQuery(<ScoringPage />);
    await waitFor(() => expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument());
  });
});
