import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetAdminFixture, resetWorkFixture } from "@/lib/api/v2/fixtures";
import * as rep from "@/lib/api/v2/reports";
import * as s9 from "@/lib/api/v2/step9";
import * as s10 from "@/lib/api/v2/step10";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { ToastProvider } from "../../../kit";
import { REPORTS_BODIES, ReportInspector, ScheduleInspector } from "../reports";
import { DeliveryInspector, WebhookInspector } from "../reports-webhook";
import { DigestInspector, PolicyPackInspector } from "../reports-digest";
import { resetReportOutcomes } from "../reports-kit";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Administrator", name: "Test", email: null, id: "u-me", fixture: true, shared: false, viewAs: null, can: () => true }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetAdminFixture();
  resetWorkFixture();
  resetReportOutcomes();
  undo = stubLayout();
  setUrl("/reports?fixture=1");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const show = (node: React.ReactNode) => renderWithQuery(<ToastProvider>{node}</ToastProvider>);

describe("reports inspector group (next)", () => {
  it("registers every kind", () => {
    expect(Object.keys(REPORTS_BODIES).sort()).toEqual(["delivery", "digest", "policypack", "report", "schedule", "webhook"]);
  });

  it("report: shows the file and downloads it", async () => {
    const dl = vi.spyOn(rep, "downloadReportFile").mockResolvedValue("workbook-2026-10-15.xlsx");
    show(<ReportInspector id="rf-2" onClose={vi.fn()} />);
    expect(await screen.findByText("workbook-2026-10-15.xlsx")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(dl).toHaveBeenCalledWith("rf-2", "workbook-2026-10-15.xlsx"));
  });

  it("schedule: creates one with a name and a recipient", async () => {
    const create = vi.spyOn(rep, "createSchedule");
    show(<ScheduleInspector id="new" onClose={vi.fn()} />);
    const go = await screen.findByRole("button", { name: "Create the schedule" });
    expect(go).toHaveAttribute("aria-disabled", "true");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Monday board pack" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Pieter van der Merwe/ }));
    await waitFor(() => expect(go).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(go);
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: "Monday board pack", recipient_user_ids: ["u-2"] })));
  });

  it("webhook: shows the delivery log and sends a test event", async () => {
    const test = vi.spyOn(s9, "testWebhook");
    show(<WebhookInspector id="wh-1" onClose={vi.fn()} />);
    const log = await screen.findByTestId("delivery-log");
    await waitFor(() => expect(norm(log)).toContain("502"));
    fireEvent.click(screen.getByRole("button", { name: "Send a test event" }));
    await waitFor(() => expect(test).toHaveBeenCalledWith("wh-1"));
  });

  it("delivery: shows the attempt and links to its webhook", async () => {
    show(<DeliveryInspector id="wh-1:dlv-104" onClose={vi.fn()} />);
    expect(await screen.findByText("HTTP 502")).toBeInTheDocument();
    const link = await screen.findByRole("link", { name: "hooks.slack.com" });
    expect(link.getAttribute("href")).toContain("open=webhook%3Awh-1");
    fireEvent.click(link);
  });

  it("policypack: lists its classes and removes it only after a confirmation", async () => {
    const unapply = vi.spyOn(s10, "unapplyPolicyPack");
    show(<PolicyPackInspector id="sox" onClose={vi.fn()} />);
    await screen.findByTestId("pack-classes");
    expect(norm(screen.getByTestId("class-vendor_bank"))).toContain("Vendor bank data");
    fireEvent.click(screen.getByRole("button", { name: "Remove the pack" }));
    const dlg = await screen.findByRole("alertdialog", { name: "Remove SOX financial controls" });
    expect(unapply).not.toHaveBeenCalled();
    fireEvent.click(within(dlg).getByRole("button", { name: "Remove the pack" }));
    await waitFor(() => expect(unapply).toHaveBeenCalledWith("sox"));
  });

  it("digest: shows its deliveries and sends it now", async () => {
    const send = vi.spyOn(s10, "sendDigestNow");
    show(<DigestInspector id="dg-1" onClose={vi.fn()} />);
    expect(norm(await screen.findByTestId("digest-deliveries"))).toContain("1 recipient refused: mailbox full");
    fireEvent.click(screen.getByRole("button", { name: "Send now" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith("dg-1"));
  });
});
