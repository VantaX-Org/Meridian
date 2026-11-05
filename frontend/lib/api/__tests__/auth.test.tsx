// The browser session is an httponly cookie, so the page keeps no token. A password change revokes every session
// issued before it, this one included; the response renews the cookie and there is nothing for the page to store.
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
  document.cookie = "mn_session=1; Path=/";
});

describe("changeOwnPassword", () => {
  it("posts both passwords and stores nothing", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({ data: { ok: true, token: "new-token" } });
    await expect(changeOwnPassword("old-password-1", "a-long-new-password")).resolves.toBeUndefined();
    expect(post).toHaveBeenCalledWith("/api/v1/auth/change-password",
      { current_password: "old-password-1", new_password: "a-long-new-password" });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("fails when the change is refused", async () => {
    vi.spyOn(apiClient, "post").mockRejectedValue(new Error("422"));
    await expect(changeOwnPassword("wrong", "a-long-new-password")).rejects.toThrow();
  });
});

function Probe({ onReady }: { onReady: (change: (c: string, n: string) => Promise<void>) => void }) {
  const { mustChangePassword, changePassword } = useAuth();
  onReady(changePassword);
  return <p>{mustChangePassword ? "gate" : "open"}</p>;
}

describe("LocalAuthProvider.changePassword", () => {
  it("clears the gate and keeps no token", async () => {
    vi.spyOn(apiClient, "get").mockResolvedValue({ data: { user: USER, must_change_password: true } });
    vi.spyOn(apiClient, "post").mockResolvedValue({ data: { ok: true, token: "new-token" } });
    let change: ((c: string, n: string) => Promise<void>) | undefined;
    render(<LocalAuthProvider><Probe onReady={(fn) => { change = fn; }} /></LocalAuthProvider>);
    expect(await screen.findByText("gate")).toBeInTheDocument();
    await act(async () => { await change?.("old-password-1", "a-long-new-password"); });
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});
