import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as mdm from "@/lib/api/v2/mdm";
import { Inspector } from "../Inspector";
import { ProcessesTab } from "../screens/object/ProcessesTab";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/o/ecc-production/material-master/processes?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const tab = (module = "material-master") => renderWithQuery(<ProcessesTab system="ecc-production" module={module} />);

describe("the Processes tab", () => {
  it("draws the tree: each L1, its areas, and each step, in reading order", async () => {
    tab();
    const sentence = await screen.findByTestId("process-sentence");
    expect(norm(sentence)).toBe("2 of 4 process steps are blocked by Material master: PTP step 3, PP step 1.");
    const l1s = screen.getAllByRole("region").filter((r) => r.getAttribute("data-l1"));
    expect(l1s.map((r) => r.getAttribute("aria-label"))).toEqual(["Procure to Pay", "Plan to Produce"]);
    const ptp = l1s[0];
    expect(within(ptp).getAllByRole("heading", { level: 3 }).map((h) => norm(h))).toEqual(["Purchase RequisitionReady", "Purchase Order ProcessingReady", "Goods ReceiptBlocked"]);
    const steps = within(ptp).getAllByTestId("process-step");
    expect(steps.map((s) => norm(within(s).getByText(/Step \d/).parentElement as HTMLElement))).toEqual([
      "ReadyCreate Purchase RequisitionME51NStep 1",
      "ReadyCreate Standard POME21NStep 2",
      "BlockedPost Goods ReceiptMIGOStep 3",
    ]);
  });

  it("marks the blocked steps with a mark and a word, and opens them; ready steps stay closed", async () => {
    tab();
    await screen.findByTestId("process-sentence");
    const all = screen.getAllByTestId("process-step");
    expect(all.filter((s) => s.getAttribute("data-blocked") === "true")).toHaveLength(2);
    const blocked = all.filter((s) => s.getAttribute("data-blocked") === "true");
    blocked.forEach((s) => {
      expect((s as HTMLDetailsElement).open).toBe(true);
      expect(s.querySelector("summary svg.m2-vm.nogo")).not.toBeNull();
      expect(within(s.querySelector("summary") as HTMLElement).getByText("Blocked")).toBeInTheDocument();
    });
    const ready = all.filter((s) => s.getAttribute("data-status") === "green");
    expect(ready).toHaveLength(2);
    ready.forEach((s) => expect((s as HTMLDetailsElement).open).toBe(false));
  });

  it("lists each step's fields with the DQ status, pass rate and failing records", async () => {
    tab();
    await screen.findByTestId("process-sentence");
    const migo = screen.getAllByTestId("process-step")[2];
    const t = within(migo).getByRole("table", { name: "Fields of Enter Quantity and Unit" });
    const row = within(t).getAllByRole("row")[1];
    expect(norm(row)).toBe("MARA.MEINSBase unit of measureBlocked94.1%3,640");
    const t2 = within(migo).getByRole("table", { name: "Fields of Select Movement Type" });
    expect(norm(within(t2).getAllByRole("row")[1])).toBe("MARA.MTARTMaterial typeBlocked95.3%2,904");
    expect(within(migo).getByRole("link", { name: "Open the step Post Goods Receipt" })).toHaveAttribute("href", expect.stringContaining("open=step%3Amaterial_master%3APTP-GR-MIGO"));
  });

  it("leads to the process designer canvas, without embedding it", async () => {
    tab();
    const frame = await screen.findByRole("region", { name: "Process designer" });
    expect(within(frame).getByRole("link", { name: "Open the designer" })).toHaveAttribute("href", "/o/ecc-production/material-master/processes/design?fixture=1");
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("is a designed empty state for an object no process step reads, with the designer as the action", async () => {
    tab("purchasing");
    const empty = await screen.findByTestId("empty-frame");
    expect(empty).toHaveTextContent(/No process step reads the fields of Purchasing/);
    expect(within(empty).getByRole("link", { name: "Open the designer" })).toHaveAttribute("href", "/o/ecc-production/purchasing/processes/design?fixture=1");
  });

  it("says when no step is blocked", async () => {
    const doc = await mdm.getProcessDocument("r", "material_master");
    const green = JSON.parse(JSON.stringify(doc.processes).replace(/"red"/g, '"green"')) as mdm.BusinessProcessL1[];
    vi.spyOn(mdm, "getProcessDocument").mockResolvedValue({ processes: green });
    tab();
    expect(await screen.findByTestId("process-sentence")).toHaveTextContent("No process step is blocked by Material master.");
    expect(screen.queryAllByTestId("process-step").filter((s) => s.getAttribute("data-blocked") === "true")).toHaveLength(0);
  });
});

describe("the step inspector", () => {
  const open = async (ref = "material_master:PTP-GR-MIGO") => {
    setUrl(`/o/ecc-production/material-master/processes?open=step:${ref}&fixture=1`);
    renderWithQuery(<Inspector />);
    const d = await screen.findByRole("dialog");
    await waitFor(() => expect(within(d).queryByRole("region", { name: "Facts" }) ?? within(d).queryByTestId("empty-frame")).not.toBeNull());
    return d;
  };

  it("draws facts, fields, the failing rules and the fix links, named by the step", async () => {
    const d = await open();
    expect(d).toHaveAccessibleName("Post Goods Receipt");
    expect(within(d).getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["Facts", "Fields: 2", "Rules failing: 2", "Actions"]);
    const fact = (l: string) => norm(within(d).getByText(l, { selector: "dt" }).closest(".m2-fact") as HTMLElement);
    expect(fact("Status")).toBe("StatusBlocked");
    expect(fact("Process")).toBe("ProcessProcure to Pay, step 3");
    expect(fact("Transaction")).toBe("TransactionMIGO");
    expect(fact("Records affected")).toBe("Records affected3,640 or more");
    const fields = within(d).getByRole("table", { name: "Fields this step writes" });
    expect(within(fields).getAllByRole("row")).toHaveLength(3);
    const rules = within(d).getByRole("list", { name: "Rules failing on this step" });
    expect(within(rules).getByRole("link", { name: "MM014" })).toHaveAttribute("href", expect.stringContaining("open=rule%3AMM014"));
  });

  it("links the fix into the ledger filtered to the rules that fail", async () => {
    const d = await open();
    const fix = within(d).getByRole("link", { name: "Fix MM014 in Work" });
    expect(fix).toHaveAttribute("href", expect.stringContaining("/work?rule=MM014&module=material_master"));
    expect(within(d).getByRole("link", { name: "Fix MM031 in Work" })).toHaveAttribute("href", expect.stringContaining("rule=MM031"));
    expect(within(d).getByRole("link", { name: "Open the designer" })).toHaveAttribute("href", expect.stringContaining("/processes/design"));
  });

  it("a ready step has no rule failing and no fix link", async () => {
    const d = await open("material_master:PTP-PR-ME51N");
    expect(within(d).getByText("No rule fails on a field of this step.")).toBeInTheDocument();
    expect(within(d).queryByRole("link", { name: /^Fix / })).toBeNull();
  });

  it("says so for a step the run does not have", async () => {
    const d = await open("material_master:PTP-NOPE");
    expect(d).toHaveTextContent(/This run has no step with that id/);
  });
});
