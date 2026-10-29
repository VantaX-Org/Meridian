import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as workApi from "@/lib/api/v2/work";
import * as batchApi from "@/lib/api/v2/batches";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { resetActions } from "@/lib/v2/undo";
import { clearPatches } from "@/lib/v2/work-overrides";
import { Inspector } from "../Inspector";
import { ToastProvider } from "../Toast";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undoLayout: () => void = () => undefined;

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

function mount(id: string, extra = "") {
  const url = `/v2/work?fixture=1&persona=owner${extra}&open=${encodeURIComponent(`batch:${id}`)}`;
  window.history.pushState({}, "", url);
  setUrl(url);
  return renderWithQuery(
    <ToastProvider>
      <Inspector />
    </ToastProvider>,
  );
}
const body = async (title: string) => {
  const insp = await screen.findByTestId("inspector");
  await screen.findByRole("heading", { level: 2, name: title });
  await within(insp).findByTestId("batch-records");
  return insp;
};
const fact = (insp: HTMLElement, label: string) => text(within(insp).getByText(label, { selector: "dt" }).closest(".m2-fact") as Element);

describe("the batch inspector", () => {
  it("states the facts: owner, steward, created, due, records, value at risk and status", async () => {
    mount("B-241");
    const insp = await body("Batch B-241");
    expect(text(insp.querySelector(".m2-ih-sl") as Element)).toContain("Waiting for approval");
    expect(fact(insp, "Batch")).toContain("B-241");
    expect(fact(insp, "Name")).toContain("Unit of measure and material type");
    expect(fact(insp, "Status")).toContain("Waiting for approval");
    expect(fact(insp, "Owner")).toContain("R. Govender");
    expect(fact(insp, "Steward")).toContain("A. Naidoo");
    expect(fact(insp, "Records")).toContain("328");
    expect(fact(insp, "Value at risk")).toContain("ZAR 413 k");
    expect(fact(insp, "Created")).toMatch(/14 Oct/);
    expect(fact(insp, "Due")).toMatch(/23 Oct/);
  });

  it("lists the first 50 records and links to the ledger filtered to the batch", async () => {
    mount("B-241");
    const insp = await body("Batch B-241");
    const list = within(insp).getByTestId("batch-records");
    expect(within(list).getAllByRole("listitem")).toHaveLength(50);
    expect(insp).toHaveTextContent("50 of 328 records shown");
    const all = within(insp).getByRole("link", { name: "Open all 328 in the ledger" });
    expect(all.getAttribute("href")).toContain("/v2/work?filter=open&batch=B-241");
  });

  it("shows the approval trail, one step per action, with the number of records", async () => {
    mount("B-236");
    const insp = await body("Batch B-236");
    const trail = await within(insp).findByTestId("batch-trail");
    const steps = within(trail).getAllByRole("listitem").map((li) => text(li));
    expect(steps).toHaveLength(2);
    expect(steps[0]).toContain("Drafted by A. Naidoo, 180 records");
    expect(steps[1]).toContain("Approved by T. Mokoena, 180 records");
  });

  it("an owner approves: the API is called for the batch, the status moves on and a notice offers Undo", async () => {
    const approve = vi.spyOn(workApi, "postApproveBatch");
    mount("B-241");
    const insp = await body("Batch B-241");
    expect(within(insp).getByText(/Approving acts on the whole batch/)).toBeInTheDocument();
    fireEvent.click(within(insp).getByRole("button", { name: "Approve batch B-241" }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith("B-241"));
    await waitFor(() => expect(fact(insp, "Status")).toContain("Approved"));
    expect(within(screen.getByTestId("toasts")).getByText("Approved batch B-241")).toBeInTheDocument();
    expect(fact(insp, "Approved by")).toContain("Demo user");
    await waitFor(() => expect(within(insp).getByRole("button", { name: "Send batch B-241 to SAP" })).toBeEnabled());
  });

  it("sends back with a reason", async () => {
    const sendBack = vi.spyOn(workApi, "postSendBack");
    mount("B-238");
    const insp = await body("Batch B-238");
    fireEvent.click(within(insp).getByRole("button", { name: "Send batch B-238 back" }));
    const dialog = await screen.findByRole("dialog", { name: "Send the batch back" });
    expect(within(dialog).getByRole("button", { name: "Send back" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("What the author has to change"), { target: { value: "Check the MRP types" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send back" }));
    await waitFor(() => expect(sendBack).toHaveBeenCalledWith("B-238", "Check the MRP types"));
    await waitFor(() => expect(within(insp).getByTestId("batch-returned")).toHaveTextContent("Check the MRP types"));
    await waitFor(() => expect(within(within(insp).getByTestId("batch-trail")).getAllByRole("listitem").map(text).join("|")).toContain("Sent back by Demo user"));
  });

  it("a batch the person built cannot be approved by them", async () => {
    mount("B-244");
    const insp = await body("Batch B-244");
    expect(within(insp).getByRole("button", { name: "Approve batch B-244" })).toBeDisabled();
    expect(within(insp).getByText("You built this batch, so a second person approves it.")).toBeInTheDocument();
  });

  it("an approved batch offers Send to SAP: the file it handed over is shown in the frame, with the checksum", async () => {
    const send = vi.spyOn(batchApi, "sendBatchToSap");
    mount("B-236");
    const insp = await body("Batch B-236");
    fireEvent.click(within(insp).getByRole("button", { name: "Send batch B-236 to SAP" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith("B-236", 180));
    const result = await within(insp).findByTestId("action-result");
    expect(text(result)).toContain("Sent to SAP, 180 records");
    expect(text(result)).toContain("remediation-cockpit_xlsx-B-236.xlsx");
    expect(text(result)).toContain("sha256 9f2c4e1a7b3d");
    await waitFor(() => expect(fact(insp, "Status")).toContain("Sent to SAP"));
    expect(within(insp).queryByRole("button", { name: "Send batch B-236 to SAP" })).toBeNull();
    expect(within(insp).getByText(/^Sent to SAP, 180 records, /)).toBeInTheDocument();
  });

  it("links the job a live write-back started from the result", async () => {
    vi.spyOn(batchApi, "sendBatchToSap").mockResolvedValueOnce({ filename: "x.xlsx", sha256: null, records: 180, job_id: "job-77" });
    mount("B-236");
    const insp = await body("Batch B-236");
    fireEvent.click(within(insp).getByRole("button", { name: "Send batch B-236 to SAP" }));
    const result = await within(insp).findByTestId("action-result");
    expect(within(result).getByRole("link", { name: "Open the job" }).getAttribute("href")).toContain("open=job%3Ajob-77");
  });

  it("downloads the sheet of the batch's records as CSV", async () => {
    const dl = vi.spyOn(batchApi, "downloadBatchSheet").mockReturnValue("b-241-sheet.csv");
    mount("B-241");
    const insp = await body("Batch B-241");
    fireEvent.click(within(insp).getByRole("button", { name: "Download sheet" }));
    await waitFor(() => expect(dl).toHaveBeenCalled());
    expect(dl.mock.calls[0][0]).toBe("B-241");
    expect(dl.mock.calls[0][1].length).toBeGreaterThan(0);
    expect(await screen.findByText("Sheet saved as b-241-sheet.csv")).toBeInTheDocument();
  });

  it("reassigns the batch's records to a chosen person through the assign decision", async () => {
    const decide = vi.spyOn(workApi, "postDecide");
    mount("B-241");
    const insp = await body("Batch B-241");
    fireEvent.click(within(insp).getByRole("button", { name: "Reassign…" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /A\. Naidoo/ }));
    await waitFor(() => expect(decide).toHaveBeenCalled());
    const items = decide.mock.calls[0][0];
    expect(items.length).toBeGreaterThan(1);
    expect(items[0]).toMatchObject({ action: "assign", assignee: "u-an" });
    expect(await screen.findByText(/Reassigned \d+ records of batch B-241 to A\. Naidoo/)).toBeInTheDocument();
  });

  it("a role that cannot approve sees no Approve, and is told why", async () => {
    mount("B-241", "&role=viewer");
    const insp = await body("Batch B-241");
    expect(within(insp).queryByRole("button", { name: /^Approve batch/ })).toBeNull();
    expect(within(insp).getByText(/Approving needs the approve permission/)).toBeInTheDocument();
    expect(within(insp).getByRole("button", { name: "Download sheet" })).toBeEnabled();
    expect(within(insp).getByRole("button", { name: "Reassign…" })).toBeInTheDocument();
  });

  it("says so for a batch that is not in the list", async () => {
    mount("B-999");
    expect(await screen.findByText(/This batch is not in the list/)).toBeInTheDocument();
  });
});
