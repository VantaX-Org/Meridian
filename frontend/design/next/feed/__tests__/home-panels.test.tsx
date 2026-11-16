// The landscape panels ported from the v2 home: go-live, cleaned and watched, readiness matrix, fix pipeline and
// value at risk, each with its loading, empty and error-with-retry states.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import type { Landscape, LandscapeCell } from "@/lib/api/v2/types";

const h = vi.hoisted(() => ({
  money: {} as Record<string, unknown>,
  work: {} as Record<string, unknown>,
  back: vi.fn(),
}));

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/v2/step9-queries", async (orig) => ({ ...(await orig<object>()), useMoney: () => h.money }));
vi.mock("@/lib/v2/work-queries", async (orig) => ({ ...(await orig<object>()), useWorkSummary: () => h.work }));
vi.mock("@/lib/v2/runs-queries", async (orig) => ({ ...(await orig<object>()), useTimeline: () => ({ data: { runs: [] } }) }));
vi.mock("@/lib/api/remediation", async (orig) => ({ ...(await orig<object>()), getBackAfterClean: () => h.back() }));

import { AutoCleanedCard, FixPipelineCard, GoLiveCard, ReadinessCard, RiskWaterfallCard } from "../HomePanels";

const cell = (module: string, verdict: LandscapeCell["verdict"], score: number): LandscapeCell => ({
  system_id: "s1", module, run_id: "r1", score, raw_score: score, capped: false, cap_level: null, breaches: [], verdict,
  coverage: 1, low_confidence: false, records_checked: 100, rules_measured: 10, open_work: 5,
  dimensions: {} as LandscapeCell["dimensions"],
});
const landscape = {
  systems: [{ id: "s1", name: "KMP", system_type: "ecc", client: "300" }],
  objects: [{ module: "material_master", label: "Material master" }, { module: "sd_customer_master", label: "Customer master" }],
  cells: [cell("material_master", "no-go", 60), cell("sd_customer_master", "go", 95)],
} as unknown as Landscape;

const money = (over: object = {}) => ({
  isLoading: false, isError: false, refetch: vi.fn(),
  data: {
    scope: "landscape", id: null, as_of: "2026-11-10", currency: "EUR", cost_model: true,
    features: [
      { feature: "MRP run", system_id: "s1", system: "KMP", run_id: "r1", status: "blocked", blocking_rules: [], modules: ["material_master"], records: 10, value_per_record_month: 1, opportunity_cost_per_month: 5000, first_blocked_at: null, months_blocked: 1, cumulative_cost: 5000 },
      { feature: "Credit check", system_id: "s1", system: "KMP", run_id: "r1", status: "degraded", blocking_rules: [], modules: [], records: 1, value_per_record_month: 1, opportunity_cost_per_month: 0, first_blocked_at: null, months_blocked: 0, cumulative_cost: 0 },
    ],
    totals: { opportunity_cost_per_month: 5000, cumulative_cost: 5000, features_blocked: 1, features_degraded: 1 },
    ranking: { waves: [], objects: [{ id: "material_master", name: "Material master", value_unblocked_per_month: 5000, features: 1 }] },
  },
  ...over,
});

beforeEach(() => {
  h.money = money();
  h.work = { isLoading: false, isError: false, refetch: vi.fn(), data: { totals: { records: 0, open: 3, issues: 0, critical: 2, proposed: 0, overdue: 0 }, objects: [{ module: "material_master", records: 10, open: 3, issues: 3, critical: 2, proposed: 1, overdue: 0, statuses: { to_fix: 2, proposed: 1 } }] } };
  h.back.mockReset().mockResolvedValue({ weeks: [{ week: "W1", back: 1, fixed: 40 }, { week: "W2", back: 3, fixed: 12 }], rules: [], batches: [] });
});

describe("GoLiveCard", () => {
  it("names the blockers, the cost of waiting and the critical issues", () => {
    renderWithQuery(<GoLiveCard landscape={landscape} waves={[]} />);
    expect(screen.getByText("1 objects block go-live: Material master")).toBeTruthy();
    expect(screen.getByText("no date set")).toBeTruthy();
    expect(screen.getByText("Fix 1 blockers")).toBeTruthy();
    expect(screen.getByText("Clear 2 critical issues")).toBeTruthy();
  });
  it("says when the cost or the critical count could not be loaded", () => {
    h.money = { isError: true, data: undefined };
    renderWithQuery(<GoLiveCard landscape={landscape} waves={[]} />);
    expect(screen.getByTestId("golive-partial")).toBeTruthy();
    expect(screen.getByText("no cost model")).toBeTruthy();
  });
});

describe("AutoCleanedCard", () => {
  it("shows what was fixed and what came back", async () => {
    renderWithQuery(<AutoCleanedCard />);
    expect(await screen.findByText("52 fixed in 2 weeks; 3 failed again this week and were reopened.")).toBeTruthy();
    expect(screen.getByText("Open monitoring")).toBeTruthy();
  });
  it("offers a retry when the record cannot be read", async () => {
    h.back.mockRejectedValue(new Error("down"));
    renderWithQuery(<AutoCleanedCard />);
    const retry = await screen.findByRole("button", { name: "Retry" });
    h.back.mockResolvedValue({ weeks: [{ week: "W1", back: 0, fixed: 4 }], rules: [], batches: [] });
    fireEvent.click(retry);
    expect(await screen.findByText("Open monitoring")).toBeTruthy();
  });
});

describe("ReadinessCard", () => {
  it("lists every object with its code, verdict and value at risk", () => {
    renderWithQuery(<ReadinessCard landscape={landscape} />);
    expect(screen.getByTestId("home-readiness")).toBeTruthy();
    expect(screen.getAllByText("material_master").length).toBeGreaterThan(0);
    expect(screen.getAllByText("not measured").length).toBeGreaterThan(0);
  });
});

describe("FixPipelineCard", () => {
  it("shows the records at each step", () => {
    renderWithQuery(<FixPipelineCard landscape={landscape} />);
    expect(screen.getByRole("img", { name: /To fix 2, Waiting for approval 1/ })).toBeTruthy();
  });
  it("retries when the work cannot be read", () => {
    const refetch = vi.fn();
    h.work = { isLoading: false, isError: true, error: null, refetch };
    renderWithQuery(<FixPipelineCard landscape={landscape} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });
  it("says nothing is open", () => {
    h.work = { isLoading: false, isError: false, data: { totals: {}, objects: [] } };
    renderWithQuery(<FixPipelineCard landscape={landscape} />);
    expect(screen.getByText("nothing open")).toBeTruthy();
  });
});

describe("RiskWaterfallCard", () => {
  it("lists only features with a cost, and the total", () => {
    renderWithQuery(<RiskWaterfallCard />);
    expect(screen.getByText("MRP run")).toBeTruthy();
    expect(screen.queryByText("Credit check")).toBeNull();
    expect(screen.getByText("Total a month")).toBeTruthy();
  });
  it("says when there is no cost model", () => {
    h.money = money({ data: { ...money().data, cost_model: false } });
    renderWithQuery(<RiskWaterfallCard />);
    expect(screen.getByText("No cost model is set up.")).toBeTruthy();
  });
  it("shows a skeleton while loading", () => {
    h.money = { isLoading: true };
    renderWithQuery(<RiskWaterfallCard />);
    expect(screen.getByText("Reading the cost model")).toBeTruthy();
  });
});
