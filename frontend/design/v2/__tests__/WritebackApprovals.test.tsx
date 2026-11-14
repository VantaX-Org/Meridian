import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { WritebackApprovals } from "../screens/WritebackApprovals";
import * as batches from "@/lib/api/v2/batches";
import * as approvals from "@/lib/api/next/approvals";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ id: "u-me", persona: "lead", label: "Lead", name: "Test", email: null, fixture: false, shared: false, can: () => true }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  vi.spyOn(batches, "getPendingWritebacks").mockResolvedValue({
    live_enabled: true,
    approvals: [{ id: "w1", finding_id: null, version_id: null, requested_by: "u-other", records_updated: 3, sap_host: "h", created_at: null, check_id: "BP_TAX_001", module: "business_partner", rule_message: "Tax number is missing", requested_by_name: "Sam" }],
  });
});
afterEach(() => {
  undo();
  vi.restoreAllMocks();
});

describe("WritebackApprovals reject", () => {
  it("needs a reason, then sends it, and links to the work queue", async () => {
    const rej = vi.spyOn(approvals, "rejectRequest").mockResolvedValue({ status: "rejected" });
    renderWithQuery(<WritebackApprovals />);
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    const form = await screen.findByTestId("reject-form");
    const send = form.querySelector("button.m2-danger") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(form.querySelector("input") as HTMLInputElement, { target: { value: " Wrong plant " } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(rej).toHaveBeenCalledWith("w1", "Wrong plant"));
    expect(screen.getByRole("link", { name: "Open the work queue" })).toBeTruthy();
  });
});
