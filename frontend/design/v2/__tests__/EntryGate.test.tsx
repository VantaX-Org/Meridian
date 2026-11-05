import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetDqFirewallFixture } from "@/lib/api/v2/fixtures/dq-firewall";
import { EntryGate, LICENSED_MODULES, moduleRows, notOpenedWord } from "../screens/EntryGate";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  resetDqFirewallFixture();
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

  it("lists the requests the gate opened, each with its status and object in words and a link to the request", async () => {
    renderWithQuery(<EntryGate />);
    const panel = await screen.findByTestId("entry-gate-requests");
    expect(within(panel).getByText("In approval")).toBeInTheDocument();
    expect(within(panel).getByText("Material")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: /Entry gate: new material/ }).getAttribute("href")).toContain("00000000-0000-4000-8000-000000000a01");
  });

  it("sends a blocked record to a steward only when asked, and a repeat returns the same request", async () => {
    renderWithQuery(<EntryGate />);
    fireEvent.click(await screen.findByTestId("entry-gate-run"));
    await screen.findByTestId("entry-gate-result");
    expect(screen.queryByTestId("entry-gate-steward")).toBeNull();

    fireEvent.click(screen.getByTestId("entry-gate-route"));
    fireEvent.click(screen.getByTestId("entry-gate-run"));
    const table = await screen.findByTestId("entry-gate-steward");
    expect(within(table).getByText("In approval")).toBeInTheDocument();
    expect(within(table).getByText(/Opened and sent to the approval workflow/)).toBeInTheDocument();
    const href = within(table).getByRole("link", { name: "Open the request" }).getAttribute("href");

    fireEvent.click(screen.getByTestId("entry-gate-run"));
    expect(await screen.findByText(/Already open for this record/)).toBeInTheDocument();
    expect(within(screen.getByTestId("entry-gate-steward")).getByRole("link", { name: "Open the request" }).getAttribute("href")).toBe(href);
  });

  it("says in words why no request was opened", () => {
    expect(notOpenedWord("module_has_no_change_request")).toMatch(/no change request/);
    expect(notOpenedWord("over_limit")).toMatch(/25/);
    expect(notOpenedWord("not_accepted")).toMatch(/refused/);
    expect(notOpenedWord("not_opened")).toMatch(/could not be opened/);
  });
});
