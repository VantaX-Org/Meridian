import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as rolesApi from "@/lib/api/roles";
import * as usersApi from "@/lib/api/users";
import * as connApi from "@/lib/api/connectivity";
import { ACTIONS, RESOURCES, resourceMatrix } from "@/lib/rbac";
import type { User } from "@/types/api";
import AdminRolesPage from "../page";

const url = vi.hoisted(() => ({ tab: "roles", user: "", expiring: "" }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("@/hooks/use-url-state", async () => {
  const { useState } = await import("react");
  return { useUrlState: (key: string, initial = "") => useState((url as Record<string, string>)[key] ?? initial) };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));

const ROLE = (key: string, name: string, extra: Partial<rolesApi.Role> = {}): rolesApi.Role => ({
  key, name, description: null, built_in: true, legacy: false, cloned_from: null, updated_at: null, users: 1, ...extra,
});
const VIEWER = ROLE("viewer", "Viewer");
const STEWARD = ROLE("data_steward", "Data steward");
const mrole = (key: string, name: string, legacy_actions: string[]): rolesApi.MatrixRole => ({ key, name, built_in: true, legacy: false, matrix: resourceMatrix(legacy_actions), legacy_actions });
const MATRIX: rolesApi.RolesMatrix = {
  resources: [...RESOURCES], actions: [...ACTIONS],
  roles: [mrole("viewer", "Viewer", ["view"]), mrole("data_steward", "Data steward", ["view", "approve", "apply"])],
};
const grant = (id: string, expires_at: string | null) => ({ id, role_key: "viewer", role_name: "Viewer", system_id: null, system_name: null, module: null, expires_at });
const USER = (id: string, name: string, grants: User["grants"], extra: Partial<User> = {}): User => ({
  id, tenant_id: "t", clerk_user_id: null, email: `${id}@x.io`, name, role: "viewer", permissions: null, is_active: true,
  last_login: "2026-10-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z", grants, ...extra,
});
const EFFECTIVE = { role: "viewer", roles: [], actions: [], resources: {}, scopes: [], home: "/" };

beforeEach(() => {
  vi.restoreAllMocks();
  url.tab = "roles"; url.user = ""; url.expiring = "";
  vi.spyOn(rolesApi, "listRoles").mockResolvedValue([VIEWER, STEWARD]);
  vi.spyOn(rolesApi, "getRolePermissions").mockImplementation(async (key) => ({ key, built_in: true, matrix: resourceMatrix([]) }));
  vi.spyOn(rolesApi, "getRolesMatrix").mockResolvedValue(MATRIX);
  vi.spyOn(rolesApi, "getUserEffective").mockResolvedValue(EFFECTIVE);
  vi.spyOn(connApi, "getSystems").mockResolvedValue([{ id: "s1", name: "ECC prod" }] as Awaited<ReturnType<typeof connApi.getSystems>>);
});

describe("Roles and access", () => {
  it("has a Matrix tab that draws every role against the resources", async () => {
    url.tab = "matrix";
    renderWithQuery(<AdminRolesPage />);
    expect(screen.getByRole("tab", { name: "Matrix" })).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "Permissions by role" });
    expect(within(table).getByRole("rowheader", { name: "Data steward" })).toBeInTheDocument();
  });

  it("shows what a role sees in its drawer, as a preview", async () => {
    renderWithQuery(<AdminRolesPage />);
    fireEvent.click(await screen.findByText("Data steward"));
    const drawer = await screen.findByRole("dialog", { name: "Data steward" });
    expect(await within(drawer).findByText("What this role sees")).toBeInTheDocument();
    const list = await within(drawer).findByRole("list", { name: "Pages this role can open" });
    // The steward fixture holds no admin action, so no admin page is listed.
    expect(within(list).queryByText("Users")).toBeNull();
    expect(within(list).getByText("Fix work")).toBeInTheDocument();
  });
});

