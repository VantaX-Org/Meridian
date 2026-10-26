import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as analytics from "@/lib/api/analytics";
import type { NextBestAction, PrescriptiveResponse } from "@/lib/api/analytics";
import { nextBestActionView } from "@/lib/next-best-action";
import { NextBestActionCard } from "../next-best-action";

afterEach(() => vi.restoreAllMocks());

const finding: NextBestAction = {
  type: "finding", id: "f1", title: "MM003: material_master", severity: "critical", affected_count: 1200, total_count: 5000,
  effort_hours: 3.4, impact_points: 120000, value_per_hour: 35294, priority_score: 90, estimated_cost: null, currency: "ZAR",
  recommended_steward: null, module: "material_master", check_id: "MM003", dimension: "completeness",
};

const response = (actions: NextBestAction[]): PrescriptiveResponse => ({
  actions, sprints: [], basis: { version_id: "run-1", findings: actions.length, cleaning_items: 0, exceptions: 0 },
  assumptions: { minutes_per_record: 1, investigation_hours: 1, cleaning_item_hours: 0.25, exception_hours: 2, sprint_hours: 40, cost_per_record: null, currency: "ZAR" },
});

describe("nextBestActionView", () => {
  it("words a finding in plain language and opens its failing records in the run", () => {
    const v = nextBestActionView(finding, "run-1");
    expect(v.title).toBe("Fix MM003 in Material master");
    expect(v.why).toBe("1,200 records of 5,000 checked fail this critical check. Fixing them clears the most severity-weighted records per hour of anything open in this run, about 3 hours of work.");
    expect(v.verb).toBe("Open failing records");
    expect(v.href).toBe("/objects/material_master?run=run-1&tab=records&check_id=MM003");
  });

  it("carries the run to a cleaning item, and opens an exception on the Inbox's exceptions list", () => {
    expect(nextBestActionView({ ...finding, type: "cleaning", title: "Clean: vendor — V1", module: undefined, check_id: undefined }, "run-1").href)
      .toBe("/fix?tab=cleaning&run=run-1");
    // ?run= alone opened the Inbox on its queue tasks; the exceptions are under ?kind=exception.
    expect(nextBestActionView({ ...finding, type: "exception", title: "Blocked payment run", module: undefined, check_id: undefined }, "run-1").href)
      .toBe("/inbox?kind=exception");
  });
});

describe("NextBestActionCard", () => {
  it("asks the planner for the one top action of this object in this run and shows it with one button", async () => {
    const spy = vi.spyOn(analytics, "getPrescriptiveAnalytics").mockResolvedValue(response([finding]));
    renderWithQuery(<NextBestActionCard run="run-1" module="material_master" />);
    expect(await screen.findByText("Fix MM003 in Material master")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith({ limit: 1, version_id: "run-1", module: "material_master" });
    const card = screen.getByTestId("next-best-action");
    expect(card).toHaveTextContent("Next best action");
    expect(card).toHaveTextContent("1,200 records of 5,000 checked fail this critical check.");
    const buttons = card.querySelectorAll("a");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute("href", "/objects/material_master?run=run-1&tab=records&check_id=MM003");
  });

  it("says so when nothing fails, with no button", async () => {
    vi.spyOn(analytics, "getPrescriptiveAnalytics").mockResolvedValue(response([]));
    renderWithQuery(<NextBestActionCard run="run-1" module="material_master" />);
    expect(await screen.findByText("Nothing fails in this object in this run.")).toBeInTheDocument();
    expect(screen.getByTestId("next-best-action").querySelector("a")).toBeNull();
  });

  it("hides itself when the planner is unreachable", async () => {
    const spy = vi.spyOn(analytics, "getPrescriptiveAnalytics").mockRejectedValue(new Error("down"));
    renderWithQuery(<NextBestActionCard run="run-1" />);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("next-best-action")).toBeNull());
  });
});
