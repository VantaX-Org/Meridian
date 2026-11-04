import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { EntryGate, LICENSED_MODULES, moduleRows } from "../screens/EntryGate";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/entry-gate");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("entry gate", () => {
  it("shows the traffic, the blocking rules with their text, and a dash where a count was not recorded", async () => {
    renderWithQuery(<EntryGate />);
    const rules = await screen.findByTestId("entry-gate-rules");
    expect(within(rules).getByText("MM003")).toBeInTheDocument();
    expect(within(rules).getByText(/Material type is mandatory/)).toBeInTheDocument();
    const days = screen.getByTestId("entry-gate-days");
    expect(within(days).getAllByText("—").length).toBeGreaterThan(0);
    expect(await screen.findByTestId("entry-gate-checked")).toBeInTheDocument();
    const ec = screen.getByTestId("entry-gate-module-employee_central");
    expect(within(ec).getAllByText("—")).toHaveLength(2);
  });

  it("lists the three licensed objects, with a dash for one the trail has not seen", () => {
    const rows = moduleRows([{ module: "material_master", checked: 2, blocked: 1, warned: 0, passed: 1 }]);
    expect(rows.map((r) => r.module)).toEqual([...LICENSED_MODULES]);
    expect(rows[1].row).toBeNull();
  });

  it("checks a record and cites the rule beside a grounded suggestion", async () => {
    renderWithQuery(<EntryGate />);
    fireEvent.click(await screen.findByTestId("entry-gate-run"));
    const result = await screen.findByTestId("entry-gate-result");
    expect(result.textContent).toContain("Blocked");
    const s = await screen.findByTestId("entry-suggestion");
    expect(s.textContent).toContain("ROH");
    expect(s.textContent).toContain("rule MM003");
  });
});
