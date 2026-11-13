import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { ConnectFlow } from "../ConnectFlow";
import { InviteFlow } from "../InviteFlow";
import { ApproveFlow } from "../ApproveFlow";
import { AnalysisFlow } from "../AnalysisFlow";
import { NotifyFlow } from "../NotifyFlow";

const type = (label: RegExp, v: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
const next = (name = "Next") => fireEvent.click(screen.getByRole("button", { name }));

describe("connect flow", () => {
  it("tests before it saves and extracts only after", async () => {
    const api = { test: vi.fn().mockResolvedValue({ ok: true }), save: vi.fn().mockResolvedValue({ id: "s1" }), extract: vi.fn().mockResolvedValue({}) };
    renderWithQuery(<ConnectFlow api={api} objects={["material-master"]} />);
    type(/^Name/, "Test system");
    type(/^Host/, "host.example");
    next();
    await screen.findByTestId("flow-step-test");
    next("Test connection");
    await screen.findByTestId("flow-step-objects");
    expect(api.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    next("Save and continue");
    await screen.findByTestId("flow-step-extract");
    next("Start extraction");
    await waitFor(() => expect(api.extract).toHaveBeenCalledWith("s1", ["material-master"]));
  });
  it("stays on the test step when the logon fails", async () => {
    const api = { test: vi.fn().mockResolvedValue({ ok: false, message: "Logon refused." }), save: vi.fn(), extract: vi.fn() };
    renderWithQuery(<ConnectFlow api={api} objects={[]} />);
    type(/^Name/, "x");
    type(/^Host/, "h");
    next();
    await screen.findByTestId("flow-step-test");
    next("Test connection");
    expect((await screen.findByRole("alert")).textContent).toBe("Logon refused.");
  });
});

describe("invite flow", () => {
  it("needs a valid email, then sends with the role", async () => {
    const api = { invite: vi.fn().mockResolvedValue({ id: "u1" }), link: vi.fn().mockResolvedValue("https://x/invite") };
    renderWithQuery(<InviteFlow roles={[{ key: "viewer", label: "Viewer" }]} api={api} />);
    expect(screen.getAllByText("Enter a valid email address.")[0]).toBeTruthy();
    type(/^Email/, "a@b.co");
    next();
    await screen.findByTestId("flow-step-role");
    next("Send invite");
    await screen.findByTestId("flow-step-link");
    expect(api.invite).toHaveBeenCalledWith({ email: "a@b.co", name: undefined, grants: [{ role_key: "viewer" }] });
    next("Create link");
    await waitFor(() => expect(screen.getByTestId("invite-link").textContent).toBe("https://x/invite"));
  });
});

describe("approve flow", () => {
  it("blocks the raiser, then approves batch and write-back in order", async () => {
    const order: string[] = [];
    const api = { batch: vi.fn(async () => void order.push("batch")), writeback: vi.fn(async () => void order.push("wb")) };
    const { unmount } = renderWithQuery(<ApproveFlow id="b1" summary="12 fixes" ownBatch api={api} />);
    expect(screen.getAllByText("A second person must approve this batch.")[0]).toBeTruthy();
    unmount();
    renderWithQuery(<ApproveFlow id="b1" summary="12 fixes" api={api} />);
    next();
    await screen.findByTestId("flow-step-batch");
    next("Approve batch");
    await screen.findByTestId("flow-step-writeback");
    next("Approve write-back");
    await waitFor(() => expect(order).toEqual(["batch", "wb"]));
  });
});

describe("analysis flow", () => {
  it("starts the chosen objects on the chosen system", async () => {
    const start = vi.fn().mockResolvedValue({});
    renderWithQuery(<AnalysisFlow systems={[{ id: "s1", name: "Sys one" }]} objects={["customer"]} start={start} />);
    fireEvent.click(screen.getByRole("radio"));
    next();
    await screen.findByTestId("flow-step-objects");
    fireEvent.click(screen.getByRole("checkbox"));
    next();
    await screen.findByTestId("flow-step-start");
    next("Start analysis");
    await waitFor(() => expect(start).toHaveBeenCalledWith("s1", ["customer"]));
  });
});

describe("notify flow", () => {
  it("saves the chosen schedule", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderWithQuery(<NotifyFlow save={save} />);
    type(/^Email/, "a@b.co");
    next();
    await screen.findByTestId("flow-step-what");
    next();
    await screen.findByTestId("flow-step-save");
    next("Save settings");
    await waitFor(() => expect(save).toHaveBeenCalledWith({ email: "a@b.co", teams_webhook: "", daily_digest: false, weekly_summary: true, monthly_report: false }));
  });
});
