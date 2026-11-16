import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as workApi from "@/lib/api/v2/work";
import { fixtureResponse, resetWorkFixture } from "@/lib/api/v2/fixtures";
import type { WorkPage } from "@/lib/api/v2/types";
import { resetActions } from "@/lib/v2/undo";
import { clearPatches } from "@/lib/v2/work-overrides";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { ToastProvider } from "../../../kit";
import { RECORD_BODIES, parseRecordId } from "../record";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const KEY = "000000000000000100"; // MM142 base unit of measure, suggested EA
const Body = RECORD_BODIES.record;
let undo: () => void = () => undefined;

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  window.localStorage.clear();
  resetWorkFixture();
  resetActions();
  clearPatches();
  undo = stubLayout(1400, 600);
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const mount = (id = `material_master:MATNR=${KEY}`, extra = "") => {
  const url = `/work?fixture=1&persona=steward${extra}&open=${encodeURIComponent(`record:${id}`)}`;
  window.history.pushState({}, "", url);
  setUrl(url);
  return renderWithQuery(
    <ToastProvider>
      <Body id={id} onClose={() => undefined} />
    </ToastProvider>,
  );
};

describe("native record inspector", () => {
  it("parses module and key", () => {
    expect(parseRecordId("material_master:MATNR=1")).toEqual({ module: "material_master", key: "MATNR=1" });
    expect(parseRecordId("abc")).toEqual({ module: "", key: "abc" });
  });

  it("shows the key as title, the facts with the failing rule, and a fix block", async () => {
    mount();
    const facts = within(await screen.findByTestId("record-facts"));
    expect(screen.getAllByText(KEY).length).toBeGreaterThan(0);
    expect(facts.getByText("MARA-MEINS").closest(".nx-ib-fact")).toHaveTextContent("Base unit of measure");
    expect(facts.getByRole("link", { name: "MM142" })).toBeInTheDocument();
    const block = within(screen.getAllByTestId("fix-block")[0]);
    expect(block.getByLabelText("New value for MM142")).toBeInTheDocument();
    expect(screen.getByTestId("money")).toHaveTextContent(/est\./);
  });

  it("refuses a new value outside the rule's list", async () => {
    const spy = vi.spyOn(workApi, "postDecide");
    mount();
    await screen.findByTestId("record-facts");
    const input = screen.getByLabelText("New value for MM142");
    fireEvent.change(input, { target: { value: "ZZZ" } });
    expect(screen.getByTestId("new-value-outside")).toHaveTextContent("ZZZ is not one of the values this rule accepts.");
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("a steward accepts the suggestion and assigns to self", async () => {
    const spy = vi.spyOn(workApi, "postDecide");
    mount();
    await screen.findByTestId("record-facts");
    fireEvent.click(screen.getByRole("button", { name: /Accept suggested/ }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toEqual([expect.objectContaining({ action: "accept", check_id: "MM142" })]);
    fireEvent.click(screen.getByRole("button", { name: /^Assign$/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Assign to me" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1][0]).toEqual([expect.objectContaining({ action: "assign", assignee: "me" })]);
  });

  it("an owner sends the draft batch back with a note", async () => {
    const waiting = fixtureResponse<WorkPage>("/work/records", { limit: 5, status: "proposed" }).items[0];
    const sendBack = vi.spyOn(workApi, "postSendBack");
    mount(`${waiting.module}:${waiting.record_key}`, "&role=owner");
    await screen.findByTestId("record-facts");
    expect(screen.queryByRole("button", { name: /Accept suggested/ })).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send back" })).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(screen.getByRole("button", { name: "Send back" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Send the batch back" });
    fireEvent.change(within(dialog).getByLabelText("What the author has to change"), { target: { value: "Plant 2000 is wrong" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send back" }));
    await waitFor(() => expect(sendBack).toHaveBeenCalledWith("B-241", "Plant 2000 is wrong"));
  });

  it("an owner approves the draft batch", async () => {
    const waiting = fixtureResponse<WorkPage>("/work/records", { limit: 5, status: "proposed" }).items[0];
    const approve = vi.spyOn(workApi, "postApproveBatch");
    mount(`${waiting.module}:${waiting.record_key}`, "&role=owner");
    await screen.findByTestId("record-facts");
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve" })).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith("B-241"));
  });

  it("the History tab lists the runs of the record", async () => {
    mount();
    await screen.findByTestId("record-facts");
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(await screen.findByTestId("history-runs")).toBeInTheDocument();
  });
});
