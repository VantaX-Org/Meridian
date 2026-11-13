import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { LoadPlan } from "../screens/LoadPlan";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  const u = "/migration/load-plan?fixture=1&persona=owner";
  window.history.pushState({}, "", u);
  setUrl(u);
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("load plan", () => {
  it("orders the objects in steps and marks the no-go state", async () => {
    renderWithQuery(<LoadPlan />);
    const banner = await screen.findByTestId("load-plan");
    expect(banner).toHaveAttribute("data-verdict", "no-go");
    const step1 = screen.getByTestId("lp-step-1");
    expect(within(step1).getByTestId("lp-object-fi_gl")).toBeInTheDocument();
    expect(within(screen.getByTestId("lp-object-fi_gl")).getByText("No-go")).toBeInTheDocument();
    expect(within(screen.getByTestId("lp-object-mm_purchasing")).getByText("Not analysed yet")).toBeInTheDocument();
  });

  it("lists every downloaded load file with its wave, objects and records", async () => {
    renderWithQuery(<LoadPlan />);
    const row = await screen.findByTestId("lp-load-exp-0001");
    expect(within(row).getByText("Wave 1")).toBeInTheDocument();
    expect(within(row).getByText("material_master_cockpit.xlsx")).toBeInTheDocument();
    expect(within(row).getByText("Resh Naidoo")).toBeInTheDocument();
  });

  it("blocks the objects that need a no-go object through a required field", async () => {
    renderWithQuery(<LoadPlan />);
    const blocked = await screen.findByTestId("lp-blocked-accounts_payable");
    expect(blocked.textContent).toMatch(/Blocked until .+ is fixed/);
    expect(screen.queryByTestId("lp-blocked-material_master")).toBeNull();
  });

  it("names the field and check table behind each dependency", async () => {
    renderWithQuery(<LoadPlan />);
    const row = await screen.findByTestId("lp-edge-fi_gl-accounts_payable-LFB1.AKONT");
    expect(within(row).getByText("Required")).toBeInTheDocument();
    expect(within(row).getAllByText(/SKB1/).length).toBeGreaterThan(0);
    expect(within(row).getAllByText(/Reconciliation account is required/).length).toBeGreaterThan(0);
  });
});
