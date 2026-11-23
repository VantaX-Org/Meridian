import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, SheetHost, ToastHost } from "@/ui/kit";
import { SHEETS } from "@/ui/sheets";
import { CleaningQueue } from "./CleaningQueue";
import { CleanBoard } from "./CleanBoard";
import { Work } from "./Work";
import { Exceptions } from "./Exceptions";
import { Triage } from "./Triage";
import { DataRequests } from "./DataRequests";
import { BatchDetail } from "./Approvals";
import { RecordDetail } from "./RecordDetail";
import { FIXTURE_ME } from "@/lib/v2/hooks";

const m = vi.hoisted(() => ({
  commentException: vi.fn(),
  assignException: vi.fn(),
  postAcceptAll: vi.fn(),
  postSetValue: vi.fn(),
  getLandscape: vi.fn(),
  bulkTriage: vi.fn(),
  submitDataRequest: vi.fn(),
  postSendBack: vi.fn(),
  getGroups: vi.fn(),
  getRecord: vi.fn(),
  listDataRequests: vi.fn(),
  getDataRequest: vi.fn(),
  real: {} as Record<string, (...a: never[]) => unknown>,
}));

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/api/v2/exceptions", async (orig) => ({ ...(await orig<typeof import("@/lib/api/v2/exceptions")>()), commentException: m.commentException, assignException: m.assignException }));
vi.mock("@/lib/api/v2/work", async (orig) => {
  const a = await orig<typeof import("@/lib/api/v2/work")>();
  m.real.getGroups = a.getGroups as never;
  m.real.getRecord = a.getRecord as never;
  return { ...a, postAcceptAll: m.postAcceptAll, postSetValue: m.postSetValue, postSendBack: m.postSendBack, getGroups: m.getGroups, getRecord: m.getRecord };
});
vi.mock("@/lib/api/v2/landscape", async (orig) => {
  const a = await orig<typeof import("@/lib/api/v2/landscape")>();
  m.getLandscape.mockImplementation(a.getLandscape);
  return { ...a, getLandscape: m.getLandscape };
});
vi.mock("@/lib/api/v2/triage", async (orig) => ({ ...(await orig<typeof import("@/lib/api/v2/triage")>()), bulkTriage: m.bulkTriage }));
vi.mock("@/lib/api/v2/data-requests", async (orig) => {
  const a = await orig<typeof import("@/lib/api/v2/data-requests")>();
  m.real.listDataRequests = a.listDataRequests as never;
  m.real.getDataRequest = a.getDataRequest as never;
  return { ...a, submitDataRequest: m.submitDataRequest, listDataRequests: m.listDataRequests, getDataRequest: m.getDataRequest };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout(); window.sessionStorage.clear();
  for (const k of ["getGroups", "getRecord", "listDataRequests", "getDataRequest"] as const) m[k].mockImplementation((...a: never[]) => m.real[k](...a));
});
afterEach(() => { undo(); vi.clearAllMocks(); });

const group = { check_id: "MARA.R1", module: "material_master", severity: "high", dimension: null, message: "Blank base unit", field: "MARA.MEINS", records: 4, population: 10, proposed: 4, truncated: false, statuses: {}, open: 4 };
const groupsOf = (n: number) => ({ version_id: "v1", built: true, total: n, groups: Array.from({ length: n }, (_, i) => ({ ...group, check_id: `MARA.R${i + 1}`, proposed: 4 - i })) });

const mount = (path: string, el: ReactElement) => {
  window.history.replaceState(null, "", path);
  return renderWithQuery(<AletheiaProvider><ToastHost><SheetHost sheets={SHEETS} closeLabel="Close">{el}</SheetHost></ToastHost></AletheiaProvider>);
};