describe("grants", () => {
  const openAna = async () => {
    url.tab = "users";
    vi.spyOn(usersApi, "getUsers").mockResolvedValue({ users: [USER("u1", "Ana", [])] });
    vi.spyOn(rolesApi, "listGrants").mockResolvedValue([]);
    renderWithQuery(<AdminRolesPage />);
    fireEvent.click(await screen.findByText("Ana"));
    return screen.findByRole("dialog", { name: "Ana" });
  };
  const chooseRole = async (drawer: HTMLElement, name: string) => {
    const user = userEvent.setup();
    await user.click(within(drawer).getAllByRole("combobox")[0]);
    await user.click(await screen.findByRole("option", { name }));
  };

  it("shows what the grant adds before it is saved, and writes it only on Save grant", async () => {
    const diff: rolesApi.GrantPreview = {
      before: EFFECTIVE, after: EFFECTIVE,
      diff: { added_actions: ["approve"], added_pairs: [["fixes", "approve"], ["extraction", "run"]], widened_scopes: [{ system_id: null, module: null }] },
    };
    const preview = vi.spyOn(rolesApi, "previewGrant").mockResolvedValue(diff);
    const add = vi.spyOn(rolesApi, "addGrant").mockResolvedValue({ id: "g9", role_key: "data_steward", system_id: null, module: null, user_id: "u1", granted_by: null, created_at: null });
    const drawer = await openAna();
    await chooseRole(drawer, "Data steward");
    fireEvent.click(within(drawer).getByRole("button", { name: "Review grant" }));
    expect(await within(drawer).findByTestId("grant-diff")).toHaveTextContent("Adds: approve fixes; run extraction on every system");
    expect(preview).toHaveBeenCalledWith("u1", { role_key: "data_steward", system_id: null, module: null });
    expect(add).not.toHaveBeenCalled();
    fireEvent.click(within(drawer).getByRole("button", { name: "Save grant" }));
    await waitFor(() => expect(add).toHaveBeenCalledWith("u1", { role_key: "data_steward", system_id: null, module: null }));
  });

  it("sends the expiry date with the grant", async () => {
    vi.spyOn(rolesApi, "previewGrant").mockResolvedValue({ before: EFFECTIVE, after: EFFECTIVE, diff: { added_actions: [], added_pairs: [], widened_scopes: [] } });
    const add = vi.spyOn(rolesApi, "addGrant").mockResolvedValue({ id: "g9", role_key: "viewer", system_id: null, module: null, user_id: "u1", granted_by: null, created_at: null });
    const drawer = await openAna();
    await chooseRole(drawer, "Viewer");
    fireEvent.change(within(drawer).getByLabelText("Expires (optional)"), { target: { value: "2099-01-31" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Review grant" }));
    await within(drawer).findByTestId("grant-diff");
    fireEvent.click(within(drawer).getByRole("button", { name: "Save grant" }));
    await waitFor(() => expect(add).toHaveBeenCalledWith("u1", { role_key: "viewer", system_id: null, module: null, expires_at: "2099-01-31T23:59:59Z" }));
  });

  it("drops the draft on Close without writing anything", async () => {
    vi.spyOn(rolesApi, "previewGrant").mockResolvedValue({ before: EFFECTIVE, after: EFFECTIVE, diff: { added_actions: [], added_pairs: [], widened_scopes: [] } });
    const add = vi.spyOn(rolesApi, "addGrant");
    const drawer = await openAna();
    await chooseRole(drawer, "Viewer");
    fireEvent.click(within(drawer).getByRole("button", { name: "Review grant" }));
    expect(await within(drawer).findByTestId("grant-diff")).toHaveTextContent("Adds nothing new");
    fireEvent.click(within(within(drawer).getByRole("group", { name: "Grant preview" })).getByRole("button", { name: "Close" }));
    expect(within(drawer).queryByTestId("grant-diff")).toBeNull();
    expect(add).not.toHaveBeenCalled();
  });
});

describe("Users and scopes", () => {
  const PEOPLE = [
    USER("u1", "Ana", [grant("g1", null)]),
    USER("u2", "Ben", [grant("g2", "2026-11-10T00:00:00Z")]),
    USER("u3", "Cleo", [grant("g3", "2020-01-01T00:00:00Z")]),
    USER("u4", "Dev", [grant("g4", "2099-01-01T00:00:00Z")], { status: "locked" }),
  ];

  it("has an Expires column and a status pill per user", async () => {
    url.tab = "users";
    vi.spyOn(usersApi, "getUsers").mockResolvedValue({ users: PEOPLE });
    renderWithQuery(<AdminRolesPage />);
    expect(await screen.findByRole("columnheader", { name: "Expires" })).toBeInTheDocument();
    const cleo = (await screen.findByText("Cleo")).closest("tr") as HTMLElement;
    expect(within(cleo).getByText(/^Expired/)).toBeInTheDocument();
    expect(within(cleo).getByText("Active")).toBeInTheDocument();
    expect(within((await screen.findByText("Dev")).closest("tr") as HTMLElement).getByText("Locked")).toBeInTheDocument();
    expect(within((await screen.findByText("Ana")).closest("tr") as HTMLElement).getByText("Never")).toBeInTheDocument();
  });

  it("lists only people with a grant that has expired or ends soon when ?expiring=1", async () => {
    url.tab = "users"; url.expiring = "1";
    vi.spyOn(usersApi, "getUsers").mockResolvedValue({ users: PEOPLE });
    renderWithQuery(<AdminRolesPage />);
    expect(await screen.findByText("Cleo")).toBeInTheDocument();
    expect(screen.queryByText("Ana")).toBeNull();
    expect(screen.queryByText("Dev")).toBeNull();
    expect(screen.getByRole("button", { name: "Expiring within 30 days" })).toHaveAttribute("aria-pressed", "true");
  });
});
