// Admin › Users: who has two-factor sign-in, resetting it for a lost phone, and requiring it for everyone.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as usersApi from "@/lib/api/users";
import * as rolesApi from "@/lib/api/roles";
import * as connectivityApi from "@/lib/api/connectivity";
import type { User } from "@/types/api";
import AdminUsersPage from "../page";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true, loading: false }) }));
const auth = vi.hoisted(() => ({ user: { id: "me" } }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/users",
  useSearchParams: () => new URLSearchParams(),
}));

const base = { tenant_id: "t1", clerk_user_id: null, role: "viewer" as const, permissions: null, is_active: true, last_login: null, created_at: "2026-01-01T00:00:00Z" };
const ANA: User = { ...base, id: "u1", email: "ana@example.test", name: "Ana Steward", totp_enabled: true };
const BEN: User = { ...base, id: "u2", email: "ben@example.test", name: "Ben Viewer", totp_enabled: false };
const ME: User = { ...base, id: "me", email: "me@example.test", name: "Me Admin", totp_enabled: true };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(usersApi, "getUsers").mockResolvedValue({ users: [ANA, BEN, ME] });
  vi.spyOn(rolesApi, "listGrants").mockResolvedValue([]);
  vi.spyOn(rolesApi, "listRoles").mockResolvedValue([]);
  vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
});

describe("admin users two-factor sign-in", () => {
  it("resets a user's two-factor sign-in after a confirmation", async () => {
    vi.spyOn(usersApi, "getSecuritySettings").mockResolvedValue({ require_2fa: false });
    const reset = vi.spyOn(usersApi, "resetUserTwoFactor").mockResolvedValue({ id: "u1", totp_enabled: false });
    renderWithQuery(<AdminUsersPage />);
    fireEvent.click(await screen.findByText("Ana Steward"));
    const drawer = await screen.findByRole("dialog");
    fireEvent.click(within(drawer).getByRole("button", { name: "Reset two-factor sign-in" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reset" }));
    await waitFor(() => expect(reset).toHaveBeenCalledWith("u1"));
  });

  it("does not offer a reset of your own", async () => {
    vi.spyOn(usersApi, "getSecuritySettings").mockResolvedValue({ require_2fa: false });
    renderWithQuery(<AdminUsersPage />);
    fireEvent.click(await screen.findByText("Me Admin"));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByRole("button", { name: /Reset two-factor sign-in. Turn your own off under Preferences/ })).toBeDisabled();
  });

  it("requires two-factor sign-in for everyone after a confirmation, and says who lacks it", async () => {
    vi.spyOn(usersApi, "getSecuritySettings").mockResolvedValue({ require_2fa: false });
    const save = vi.spyOn(usersApi, "updateSecuritySettings").mockResolvedValue({ require_2fa: true });
    renderWithQuery(<AdminUsersPage />);
    expect(await screen.findByText("1 of 3 active users have not set it up.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Require two-factor sign-in for everyone" }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Require it" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ require_2fa: true }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Require two-factor sign-in for everyone" })).toHaveAttribute("aria-checked", "true"));
  });
});
