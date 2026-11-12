import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetDqFirewallFixture } from "@/lib/api/v2/fixtures/dq-firewall";
import { statusWord } from "../inspector/request";
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

  it("shows what the SAP dictionary says about a value its check table rejects, with the nearest valid codes", async () => {
    renderWithQuery(<EntryGate />);
    fireEvent.change(await screen.findByTestId("entry-gate-json"), { target: { value: JSON.stringify([{ "MARA.MATNR": "ENTRY-TEST-2", "MARA.MTART": "FERX", "MARA.MEINS": "KG" }]) } });
    fireEvent.click(screen.getByTestId("entry-gate-run"));
    const card = await screen.findByTestId("ddic-card");
    expect(card.textContent).toContain("Material Type");
    expect(card.textContent).toContain("check table T134, read from the system");
    expect(within(card).getByTestId("ddic-reasons").textContent).toContain("not in check table T134");
    expect(within(card).getByTestId("ddic-nearest").textContent).toContain("FERT");
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

  it("shows the hold counts, the oldest wait, the median decision time and the latest held requests", async () => {
    renderWithQuery(<EntryGate />);
    const panel = await screen.findByTestId("entry-gate-holds");
    expect(within(screen.getByTestId("entry-gate-hold-held")).getByText("1")).toBeInTheDocument();
    expect(within(screen.getByTestId("entry-gate-hold-released")).getByText("6")).toBeInTheDocument();
    expect(within(screen.getByTestId("entry-gate-hold-rejected")).getByText("2")).toBeInTheDocument();
    expect(within(screen.getByTestId("entry-gate-hold-written")).getByText("4")).toBeInTheDocument();
    expect(screen.getByTestId("entry-gate-hold-oldest").textContent).toMatch(/32/);
    expect(screen.getByTestId("entry-gate-hold-median").textContent).toMatch(/5/);
    const list = within(panel).getByTestId("entry-gate-held-list");
    expect(within(list).getAllByRole("link").length).toBeGreaterThan(0);
  });

  async function runWith(hold: string, matnr: string) {
    renderWithQuery(<EntryGate />);
    await screen.findByTestId("entry-gate-run");
    fireEvent.change(screen.getByTestId("entry-gate-json"), { target: { value: JSON.stringify([{ "MARA.MATNR": matnr, "MARA.MTART": "", "MARA.MEINS": "KG" }]) } });
    fireEvent.change(screen.getByTestId("entry-gate-hold"), { target: { value: hold } });
    fireEvent.click(screen.getByTestId("entry-gate-run"));
    return screen.findByTestId("entry-gate-hold-results");
  }

  it("holds a blocked record and says the SAP save stops", async () => {
    const table = await runWith("blocked", "ENTRY-TEST-1");
    expect(within(table).getByText("Held")).toBeInTheDocument();
    expect(screen.getByTestId("entry-gate-save").textContent).toContain("The SAP save stops.");
  });

  it("says the save may go on when the record was released", async () => {
    const table = await runWith("blocked", "ENTRY-APPROVED");
    expect(within(table).getByText("Released")).toBeInTheDocument();
    expect(screen.getByTestId("entry-gate-save").textContent).toContain("may go on");
  });

  it("shows a rejected and a written record with the SAP key", async () => {
    let table = await runWith("flagged", "ENTRY-WRITTEN");
    expect(within(table).getByText("Written")).toBeInTheDocument();
    expect(within(table).getByText("4711")).toBeInTheDocument();
    expect(screen.getByTestId("entry-gate-save").textContent).toContain("stops");
    fireEvent.change(screen.getByTestId("entry-gate-json"), { target: { value: JSON.stringify([{ "MARA.MATNR": "ENTRY-REJECTED", "MARA.MTART": "" }]) } });
    fireEvent.click(screen.getByTestId("entry-gate-run"));
    table = await screen.findByText("Rejected by an approver. The SAP save stops. Changed content opens a new request.");
    expect(table).toBeInTheDocument();
  });

  it("names a released request that has not been exported in words", () => {
    expect(statusWord("approved", "2026-10-18T09:00:00Z")).toBe("Released to the SAP save");
    expect(statusWord("approved", null)).not.toBe("Released to the SAP save");
  });
});

function asViewer(path: string) {
  const url = `${path}?fixture=1&role=viewer`;
  window.history.pushState({}, "", url);
  setUrl(url);
}

describe("entry gate: roles", () => {
  it("tells a viewer the check needs mdm.write instead of offering a button the API refuses", async () => {
    asViewer("/entry-gate");
    renderWithQuery(<EntryGate />);
    const lock = await screen.findByTestId("needs-permission");
    expect(lock).toHaveTextContent("Checking records at the gate needs the mdm.write permission");
    expect(within(lock).getByTestId("request-access")).toBeInTheDocument();
    expect(screen.queryByTestId("entry-gate-run")).toBeNull();
  });
});
