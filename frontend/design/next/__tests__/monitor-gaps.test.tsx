import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import type { PortfolioRow } from "@/lib/api/next/portfolio";
import { perDay, type Finding, type RunGroup } from "@/lib/api/next/monitor";
import { Monitor, Watched } from "../screens/Monitor";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/design/v2/screens/LearnedMonitors", async () => (await import("./stub")).stub("LearnedMonitors"));

const row = (over: Partial<PortfolioRow>): PortfolioRow => ({
  module: "material_master", label: "Material master", version_id: "v1", run_at: null, system_id: "s1", composite_score: 80, raw_score: 80, measured_score: 80,
  capped: false, readiness: "pass", step: null, cycle: null, run_number: 2, owner: "Owner A", trend: [70, 75, 80], previous_score: 75, new_issues: 4, regressed: 1, resolved: 9, freshness: null, ...over,
});
const rows = [row({}), row({ module: "customer_master", label: "Customer master", version_id: "v2", owner: "Owner B", system_id: "s2", trend: [60, 55], new_issues: 2, regressed: 0, resolved: 0 })];
const fnd = (module: string, label: string, version_id: string): Finding => ({ module, label, check_id: `C-${module}`, change: "new", records: 2, reason: "r", version_id, baseline_version_id: "b", detected_at: "2026-11-01T00:00:00Z", severity: module === "material_master" ? "high" : "low", owner: module === "material_master" ? "Owner A" : "Owner B" });

vi.mock("@/lib/api/next/portfolio", async (orig) => ({ ...(await orig<object>()), usePortfolio: () => ({ data: { objects: rows } }) }));
vi.mock("@/lib/api/next/monitor", async (orig) => ({
  ...(await orig<object>()),
  useFeed: () => ({ isLoading: false, isError: false, data: { items: [fnd("material_master", "Material master", "v1"), fnd("customer_master", "Customer master", "v2")], total: 2, runs: [{ version_id: "v1", resolved: 6 }, { version_id: "v2", resolved: 0 }] } }),
}));
vi.mock("@/lib/v2/queries", () => ({ useLandscape: () => ({ data: { objects: [], systems: [], cells: [] } }) }));

describe("Monitor watched objects", () => {
  it("draws a sparkline and shows open beside resolved counts", () => {
    renderWithQuery(<Watched rows={rows} />);
    const li = screen.getByText("Material master").closest("li")!;
    expect(within(li).getByRole("img", { name: "DQS trend of Material master" })).toBeInTheDocument();
    expect(within(li).getByText("5 open")).toBeInTheDocument();
    expect(within(li).getByText("9 resolved")).toBeInTheDocument();
  });

  it("leaves the sparkline out when there is one point or none", () => {
    renderWithQuery(<Watched rows={[row({ trend: [70] })]} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("filters watched objects and feed runs by owner", async () => {
    setUrl("/monitor");
    renderWithQuery(<Monitor />);
    expect(screen.getByRole("heading", { name: "Customer master" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Owner"), "Owner A");
    expect(screen.queryByRole("heading", { name: "Customer master" })).not.toBeInTheDocument();
    expect(screen.queryByText("Customer master")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Material master" })).toBeInTheDocument();
  });

  it("shows resolved per run and filters the feed by severity", async () => {
    setUrl("/monitor");
    renderWithQuery(<Monitor />);
    expect(within(screen.getByRole("heading", { name: "Material master" }).closest("li")!).getByText(/6/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Severity"), "low");
    expect(screen.queryByRole("heading", { name: "Material master" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Customer master" })).toBeInTheDocument();
  });
});

describe("Monitor per-day strip", () => {
  it("sums run groups per day, oldest first, and skips undated groups", () => {
    const g = (detected_at: string | null, n: number, r: number, x: number) => ({ detected_at, newCount: n, resolvedCount: r, regressedCount: x }) as unknown as RunGroup;
    expect(perDay([g("2026-11-02T08:00:00Z", 1, 0, 0), g("2026-11-01T00:00:00Z", 2, 3, 1), g("2026-11-02T09:00:00Z", 1, 1, 0), g(null, 9, 9, 9)])).toEqual([
      { day: "2026-11-01", newCount: 2, resolvedCount: 3, regressedCount: 1 },
      { day: "2026-11-02", newCount: 2, resolvedCount: 1, regressedCount: 0 },
    ]);
  });
  it("draws the strip on the Monitor", () => {
    setUrl("/monitor");
    renderWithQuery(<Monitor />);
    expect(screen.getByTestId("mon-days")).toBeInTheDocument();
  });
});
