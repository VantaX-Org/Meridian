import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as usersApi from "@/lib/api/users";
import * as authApi from "@/lib/api/auth";
import * as auditApi from "@/lib/api/audit";
import * as rolesApi from "@/lib/api/roles";
import * as connectivityApi from "@/lib/api/connectivity";
import type { User } from "@/types/api";
import AdminUsersPage from "../page";

const role = { can: () => true, loading: false };
vi.mock("@/hooks/use-role", () => ({ useRole: () => role }));
vi.mock("@/components/admin/settings-tabs", () => ({ SettingsTabs: () => null }));
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

const ROLE_ROWS: rolesApi.Role[] = [
  { key: "data_steward", name: "Data steward", description: null, built_in: true, legacy: false, cloned_from: null, updated_at: null, users: 1 },
  { key: "steward", name: "Steward (legacy)", description: null, built_in: true, legacy: true, cloned_from: null, updated_at: null, users: 1 },
  { key: "analyst", name: "Analyst", description: null, built_in: true, legacy: false, cloned_from: null, updated_at: null, users: 1 },
];
const GRANTS: rolesApi.Grant[] = [
  { id: "g1", role_key: "data_steward", system_id: null, module: null, user_id: "u1", granted_by: null, created_at: null },
  { id: "g2", role_key: "steward", system_id: null, module: null, user_id: "u1", granted_by: null, created_at: null },
  { id: "g3", role_key: "analyst", system_id: "s1", module: "fi_gl", user_id: "u1", granted_by: null, created_at: null },
];

beforeEach(() => {
  vi.spyOn(rolesApi, "listGrants").mockResolvedValue(GRANTS);
  vi.spyOn(rolesApi, "listRoles").mockResolvedValue(ROLE_ROWS);
  vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([{ id: "s1", name: "ECC prod" }] as Awaited<ReturnType<typeof connectivityApi.getSystems>>);
});

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
    renderWithQuery(<AdminUsersPage />);
    fireEvent.click(await screen.findByText("Ana Steward"));
    expect(screen.queryByRole("tab", { name: "Roles" })).toBeNull();
    const dialog = await screen.findByRole("dialog", { name: "Ana Steward" });
    expect(within(dialog).getByRole("link", { name: "Manage roles" })).toHaveAttribute("href", "/admin/roles?tab=users&user=u1");
  });

  it("shows the user's grants read-only with their scope, and no role select", async () => {
    vi.spyOn(usersApi, "getUsers").mockResolvedValue({ users: [USER] });
    renderWithQuery(<AdminUsersPage />);
    fireEvent.click(await screen.findByText("Ana Steward"));
    const dialog = await screen.findByRole("dialog", { name: "Ana Steward" });
    const list = await within(dialog).findByRole("list", { name: "Roles granted" });
    expect(await within(list).findByText("Data steward, All systems")).toBeInTheDocument();
    expect(within(list).getByText("Steward (legacy), All systems")).toBeInTheDocument();
    expect(await within(list).findByText("Analyst, ECC prod / FI general ledger")).toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox")).toBeNull();
    expect(within(dialog).queryByLabelText("Role")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /Remove Data steward/ })).toBeNull();
  });

  it("lists each user's granted roles in the table", async () => {
    vi.spyOn(usersApi, "getUsers").mockResolvedValue({ users: [{ ...USER, grants: [
      { id: "g1", role_key: "data_steward", role_name: "Data steward", system_id: null, system_name: null, module: null },
      { id: "g3", role_key: "analyst", role_name: "Analyst", system_id: "s1", system_name: "ECC prod", module: "fi_gl" },
      { id: "g4", role_key: "analyst", role_name: "Analyst", system_id: null, system_name: null, module: "hcm" },
    ] }] });
    renderWithQuery(<AdminUsersPage />);
    expect(await screen.findByText("Data steward, Analyst")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Roles" })).toBeInTheDocument();
  });

  it("locks Active and Remove on your own row, with the reason", async () => {
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

  it("leaves another user's Active and Remove editable", async () => {
    vi.spyOn(usersApi, "getUsers").mockResolvedValue({ users: [USER] });
    vi.spyOn(authApi, "getRoleMatrix").mockResolvedValue({ steward: ["fix"] });
    renderWithQuery(<AdminUsersPage />);
    fireEvent.click(await screen.findByText("Ana Steward"));
    const dialog = await screen.findByRole("dialog", { name: "Ana Steward" });
    expect(within(dialog).queryByText(/You can't change your own access/)).toBeNull();
    expect(within(dialog).getByRole("checkbox", { name: "Active" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Remove user" })).toBeEnabled();
  });

  it("counts users and those who never signed in in the header meta, not a stat tile", async () => {
    const signedIn: User = { ...USER, id: "u2", name: "Ben Analyst", email: "ben@example.com", last_login: "2026-10-20T00:00:00Z" };
    const never: User = { ...USER, id: "u3", name: "Cleo Viewer", email: "cleo@example.com" };
    vi.spyOn(usersApi, "getUsers").mockResolvedValue({ users: [USER, signedIn, never] });
    renderWithQuery(<AdminUsersPage />);
    expect(await screen.findByTestId("users-meta")).toHaveTextContent("3 users, 2 never signed in");
    expect(screen.queryByText("Never signed in")).toBeNull();
    // the user cell is one line: name and email side by side
    const name = await screen.findByText("Ana Steward");
    expect(name.parentElement).toHaveTextContent("Ana Stewardana@example.com");
    expect(name.closest("td")).toHaveClass("sticky");
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
