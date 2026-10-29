import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as rolesApi from "@/lib/api/roles";
import * as meApi from "@/lib/api/me";
import * as usersApi from "@/lib/api/users";
import * as auditApi from "@/lib/api/audit";
import * as connApi from "@/lib/api/connectivity";
import * as triageApi from "@/lib/api/triage";
import AdminRolesPage from "../page";
import AdminRolesLoading from "../loading";

let tab = "roles";
let userParam = "";
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
// Each key keeps its own state, seeded from the "URL" the test sets.
vi.mock("@/hooks/use-url-state", async () => {
  const { useState } = await import("react");
  return { useUrlState: (key: string, initial = "") => useState(key === "tab" ? tab : key === "user" ? userParam : initial) };
});

const BUILTIN: rolesApi.Role = { key: "viewer", name: "Viewer", description: null, built_in: true, legacy: false, cloned_from: null, updated_at: null, users: 2 };
const CUSTOM: rolesApi.Role = { key: "custom:ops", name: "Ops", description: null, built_in: false, legacy: false, cloned_from: "viewer", updated_at: "2026-01-01T00:00:00Z", users: 0 };
const MATRIX = { findings: { read: true, write: false }, users: { read: false, write: false } };

beforeEach(() => {
  tab = "roles";
  userParam = "";
  vi.restoreAllMocks();
  vi.spyOn(rolesApi, "listRoles").mockResolvedValue([BUILTIN, CUSTOM]);
  vi.spyOn(rolesApi, "getRolePermissions").mockImplementation(async (key) => ({ key, built_in: key === "viewer", matrix: MATRIX }));
  vi.spyOn(connApi, "getSystems").mockResolvedValue([]);
  vi.spyOn(usersApi, "getUsers").mockResolvedValue({ users: [] });
});

