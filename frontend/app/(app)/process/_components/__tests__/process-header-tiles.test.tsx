import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as pd from "@/lib/api/process-discovery";
import { ProcessHeaderTiles, fitnessChange } from "../process-header";

const run = (fitness: number | null, over: Partial<NonNullable<pd.ProcessHealth["last_run"]>> = {}) => ({
  id: "r2", status: "completed", finished_at: new Date(Date.now() - 3 * 3_600_000).toISOString(), fitness, ...over,
});
const health = (over: Partial<pd.ProcessHealth>): pd.ProcessHealth => ({
  l1: "PTP", last_run: run(0.92), previous_fitness: 0.8, fitness_drift: 0.12,
  schedule: { id: "s1", cron: "0 2 * * *", active: true, next_run_at: null }, freshness: "fresh", ...over,
});
const tile = (label: string) => screen.getByText(label).closest(".m-stat") as HTMLElement;

beforeEach(() => vi.restoreAllMocks());

describe("ProcessHeaderTiles", () => {
  it("a fresh daily process reads checked, cadence, fresh and the fitness gain", async () => {
    vi.spyOn(pd, "getProcessHealth").mockResolvedValue([health({}), health({ l1: "OTC", freshness: "stale" })]);
    renderWithQuery(<ProcessHeaderTiles systemId="sys" l1="PTP" />);
    expect(await screen.findByText("3h ago")).toBeInTheDocument();
    expect(tile("Checked")).toHaveAttribute("href", "/process/runs/r2");
    expect(tile("Cadence")).toHaveTextContent("Daily at 02:00");
    expect(tile("Freshness")).toHaveTextContent("Fresh");
    expect(tile("Fitness change")).toHaveTextContent("+12 points");
    expect(tile("Fitness change")).toHaveTextContent("From 80% to 92%");
    expect(tile("Fitness change").querySelector("[data-tone]")).toHaveAttribute("data-tone", "go");
  });

  it("a stale process says stale and a falling fitness reads as a loss in the no-go tone", async () => {
    vi.spyOn(pd, "getProcessHealth").mockResolvedValue([
      health({ freshness: "stale", fitness_drift: -0.04, previous_fitness: 0.9, last_run: run(0.86) })]);
    renderWithQuery(<ProcessHeaderTiles systemId="sys" l1="PTP" />);
    expect(await screen.findByText("-4 points")).toBeInTheDocument();
    expect(tile("Freshness")).toHaveTextContent("Stale");
    expect(tile("Fitness change").querySelector("[data-tone]")).toHaveAttribute("data-tone", "no-go");
  });

  it("a paused schedule reads Paused and a process without one reads Manual only", async () => {
    vi.spyOn(pd, "getProcessHealth").mockResolvedValue([
      health({ freshness: "paused", schedule: { id: "s1", cron: "0 2 * * *", active: false, next_run_at: null } }),
      health({ l1: "OTC", freshness: "manual", schedule: null })]);
    const { unmount } = renderWithQuery(<ProcessHeaderTiles systemId="sys" l1="PTP" />);
    await screen.findByText("Cadence");
    expect(tile("Cadence")).toHaveTextContent("Paused");
    expect(tile("Freshness")).toHaveTextContent("Paused");
    unmount();
    renderWithQuery(<ProcessHeaderTiles systemId="sys" l1="OTC" />);
    expect(await screen.findByText("Manual only")).toBeInTheDocument();
    expect(tile("Freshness")).toHaveTextContent("Manual");
  });

  it("a process that never ran says so, with no fitness change to report", async () => {
    vi.spyOn(pd, "getProcessHealth").mockResolvedValue([
      health({ last_run: null, previous_fitness: null, fitness_drift: null, freshness: "due" })]);
    renderWithQuery(<ProcessHeaderTiles systemId="sys" l1="PTP" />);
    expect(await screen.findByText("Not checked yet")).toBeInTheDocument();
    expect(tile("Fitness change")).toHaveTextContent("No result yet");
    expect(tile("Freshness")).toHaveTextContent("Due");
  });

  it("a first run has fitness but no change yet", async () => {
    vi.spyOn(pd, "getProcessHealth").mockResolvedValue([health({ previous_fitness: null, fitness_drift: null })]);
    renderWithQuery(<ProcessHeaderTiles systemId="sys" l1="PTP" />);
    expect(await screen.findByText("First run")).toBeInTheDocument();
  });

  it("renders nothing when the health read fails", async () => {
    vi.spyOn(pd, "getProcessHealth").mockRejectedValue(new Error("boom"));
    const { container } = renderWithQuery(<ProcessHeaderTiles systemId="sys" l1="PTP" />);
    await vi.waitFor(() => expect(container.querySelector("[aria-busy]")).toBeNull());
    expect(container).toBeEmptyDOMElement();
  });
});

describe("fitnessChange", () => {
  it("signs whole points", () => {
    expect([fitnessChange(0.03), fitnessChange(-0.01), fitnessChange(0), fitnessChange(0.004)])
      .toEqual(["+3 points", "-1 point", "0 points", "0 points"]);
  });
});
