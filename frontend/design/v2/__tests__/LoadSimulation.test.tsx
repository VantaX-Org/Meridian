import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { LoadSimulationPanel } from "../screens/LoadSimulation";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  const u = "/migration?fixture=1&persona=owner";
  window.history.pushState({}, "", u);
  setUrl(u);
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("load simulation", () => {
  it("shows would load and would fail per load object", async () => {
    renderWithQuery(<LoadSimulationPanel runId="mig-0002" />);
    const bars = await screen.findByTestId("load-sim-bars");
    expect(within(bars).getByText("Material master, would fail")).toBeInTheDocument();
    expect(within(bars).getByText(/1,755 \(1,327 provisional\)/)).toBeInTheDocument();
    expect(screen.getByTestId("load-sim-provisional").textContent).toMatch(/1,327 records fail only on values missing/);
  });

  it("lists cockpit messages with the field text and sample records", async () => {
    renderWithQuery(<LoadSimulationPanel runId="mig-0002" />);
    const row = await screen.findByTestId("load-sim-group-MAKT-MAKTX-length_truncation");
    expect(within(row).getByText("Field MAKT-MAKTX too long: CHAR 40")).toBeInTheDocument();
    expect(within(row).getByText("Material description")).toBeInTheDocument();
    expect(within(row).getByText(/000000000010009001/)).toBeInTheDocument();
    const ct = screen.getByTestId("load-sim-group-ADRC-COUNTRY-check_table_value");
    expect(within(ct).getByText("Provisional")).toBeInTheDocument();
  });

  it("lists the configuration to transport per check table", async () => {
    renderWithQuery(<LoadSimulationPanel runId="mig-0002" />);
    const t005 = await screen.findByTestId("load-sim-transport-T005");
    expect(within(t005).getByText("Countries")).toBeInTheDocument();
    expect(within(t005).getByText(/UK \(1,310 records\)/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the load order" })).toHaveAttribute("href", expect.stringContaining("/migration/load-plan"));
  });

  it("says nothing fails for a run without failing records", async () => {
    renderWithQuery(<LoadSimulationPanel runId="mig-0001" />);
    expect(await screen.findByText("No record would fail the load.")).toBeInTheDocument();
  });
});
