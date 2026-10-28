import axe from "axe-core";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as rolesApi from "@/lib/api/roles";
import { ACTIONS, RESOURCES, resourceMatrix } from "@/lib/rbac";
import { MatrixTab, cellText } from "../matrix-tab";
import { RoleNavPreview, navForRole } from "../role-nav-preview";

const role = (key: string, name: string, legacy_actions: string[], extra: Partial<rolesApi.MatrixRole> = {}): rolesApi.MatrixRole => ({
  key, name, built_in: true, legacy: false, matrix: resourceMatrix(legacy_actions), legacy_actions, ...extra,
});
const VIEWER = role("viewer", "Viewer", ["view"]);
const ADMINISH = role("platform_admin", "Platform admin", ["view", "manage_users", "manage_settings", "view_audit", "manage_system"]);
const OLD = role("steward", "Steward (legacy)", ["view", "approve"], { legacy: true });
const MATRIX: rolesApi.RolesMatrix = { resources: [...RESOURCES], actions: [...ACTIONS], roles: [VIEWER, ADMINISH, OLD] };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(rolesApi, "getRolesMatrix").mockResolvedValue(MATRIX);
});

describe("MatrixTab", () => {
  it("draws one row per role and one column per resource in an m-table with a sticky first column", async () => {
    renderWithQuery(<MatrixTab />);
    const table = await screen.findByRole("table", { name: "Permissions by role" });
    expect(table).toHaveClass("m-table");
    const body = within(table).getAllByRole("row").slice(1);
    expect(body).toHaveLength(3);
    expect(within(table).getAllByRole("columnheader")).toHaveLength(1 + RESOURCES.length);
    const first = within(body[0]).getByRole("rowheader", { name: "Viewer" });
    expect(first).toHaveClass("sticky", "left-0");
    expect(within(table).getByRole("columnheader", { name: "Role" })).toHaveClass("sticky");
  });

  it("reads each cell as the actions the role holds", () => {
    expect(cellText(VIEWER, "findings", ACTIONS)).toBe("View");
    expect(cellText(VIEWER, "users", ACTIONS)).toBe("None");
    expect(cellText(ADMINISH, "users", ACTIONS)).toContain("Administer");
  });

  it("shows the legacy actions only when asked", async () => {
    renderWithQuery(<MatrixTab />);
    await screen.findByRole("table", { name: "Permissions by role" });
    expect(screen.queryByRole("columnheader", { name: "Legacy actions" })).toBeNull();
    const choice = screen.getByRole("button", { name: "Show legacy actions" });
    expect(choice).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(choice);
    expect(choice).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("columnheader", { name: "Legacy actions" })).toBeInTheDocument();
    const row = screen.getByRole("rowheader", { name: "Steward (legacy)" }).closest("tr") as HTMLElement;
    expect(within(row).getByText("View, Approve")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = renderWithQuery(<MatrixTab />);
    await screen.findByRole("table", { name: "Permissions by role" });
    // jsdom has no layout, so colour contrast is checked by the e2e axe pass instead.
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  it("retries when the matrix cannot be read", async () => {
    const spy = vi.spyOn(rolesApi, "getRolesMatrix").mockRejectedValue(new Error("down"));
    renderWithQuery(<MatrixTab />);
    await waitFor(() => expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument());
    spy.mockResolvedValue(MATRIX);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByRole("table", { name: "Permissions by role" })).toBeInTheDocument();
  });
});

describe("What this role sees", () => {
  const labels = (r: rolesApi.MatrixRole) => navForRole(r).flatMap((g) => g.items.map((i) => i.label));

  it("feeds visibleNav the role's own permissions", () => {
    expect(labels(VIEWER)).not.toContain("Users");
    expect(labels(ADMINISH)).toEqual(expect.arrayContaining(["Users", "Roles and access", "Audit log"]));
  });

  it("lists the pages for the chosen role, read only", async () => {
    renderWithQuery(<RoleNavPreview roleKey="platform_admin" />);
    const list = await screen.findByRole("list", { name: "Pages this role can open" });
    expect(within(list).getByText("Users")).toBeInTheDocument();
    expect(within(list).getByText("Audit log")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/nobody is impersonated/)).toBeInTheDocument();
  });

  it("shows a viewer without the admin pages", async () => {
    renderWithQuery(<RoleNavPreview roleKey="viewer" />);
    const list = await screen.findByRole("list", { name: "Pages this role can open" });
    expect(within(list).queryByText("Users")).toBeNull();
    expect(within(list).queryByText("Roles and access")).toBeNull();
  });

  it("says so for a role that is not in the matrix", async () => {
    renderWithQuery(<RoleNavPreview roleKey="custom:gone" />);
    expect(await screen.findByText("This role is not in the matrix yet.")).toBeInTheDocument();
  });
});
