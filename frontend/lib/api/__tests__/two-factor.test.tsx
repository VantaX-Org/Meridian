// Two-factor sign-in in the session layer: a password alone is no session when the account has it, the second
// step stores the session, and the set-up calls swap in the replacement token the API returns.
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import apiClient from "@/lib/api/client";
import { LocalAuthProvider, useAuth, type LoginResult } from "@/context/auth-context";
import { confirmTwoFactor, disableTwoFactor } from "../auth";

const TOKEN_KEY = "mn_auth_token";
const USER = { id: "u1", email: "a@example.test", name: "Ana", role: "analyst", permissions: [] };

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

type Api = ReturnType<typeof useAuth>;

function Probe({ onReady }: { onReady: (api: Api) => void }) {
  const api = useAuth();
  onReady(api);
  return <p>{`${api.user?.email ?? "signed out"} ${api.mustEnrolTwoFactor ? "enrol" : "open"}`}</p>;
}

async function mount(): Promise<() => Api> {
  let latest: Api | undefined;
  render(<LocalAuthProvider><Probe onReady={(a) => { latest = a; }} /></LocalAuthProvider>);
  expect(await screen.findByText("signed out open")).toBeInTheDocument();
  return () => latest as Api;
}

describe("LocalAuthProvider with two-factor sign-in", () => {
  it("asks for a code instead of signing in, then signs in with it", async () => {
    const api = await mount();
    const post = vi.spyOn(apiClient, "post")
      .mockResolvedValueOnce({ data: { token: null, user: null, must_change_password: false, mfa_required: true, mfa_token: "pending" } })
      .mockResolvedValueOnce({ data: { token: "session", user: USER, must_change_password: false, mfa_required: false, mfa_token: null } });

    let result: LoginResult | undefined;
    await act(async () => { result = await api().login("a@example.test", "pw"); });
    expect(result).toEqual({ status: "mfa_required", mfaToken: "pending" });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(screen.getByText("signed out open")).toBeInTheDocument();

    await act(async () => { await api().verifyCode("pending", "123456"); });
    expect(post).toHaveBeenLastCalledWith("/api/v1/auth/login/2fa", { mfa_token: "pending", code: "123456" });
    expect(localStorage.getItem(TOKEN_KEY)).toBe("session");
    expect(screen.getByText("a@example.test open")).toBeInTheDocument();
  });

  it("holds a session that must set up two-factor sign-in until the set-up is done", async () => {
    const api = await mount();
    vi.spyOn(apiClient, "post").mockResolvedValueOnce({
      data: { token: "restricted", user: USER, must_change_password: false, mfa_required: false, must_enrol_2fa: true },
    });
    await act(async () => { await api().login("a@example.test", "pw"); });
    expect(screen.getByText("a@example.test enrol")).toBeInTheDocument();
    act(() => api().completeTwoFactorEnrolment("full"));
    expect(screen.getByText("a@example.test open")).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_KEY)).toBe("full");
  });

  it("reads the set-up requirement from the session check too", async () => {
    localStorage.setItem(TOKEN_KEY, "tok");
    vi.spyOn(apiClient, "get").mockResolvedValue({ data: { user: USER, must_change_password: false, must_enrol_2fa: true } });
    render(<LocalAuthProvider><Probe onReady={() => undefined} /></LocalAuthProvider>);
    expect(await screen.findByText("a@example.test enrol")).toBeInTheDocument();
  });
});

describe("set-up and turn-off calls", () => {
  it("confirmTwoFactor stores the replacement session and returns the recovery codes", async () => {
    localStorage.setItem(TOKEN_KEY, "restricted");
    vi.spyOn(apiClient, "post").mockResolvedValue({ data: { recovery_codes: ["AAAA-BBBB-CCCC-DDDD"], token: "full" } });
    await expect(confirmTwoFactor("123456")).resolves.toEqual({ recoveryCodes: ["AAAA-BBBB-CCCC-DDDD"], token: "full" });
    expect(localStorage.getItem(TOKEN_KEY)).toBe("full");
  });

  it("disableTwoFactor stores the replacement session, and keeps the old one when refused", async () => {
    localStorage.setItem(TOKEN_KEY, "old");
    const post = vi.spyOn(apiClient, "post").mockRejectedValueOnce(new Error("422"));
    await expect(disableTwoFactor("pw", "000000")).rejects.toThrow();
    expect(localStorage.getItem(TOKEN_KEY)).toBe("old");
    post.mockResolvedValueOnce({ data: { ok: true, token: "new" } });
    await expect(disableTwoFactor("pw", "123456")).resolves.toBe("new");
    expect(post).toHaveBeenLastCalledWith("/api/v1/auth/2fa/disable", { password: "pw", code: "123456" });
    expect(localStorage.getItem(TOKEN_KEY)).toBe("new");
  });
});
