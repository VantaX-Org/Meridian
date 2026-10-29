import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as workApi from "@/lib/api/v2/work";
import { fixtureResponse, resetWorkFixture } from "@/lib/api/v2/fixtures";
import type { WorkPage } from "@/lib/api/v2/types";
import { resetActions } from "@/lib/v2/undo";
import { clearPatches } from "@/lib/v2/work-overrides";
import { Inspector } from "../Inspector";
import { ToastProvider } from "../Toast";
import { V2Shell } from "../shell/V2Shell";
import { WorkCanvas } from "../screens/Work";
import { getUrl, setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undoLayout: () => void = () => undefined;
const KEY = "000000000000000100"; // MM014 base unit of measure, suggested EA

function visit(open: string, extra = "") {
  const url = `/v2/work?fixture=1&persona=steward${extra}&open=${encodeURIComponent(`record:${open}`)}`;
  window.history.pushState({}, "", url);
  setUrl(url);
}

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  window.localStorage.clear();
  resetWorkFixture();
  resetActions();
  clearPatches();
  undoLayout = stubLayout(1400, 600);
});
afterEach(() => {
  undoLayout();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const mount = (open = `material_master:MATNR=${KEY}`, extra = "") => {
  visit(open, extra);
  return renderWithQuery(
    <ToastProvider>
      <Inspector />
    </ToastProvider>,
  );
};
const body = async () => {
  await screen.findByTestId("record-facts");
  return screen.getByTestId("inspector");
};

describe("the record inspector", () => {
  it("has the key in mono as its title and a status line: status, name, plant, value at risk", async () => {
    mount();
    const title = await screen.findByRole("heading", { level: 2, name: KEY });
    expect(title.querySelector(".m2-mono")).not.toBeNull();
    await screen.findByTestId("record-facts");
    const status = document.querySelector(".m2-ih-sl") as HTMLElement;
    expect(text(status)).toMatch(/^To fix Hex bolt M8 zinc plant 1000 ZAR [\d,]+ at risk$/);
  });

  it("lists every field of the record as description, TABLE-FIELD and value, the failing ones marked with their rule id", async () => {
    mount();
    const facts = within(await screen.findByTestId("record-facts"));
    const fact = (field: string) => facts.getByText(field).closest(".m2-fact") as HTMLElement;
    expect(fact("MARA-MATNR")).toHaveTextContent("Material number");
    expect(fact("MARA-MATNR")).toHaveTextContent(KEY);
    expect(fact("MAKT-MAKTX")).toHaveTextContent("Hex bolt M8 zinc");
    expect(fact("MARC-WERKS")).toHaveTextContent("Plant");
    expect(fact("MBEW-BKLAS")).toHaveTextContent("Valuation class");
    // The failing field carries the rule's id as a link that opens the rule.
    const failing = fact("MARA-MEINS");
    expect(failing).toHaveTextContent("Base unit of measure");
    expect(within(failing).getByText("PCS")).toHaveClass("m2-mono");
    const rule = within(failing).getByRole("link", { name: "MM014" });
    expect(decodeURIComponent(rule.getAttribute("href") ?? "")).toContain("open=rule:MM014");
    // A field that passes carries none.
    expect(within(fact("MARA-MATKL")).queryByRole("link")).toBeNull();
    expect(facts.getAllByText(/^[A-Z0-9]{4,6}-[A-Z0-9_]+$/).length).toBeGreaterThanOrEqual(11);
  });

  it("has a fix block for the failing rule: rule, field, current value, possible values with meanings, suggested value, New value, Decision", async () => {
    mount();
    await body();
    const block = within(screen.getAllByTestId("fix-block")[0]);
    expect(block.getByRole("link", { name: "MM014" })).toBeInTheDocument();
    expect(block.getByText("Base unit of measure not valid")).toBeInTheDocument();
    expect(block.getByText("MARA-MEINS")).toBeInTheDocument();
    expect(block.getByText("PCS")).toBeInTheDocument();
    const values = block.getByText("Possible values").parentElement as HTMLElement;
    expect(values).toHaveTextContent("EA Each");
    expect(values).toHaveTextContent("PC Piece");
    fireEvent.click(within(values).getByRole("button", { name: "Show all 38" }));
    expect(values).toHaveTextContent("ST Piece (German)");
    const suggested = block.getByText("Suggested value").parentElement as HTMLElement;
    expect(within(suggested).getByText("EA")).toHaveClass("m2-mono");
    expect(block.getByLabelText("New value for MM014")).toBeInTheDocument();
    expect(block.getByLabelText("Decision for MM014")).toBeInTheDocument();
  });

  it("a record that fails several rules has one fix block each, worst first", async () => {
    const page = fixtureResponse<WorkPage>("/work/records", { limit: 100, status: "to_fix" });
    const many = page.items.find((r) => {
      const d = fixtureResponse<{ issues: unknown[] }>(`/work/records/${r.module}/${encodeURIComponent(r.record_key)}`, {});
      return d.issues.length >= 2;
    });
    expect(many).toBeDefined();
    mount(`${many?.module}:${many?.record_key}`);
    await body();
    expect(screen.getAllByTestId("fix-block").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("heading", { level: 3, name: "Fix by rule" })).toBeInTheDocument();
  });

  it("Enter in New value sends an edit for that rule; the Decision select sends fix, or asks for a reason first", async () => {
    const spy = vi.spyOn(workApi, "postDecide");
    mount();
    await body();
    const input = screen.getByLabelText("New value for MM014");
    fireEvent.change(input, { target: { value: "KG" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0]).toEqual([expect.objectContaining({ module: "material_master", record_key: `MATNR=${KEY}`, check_id: "MM014", action: "edit", value: "KG" })]);
    expect(spy.mock.calls[0][1]).toBe("d3229ded-0708-4967-9dfb-1b7f4fada953");
  });

  it("the Decision select: not an issue asks for the reason, then sends it", async () => {
    const spy = vi.spyOn(workApi, "postDecide");
    mount();
    await body();
    fireEvent.change(screen.getByLabelText("Decision for MM014"), { target: { value: "not an issue" } });
    const dialog = await screen.findByRole("dialog", { name: "Mark as not an issue" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Legacy part" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as not an issue" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toEqual([expect.objectContaining({ action: "not_an_issue", note: "Legacy part", check_id: "MM014" })]);
  });

  it("links: feature impact, provenance and history come from the record's links", async () => {
    mount();
    await body();
    const impact = await screen.findByTestId("feature-impact");
    expect(impact).toHaveTextContent("Migration cockpit: material load");
    expect(impact).toHaveTextContent("blocked by MM014");
    expect(within(impact).getByRole("link", { name: "Material ledger actual costing" })).toBeInTheDocument();
    const prov = within(await screen.findByTestId("provenance"));
    expect(prov.getByText("MARA")).toBeInTheDocument();
    expect(prov.getByText("Extracted at").parentElement).toHaveTextContent("16 Oct 2026");
    expect(prov.getByText("Record hash").parentElement?.querySelector(".m2-mono")).not.toBeNull();
    const history = await screen.findByTestId("record-history");
    expect(history).toHaveTextContent("Assigned to A. Naidoo by R. Govender");
  });

  it("Also fails on… names the other plants when the key has a plant", async () => {
    const page = fixtureResponse<WorkPage>("/work/records", { limit: 100, status: "to_fix" });
    const withPlant = page.items.find((r) => r.record_key.includes("WERKS="));
    expect(withPlant).toBeDefined();
    mount(`${withPlant?.module}:${withPlant?.record_key}`);
    await body();
    const also = await screen.findByTestId("also-fails");
    expect(also).toHaveTextContent(/on plant \d{4}/);
  });

  it("says so when the record no longer fails anything", async () => {
    mount("material_master:MATNR=999");
    expect(await screen.findByText(/does not fail any check in the latest run/)).toBeInTheDocument();
  });
});

describe("actions by permission", () => {
  it("a steward: accept suggested, propose a value, not an issue, accept risk, assign", async () => {
    const spy = vi.spyOn(workApi, "postDecide");
    mount();
    await body();
    const acts = within(screen.getByRole("heading", { level: 3, name: "Actions" }).nextElementSibling as HTMLElement);
    for (const name of [/Accept suggested/, /Propose value/, /Not an issue/, /Accept risk/, /^Assign$/]) expect(acts.getByRole("button", { name })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    fireEvent.click(acts.getByRole("button", { name: /Accept suggested/ }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toEqual([expect.objectContaining({ action: "accept", check_id: "MM014" })]);
    fireEvent.click(acts.getByRole("button", { name: /^Assign$/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Assign to me" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1][0]).toEqual([expect.objectContaining({ action: "assign", assignee: "me" })]);
  });

  it("Accept suggested is off, with the reason, for a record with no suggestion", async () => {
    const page = fixtureResponse<WorkPage>("/work/records", { limit: 100, status: "to_fix" });
    const none = page.items.find((r) => {
      const d = fixtureResponse<{ issues: { suggestion: unknown }[] }>(`/work/records/${r.module}/${encodeURIComponent(r.record_key)}`, {});
      return d.issues.every((i) => !i.suggestion);
    });
    expect(none).toBeDefined();
    mount(`${none?.module}:${none?.record_key}`);
    await body();
    expect(screen.getByRole("button", { name: /Accept suggested/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Accept suggested/ })).toHaveAttribute("title", "No suggested value for this record");
  });

  it("an owner: approve and send back, on a record whose value waits in a draft batch", async () => {
    const waiting = fixtureResponse<WorkPage>("/work/records", { limit: 5, status: "proposed" }).items[0];
    const approve = vi.spyOn(workApi, "postApproveBatch");
    const sendBack = vi.spyOn(workApi, "postSendBack");
    mount(`${waiting.module}:${waiting.record_key}`, "&role=owner");
    await body();
    expect(screen.queryByRole("button", { name: /Accept suggested/ })).toBeNull();
    const ok = screen.getByRole("button", { name: "Approve" });
    expect(ok).toBeEnabled();
    expect(screen.getByText(/Approving acts on the whole batch/)).toBeInTheDocument();
    fireEvent.click(ok);
    await waitFor(() => expect(approve).toHaveBeenCalledWith("fx-batch"));
    expect(sendBack).not.toHaveBeenCalled();
    expect(await screen.findByText("Approved Fixes by Demo user")).toBeInTheDocument();
  });

  it("an owner sends a batch back with a note", async () => {
    const waiting = fixtureResponse<WorkPage>("/work/records", { limit: 5, status: "proposed" }).items[0];
    const sendBack = vi.spyOn(workApi, "postSendBack");
    mount(`${waiting.module}:${waiting.record_key}`, "&role=owner");
    await body();
    fireEvent.click(screen.getByRole("button", { name: "Send back" }));
    const dialog = await screen.findByRole("dialog", { name: "Send the batch back" });
    fireEvent.change(within(dialog).getByLabelText("What the author has to change"), { target: { value: "Plant 2000 is wrong" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send back" }));
    await waitFor(() => expect(sendBack).toHaveBeenCalledWith("fx-batch", "Plant 2000 is wrong"));
  });

  it("an owner cannot approve a record that is not waiting, and is told why", async () => {
    mount(undefined, "&role=owner");
    await body();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByText(/Only a record whose value waits in a draft fix batch can be approved/)).toBeInTheDocument();
  });

  it("a viewer has no actions: the fix blocks are read-only", async () => {
    mount(undefined, "&role=viewer");
    await body();
    expect(screen.getByTestId("read-only")).toHaveTextContent("Read-only for your role");
    const acts = screen.getByRole("heading", { level: 3, name: "Actions" }).nextElementSibling as HTMLElement;
    expect(within(acts).queryByRole("button")).toBeNull();
    expect(screen.queryByLabelText("New value for MM014")).toBeNull();
    expect(screen.queryByLabelText("Decision for MM014")).toBeNull();
  });
});

describe("stepping through the ledger", () => {
  it("] opens the next row and [ the previous one", async () => {
    window.sessionStorage.setItem("mn_v2_fixture", "1");
    const url = `/v2/work?fixture=1&persona=steward&open=${encodeURIComponent("record:material_master:MATNR=000000000000000232")}`;
    window.history.pushState({}, "", url);
    setUrl(url);
    renderWithQuery(
      <V2Shell>
        <WorkCanvas />
      </V2Shell>,
    );
    await screen.findByRole("heading", { level: 2, name: "000000000000000232" });
    await screen.findByTestId("record-facts");
    fireEvent.keyDown(document.body, { key: "]" });
    await waitFor(() => expect(decodeURIComponent(getUrl())).not.toContain("MATNR=000000000000000232"));
    const second = decodeURIComponent(getUrl()).match(/MATNR=(\d+)/)?.[1];
    expect(second).toBeTruthy();
    await screen.findByRole("heading", { level: 2, name: second as string });
    fireEvent.keyDown(document.body, { key: "[" });
    await waitFor(() => expect(decodeURIComponent(getUrl())).toContain("MATNR=000000000000000232"));
  });
});
