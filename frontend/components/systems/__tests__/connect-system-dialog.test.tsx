import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/render";
import * as systemsApi from "@/lib/api/systems";
import { ConnectSystemDialog } from "../connect-system-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const type = (label: string, value: string) => {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

beforeEach(() => vi.restoreAllMocks());

describe("ConnectSystemDialog", () => {
  it("keeps Connect disabled and shows inline errors for invalid RFC input", () => {
    renderWithQuery(<ConnectSystemDialog open onOpenChange={() => {}} />);
    const submit = screen.getByRole("button", { name: "Connect system" });
    expect(submit).toBeDisabled();
    // untouched: no wall of red
    expect(screen.queryByText("Enter a system name")).not.toBeInTheDocument();

    type("Name", "");
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Enter a system name")).toBeInTheDocument();

    type("Client", "12");
    expect(screen.getByText("Enter a 3-digit client")).toBeInTheDocument();
    type("Instance number", "1");
    expect(screen.getByText("Enter a 2-digit instance number")).toBeInTheDocument();
    expect(submit).toBeDisabled();
  });

  const pickType = async (name: string) => {
    await userEvent.click(screen.getByRole("combobox", { name: "Type" }));
    await userEvent.click(await screen.findByRole("option", { name }));
  };

  it("connects Ariba with its realm, token URL, OAuth client and API key", async () => {
    const register = vi.spyOn(systemsApi, "registerSystem").mockResolvedValue({ id: "s2", name: "Ariba" } as Awaited<ReturnType<typeof systemsApi.registerSystem>>);
    renderWithQuery(<ConnectSystemDialog open onOpenChange={() => {}} />);
    await pickType("Ariba");
    type("Name", "Ariba");
    type("Base URL", "https://openapi.ariba.com");
    type("Realm", "acme-T");
    type("Token URL", "https://api.ariba.com/v2/oauth/token");
    type("Client ID", "cid");
    type("Client secret", "csecret");
    const submit = screen.getByRole("button", { name: "Connect system" });
    expect(submit).toBeDisabled(); // the API key is still missing
    type("API key", "key-1");
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() => expect(register).toHaveBeenCalledOnce());
    expect(register.mock.calls[0]![0]).toMatchObject({
      system_type: "ariba", base_url: "https://openapi.ariba.com", company_id: "acme-T", auth_type: "oauth2_client_credentials",
      token_url: "https://api.ariba.com/v2/oauth/token", credentials: { client_id: "cid", client_secret: "csecret", api_key: "key-1" },
    });
  });

  it("lets SuccessFactors sign in with a user and password instead of OAuth", async () => {
    const register = vi.spyOn(systemsApi, "registerSystem").mockResolvedValue({ id: "s3", name: "SF" } as Awaited<ReturnType<typeof systemsApi.registerSystem>>);
    renderWithQuery(<ConnectSystemDialog open onOpenChange={() => {}} />);
    await pickType("SuccessFactors");
    expect(screen.getByLabelText("Client ID")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("combobox", { name: "Sign-in method" }));
    await userEvent.click(await screen.findByRole("option", { name: "User and password" }));
    expect(screen.queryByLabelText("Client ID")).not.toBeInTheDocument();
    type("Name", "SF");
    type("Base URL", "https://api4.successfactors.com");
    type("Company ID", "ACME");
    type("User", "svc_meridian");
    type("Password", "pw");
    const submit = screen.getByRole("button", { name: "Connect system" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() => expect(register).toHaveBeenCalledOnce());
    expect(register.mock.calls[0]![0]).toMatchObject({ system_type: "successfactors", auth_type: "basic", username: "svc_meridian", company_id: "ACME", credentials: { password: "pw" } });
    expect(register.mock.calls[0]![0].credentials).not.toHaveProperty("client_id");
  });

  it("explains the RFC user without naming an environment variable", () => {
    renderWithQuery(<ConnectSystemDialog open onOpenChange={() => {}} />);
    expect(screen.getByText("Leave empty to use the deployment's default RFC user")).toBeInTheDocument();
    expect(screen.queryByText(/SAP_RFC_USER/)).not.toBeInTheDocument();
  });

  it("says why Test connection is disabled", () => {
    renderWithQuery(<ConnectSystemDialog open onOpenChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Test connection" })).toBeDisabled();
    expect(screen.getByText("To test, complete the host, the client, the instance number and the password")).toBeInTheDocument();
    type("Host", "ecc.internal");
    type("Client", "100");
    type("Instance number", "00");
    expect(screen.getByText("To test, complete the password")).toBeInTheDocument();
  });

  const fillEcc = () => {
    type("Name", "ECC Prod");
    type("Host", "ecc.internal");
    type("Client", "100");
    type("Instance number", "00");
    type("Password", "s3cret");
  };

  it("keeps the test outcome in the dialog until a field changes", async () => {
    const test = vi.spyOn(systemsApi, "testDraftConnection").mockResolvedValue({ connected: false, message: "Connection failed: logon rejected" });
    renderWithQuery(<ConnectSystemDialog open onOpenChange={() => {}} />);
    fillEcc();
    expect(screen.getByText(/Not tested yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(test).toHaveBeenCalledOnce());
    expect(await screen.findByText("Not connected")).toBeInTheDocument();
    expect(screen.getByText("Connection failed: logon rejected")).toBeInTheDocument();
    type("Password", "other");
    expect(screen.queryByText("Not connected")).not.toBeInTheDocument();
  });

  it("shows a connected outcome and drops the untested note", async () => {
    vi.spyOn(systemsApi, "testDraftConnection").mockResolvedValue({ connected: true, message: "Connection successful" });
    renderWithQuery(<ConnectSystemDialog open onOpenChange={() => {}} />);
    fillEcc();
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.queryByText(/Not tested yet/)).not.toBeInTheDocument();
  });

  it("labels a failed registration Not saved with the API's message", async () => {
    vi.spyOn(systemsApi, "registerSystem").mockRejectedValue(
      Object.assign(new Error("conflict"), { isAxiosError: true, response: { status: 409, data: { detail: "A system named ECC Prod already exists" } } }),
    );
    const onOpenChange = vi.fn();
    renderWithQuery(<ConnectSystemDialog open onOpenChange={onOpenChange} />);
    fillEcc();
    const submit = screen.getByRole("button", { name: "Connect system" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    expect(await screen.findByText("Not saved")).toBeInTheDocument();
    expect(screen.getByText("A system named ECC Prod already exists")).toBeInTheDocument();
    expect(screen.queryByText(/Not connected/)).not.toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("registers the system with its credentials once valid", async () => {
    const register = vi.spyOn(systemsApi, "registerSystem").mockResolvedValue({ id: "s1", name: "ECC Prod" } as Awaited<ReturnType<typeof systemsApi.registerSystem>>);
    const onOpenChange = vi.fn();
    renderWithQuery(<ConnectSystemDialog open onOpenChange={onOpenChange} />);
    type("Name", "ECC Prod");
    type("Host", "ecc.internal");
    type("Client", "100");
    type("Instance number", "00");
    type("Password", "s3cret");
    const submit = screen.getByRole("button", { name: "Connect system" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() => expect(register).toHaveBeenCalledOnce());
    expect(register.mock.calls[0]![0]).toMatchObject({
      name: "ECC Prod", system_type: "ecc", environment: "DEV", host: "ecc.internal", client: "100", sysnr: "00",
      auth_type: "rfc", credentials: { password: "s3cret" },
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
