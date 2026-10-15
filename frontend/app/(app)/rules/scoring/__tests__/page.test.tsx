import { screen, waitFor } from "@testing-library/react";
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

  it("shows a retryable error when settings fail to load", async () => {
    vi.spyOn(settingsApi, "getSettings").mockRejectedValue(new Error("network down"));
    vi.spyOn(findingsApi, "getFindingsAggregate").mockResolvedValue(AGGREGATE);
    renderWithQuery(<ScoringPage />);
    await waitFor(() => expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument());
  });
});
