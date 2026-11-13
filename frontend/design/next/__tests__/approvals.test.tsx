import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { ToastProvider } from "../kit";
import { Approvals } from "../screens/Approvals";
import { ChangeTable } from "../approvals/ChangeTable";
import { resetWbFixture } from "@/lib/api/v2/fixtures/writeback-requests";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  resetWbFixture();
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
});

const page = () => renderWithQuery(<ToastProvider><Approvals /></ToastProvider>);

describe("ChangeTable", () => {
  it("shows before and after side by side with the delivery", () => {
    renderWithQuery(<ChangeTable changes={[{ record_key: "MARA|1", field: "MARA.MEINS", before: null, after: "EA", delivery: "export", bapi: null, reason: "No BAPI carries this field." }]} />);
    expect(screen.getByText("MARA-MEINS")).toBeTruthy();
    expect(screen.getByText("EA")).toBeTruthy();
    expect(screen.getByText("empty")).toBeTruthy();
    expect(screen.getByText("Export for manual load")).toBeTruthy();
  });
});

describe("Approvals", () => {
  it("lists waiting requests", async () => {
    setUrl("/next/approvals?fixture=1");
    page();
    expect(await screen.findAllByText("MM142")).toHaveLength(3);
  });

  it("tells the requester a second person must decide, and offers no buttons", async () => {
    setUrl("/next/approvals?fixture=1&id=WB-1");
    page();
    expect(await screen.findByText("You made this request. A second person must approve or reject it.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByTestId("change-table")).toBeTruthy();
    expect(screen.getByTestId("undo-note").textContent).toMatch(/cannot be reversed/);
  });

  it("lets another user approve after a confirm", async () => {
    setUrl("/next/approvals?fixture=1&id=WB-3");
    page();
    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await userEvent.click((await screen.findAllByRole("button", { name: "Approve" })).at(-1) as HTMLElement);
    await waitFor(() => expect(screen.getByText("Approved. 3 changes sent for writing.")).toBeTruthy());
  });

  it("rejects with a reason", async () => {
    setUrl("/next/approvals?fixture=1&id=WB-3");
    page();
    await userEvent.click(await screen.findByRole("button", { name: "Reject" }));
    const send = () => screen.getAllByRole("button", { name: "Reject" }).at(-1) as HTMLElement;
    expect(send().getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Give a reason first")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Reason"), "   ");
    expect(send().getAttribute("aria-disabled")).toBe("true");
    await userEvent.type(screen.getByLabelText("Reason"), "wrong unit");
    expect(send().getAttribute("aria-disabled")).toBeNull();
    await userEvent.click(send());
    await waitFor(() => expect(screen.getByText("Rejected. Nothing was written.")).toBeTruthy());
  });
});
