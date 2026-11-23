import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { ToastHost } from "@/ui/kit";
import type { BatchRow } from "@/lib/v2/batches";
import { fixtureResponse, fixtureWrite, resetWorkFixture } from "@/lib/api/v2/fixtures";
import { setFixtureBatchStatus } from "@/lib/api/v2/fixtures/work-fixture";
import { ExportPanel, RunRecords } from "./BatchSend";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
const can = vi.hoisted(() => ({ allow: true }));
vi.mock("@/ui/screens/orphans/useCan", () => ({ useCan: () => () => can.allow }));

let undo: () => void = () => undefined;
beforeEach(() => { can.allow = true; resetWorkFixture(); undo = stubLayout(); window.history.replaceState(null, "", "/work?fixture=1"); });
afterEach(() => undo());

const row = (status: BatchRow["status"]): BatchRow => ({
  id: "B-236", label: "B-236", name: "Plant fixes", status, owner: "A", ownerId: "u-an", steward: null, records: 12, valueAtRisk: null,
  dueAt: null, createdAt: "2026-10-01T00:00:00Z", approvedBy: null, approvedAt: null, sentAt: null, returned: null, verification: null, modules: [],
});
const mount = (b: BatchRow) => renderWithQuery(<ToastHost><ExportPanel b={b} /></ToastHost>);

describe("ExportPanel", () => {
  it("exports only after a confirm that names the count, then shows the file", async () => {
    mount(row("approved"));
    fireEvent.click(screen.getByRole("button", { name: "Review the export" }));
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg.textContent).toContain("12 records of Plant fixes");
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(await screen.findByText("remediation-cockpit_xlsx-B-236.xlsx")).toBeTruthy();
  });

  it("blocks a draft and says why", () => {
    mount(row("draft"));
    expect(screen.getByText("Approve the batch before exporting it.")).toBeTruthy();
  });

  it("blocks export without the role", () => {
    can.allow = false;
    mount(row("approved"));
    expect((screen.getByRole("button", { name: "Review the export" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Your role cannot export a batch.")).toBeTruthy();
  });

  it("confirms the SAP load after a confirm", async () => {
    setFixtureBatchStatus("B-236", "awaiting_load");
    mount(row("awaiting_load"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm it was loaded" }));
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg.textContent).toContain("12 records of Plant fixes");
    fireEvent.click(screen.getByRole("button", { name: "Confirm the load" }));
    expect(await screen.findByText("The load is confirmed.")).toBeTruthy();
  });

  it("shows a refusal inside the confirm", async () => {
    setFixtureBatchStatus("B-236", "exported");
    mount(row("awaiting_load"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm it was loaded" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Confirm the load" }));
    expect((await screen.findByRole("alert")).textContent).toContain("already sent");
  });
});

describe("RunRecords", () => {
  it("lists failed records of the run and switches state", async () => {
    fixtureWrite("POST", "/writeback/batches/B-236/send", undefined, {});
    fixtureResponse("/writeback/batches/B-236/run", {});
    fixtureResponse("/writeback/batches/B-236/run", {});
    renderWithQuery(<RunRecords id="B-236" />);
    expect(await screen.findByLabelText("Records of the send")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Show records that are"), { target: { value: "export_only" } });
    expect(await screen.findByText("No records in this state")).toBeTruthy();
  });

  it("offers a retry when the run cannot be read", async () => {
    renderWithQuery(<RunRecords id="B-236" />);
    expect(await screen.findByText("Records could not be loaded")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
