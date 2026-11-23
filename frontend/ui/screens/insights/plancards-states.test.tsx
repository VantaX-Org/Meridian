import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import * as analytics from "@/lib/api/v2/analytics";
import { QueueCards } from "./MonitorSeries";
import { PlanCard } from "./PlanCards";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
vi.mock("@/lib/api/v2/analytics", async (orig) => ({
  ...(await orig<typeof analytics>()),
  getPrescriptive: vi.fn(), getSprintPlan: vi.fn(), getBottlenecks: vi.fn(), getCapacity: vi.fn(),
}));

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.history.replaceState(null, "", "/insights/forecast"); });
afterEach(() => { undo(); vi.clearAllMocks(); });

const plan = { actions: [], total_actions: 0, sprints: [], assumptions: { minutes_per_record: 1, investigation_hours: 2, sprint_hours: 40, cost_per_record: null, currency: "ZAR" }, basis: { version_id: null, findings: 0, cleaning_items: 0, exceptions: 0 } };

describe("plan and queue states", () => {
  it("shows the empty state when no work is open", async () => {
    vi.mocked(analytics.getPrescriptive).mockResolvedValue(plan);
    vi.mocked(analytics.getSprintPlan).mockResolvedValue({ sprints: [], total_actions: 0, assumptions: {} });
    renderWithQuery(<PlanCard />);
    expect(await screen.findByText("No open work")).toBeTruthy();
    expect(await screen.findByText("No sprints to plan")).toBeTruthy();
  });

  it("shows an error and retries the read", async () => {
    vi.mocked(analytics.getPrescriptive).mockRejectedValueOnce(new Error("down")).mockResolvedValue(plan);
    vi.mocked(analytics.getSprintPlan).mockResolvedValue({ sprints: [], total_actions: 0, assumptions: {} });
    renderWithQuery(<PlanCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No open work")).toBeTruthy();
    expect(vi.mocked(analytics.getPrescriptive)).toHaveBeenCalledTimes(2);
  });

  it("says why capacity cannot be worked out and shows an empty queue", async () => {
    vi.mocked(analytics.getBottlenecks).mockResolvedValue({ bottlenecks: [], total_queue_size: 0 });
    vi.mocked(analytics.getCapacity).mockResolvedValue({ needed: null, current: 0, surplus_deficit: null, daily_inflow: null, per_steward: null, reason: "no_inflow" });
    renderWithQuery(<QueueCards />);
    expect(await screen.findByText("No stage is stuck")).toBeTruthy();
    expect(await screen.findByText("No inflow is recorded, so the need cannot be worked out.")).toBeTruthy();
  });

  it("shows an error for the queue and retries", async () => {
    vi.mocked(analytics.getBottlenecks).mockRejectedValueOnce(new Error("down")).mockResolvedValue({ bottlenecks: [], total_queue_size: 0 });
    vi.mocked(analytics.getCapacity).mockResolvedValue({ needed: 1, current: 1, surplus_deficit: 0, daily_inflow: 5, per_steward: 5 });
    renderWithQuery(<QueueCards />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No stage is stuck")).toBeTruthy();
  });
});
