import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { ToastProvider } from "../../kit";
import { ConnectCanvasNative } from "../ConnectCanvasNative";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
const S = vi.hoisted(() => ({
  can: (_p: string): boolean => true,
  register: vi.fn(),
  profile: vi.fn(),
  apply: vi.fn(),
  invite: vi.fn(),
  packs: [{ id: "p1", name: "SAP baseline", authority: "SAP", applied: false }],
}));
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: S.can, id: "u", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));
vi.mock("@/lib/v2/sys-queries", async (orig) => ({ ...(await orig<object>()), useRefreshV2: () => () => undefined }));
vi.mock("@/lib/api/v2/sys", async (orig) => ({ ...(await orig<object>()), registerSystem: S.register, createProfile: S.profile, testDraftConnection: vi.fn() }));
vi.mock("@/lib/v2/runs-queries", async (orig) => ({
  ...(await orig<object>()),
  useSystemObjectList: (id: string, on: boolean) => ({ data: on ? { objects: [{ object: "employee_central", tables: ["PerPerson", "EmpJob"], licensed: true }] } : undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/lib/v2/step10-queries", async (orig) => ({
  ...(await orig<object>()),
  usePolicyPacks: () => ({ data: { packs: S.packs }, isLoading: false, isError: false, error: null, refetch: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock("@/lib/api/v2/step10", async (orig) => ({ ...(await orig<object>()), applyPolicyPack: S.apply, unapplyPolicyPack: vi.fn() }));
vi.mock("@/lib/api/v2/admin", async (orig) => ({ ...(await orig<object>()), inviteUser: S.invite }));

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  setUrl("/?fixture=1");
  S.can = () => true;
  S.register.mockReset().mockResolvedValue({ id: "sys-sf", name: "SF prod" });
  S.profile.mockReset().mockResolvedValue({ id: "prof-1" });
  S.apply.mockReset().mockResolvedValue(undefined);
  S.invite.mockReset().mockResolvedValue(undefined);
});
afterEach(() => undo());
const wrap = () => renderWithQuery(<ToastProvider><ConnectCanvasNative /></ToastProvider>);
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("ConnectCanvasNative", () => {
  it("without manage systems shows the denied state", () => {
    S.can = () => false;
    wrap();
    expect(screen.queryByTestId("connection-form")).toBeNull();
    expect(screen.getByText("Set up Meridian")).toBeInTheDocument();
  });

  it("SAP step explains that RFC systems are set up on the server", () => {
    wrap();
    expect(screen.getByTestId("rfc-notice")).toBeInTheDocument();
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(1);
  });

  it("connects SuccessFactors, picks an object and a pack, saves the schedule and invites", async () => {
    wrap();
    fireEvent.click(screen.getByRole("button", { name: "I only use SuccessFactors" }));
    fill("Name", "SF prod");
    fill("Base URL", "https://api.sf.example.com");
    fill("Company ID", "ACME");
    fill("Token URL", "https://api.sf.example.com/oauth/token");
    fill("Client ID", "client");
    fill("Client secret", "s3cret");
    fireEvent.click(screen.getByRole("button", { name: "Connect system" }));
    await waitFor(() => expect(S.register).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(S.register.mock.calls[0][0])).not.toMatch(/password/i);

    fireEvent.click(await screen.findByRole("checkbox", { name: /employee_central/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    fireEvent.click(await screen.findByRole("checkbox", { name: /SAP baseline/ }));
    await waitFor(() => expect(S.apply).toHaveBeenCalledWith("p1"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    fireEvent.click(await screen.findByRole("button", { name: "Save schedule" }));
    await waitFor(() => expect(S.profile).toHaveBeenCalledWith("sys-sf", { system_id: "sys-sf", domain: "employee_central", tables: ["PerPerson", "EmpJob"], schedule_cron: "0 2 * * *", active: true, extraction_mode: "delta" }));

    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "ana@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    await waitFor(() => expect(S.invite).toHaveBeenCalledWith({ email: "ana@example.com", grants: [{ role_key: "data_steward" }] }));
    expect(await screen.findByText("Setup complete")).toBeInTheDocument();
  });
});
