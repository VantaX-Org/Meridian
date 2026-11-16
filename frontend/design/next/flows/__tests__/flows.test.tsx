import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { ConnectSteps } from "../ConnectSteps";
import { InviteSteps } from "../InviteSteps";
import { FixApproveFlow } from "../FixApproveFlow";
import { AnalysisFlow } from "../AnalysisFlow";
import { NotifySteps } from "../NotifySteps";

const target = vi.hoisted(() => ({
  systems: [] as unknown[],
  templates: {} as Record<string, { id: string; name: string; version: number; created_at: string }[]>,
}));
vi.mock("@/lib/v2/runs-queries", async (orig) => ({ ...(await orig<object>()), useSystemsExtended: () => ({ data: target.systems, isLoading: false, isError: false }) }));
vi.mock("@/lib/api/v2/migration", async (orig) => ({ ...(await orig<object>()), getTemplates: async (m: string) => ({ module: m, templates: target.templates[m] ?? [] }) }));

const type = (label: RegExp, v: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
const next = (name = "Next") => fireEvent.click(screen.getByRole("button", { name }));

vi.mock("../ConnectDetails", () => ({
  ConnectDetails: ({ onSaved }: { onSaved: (s: { id: string; name: string }) => void }) => (
    <button type="button" onClick={() => onSaved({ id: "s1", name: "Test system" })}>Save details</button>
  ),
}));

describe("connect flow", () => {
  it("saves the OAuth details, tests by id, then extracts", async () => {
    const api = { test: vi.fn().mockResolvedValue({ connected: true }), extract: vi.fn().mockResolvedValue({}) };
    renderWithQuery(<ConnectSteps api={api} objects={["material-master"]} />);
    next("Save details");
    await screen.findByText("Test system");
    next();
    await screen.findByTestId("flow-step-test");
    next("Test connection");
    await screen.findByTestId("flow-step-objects");
    expect(api.test).toHaveBeenCalledWith("s1");
    fireEvent.click(screen.getByRole("checkbox"));
    next();
    await screen.findByTestId("flow-step-extract");
    next("Start extraction");
    await waitFor(() => expect(api.extract).toHaveBeenCalledWith("s1", ["material-master"]));
  });
  it("stays on the test step when the logon fails", async () => {
    const api = { test: vi.fn().mockResolvedValue({ connected: false, message: "Logon refused." }), extract: vi.fn() };
    renderWithQuery(<ConnectSteps api={api} objects={[]} />);
    next("Save details");
    await screen.findByText("Test system");
    next();
    await screen.findByTestId("flow-step-test");
    next("Test connection");
    expect((await screen.findByRole("alert")).textContent).toBe("Logon refused.");
  });
});

describe("invite flow", () => {
  it("needs a valid email, then sends with the role", async () => {
    const api = { invite: vi.fn().mockResolvedValue({ id: "u1" }), link: vi.fn().mockResolvedValue({ url: "https://x/invite" }) };
    renderWithQuery(<InviteSteps roles={[{ key: "viewer", label: "Viewer" }]} api={api} />);
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
    const { unmount } = renderWithQuery(<FixApproveFlow id="b1" summary="12 fixes" ownBatch api={api} />);
    expect(screen.getAllByText("A second person must approve this batch.")[0]).toBeTruthy();
    unmount();
    renderWithQuery(<FixApproveFlow id="b1" summary="12 fixes" api={api} />);
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
    await screen.findByTestId("flow-step-target");
    expect(screen.getByTestId("extract-target-nopair")).toBeTruthy();
    expect(await screen.findByTestId("extract-target-none-customer")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Upload a template" })).toBeTruthy();
    next();
    await screen.findByTestId("flow-step-start");
    expect(screen.getByTestId("extract-target-preview").textContent).toBe("No template will be filled automatically.");
    next("Start analysis");
    await waitFor(() => expect(start).toHaveBeenCalledWith("s1", ["customer"], undefined));
  });
  it("sends a changed target system and a picked template", async () => {
    target.systems = [
      { id: "src", name: "Source one", role: "source", target_system_id: "tgt" },
      { id: "tgt", name: "Target one", role: "target", target_system_id: null },
      { id: "tgt2", name: "Target two", role: "target", target_system_id: null },
    ];
    target.templates = { customer: [{ id: "old", name: "Customer load", version: 1, created_at: "2026-01-01" }, { id: "new", name: "Customer load v2", version: 2, created_at: "2026-02-01" }] };
    const start = vi.fn().mockResolvedValue({});
    renderWithQuery(<AnalysisFlow systems={[{ id: "src", name: "Source one" }]} objects={["customer"]} start={start} />);
    fireEvent.click(screen.getByRole("radio"));
    next();
    await screen.findByTestId("flow-step-objects");
    fireEvent.click(screen.getByRole("checkbox"));
    next();
    await screen.findByTestId("flow-step-target");
    const sys = screen.getByTestId("extract-target-system") as HTMLSelectElement;
    expect(sys.value).toBe("tgt");
    const tpl = (await screen.findByTestId("extract-target-tpl-customer")) as HTMLSelectElement;
    expect(tpl.value).toBe("new");
    fireEvent.change(sys, { target: { value: "tgt2" } });
    fireEvent.change(tpl, { target: { value: "old" } });
    next();
    await screen.findByTestId("flow-step-start");
    expect(screen.getByTestId("extract-target-preview").textContent).toMatch(/^Will fill: Customer load for /);
    next("Start analysis");
    await waitFor(() => expect(start).toHaveBeenCalledWith("src", ["customer"], { target_system_id: "tgt2", target_template_ids: { customer: "old" } }));
  });
});

describe("notify flow", () => {
  it("saves the chosen schedule", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderWithQuery(<NotifySteps save={save} />);
    type(/^Email/, "a@b.co");
    next();
    await screen.findByTestId("flow-step-what");
    next();
    await screen.findByTestId("flow-step-save");
    next("Save settings");
    await waitFor(() => expect(save).toHaveBeenCalledWith({ email: "a@b.co", teams_webhook: "", daily_digest: false, weekly_summary: true, monthly_report: false }));
  });
});
