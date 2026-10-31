import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as workApi from "@/lib/api/v2/work";
import * as batchApi from "@/lib/api/v2/batches";
import * as adminApi from "@/lib/api/v2/admin";
import { fixtureWrite, resetAdminFixture } from "@/lib/api/v2/fixtures";
import type { BatchWritebackCheck, BatchWritebackSend } from "@/lib/api/v2/batches";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { setFixtureBatchStatus } from "@/lib/api/v2/fixtures/work-fixture";
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
  resetAdminFixture();
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
  const url = `/work?fixture=1&persona=owner${extra}&open=${encodeURIComponent(`batch:${id}`)}`;
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
    expect(all.getAttribute("href")).toContain("/work?filter=open&batch=B-241");
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
    await waitFor(() => expect(approve).toHaveBeenCalledWith("B-241", false));
    await waitFor(() => expect(fact(insp, "Status")).toContain("Approved"));
    expect(within(screen.getByTestId("toasts")).getByText("Approved batch B-241")).toBeInTheDocument();
    expect(fact(insp, "Approved by")).toContain("Demo user");
    await waitFor(() => expect(within(insp).getByRole("button", { name: "Export batch B-241 as a load file" })).toBeEnabled());
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

  it("F12: records without a new value stop the approval; the others can be approved without them", async () => {
    const approve = vi.spyOn(workApi, "postApproveBatch");
    mount("B-238");
    const insp = await body("Batch B-238");
    fireEvent.click(within(insp).getByRole("button", { name: "Approve batch B-238" }));
    const dialog = await screen.findByRole("dialog", { name: "Some records have no new value" });
    expect(text(dialog)).toContain("3 records have no new value");
    expect(within(dialog).getByRole("button", { name: "Send back" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve the others" }));
    await waitFor(() => expect(approve).toHaveBeenLastCalledWith("B-238", true));
    await waitFor(() => expect(fact(insp, "Status")).toContain("Approved"));
  });

  it("F09: a loaded batch says what the next run found and opens the ones still failing", async () => {
    mount("B-229");
    const insp = await body("Batch B-229");
    const v = within(insp).getByTestId("batch-verified");
    expect(text(v)).toContain("Verified on run 12 Oct 2026: 88 fixed, 8 still failing.");
    expect(within(v).getByRole("link", { name: "Open the 8" }).getAttribute("href")).toContain("batch=B-229");
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
    fireEvent.click(within(insp).getByRole("button", { name: "Export batch B-236 as a load file" }));
    // F08: asked once, naming who loads the file.
    const dialog = await screen.findByRole("dialog", { name: "Export the load file" });
    expect(within(dialog).getByTestId("export-loader")).toHaveTextContent("The SAP Basis people gets the file in the inbox");
    fireEvent.click(within(dialog).getByRole("button", { name: "Export load file" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith("B-236", 180, null));
    const result = await within(insp).findByTestId("action-result");
    expect(text(result)).toContain("Load file exported, 180 records");
    expect(text(result)).toContain("remediation-cockpit_xlsx-B-236.xlsx");
    expect(text(result)).toContain("sha256 9f2c4e1a7b3d");
    await waitFor(() => expect(fact(insp, "Status")).toContain("Sent to SAP"));
    expect(within(insp).queryByRole("button", { name: "Export batch B-236 as a load file" })).toBeNull();
    expect(within(insp).getByText(/^Sent to SAP, 180 records, /)).toBeInTheDocument();
  });

  it("links the job a live write-back started from the result", async () => {
    vi.spyOn(batchApi, "sendBatchToSap").mockResolvedValueOnce({ filename: "x.xlsx", sha256: null, records: 180, job_id: "job-77" });
    mount("B-236");
    const insp = await body("Batch B-236");
    fireEvent.click(within(insp).getByRole("button", { name: "Export batch B-236 as a load file" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Export the load file" })).getByRole("button", { name: "Export load file" }));
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

describe("live write-back of an approved batch", () => {
  /** Live write-back on, as GET /settings reports it when MERIDIAN_LIVE_WRITEBACK_ENABLED is set. */
  const liveOn = async () => {
    const base = await adminApi.getTenantSettings();
    vi.spyOn(adminApi, "getTenantSettings").mockResolvedValue({ ...base, live_writeback: true });
  };
  const rowsOf = (insp: HTMLElement, name: string) => within(within(insp).getByRole("grid", { name })).getAllByRole("row").slice(1);

  it("is not offered while the API reports live write-back off: the button is Export load file", async () => {
    mount("B-236");
    const insp = await body("Batch B-236");
    expect(within(insp).queryByTestId("live-writeback")).toBeNull();
    expect(within(insp).queryByRole("button", { name: "Check with SAP" })).toBeNull();
    expect(within(insp).getByRole("button", { name: "Export batch B-236 as a load file" })).toHaveTextContent("Export load file");
  });

  it("step 1, Check with SAP: a table of the fields, BAPI or export, and the reason; nothing is sent", async () => {
    await liveOn();
    const check = vi.spyOn(batchApi, "checkBatchWriteback");
    const send = vi.spyOn(batchApi, "sendBatchWriteback");
    mount("B-236");
    const insp = await body("Batch B-236");
    const live = await within(insp).findByTestId("live-writeback");
    // The load file stays, under its own name; Send to SAP waits for the check.
    expect(within(insp).getByRole("button", { name: "Export batch B-236 as a load file" })).toHaveTextContent("Export load file");
    expect(within(live).getByRole("button", { name: "Send to SAP" })).toBeDisabled();
    fireEvent.click(within(live).getByRole("button", { name: "Check with SAP" }));
    await waitFor(() => expect(check).toHaveBeenCalledWith("B-236"));
    const expected = fixtureWrite<BatchWritebackCheck>("POST", "/writeback/batches/B-236/check", undefined, {});
    const rows = await waitFor(() => rowsOf(insp, "Fields checked with SAP"));
    expect(rows).toHaveLength(Math.min(expected.fields.length, rows.length));
    const bapiRow = expected.fields.findIndex((f) => f.delivery === "bapi");
    const exportRow = expected.fields.findIndex((f) => f.delivery === "export");
    expect(bapiRow).toBeGreaterThanOrEqual(0);
    expect(exportRow).toBeGreaterThanOrEqual(0);
    if (bapiRow < rows.length) {
      expect(text(rows[bapiRow])).toContain(expected.fields[bapiRow].field.replace(".", "-"));
      expect(text(rows[bapiRow])).toContain("BAPI_MATERIAL_SAVEDATA");
      expect(text(rows[bapiRow])).toContain("A BAPI carries it");
    }
    if (exportRow < rows.length) {
      expect(text(rows[exportRow])).toContain("Export");
      expect(text(rows[exportRow])).toContain(expected.fields[exportRow].reason ?? "");
    }
    expect(fact(live, "Fields by BAPI")).toContain(String(expected.bapi));
    expect(fact(live, "Fields by export")).toContain(String(expected.export_only));
    expect(send).not.toHaveBeenCalled();
    expect(within(live).getByRole("button", { name: "Send to SAP" })).toBeEnabled();
  });

  it("step 2, Send to SAP: confirm with the record count, then each record's result with SAP's RETURN messages and a summary", async () => {
    await liveOn();
    const send = vi.spyOn(batchApi, "sendBatchWriteback");
    mount("B-236");
    const insp = await body("Batch B-236");
    const live = await within(insp).findByTestId("live-writeback");
    fireEvent.click(within(live).getByRole("button", { name: "Check with SAP" }));
    await within(live).findByTestId("writeback-check");
    const records = Number(fact(live, "Records").replace(/\D/g, ""));
    expect(records).toBeGreaterThan(0);
    fireEvent.click(within(live).getByRole("button", { name: "Send to SAP" }));
    const dialog = await screen.findByRole("dialog", { name: "Send batch B-236 to SAP" });
    expect(text(dialog)).toContain(`${records} records are written to SAP now`);
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: `Send ${records} records` }));
    await waitFor(() => expect(send).toHaveBeenCalledWith("B-236"));
    const result = (await send.mock.results[0].value) as BatchWritebackSend;
    const summary = await within(live).findByTestId("writeback-summary");
    expect(text(summary)).toBe(`Sent ${result.sent}, failed ${result.failed}, export only ${result.export_only}.`);
    expect(result.sent).toBeGreaterThan(0);
    expect(result.failed).toBeGreaterThan(0);
    const lines = rowsOf(insp, "What SAP answered, per record").map(text);
    // The first record: the test run's and the commit's RETURN messages, type, class, number and text.
    const first = result.records[0];
    expect(lines.some((l) => l.includes(first.record_key) && l.includes("Written to SAP") && l.includes("Test run") && l.includes("M3") && l.includes("801") && l.includes(first.simulate_messages[0].message))).toBe(true);
    expect(lines.some((l) => l.includes("Commit") && l.includes(first.messages[0].message))).toBe(true);
    // A refusal shows SAP's error message.
    const refused = result.records.find((r) => !r.committed);
    if (refused && lines.length < 20) expect(lines.some((l) => l.includes("Refused by SAP") && l.includes(refused.simulate_messages[0].message))).toBe(true);
    await waitFor(() => expect(fact(insp, "Status")).toContain("Sent to SAP"));
    // Once sent, the answer stays on screen and nothing is offered again.
    expect(within(live).getByTestId("writeback-summary")).toBeInTheDocument();
    expect(within(live).queryByRole("button", { name: "Send to SAP" })).toBeNull();
  });

  it("the permission gate: Send to SAP needs approve; a role without it is told why and sends nothing", async () => {
    await liveOn();
    const send = vi.spyOn(batchApi, "sendBatchWriteback");
    mount("B-236", "&role=analyst");
    const insp = await body("Batch B-236");
    const live = await within(insp).findByTestId("live-writeback");
    expect(within(live).queryByRole("button", { name: "Send to SAP" })).toBeNull();
    expect(within(live).queryByRole("button", { name: "Check with SAP" })).toBeNull();
    expect(within(live).getByText("Sending to SAP needs the approve permission, which your role does not hold.")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("an approver who does not hold apply still checks and sends", async () => {
    await liveOn();
    mount("B-236", "&role=approver");
    const insp = await body("Batch B-236");
    const live = await within(insp).findByTestId("live-writeback");
    fireEvent.click(within(live).getByRole("button", { name: "Check with SAP" }));
    await within(live).findByTestId("writeback-check");
    expect(within(live).getByRole("button", { name: "Send to SAP" })).toBeEnabled();
  });

  it("names a batch whose load file waits for the SAP load and lets a second person confirm the load", async () => {
    setFixtureBatchStatus("B-241", "awaiting_load");
    const loaded = vi.spyOn(batchApi, "confirmBatchLoaded");
    mount("B-241");
    const insp = await body("Batch B-241");
    expect(fact(insp, "Status")).toContain("Exported, waiting for the SAP load");
    expect(within(insp).getByTestId("batch-awaiting-load")).toHaveTextContent("an approver or SAP Basis confirms it here");
    fireEvent.click(within(insp).getByRole("button", { name: "Loaded in SAP" }));
    await waitFor(() => expect(loaded).toHaveBeenCalledWith("B-241", null));
    await waitFor(() => expect(fact(insp, "Status")).toContain("Sent to SAP"));
  });
});