describe("admin roles page", () => {
  it("loading skeleton is aria-busy", () => {
    render(<AdminRolesLoading />);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("round-trips the matrix of a custom role", async () => {
    const put = vi.spyOn(rolesApi, "putRolePermissions").mockResolvedValue({ key: "custom:ops", built_in: false, matrix: MATRIX });
    renderWithQuery(<AdminRolesPage />);
    fireEvent.click(await screen.findByText("Ops"));
    fireEvent.click(await screen.findByLabelText("findings write"));
    fireEvent.click(screen.getByRole("button", { name: "Save permissions" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("custom:ops", [{ resource: "findings", action: "read" }, { resource: "findings", action: "write" }]));
  });

  it("built-in role is read-only with Clone to edit", async () => {
    renderWithQuery(<AdminRolesPage />);
    fireEvent.click(await screen.findByText("Viewer"));
    expect(await screen.findByRole("button", { name: "Clone to edit" })).toBeInTheDocument();
    expect(screen.getByLabelText("findings read")).toBeDisabled();
  });

  it("clones, edits and deletes a custom role", async () => {
    const clone = vi.spyOn(rolesApi, "cloneRole").mockResolvedValue(CUSTOM);
    const upd = vi.spyOn(rolesApi, "updateRole").mockResolvedValue(CUSTOM);
    const del = vi.spyOn(rolesApi, "deleteRole").mockResolvedValue({ key: "custom:ops", status: "deleted" });
    renderWithQuery(<AdminRolesPage />);
    const user = userEvent.setup();
    await screen.findByText("Ops");
    // Clone is the row's visible action; a custom role's Edit and Delete wait in its menu, a built-in has no menu.
    expect(screen.queryByRole("button", { name: "Actions for Viewer" })).toBeNull();
    expect(screen.getByRole("button", { name: "Actions for Ops" })).toHaveClass("m-iconbtn", "m-iconbtn-sm");
    await user.click(screen.getByRole("button", { name: "Clone Viewer" }));
    await user.type(await screen.findByLabelText("New role name"), "Copy");
    await user.click(screen.getByRole("button", { name: "Create clone" }));
    await waitFor(() => expect(clone).toHaveBeenCalledWith({ name: "Copy", cloned_from: "viewer" }));

    await user.click(screen.getByRole("button", { name: "Actions for Ops" }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
    await user.type(await screen.findByLabelText("Name"), "2");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(upd).toHaveBeenCalledWith("custom:ops", { name: "Ops2", description: "" }));

    await user.click(screen.getByRole("button", { name: "Actions for Ops" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByText(/No one holds this role now/)).toBeInTheDocument();
    // The role's name must be typed before the delete enables.
    expect(screen.getByRole("button", { name: "Delete role" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type to confirm"), { target: { value: "Op" } });
    expect(screen.getByRole("button", { name: "Delete role" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type to confirm"), { target: { value: "Ops" } });
    await user.click(screen.getByRole("button", { name: "Delete role" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("custom:ops"));
  }, 60_000); // clone, edit and type-to-confirm delete in one walk; slow under a loaded full run

  it("opens a user's grants from ?user= and names the base role", async () => {
    tab = "users";
    userParam = "u1";
    vi.spyOn(usersApi, "getUsers").mockResolvedValue({ users: [{ id: "u1", tenant_id: "t", clerk_user_id: null, email: "a@x.io", name: "Ana", role: "viewer", permissions: null, is_active: true, last_login: null, created_at: "2026-01-01T00:00:00Z" }] });
    vi.spyOn(rolesApi, "listGrants").mockResolvedValue([]);
    vi.spyOn(rolesApi, "getUserEffective").mockResolvedValue({ role: "viewer", roles: [], actions: [], resources: {}, scopes: [], home: "/" });
    renderWithQuery(<AdminRolesPage />);
    expect(await screen.findByRole("dialog", { name: "Ana" })).toBeInTheDocument();
    expect(screen.getByText("Base role")).toBeInTheDocument();
    expect(screen.queryByText("Legacy role")).toBeNull();
  });

  it("adds and removes a grant, and shows effective permissions", async () => {
    tab = "users";
    vi.spyOn(usersApi, "getUsers").mockResolvedValue({ users: [{ id: "u1", tenant_id: "t", clerk_user_id: null, email: "a@x.io", name: "Ana", role: "viewer", permissions: null, is_active: true, last_login: null, created_at: "2026-01-01T00:00:00Z" }] });
    const grant = { id: "g1", role_key: "viewer", system_id: null, module: null, user_id: "u1", granted_by: null, created_at: null };
    vi.spyOn(rolesApi, "listGrants").mockResolvedValue([grant]);
    const eff = vi.spyOn(rolesApi, "getUserEffective").mockResolvedValue({
      role: "viewer", roles: [{ key: "viewer", name: "Viewer", system_id: null, module: null }], actions: [],
      resources: { findings: { read: true, write: false } }, scopes: [], home: "/",
    });
    const add = vi.spyOn(rolesApi, "addGrant").mockResolvedValue(grant);
    const rem = vi.spyOn(rolesApi, "deleteGrant").mockResolvedValue({ id: "g1", status: "deleted" });
    renderWithQuery(<AdminRolesPage />);
    fireEvent.click(await screen.findByText("Ana"));
    await waitFor(() => expect(eff).toHaveBeenCalledWith("u1", {}));
    expect(await screen.findByLabelText("findings read allowed")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Remove Viewer, All systems" }));
    expect(rem).not.toHaveBeenCalled(); // removal is confirmed first, naming what the user loses
    fireEvent.click(await screen.findByRole("button", { name: "Remove grant" }));
    await waitFor(() => expect(rem).toHaveBeenCalledWith("u1", "g1"));
    expect(add).not.toHaveBeenCalled();
  });

  it("refetches the users list after a grant changes, so its roles and scope column is current", async () => {
    tab = "users";
    const users = vi.spyOn(usersApi, "getUsers").mockResolvedValue({ users: [{ id: "u1", tenant_id: "t", clerk_user_id: null, email: "a@x.io", name: "Ana", role: "viewer", permissions: null, is_active: true, last_login: null, created_at: "2026-01-01T00:00:00Z" }] });
    const grant = { id: "g1", role_key: "viewer", system_id: null, module: null, user_id: "u1", granted_by: null, created_at: null };
    vi.spyOn(rolesApi, "listGrants").mockResolvedValue([grant]);
    vi.spyOn(rolesApi, "getUserEffective").mockResolvedValue({
      role: "viewer", roles: [{ key: "viewer", name: "Viewer", system_id: null, module: null }], actions: [],
      resources: {}, scopes: [], home: "/",
    });
    const rem = vi.spyOn(rolesApi, "deleteGrant").mockResolvedValue({ id: "g1", status: "deleted" });
    renderWithQuery(<AdminRolesPage />);
    fireEvent.click(await screen.findByText("Ana"));
    fireEvent.click(await screen.findByRole("button", { name: "Remove Viewer, All systems" }));
    const before = users.mock.calls.length;
    fireEvent.click(await screen.findByRole("button", { name: "Remove grant" }));
    await waitFor(() => expect(rem).toHaveBeenCalledWith("u1", "g1"));
    await waitFor(() => expect(users.mock.calls.length).toBeGreaterThan(before));
  });

  it("history lists audit rows", async () => {
    tab = "history";
    vi.spyOn(auditApi, "getAuditEntries").mockImplementation(async (p) => ({
      entries: p?.action === "role.create" ? [{ id: "a1", actor_user_id: null, actor_email: "root@x.io", action: "role.create", entity_type: "role", entity_id: "custom:ops", method: "POST", path: "/", status_code: 200, ip: null, user_agent: null, before_json: null, after_json: { n: 1 }, created_at: "2026-01-01T00:00:00Z" }] : [],
      total: 0, limit: 50, offset: 0,
    }));
    vi.spyOn(triageApi, "getTriageSettings").mockResolvedValue({
      timezone: "UTC", work_days: [1, 2, 3, 4, 5], work_start: "08:00:00", work_end: "17:00:00", holidays: [], fallback_user_id: null,
    });
    renderWithQuery(<AdminRolesPage />);
    // The same sentence and tenant-zone time as Admin > Audit log; no raw action code or record id.
    expect(await screen.findByText("root created a role")).toBeInTheDocument();
    expect(screen.queryByText(/role\.create|custom:ops/)).toBeNull();
    expect(screen.getByText(/Jan 2026/).closest("time")).toHaveAttribute("dateTime", "2026-01-01T00:00:00Z");
    // before and after read as a sentence per field, never raw JSON
    expect(screen.getByText("N: 1")).toBeInTheDocument();
    expect(screen.queryByText(/"after"/)).toBeNull();
  });

  it("empty states are plain sentences", async () => {
    tab = "history";
    vi.spyOn(auditApi, "getAuditEntries").mockResolvedValue({ entries: [], total: 0, limit: 50, offset: 0 });
    const h = renderWithQuery(<AdminRolesPage />);
    expect(await screen.findByText("No role changes yet")).toBeInTheDocument();
    h.unmount();
    tab = "requests";
    vi.spyOn(meApi, "listAccessRequests").mockResolvedValue([]);
    const r = renderWithQuery(<AdminRolesPage />);
    expect(await screen.findByText("No open requests")).toBeInTheDocument();
    r.unmount();
    tab = "users";
    renderWithQuery(<AdminRolesPage />);
    expect(await screen.findByText("No users yet")).toBeInTheDocument();
  });

  it("invite needs at least one grant", async () => {
    tab = "invite";
    const inv = vi.spyOn(usersApi, "inviteUser").mockResolvedValue({ id: "1", email: "n@x.io", role: "viewer", status: "invited" });
    renderWithQuery(<AdminRolesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Invite user" }));
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "n@x.io" } });
    expect(screen.getByRole("button", { name: "Send invitation" })).toBeDisabled();
    expect(inv).not.toHaveBeenCalled();
  });

  it("names Create role as the page's primary, and creates a role as a copy of the one picked", async () => {
    const clone = vi.spyOn(rolesApi, "cloneRole").mockResolvedValue(CUSTOM);
    renderWithQuery(<AdminRolesPage />);
    const user = userEvent.setup();
    const create = await screen.findByRole("button", { name: "Create role" });
    expect(create).toHaveClass("m-btn-primary");
    // The banner says what is possible, not a Clone button that does not exist.
    expect(screen.getByText(/Create a role or clone one, which starts as a copy/)).toBeInTheDocument();
    await user.click(create);
    expect(await screen.findByRole("dialog", { name: "Create role" })).toBeInTheDocument();
    expect(screen.getByText(/A new role starts as a copy of the role you pick/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("New role name"), "Auditors");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create role" }));
    await waitFor(() => expect(clone).toHaveBeenCalledWith({ name: "Auditors", cloned_from: "viewer" }));
  });

});