describe("Cleaning queue reject", () => {
  it("keeps the dialog open and asks for a reason when the reason is empty", async () => {
    mount("/work/cleaning?fixture=1", <CleaningQueue />);
    fireEvent.click((await screen.findAllByRole("row", {}, { timeout: 5000 }))[1]);
    fireEvent.click(await screen.findByRole("button", { name: "Reject the group" }, { timeout: 5000 }));
    const dialog = await screen.findByRole("alertdialog", { name: "Reject the fix" });
    expect(within(dialog).getByText("A reason is required.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(screen.getByRole("alertdialog", { name: "Reject the fix" })).toBeTruthy();
  });
});

describe("Work saved view and bulk guard", () => {
  it("names a view in a dialog with a text field and refuses an empty name", async () => {
    const prompt = vi.spyOn(window, "prompt");
    mount("/work?fixture=1", <Work />);
    fireEvent.click(await screen.findByRole("button", { name: "Save this view" }, { timeout: 5000 }));
    const dialog = await screen.findByRole("alertdialog", { name: "Name this view" });
    expect(within(dialog).getByText("A name is required.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save this view" }));
    expect(screen.getByRole("alertdialog", { name: "Name this view" })).toBeTruthy();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "View name" }), { target: { value: "Late fixes" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save this view" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog", { name: "Name this view" })).toBeNull());
    expect(prompt).not.toHaveBeenCalled();
  });

  it("runs one bulk action at a time", async () => {
    let done: (v: { accepted: number }) => void = () => undefined;
    m.postAcceptAll.mockImplementation(() => new Promise((r) => { done = r; }));
    m.getGroups.mockResolvedValue(groupsOf(1));
    mount("/work?fixture=1", <Work />);
    const list = await screen.findByRole("list", { name: "Rules with work" }, { timeout: 5000 });
    fireEvent.click(await within(list).findByRole("button", { name: /Blank base unit/ }));
    const btn = await screen.findByRole("button", { name: "Accept every proposed value" }, { timeout: 5000 });
    fireEvent.click(btn);
    const ok = await screen.findByRole("button", { name: "Accept all" }, { timeout: 5000 });
    fireEvent.click(ok);
    fireEvent.click(ok);
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(true));
    expect(m.postAcceptAll).toHaveBeenCalledTimes(1);
    done({ accepted: 1 });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
  });
});

describe("Exceptions", () => {
  const openFirst = async () => {
    fireEvent.click((await screen.findAllByRole("row", {}, { timeout: 5000 }))[1]);
    return screen.findByRole("button", { name: "Add comment" }, { timeout: 5000 });
  };

  it("sends the stable user id as the comment author, never a translated word", async () => {
    m.commentException.mockResolvedValue({});
    mount("/work/exceptions?fixture=1", <Exceptions />);
    const add = await openFirst();
    fireEvent.change(screen.getByRole("textbox", { name: "Add a comment" }), { target: { value: "Checked with the owner" } });
    fireEvent.click(add);
    await waitFor(() => expect(m.commentException).toHaveBeenCalledTimes(1));
    expect(m.commentException.mock.calls[0][1]).toBe("Checked with the owner");
    expect(m.commentException.mock.calls[0][2]).toBe(FIXTURE_ME);
  });

  it("assigns to the picked person, sending the id and the name", async () => {
    m.assignException.mockResolvedValue({});
    mount("/work/exceptions?fixture=1", <Exceptions />);
    await openFirst();
    const owner = screen.getByRole("combobox", { name: "Owner" }) as HTMLSelectElement;
    const assign = screen.getByRole("button", { name: "Assign" });
    expect((assign as HTMLButtonElement).disabled).toBe(true);
    const pick = await waitFor(() => { const o = [...owner.options].find((x) => x.value); if (!o) throw new Error("no people"); return o; });
    fireEvent.change(owner, { target: { value: pick.value } });
    fireEvent.click(assign);
    await waitFor(() => expect(m.assignException).toHaveBeenCalledTimes(1));
    expect(m.assignException.mock.calls[0][1]).toBe(pick.value);
    expect(m.assignException.mock.calls[0][2]).toBe(pick.text);
  });

  it("says Admins only on the billing tab without manage_settings", async () => {
    mount("/work/exceptions?fixture=1&role=viewer", <Exceptions />);
    fireEvent.click(await screen.findByRole("tab", { name: "Billing" }, { timeout: 5000 }));
    expect(await screen.findByText("Admins only")).toBeTruthy();
  });

  it("shows billing to an admin", async () => {
    mount("/work/exceptions?fixture=1", <Exceptions />);
    fireEvent.click(await screen.findByRole("tab", { name: "Billing" }, { timeout: 5000 }));
    await screen.findByText("Exception billing", {}, { timeout: 5000 });
    expect(screen.queryByText("Admins only")).toBeNull();
  });
});

