import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { ForesightCard, LEADS, LoadPlanCard, ReasonCard, S4Card, SurvivorshipCard, MaterialCard } from "../leads";

const ev = { inputs: ["composite per run"], method: "least squares over runs", confidence: 72, runs: 6, first_run: "2026-01-05T00:00:00Z", last_run: "2026-03-01T00:00:00Z" };

vi.mock("@/lib/api/v2/aletheia-engine", () => ({
  getForesight: () => Promise.resolve({
    target: 85,
    runs: [{ run_at: "2026-01-05T00:00:00Z", composite: 61 }, { run_at: "2026-03-01T00:00:00Z", composite: 74.5 }],
    projection: { available: true, go_live: { status: "projected", projected: "2026-06-01T00:00:00Z", earliest: null, latest: null }, evidence: ev },
  }),
  getReason: () => Promise.resolve({
    deterministic: { risks: [{ name: "Missing base unit", driver: "MM001", effect: -3.2 }, { name: "Blank plant", driver: "MM002", effect: 1.1 }], anomalies: [{}], risk_evidence: ev },
  }),
}));
vi.mock("@/lib/api/v2/aletheia-survivorship", () => ({
  getSurvivorship: () => Promise.resolve({ counts: { proposed: 4, approved: 2, rejected: 1, auto_applied: 3 }, domains: [{ domain: "material_master", verified: 5, rejected: 1 }] }),
}));
vi.mock("@/lib/api/v2/load-plan", () => ({
  getLoadPlan: () => Promise.resolve({ steps: 3, objects: [{ status: "go" }, { status: "go" }, { status: "no_go" }, { status: "not_run" }] }),
}));
vi.mock("@/lib/api/v2/s4", () => ({
  getS4Readiness: () => Promise.resolve({ blocking_failing: 2, areas: [{ status: "green" }, { status: "red" }, { status: "amber" }] }),
}));
vi.mock("@/lib/api/v2/work", () => ({
  getWork: () => Promise.resolve({ total: 9, items: [{ record_key: "M-100", name: "Bolt", issues: 4 }, { record_key: "M-200", name: null, issues: 2 }] }),
}));

describe("lead cards", () => {
  it("foresight shows the score, go-live line, Aletheia mark and evidence", async () => {
    renderWithQuery(<ForesightCard />);
    const card = await screen.findByTestId("lead-foresight");
    expect(await within(card).findByText("74.5")).toBeTruthy();
    expect(within(card).getByText(/The go-live target is projected/)).toBeTruthy();
    expect(within(card).getByText("Aletheia")).toBeTruthy();
    const evd = within(card).getByTestId("lead-foresight-evidence");
    expect(evd.textContent).toContain("least squares over runs");
    expect(evd.textContent).toContain("72 out of 100");
  });

  it("reason ranks risks and carries the mark and evidence", async () => {
    renderWithQuery(<ReasonCard />);
    const card = await screen.findByTestId("lead-reason");
    expect(await within(card).findByText("1 unusual run")).toBeTruthy();
    expect(within(card).getByText("Aletheia")).toBeTruthy();
    expect(within(card).getByTestId("lead-reason-evidence")).toBeTruthy();
  });

  it("survivorship shows proposals waiting and evidence per domain", async () => {
    renderWithQuery(<SurvivorshipCard />);
    const card = await screen.findByTestId("lead-survivorship");
    expect(await within(card).findByText("4 waiting for a decision")).toBeTruthy();
    expect(within(card).getByText("Aletheia")).toBeTruthy();
    expect(within(card).getByTestId("lead-survivorship-evidence").textContent).toContain("5 verified, 1 rejected");
  });

  it("load plan, S/4 and materials lead with their figures", async () => {
    renderWithQuery(<><LoadPlanCard /><S4Card /><MaterialCard /></>);
    expect(await screen.findByText("2 of 4 objects may load, in 3 steps")).toBeTruthy();
    expect(await screen.findByText("2 blocking rules fail")).toBeTruthy();
    expect(await within(await screen.findByTestId("lead-materials")).findByText("9")).toBeTruthy();
  });

  it("maps every ported address to a lead row", () => {
    for (const k of ["aletheia/evidence", "aletheia/foresight", "aletheia/reason", "aletheia/survivorship", "master-data/golden", "master-data/mining", "master-data/materials", "insights/score", "insights/insights", "insights/forecast", "insights/value", "atlas", "load/plan", "load/s4", "load/go-live"]) {
      expect(LEADS[k], k).toBeTruthy();
    }
  });
});
