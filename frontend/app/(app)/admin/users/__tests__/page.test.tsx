import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as usersApi from "@/lib/api/users";
import * as authApi from "@/lib/api/auth";
import * as auditApi from "@/lib/api/audit";
import type { User } from "@/types/api";
import AdminUsersPage from "../page";

const role = { can: () => true, loading: false };
vi.mock("@/hooks/use-role", () => ({ useRole: () => role }));
const auth = vi.hoisted(() => ({ user: { id: "me" } as { id: string } | null }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: auth.user }) }));

const USER: User = {
  id: "u1", tenant_id: "t1", clerk_user_id: null, email: "ana@example.com", name: "Ana Steward",
  role: "steward", permissions: null, is_active: true, last_login: null, created_at: "2026-01-01T00:00:00Z",
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/x",
  useSearchParams: () => new URLSearchParams(),
}));

describe("admin users page", () => {
  it("shows a skeleton, not a refusal, while the grants are still loading", () => {
    role.loading = true;
    try {
      renderWithQuery(<AdminUsersPage />);
      expect(screen.queryByText(/Only administrators manage users/)).toBeNull();
      expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
    } finally {
      role.loading = false;
    }
  });

  it("renders users, roles and audit log once loaded", async () => {
    vi.spyOn(usersApi, "getUsers").mockResolvedValue({ users: [USER] });
    vi.spyOn(usersApi, "getAssignableUsers").mockResolvedValue([]);
    vi.spyOn(authApi, "getRoleMatrix").mockResolvedValue({ steward: ["fix"] });
    vi.spyOn(auditApi, "getAuditEntries").mockResolvedValue({ entries: [], total: 0, limit: 50, offset: 0 });
    renderWithQuery(<AdminUsersPage />);
    await waitFor(() => expect(screen.getByText("Ana Steward")).toBeInTheDocument());
  });

  it("opens a row's actions from a sized icon button that edits the user", async () => {
    vi.spyOn(usersApi, "getUsers").mockResolvedValue({ users: [USER] });
    vi.spyOn(authApi, "getRoleMatrix").mockResolvedValue({ steward: ["fix"] });
    renderWithQuery(<AdminUsersPage />);
    const trigger = await screen.findByRole("button", { name: "Actions for Ana Steward" });
    expect(trigger).toHaveClass("m-iconbtn", "m-iconbtn-sm");
    expect(trigger).toHaveAttribute("type", "button");
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
    expect(await screen.findByRole("dialog", { name: "Ana Steward" })).toBeInTheDocument();
  });

  it("has no role matrix of its own and deep-links a user's grants to Roles and access", async () => {
    vi.spyOn(usersApi, "getUsers").mockResolvedValue({ users: [USER] });
    vi.spyOn(authApi, "getRoleMatrix").mockResolvedValue({ steward: ["fix"] });
    renderWithQuery(<AdminUsersPage />);
    fireEvent.click(await screen.findByText("Ana Steward"));
    expect(screen.queryByRole("tab", { name: "Roles" })).toBeNull();
    const dialog = await screen.findByRole("dialog", { name: "Ana Steward" });
    expect(within(dialog).getByRole("link", { name: "Roles and access" })).toHaveAttribute("href", "/admin/roles?tab=users&user=u1");
  });

  it("locks role, Active and Remove on your own row, with the reason", async () => {
    const ME: User = { ...USER, id: "me", name: "Me Admin", email: "me@example.com", role: "admin" };
    vi.spyOn(usersApi, "getUsers").mockResolvedValue({ users: [ME, USER] });
    vi.spyOn(authApi, "getRoleMatrix").mockResolvedValue({ steward: ["fix"] });
    renderWithQuery(<AdminUsersPage />);
    fireEvent.click(await screen.findByText("Me Admin"));
    const dialog = await screen.findByRole("dialog", { name: "Me Admin" });
    expect(within(dialog).getByText(/You can't change your own access/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox")).toBeNull();
    expect(within(dialog).getByRole("checkbox", { name: "Active" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /Remove user/ })).toBeDisabled();
  });

  it("leaves another user's role, Active and Remove editable", async () => {
    vi.spyOn(usersApi, "getUsers").mockResolvedValue({ users: [USER] });
    vi.spyOn(authApi, "getRoleMatrix").mockResolvedValue({ steward: ["fix"] });
    renderWithQuery(<AdminUsersPage />);
    fireEvent.click(await screen.findByText("Ana Steward"));
    const dialog = await screen.findByRole("dialog", { name: "Ana Steward" });
    expect(within(dialog).queryByText(/You can't change your own access/)).toBeNull();
    expect(within(dialog).getByRole("checkbox", { name: "Active" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Remove user" })).toBeEnabled();
  });

  it("shows a retryable error when users fail to load", async () => {
    const spy = vi.spyOn(usersApi, "getUsers").mockRejectedValue(new Error("network down"));
    vi.spyOn(usersApi, "getAssignableUsers").mockResolvedValue([]);
    vi.spyOn(authApi, "getRoleMatrix").mockResolvedValue({ steward: ["fix"] });
    vi.spyOn(auditApi, "getAuditEntries").mockResolvedValue({ entries: [], total: 0, limit: 50, offset: 0 });
    renderWithQuery(<AdminUsersPage />);
    await waitFor(() => expect(screen.getByText(/Could not reach the server/)).toBeInTheDocument());
    const retry = screen.getAllByRole("button", { name: /retry/i })[0];
    spy.mockResolvedValue({ users: [USER] });
    retry.click();
    await waitFor(() => expect(screen.getByText("Ana Steward")).toBeInTheDocument());
  });
});