describe("Clean board failures", () => {
  it("shows an error with a retry when the landscape does not load", async () => {
    m.getLandscape.mockRejectedValueOnce(new Error("down"));
    mount("/work?fixture=1", <CleanBoard />);
    expect(await screen.findByText("The clean cycle could not be loaded", {}, { timeout: 5000 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: /Clean cycle/ }, { timeout: 5000 })).toBeTruthy();
  });

  it("keeps going after a failed rule and reports how many failed", async () => {
    m.getGroups.mockResolvedValue(groupsOf(3));
    m.postAcceptAll.mockRejectedValueOnce(new Error("no")).mockResolvedValue({ accepted: 2 });
    mount("/work?fixture=1", <CleanBoard />);
    fireEvent.click(await screen.findByRole("button", { name: /^Approve all \d/ }, { timeout: 5000 }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve all" }, { timeout: 5000 }));
    expect(await screen.findByText("1 rules failed. Try again.", {}, { timeout: 5000 })).toBeTruthy();
    expect(m.postAcceptAll).toHaveBeenCalledTimes(3);
  });
});

describe("Triage validation", () => {
  it("blocks priority outside 1 to 5 and a snooze in the past", async () => {
    mount("/work/triage?fixture=1", <Triage />);
    fireEvent.click((await screen.findAllByRole("checkbox", {}, { timeout: 5000 }))[0]);
    const apply = screen.getByRole("button", { name: /^Apply to 1/ }) as HTMLButtonElement;
    fireEvent.change(screen.getByRole("combobox", { name: "Action" }), { target: { value: "priority" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Priority (1 is highest)" }), { target: { value: "9" } });
    expect(apply.disabled).toBe(true);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Priority (1 is highest)" }), { target: { value: "3" } });
    expect(apply.disabled).toBe(false);
    fireEvent.change(screen.getByRole("combobox", { name: "Action" }), { target: { value: "snooze" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Why snooze" }), { target: { value: "Waiting" } });
    fireEvent.change(screen.getByLabelText("Until"), { target: { value: "2001-01-01T10:00" } });
    expect(apply.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Until"), { target: { value: "2999-01-01T10:00" } });
    expect(apply.disabled).toBe(false);
  });
});

describe("Data requests", () => {
  it("keeps a failed item's answer and shows its error beside it", async () => {
    m.submitDataRequest.mockImplementation(async (_id: string, values: { item_id: string }[]) => ({ submitted: values.length - 1, errors: [{ item_id: values[0].item_id, error: "Too long for the field" }] }));
    const sum = { id: "r1", version_id: "v1", module: "material_master", owner_id: "u1", owner_name: "Ann", due_date: "2999-01-01", note: "", created_at: "2026-01-01", total: 2, open: 2, submitted: 0, approved: 0, rejected: 0, status: "open" };
    const item = (id: string) => ({ id, check_id: "MARA.R1", record_key: `MATNR=${id}`, field: "MARA.MAKTX", state: "open", max_length: 40, allowed_values: null });
    m.listDataRequests.mockResolvedValue([sum]);
    m.getDataRequest.mockResolvedValue({ ...sum, items: [item("i1"), item("i2")] });
    mount("/work/requests?fixture=1", <DataRequests />);
    fireEvent.click((await screen.findAllByRole("row", {}, { timeout: 5000 }))[1]);
    const box = (await screen.findAllByRole("textbox", { name: /^Answer for/ }, { timeout: 5000 }))[0] as HTMLInputElement;
    fireEvent.change(box, { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
    const err = await screen.findByRole("alert", {}, { timeout: 5000 });
    expect(err.textContent).toBe("Too long for the field");
    expect((screen.getAllByRole("textbox", { name: /^Answer for/ })[0] as HTMLInputElement).value).toBe("abc");
  });
});

describe("Approvals send back", () => {
  const batch = { id: "b1", label: "B1", name: "Batch", status: "draft", records: 3, owner: "Ann", modules: ["material"], returned: null, verification: null } as unknown as Parameters<typeof BatchDetail>[0]["b"];
  it("needs a reason before it sends the batch back", async () => {
    m.postSendBack.mockResolvedValue({});
    mount("/approvals?fixture=1", <BatchDetail b={batch} />);
    fireEvent.click(screen.getByRole("button", { name: "Send back" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Send this batch back?" });
    expect(within(dialog).getByText("A reason is required.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send back" }));
    expect(m.postSendBack).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Reason" }), { target: { value: "Wrong plant" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send back" }));
    await waitFor(() => expect(m.postSendBack).toHaveBeenCalledWith("b1", "Wrong plant"));
  });
});

describe("Record detail", () => {
  it("shows the proposed value as text, not an object", async () => {
    const issue = { check_id: "MARA.R1", severity: "high", dimension: null, message: "Blank base unit", field: "MARA.MEINS", current_value: null, instruction: null, why_it_matters: null, sap_impact: null, suggestion: { value: "EA", source: "rule", confidence: null, why: null }, status: "proposed", issue_id: "x", resolution: null };
    m.getRecord.mockResolvedValue({ version_id: "v1", module: "material_master", record_key: "MATNR=1", name: null, status: "proposed", assigned_to: null, assignee_email: null, values: {}, issues: [issue], events: [], can: { fix: true, sign_off: true, assign: true, comment: true } });
    mount("/work?fixture=1", <RecordDetail module="material_master" recordKey="MATNR=1" />);
    fireEvent.click(await screen.findByRole("tab", { name: /^Fix/ }, { timeout: 5000 }));
    const line = await screen.findByText(/Proposed:/, {}, { timeout: 5000 });
    expect(line.textContent).toContain("Proposed: EA");
    expect(line.textContent).not.toContain("[object");
  });
});
