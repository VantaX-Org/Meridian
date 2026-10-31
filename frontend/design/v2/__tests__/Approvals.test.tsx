import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as workApi from "@/lib/api/v2/work";
import * as batchApi from "@/lib/api/v2/batches";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { resetActions } from "@/lib/v2/undo";
import { clearPatches } from "@/lib/v2/work-overrides";
import { WorkCanvas } from "../screens/Work";
import { Inspector } from "../Inspector";
import { ToastProvider } from "../Toast";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undoLayout: () => void = () => undefined;

function visit(search = "") {
  const url = `/work?fixture=1${search}`;
  window.history.pushState({}, "", url);
  setUrl(url);
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  window.localStorage.clear();
  resetWorkFixture();
  resetActions();
  clearPatches();
  undoLayout = stubLayout(1400, 700);
});
afterEach(() => {
  undoLayout();
  vi.restoreAllMocks();
});

const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

function mount(search = "") {
  visit(search);
  return renderWithQuery(
    <ToastProvider>
      <WorkCanvas />
      <Inspector />
    </ToastProvider>,
  );
}

const ledger = () => screen.findByRole("grid", { name: "Work ledger" });
const chip = (name: RegExp) => within(screen.getByRole("group", { name: "Filter by state" })).getByRole("button", { name });

