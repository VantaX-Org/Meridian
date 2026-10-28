import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as ssoApi from "@/lib/api/sso";
import type { SsoConfig } from "@/lib/api/sso";
import AdminSignInPage, { parseDomains } from "../page";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts, Toaster: () => null }));
const role = vi.hoisted(() => ({ canManage: true, loading: false }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => role.canManage, loading: role.loading }) }));
vi.mock("@/components/admin/settings-tabs", () => ({ SettingsTabs: () => null }));

const EMPTY: SsoConfig = {
  configured: false, issuer: "", client_id: "", has_secret: false, display_name: "", allowed_domains: [],
  default_role: "viewer", enforce: false, redirect_uri: "https://meridian.example.com/api/v1/auth/oidc/callback",
};
const SAVED: SsoConfig = {
  ...EMPTY, configured: true, issuer: "https://login.example.com/t1", client_id: "client-1", has_secret: true,
  display_name: "Corp login", allowed_domains: ["corp.com", "corp.org"],
};

beforeEach(() => {
  vi.restoreAllMocks();
  role.canManage = true;
  role.loading = false;
});

describe("AdminSignInPage", () => {
  it("shows the saved settings, never the secret, the redirect address and the fixed password rules", async () => {
    vi.spyOn(ssoApi, "getSsoConfig").mockResolvedValue(SAVED);
    renderWithQuery(<AdminSignInPage />);
    await waitFor(() => expect(screen.getByLabelText("Issuer address")).toHaveValue("https://login.example.com/t1"));
    expect(screen.getByLabelText("Client ID")).toHaveValue("client-1");
    const secret = screen.getByLabelText("Client secret");
    expect(secret).toHaveValue("");
    expect(secret).toHaveAttribute("type", "password");
    expect(secret).toHaveAttribute("placeholder", "Stored. Leave blank to keep it");
    expect(screen.getByLabelText("Allowed email domains")).toHaveValue("corp.com, corp.org");
    expect(screen.getByText("https://meridian.example.com/api/v1/auth/oidc/callback")).toBeInTheDocument();
    expect(screen.getByText(/At least 12 characters, not the email name, and not a common password/)).toBeInTheDocument();
    expect(screen.getByText("10 failed sign-ins lock the account for 15 minutes")).toBeInTheDocument();
  });

  it("saves without resending the secret, and sends it when typed", async () => {
    vi.spyOn(ssoApi, "getSsoConfig").mockResolvedValue(SAVED);
    const save = vi.spyOn(ssoApi, "saveSsoConfig").mockResolvedValue(SAVED);
    renderWithQuery(<AdminSignInPage />);
    await waitFor(() => expect(screen.getByLabelText("Display name")).toHaveValue("Corp login"));
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Company login" } });
    fireEvent.click(screen.getByRole("button", { name: "Save sign-in settings" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toEqual({
      issuer: SAVED.issuer, client_id: "client-1", display_name: "Company login",
      allowed_domains: ["corp.com", "corp.org"], default_role: "viewer", enforce: false,
    });
    expect(save.mock.calls[0][0]).not.toHaveProperty("client_secret");
    fireEvent.change(screen.getByLabelText("Client secret"), { target: { value: "  new-secret " } });
    fireEvent.click(screen.getByRole("button", { name: "Save sign-in settings" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toMatchObject({ client_secret: "new-secret" });
  });

  it("holds Save until a first configuration is complete and asks for the secret again when the issuer changes", async () => {
    vi.spyOn(ssoApi, "getSsoConfig").mockResolvedValue(EMPTY);
    renderWithQuery(<AdminSignInPage />);
    await waitFor(() => expect(screen.getByLabelText("Issuer address")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Save sign-in settings" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Test sign-in" })).toBeDisabled();
    expect(screen.getByText("Enter the client secret")).toBeInTheDocument();
  });

  it("asks for the secret again when the issuer of a saved configuration changes", async () => {
    vi.spyOn(ssoApi, "getSsoConfig").mockResolvedValue(SAVED);
    renderWithQuery(<AdminSignInPage />);
    await waitFor(() => expect(screen.getByLabelText("Issuer address")).toHaveValue(SAVED.issuer));
    expect(screen.getByRole("button", { name: "Save sign-in settings" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Issuer address"), { target: { value: "https://other.example.com" } });
    expect(screen.getByText("Enter the secret again when the issuer or client ID changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save sign-in settings" })).toBeDisabled();
  });

  it("confirms before requiring single sign-on, then saves with enforce on", async () => {
    vi.spyOn(ssoApi, "getSsoConfig").mockResolvedValue(SAVED);
    const save = vi.spyOn(ssoApi, "saveSsoConfig").mockResolvedValue({ ...SAVED, enforce: true });
    renderWithQuery(<AdminSignInPage />);
    await waitFor(() => expect(screen.getByLabelText("Display name")).toHaveValue("Corp login"));
    fireEvent.click(screen.getByRole("switch", { name: "Require single sign-on" }));
    fireEvent.click(screen.getByRole("button", { name: "Save sign-in settings" }));
    expect(save).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Password sign-in will stop for everyone except administrators/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /cancel/i })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Require single sign-on" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0].enforce).toBe(true);
  });

  it("does not confirm when enforcement is already on, and shows a server refusal", async () => {
    vi.spyOn(ssoApi, "getSsoConfig").mockResolvedValue({ ...SAVED, enforce: true });
    vi.spyOn(ssoApi, "saveSsoConfig").mockRejectedValue({ response: { status: 422, data: { detail: "Enforcing is refused until the provider is reachable." } }, isAxiosError: true });
    renderWithQuery(<AdminSignInPage />);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Require single sign-on" })).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(screen.getByRole("button", { name: "Save sign-in settings" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
  });

  it("tests the issuer typed in the form and prints the sentence either way", async () => {
    vi.spyOn(ssoApi, "getSsoConfig").mockResolvedValue(SAVED);
    const test = vi.spyOn(ssoApi, "testSsoConfig")
      .mockResolvedValueOnce({ ok: true, message: "Reached https://login.example.com/t1. Register the redirect address at your provider." })
      .mockResolvedValueOnce({ ok: false, message: "The identity provider could not be reached. Check the issuer address." });
    renderWithQuery(<AdminSignInPage />);
    await waitFor(() => expect(screen.getByLabelText("Issuer address")).toHaveValue(SAVED.issuer));
    fireEvent.click(screen.getByRole("button", { name: "Test sign-in" }));
    expect(await screen.findByText(/^Reached https:\/\/login\.example\.com\/t1/)).toBeInTheDocument();
    expect(test).toHaveBeenCalledWith(SAVED.issuer);
    fireEvent.click(screen.getByRole("button", { name: "Test sign-in" }));
    expect(await screen.findByText("The identity provider could not be reached. Check the issuer address.")).toBeInTheDocument();
  });

  it("turns single sign-on off after a confirmation", async () => {
    vi.spyOn(ssoApi, "getSsoConfig").mockResolvedValue(SAVED);
    const remove = vi.spyOn(ssoApi, "removeSsoConfig").mockResolvedValue(EMPTY);
    renderWithQuery(<AdminSignInPage />);
    await waitFor(() => expect(screen.getByLabelText("Issuer address")).toHaveValue(SAVED.issuer));
    fireEvent.click(screen.getByRole("button", { name: "Turn off single sign-on" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Turn off single sign-on" }));
    await waitFor(() => expect(remove).toHaveBeenCalled());
  });

  it("refuses people without manage users and does not fetch the settings", () => {
    role.canManage = false;
    const get = vi.spyOn(ssoApi, "getSsoConfig");
    renderWithQuery(<AdminSignInPage />);
    expect(screen.getByText("Only administrators change sign-in")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("shows a skeleton while permissions load", () => {
    role.loading = true;
    const { container } = renderWithQuery(<AdminSignInPage />);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
  });

  it("parses the domain list", () => {
    expect(parseDomains("Corp.com, @corp.org;  corp.net\nx.io,,")).toEqual(["corp.com", "corp.org", "corp.net", "x.io"]);
    expect(parseDomains("")).toEqual([]);
  });
});
