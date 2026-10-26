// A password change revokes every session issued before it (users.token_version), the caller's included,
// so the client swaps in the replacement token the endpoint returns; the old one would 401 and sign out.
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import apiClient from "@/lib/api/client";
import { LocalAuthProvider, useAuth } from "@/context/auth-context";
import { changeOwnPassword } from "../auth";

const TOKEN_KEY = "mn_auth_token";
const USER = { id: "u1", email: "a@example.test", name: "Ana", role: "analyst", permissions: [] };

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  localStorage.setItem(TOKEN_KEY, "old-token");
});

describe("changeOwnPassword", () => {
  it("stores the replacement session token and returns it", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({ data: { ok: true, token: "new-token" } });
    await expect(changeOwnPassword("old-password-1", "a-long-new-password")).resolves.toBe("new-token");
    expect(post).toHaveBeenCalledWith("/api/v1/auth/change-password",
      { current_password: "old-password-1", new_password: "a-long-new-password" });
    expect(localStorage.getItem(TOKEN_KEY)).toBe("new-token");
  });

  it("keeps the old token and fails when the response carries no token", async () => {
    vi.spyOn(apiClient, "post").mockResolvedValue({ data: { ok: true } });
    await expect(changeOwnPassword("old-password-1", "a-long-new-password")).rejects.toThrow(/Sign in again/);
    expect(localStorage.getItem(TOKEN_KEY)).toBe("old-token");
  });

  it("leaves the stored token alone when the change is refused", async () => {
    vi.spyOn(apiClient, "post").mockRejectedValue(new Error("422"));
    await expect(changeOwnPassword("wrong", "a-long-new-password")).rejects.toThrow();
    expect(localStorage.getItem(TOKEN_KEY)).toBe("old-token");
  });
});

function Probe({ onReady }: { onReady: (change: (c: string, n: string) => Promise<void>) => void }) {
  const { token, mustChangePassword, changePassword } = useAuth();
  onReady(changePassword);
  return <p>{`${token ?? "none"} ${mustChangePassword ? "gate" : "open"}`}</p>;
}

describe("LocalAuthProvider.changePassword", () => {
  it("swaps the session to the replacement token and clears the gate", async () => {
    vi.spyOn(apiClient, "get").mockResolvedValue({ data: { user: USER, must_change_password: true } });
    vi.spyOn(apiClient, "post").mockResolvedValue({ data: { ok: true, token: "new-token" } });
    let change: ((c: string, n: string) => Promise<void>) | undefined;
    render(<LocalAuthProvider><Probe onReady={(fn) => { change = fn; }} /></LocalAuthProvider>);
    expect(await screen.findByText("old-token gate")).toBeInTheDocument();
    await act(async () => { await change?.("old-password-1", "a-long-new-password"); });
    expect(screen.getByText("new-token open")).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_KEY)).toBe("new-token");
  });
});
