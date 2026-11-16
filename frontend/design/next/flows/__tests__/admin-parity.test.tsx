// Admin and flow parity with v2: invite link url, the stored Teams webhook, update status errors,
// the connect gate with tables and extraction mode, the invite system scope, and the approvals gates.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { renderWithQuery } from "@/__tests__/render";
import { ToastProvider } from "../../kit";
import { InviteSteps } from "../InviteSteps";
import { NotifySteps } from "../NotifySteps";

const h = vi.hoisted(() => ({
  can: ((): boolean => true) as (p: string) => boolean,
  status: {} as Record<string, unknown>,
  createProfile: vi.fn(),
  inviteUser: vi.fn(),
  requests: {} as Record<string, unknown>,
}));

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: (p: string) => h.can(p), id: "u", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));
vi.mock("@/lib/v2/admin-queries", async (orig) => ({
  ...(await orig<object>()),
  useUpdateStatus: () => h.status,
  useRoles: () => ({ data: [{ key: "viewer", name: "Viewer" }] }),
  useScheduleOptions: () => ({ data: { modules: ["material_master"] } }),
  useUsers: () => ({ data: { users: [] } }),
  refreshAdmin: vi.fn(),
}));
vi.mock("@/lib/api/v2/admin", async (orig) => ({ ...(await orig<object>()), inviteUser: (b: unknown) => h.inviteUser(b) }));
vi.mock("@/lib/v2/runs-queries", async (orig) => ({
  ...(await orig<object>()),
  useSystemsExtended: () => ({ data: [{ id: "s9", name: "KMP" }] }),
  useSystemObjectList: () => ({ data: { system_type: "ecc", objects: [{ object: "material_master", tables: ["MARA", "MARC"], licensed: true }] }, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/lib/api/v2/sys", async (orig) => ({ ...(await orig<object>()), createProfile: (...a: unknown[]) => h.createProfile(...a) }));
vi.mock("@/lib/api/v2/runs", async (orig) => ({ ...(await orig<object>()), testSystemConnection: async () => ({ connected: true, message: "ok" }) }));
vi.mock("../ConnectDetails", () => ({
  ConnectDetails: ({ onSaved }: { onSaved: (s: { id: string; name: string }) => void }) => <button type="button" onClick={() => onSaved({ id: "s1", name: "Test system" })}>Save details</button>,
}));
vi.mock("@/lib/api/next/approvals", async (orig) => ({ ...(await orig<object>()), useRequests: () => h.requests }));

import { UpdateFlow } from "../UpdateFlow";
import { ConnectFlow } from "../ConnectFlow";
import { InviteFlow } from "../InviteFlow";
import { Approvals } from "../../screens/Approvals";

const next = (name = "Next") => fireEvent.click(screen.getByRole("button", { name }));
function Harness({ C, start = 1 }: { C: typeof ConnectFlow; start?: number }) {
  const [step, setStep] = useState(start);
  return <ToastProvider><C ctx={{ id: "new", close: vi.fn(), dismiss: vi.fn(), under: undefined, step, setStep, open: vi.fn() } as never} /></ToastProvider>;
}

beforeEach(() => {
  h.can = () => true;
  h.createProfile.mockReset().mockResolvedValue({});
  h.inviteUser.mockReset().mockResolvedValue({ id: "u1" });
  window.sessionStorage.clear();
});

describe("InviteSteps", () => {
  it("shows the link url, not the response object", async () => {
    const api = { invite: vi.fn().mockResolvedValue({ id: "u1" }), link: vi.fn().mockResolvedValue({ id: "l1", url: "https://x/i/abc", expires_at: "2026-12-01" }) };
    renderWithQuery(<InviteSteps roles={[{ key: "viewer", label: "Viewer" }]} api={api} />);
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "a@b.co" } });
    next();
    await screen.findByTestId("flow-step-role");
    next("Send invite");
    await screen.findByTestId("flow-step-link");
    next("Create link");
    await waitFor(() => expect(screen.getByTestId("invite-link").textContent).toBe("https://x/i/abc"));
  });
});

describe("NotifySteps", () => {
  it("keeps the stored Teams webhook and starts from the stored schedule", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderWithQuery(<NotifySteps save={save} initial={{ email: "ops@x.co", teams_webhook: "https://teams/hook", daily_digest: true, weekly_summary: false, monthly_report: false }} />);
    next();
    await screen.findByTestId("flow-step-what");
    next();
    await screen.findByTestId("flow-step-save");
    next("Save settings");
    await waitFor(() => expect(save).toHaveBeenCalledWith({ email: "ops@x.co", teams_webhook: "https://teams/hook", daily_digest: true, weekly_summary: false, monthly_report: false }));
  });
});

describe("UpdateFlow", () => {
  it("shows an error with retry when the status cannot be read", () => {
    const refetch = vi.fn();
    h.status = { isError: true, error: null, data: undefined, refetch };
    renderWithQuery(<ToastProvider><UpdateFlow ctx={{ close: vi.fn(), under: undefined } as never} /></ToastProvider>);
    expect(screen.getByText("The update status could not be read.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe("ConnectFlow", () => {
  it("is denied without manage_systems", () => {
    h.can = (p) => p !== "manage_systems";
    renderWithQuery(<Harness C={ConnectFlow} />);
    expect(screen.getByTestId("denied")).toBeTruthy();
  });
  it("sends each object's tables and the extraction mode", async () => {
    renderWithQuery(<Harness C={ConnectFlow} start={2} />);
    next("Save details");
    next("Run the test");
    await waitFor(() => expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).getAttribute("aria-disabled")).not.toBe("true"));
    next();
    fireEvent.click(screen.getByRole("checkbox"));
    next();
    fireEvent.click(screen.getByLabelText("Full extraction"));
    next("Connect");
    await waitFor(() => expect(h.createProfile).toHaveBeenCalledWith("s1", expect.objectContaining({ domain: "material_master", tables: ["MARA", "MARC"], extraction_mode: "full" })));
  });
});

describe("InviteFlow", () => {
  it("scopes the grant to the chosen system", async () => {
    window.sessionStorage.setItem("nx_draft:invite", JSON.stringify({ email: "a@b.co", role: "viewer" }));
    renderWithQuery(<Harness C={InviteFlow as typeof ConnectFlow} start={3} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "s9" } });
    next("Send invite");
    await waitFor(() => expect(h.inviteUser).toHaveBeenCalledWith(expect.objectContaining({ grants: [{ role_key: expect.any(String), system_id: "s9" }] })));
  });
});

describe("Approvals list", () => {
  it("says when live write-back is off and when the viewer cannot approve", () => {
    h.can = (p) => p !== "approve";
    h.requests = { data: { items: [], live_enabled: false }, isLoading: false, isError: false, refetch: vi.fn() };
    renderWithQuery(<ToastProvider><Approvals /></ToastProvider>);
    expect(screen.getByTestId("live-off")).toBeTruthy();
    expect(screen.getByTestId("no-approve")).toBeTruthy();
  });
  it("shows neither note when live and allowed", () => {
    h.requests = { data: { items: [], live_enabled: true }, isLoading: false, isError: false, refetch: vi.fn() };
    renderWithQuery(<ToastProvider><Approvals /></ToastProvider>);
    expect(screen.queryByTestId("live-off")).toBeNull();
    expect(screen.queryByTestId("no-approve")).toBeNull();
  });
});