describe("Waiting for approval: records under their batch", () => {
  it("shows a header row per draft batch with its owner, records, value at risk and due date, and the records under it", async () => {
    mount("&persona=owner&filter=approvals&density=compact");
    const grid = await ledger();
    const b241 = await within(grid).findByTestId("batch-row-B-241");
    const line = text(b241);
    expect(line).toContain("B-241");
    expect(line).toContain("Unit of measure and material type");
    expect(line).toContain("R. Govender");
    expect(line).toContain("328 records");
    expect(line).toContain("ZAR 413 k est. at risk");
    expect(line).toMatch(/due 23 Oct/);
    expect(within(b241).getByRole("button", { name: "Approve batch B-241" })).toBeEnabled();
    expect(within(b241).getByRole("button", { name: "Send batch B-241 back" })).toBeEnabled();
    // The batches are in the order they were built, newest first, each followed by its own records.
    const heads = within(grid).getAllByTestId(/^batch-row-/).map((h) => h.getAttribute("data-testid"));
    expect(heads.slice(0, 2)).toEqual(["batch-row-B-244", "batch-row-B-241"]);
    const rows = within(grid).getAllByRole("row");
    const at = (id: string) => rows.findIndex((r) => r.querySelector(`[data-testid="batch-row-${id}"]`));
    expect(at("B-241")).toBeGreaterThan(at("B-244") + 1);
  });

  it("Approve calls the approve endpoint for the batch, posts a notice with Undo, and moves the batch out of the waiting count", async () => {
    const approve = vi.spyOn(workApi, "postApproveBatch");
    mount("&persona=owner&filter=approvals&density=compact");
    const grid = await ledger();
    await waitFor(() => expect(chip(/Waiting for approval/)).toHaveTextContent("612"));
    fireEvent.click(await within(grid).findByRole("button", { name: "Approve batch B-241" }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith("B-241"));
    expect(await screen.findByText("Approved batch B-241")).toBeInTheDocument();
    expect(within(screen.getByTestId("toasts")).getByRole("button", { name: "Undo" })).toBeInTheDocument();
    await waitFor(() => expect(chip(/Waiting for approval/)).toHaveTextContent("284"));
    // Undo puts it back.
    fireEvent.click(within(screen.getByTestId("toasts")).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(chip(/Waiting for approval/)).toHaveTextContent("612"));
  });

  it("Send back asks for a reason and sends it with the batch", async () => {
    const sendBack = vi.spyOn(workApi, "postSendBack");
    mount("&persona=owner&filter=approvals&density=compact");
    const grid = await ledger();
    fireEvent.click(await within(grid).findByRole("button", { name: "Send batch B-241 back" }));
    const dialog = await screen.findByRole("dialog", { name: "Send the batch back" });
    fireEvent.change(within(dialog).getByLabelText("What the author has to change"), { target: { value: "Plant 2000 is wrong" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send back" }));
    await waitFor(() => expect(sendBack).toHaveBeenCalledWith("B-241", "Plant 2000 is wrong"));
    expect(await screen.findByText("Sent batch B-241 back")).toBeInTheDocument();
  });

  it("will not let the author approve their own batch, and says why", async () => {
    mount("&persona=owner&filter=approvals&density=compact");
    const grid = await ledger();
    const own = await within(grid).findByRole("button", { name: "Approve batch B-244" });
    expect(own).toBeDisabled();
    expect(own).toHaveAttribute("title", "You built this batch; a second person approves it.");
  });

  it("offers no Approve or Send back to a role that cannot approve", async () => {
    mount("&persona=steward&role=viewer&filter=approvals&density=compact");
    const grid = await ledger();
    await within(grid).findByTestId("batch-row-B-241");
    expect(screen.queryByRole("button", { name: /^Approve batch/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /back$/ })).toBeNull();
  });

  it("shows a refusal from the server as a notice", async () => {
    vi.spyOn(workApi, "postApproveBatch").mockRejectedValueOnce(Object.assign(new Error("x"), { response: { data: { detail: "The batch creator cannot approve it." } } }));
    mount("&persona=owner&filter=approvals&density=compact");
    const grid = await ledger();
    fireEvent.click(await within(grid).findByRole("button", { name: "Approve batch B-241" }));
    expect(await screen.findByText("The batch creator cannot approve it.")).toBeInTheDocument();
  });
});

describe("Exceptions: the sign-off, its reason, who and when, and Reopen", () => {
  it("lists signed-off records with their resolution, reason, who and when", async () => {
    mount("&persona=steward&filter=exceptions");
    const grid = await ledger();
    await waitFor(() => expect(within(grid).getAllByRole("row").length).toBeGreaterThan(3));
    const heads = within(grid).getAllByRole("columnheader").map((h) => text(h));
    for (const h of ["Resolution", "Reason", "Signed off by", "When", "Reopen"]) expect(heads).toContain(h);
    expect(heads).not.toContain("New value");
    const first = within(grid).getAllByRole("row")[1];
    expect(text(first)).toMatch(/Accept risk|Not an issue/);
    expect(text(first)).toMatch(/T\. Mokoena|R\. Govender|P\. Khumalo/);
    expect(within(grid).getAllByRole("button", { name: /^Reopen / }).length).toBeGreaterThan(0);
  });

  it("Reopen puts the record back to rows to fix with one undoable change", async () => {
    const decide = vi.spyOn(workApi, "postDecide");
    mount("&persona=steward&filter=exceptions");
    const grid = await ledger();
    await waitFor(() => expect(chip(/Exceptions/)).toHaveTextContent("48"));
    const reopen = (await within(grid).findAllByRole("button", { name: /^Reopen / }))[0];
    fireEvent.click(reopen);
    await waitFor(() => expect(decide).toHaveBeenCalled());
    expect(decide.mock.calls[0][0][0]).toMatchObject({ action: "undo" });
    expect(await screen.findByText("Reopened 1 record")).toBeInTheDocument();
    await waitFor(() => expect(chip(/Exceptions/)).toHaveTextContent("47"));
    await waitFor(() => expect(chip(/To fix/)).toHaveTextContent("25,713"));
  });

  it("gives Reopen to stewards only", async () => {
    mount("&persona=owner&role=owner&filter=exceptions");
    const grid = await ledger();
    await waitFor(() => expect(within(grid).getAllByRole("row").length).toBeGreaterThan(3));
    expect(within(grid).queryByRole("button", { name: /^Reopen / })).toBeNull();
  });
});

describe("Write-back: Send to SAP", () => {
  it("an approved batch shows Send to SAP; sending shows the result in the frame and the batch as sent", async () => {
    const send = vi.spyOn(batchApi, "sendBatchToSap");
    mount("&persona=steward&filter=open&batch=B-236");
    const grid = await ledger();
    const head = await within(grid).findByTestId("batch-row-B-236");
    expect(text(head)).toContain("Approved by T. Mokoena");
    expect(text(head)).toContain("180 records");
    // The per-record status.
    expect(within(grid).getAllByRole("columnheader").map((h) => text(h))).toContain("Status");
    await waitFor(() => expect(within(grid).getAllByText("Approved").length).toBeGreaterThan(0));
    fireEvent.click(within(head).getByRole("button", { name: "Send batch B-236 to SAP" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith("B-236", 180));
    const result = await screen.findByTestId("action-result");
    expect(text(result)).toContain("Load file exported, 180 records");
    expect(text(result)).toContain("remediation-cockpit_xlsx-B-236.xlsx");
    await waitFor(() => expect(text(within(grid).getByTestId("batch-row-B-236"))).toMatch(/Sent to SAP, 180 records, /));
    await waitFor(() => expect(within(grid).getAllByText("Sent to SAP").length).toBeGreaterThan(0));
    expect(within(grid).queryByRole("button", { name: "Send batch B-236 to SAP" })).toBeNull();
  });

  it("a sent batch shows 'Sent to SAP, N records, date' and the status of each record", async () => {
    mount("&persona=steward&filter=open&batch=B-229");
    const grid = await ledger();
    const head = await within(grid).findByTestId("batch-row-B-229");
    expect(text(head)).toMatch(/Sent to SAP, 96 records, 9 Oct/);
    await waitFor(() => expect(within(grid).getAllByText("Sent to SAP").length).toBeGreaterThan(0));
    expect(within(head).queryByRole("button", { name: /Send batch/ })).toBeNull();
  });

  it("is not offered to a role without the export permission", async () => {
    mount("&persona=steward&role=viewer&filter=open&batch=B-236");
    const grid = await ledger();
    await within(grid).findByTestId("batch-row-B-236");
    expect(screen.queryByRole("button", { name: /to SAP$/ })).toBeNull();
  });

  it("shows the server's refusal in the frame, not as a stack trace", async () => {
    vi.spyOn(batchApi, "sendBatchToSap").mockRejectedValueOnce(Object.assign(new Error("x"), { response: { data: { detail: "The batch creator cannot export it." } } }));
    mount("&persona=steward&filter=open&batch=B-236");
    const grid = await ledger();
    fireEvent.click(await within(grid).findByRole("button", { name: "Send batch B-236 to SAP" }));
    const result = await screen.findByTestId("action-result");
    expect(text(result)).toContain("The batch creator cannot export it.");
  });

  it("says the list is not narrowed to the batch when the API sends no batch on a row", async () => {
    const real = workApi.getWork;
    vi.spyOn(workApi, "getWork").mockImplementation(async (q) => {
      const page = await real(q);
      return { ...page, items: page.items.map((r) => ({ ...r, batch_id: undefined, batch_name: undefined })) };
    });
    mount("&persona=steward&filter=open&batch=B-236");
    await ledger();
    expect(await screen.findByTestId("batch-unfiltered")).toHaveTextContent("not narrowed to the batch");
  });
});
