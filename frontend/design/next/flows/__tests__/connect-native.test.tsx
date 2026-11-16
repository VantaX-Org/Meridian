import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { ToastProvider } from "../../kit";
import { ConnectDetails } from "../ConnectDetails";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
const S = vi.hoisted(() => ({ can: (): boolean => true, register: vi.fn(), test: vi.fn() }));
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: S.can, id: "u", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));
vi.mock("@/lib/v2/sys-queries", async (orig) => ({ ...(await orig<object>()), useRefreshV2: () => () => undefined }));
vi.mock("@/lib/api/v2/sys", async (orig) => ({ ...(await orig<object>()), registerSystem: S.register, testDraftConnection: S.test }));

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  setUrl("/?fixture=1");
  S.can = () => true;
  S.register.mockReset().mockResolvedValue({ id: "sys-1", name: "SF prod" });
  S.test.mockReset().mockResolvedValue({ connected: true, message: "OK", latency_ms: 12 });
});
afterEach(() => undo());
const wrap = (ui: React.ReactElement) => renderWithQuery(<ToastProvider>{ui}</ToastProvider>);
const fill = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const fillSf = () => {
  fill("Name", "SF prod");
  fill("Base URL", "https://api.sf.example.com");
  fill("Company ID", "ACME");
  fill("Token URL", "https://api.sf.example.com/oauth/token");
  fill("Client ID", "client");
  fill("Client secret", "s3cret");
};

describe("ConnectDetails", () => {
  it("never offers a password field: the only secret inputs are client secret", () => {
    wrap(<ConnectDetails initialType="successfactors" />);
    const secrets = Array.from(document.querySelectorAll('input[type="password"]')).map((i) => i.id);
    expect(secrets).toHaveLength(1);
    expect(screen.getByLabelText("Client secret")).toHaveAttribute("type", "password");
    expect(screen.queryByLabelText(/^password$/i)).toBeNull();
    expect(screen.queryByLabelText(/user/i)).toBeNull();
  });

  it("an RFC type shows the server notice and offers only cloud types", () => {
    wrap(<ConnectDetails initialType="ecc" />);
    expect(screen.getByTestId("rfc-notice")).toHaveTextContent(/does not send passwords/);
    const values = Array.from((screen.getByLabelText("System type") as HTMLSelectElement).options).map((o) => o.value);
    expect(values).not.toContain("ecc");
    expect(values).not.toContain("s4hana_onprem");
    expect(values).not.toContain("ewm");
  });

  it("tests and saves without a password key, then calls onSaved", async () => {
    const onSaved = vi.fn();
    wrap(<ConnectDetails initialType="successfactors" onSaved={onSaved} />);
    fillSf();
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(S.test).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId("test-outcome")).toHaveTextContent("Connected");
    fireEvent.click(screen.getByRole("button", { name: "Connect system" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: "sys-1", name: "SF prod" }));
    for (const body of [S.test.mock.calls[0][0], S.register.mock.calls[0][0]]) {
      expect(JSON.stringify(body)).not.toMatch(/password/i);
      expect(body).toMatchObject({ system_type: "successfactors", auth_type: "oauth2_client_credentials", credentials: { client_id: "client", client_secret: "s3cret" } });
    }
  });

  it("without manage systems the fields are read only", () => {
    S.can = () => false;
    wrap(<ConnectDetails />);
    expect(screen.getByText(/needs the manage systems permission/)).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeDisabled();
  });
});
