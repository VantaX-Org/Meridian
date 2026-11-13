import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import type { PortfolioRow } from "@/lib/api/next/portfolio";
import type { Finding } from "@/lib/api/next/monitor";
import { Monitor, Watched } from "../screens/Monitor";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/design/v2/screens/LearnedMonitors", async () => (await import("./stub")).stub("LearnedMonitors"));

const row = (over: Partial<PortfolioRow>): PortfolioRow => ({
  module: "material_master", label: "Material master", version_id: "v1", run_at: null, system_id: "s1", composite_score: 80, raw_score: 80, measured_score: 80,
  capped: false, readiness: "pass", step: null, cycle: null, run_number: 2, owner: "Owner A", trend: [70, 75, 80], previous_score: 75, new_issues: 4, regressed: 1, resolved: 9, freshness: null, ...over,
});
const rows = [row({}), row({ module: "customer_master", label: "Customer master", version_id: "v2", owner: "Owner B", system_id: "s2", trend: [60, 55], new_issues: 2, regressed: 0, resolved: 0 })];
const fnd = (module: string, label: string, version_id: string): Finding => ({ module, label, check_id: `C-${module}`, change: "new", records: 2, reason: "r", version_id, baseline_version_id: "b", detected_at: "2026-11-01T00:00:00Z" });

vi.mock("@/lib/api/next/portfolio", async (orig) => ({ ...(await orig<object>()), usePortfolio: () => ({ data: { objects: rows } }) }));
vi.mock("@/lib/api/next/monitor", async (orig) => ({
  ...(await orig<object>()),
  useFeed: () => ({ isLoading: false, isError: false, data: { items: [fnd("material_master", "Material master", "v1"), fnd("customer_master", "Customer master", "v2")], total: 2 } }),
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
});
