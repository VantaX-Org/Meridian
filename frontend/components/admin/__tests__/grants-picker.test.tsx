import userEvent from "@testing-library/user-event";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { describe, expect, it, vi } from "vitest";
import { GrantsPicker } from "../grants-picker";
import { matrixDiff, RoleMatrix } from "../role-matrix";

const ROLE = { key: "viewer", name: "Viewer", description: null, built_in: true, legacy: false, cloned_from: null, updated_at: null, users: 0 };
const role = (key: string, name: string, extra: Partial<typeof ROLE> = {}) => ({ ...ROLE, key, name, ...extra });

describe("GrantsPicker", () => {
  it("adds a grant from a preset role and removes an existing one", () => {
    const onAdd = vi.fn(), onRemove = vi.fn();
    const g = { id: "g1", role_key: "viewer", system_id: null, module: null };
    renderWithQuery(<GrantsPicker grants={[g]} roles={[ROLE]} systems={[]} onAdd={onAdd} onRemove={onRemove} preset={{ role_key: "viewer" }} />);
    fireEvent.click(screen.getByRole("button", { name: /Add grant/ }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ role_key: "viewer" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Viewer, All systems" }));
    expect(onRemove).toHaveBeenCalledWith(g);
  });

  it("offers persona and custom roles only, and still shows a held legacy grant", async () => {
    const user = userEvent.setup();
    const roles = [
      role("platform_admin", "Platform admin"), role("data_steward", "Data steward"),
      role("admin", "Admin (legacy)", { legacy: true }), role("manager", "Manager (legacy)", { legacy: true }),
      role("steward", "Steward (legacy)", { legacy: true }), role("approver", "Approver (legacy)", { legacy: true }),
      // A legacy key is refused even if a stale list does not flag it.
      role("ai_reviewer", "AI reviewer (legacy)"),
      role("custom:ops", "Ops lead", { built_in: false }),
    ];
    const held = [
      { id: "g1", role_key: "admin", system_id: null, module: null },
      { id: "g2", role_key: "data_steward", system_id: "s1", module: "fi_gl" },
    ];
    renderWithQuery(<GrantsPicker grants={held} roles={roles} systems={[{ id: "s1", name: "ECC prod" }]} onAdd={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("Admin (legacy), All systems")).toBeInTheDocument();
    expect(screen.getByText("Data steward, ECC prod / FI general ledger")).toBeInTheDocument();
    await user.click(screen.getAllByRole("combobox")[0]);
    const offered = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(offered).toEqual(["Platform admin", "Data steward", "Ops lead"]);
  });
  it("matrixDiff counts added and removed cells", () => {
    expect(matrixDiff({ a: { x: true, y: false } }, { a: { x: false, y: true } })).toEqual({ added: 1, removed: 1 });
  });
});

describe("RoleMatrix lock", () => {
  const m = { users: { read: true } };
  it("shows the tenant-wide lock only when a scope is chosen", () => {
    const a = renderWithQuery(<RoleMatrix label="a" matrix={m} />);
    expect(screen.queryByLabelText("Tenant-wide; scope does not apply.")).toBeNull();
    a.unmount();
    renderWithQuery(<RoleMatrix label="b" matrix={m} scoped />);
    expect(screen.getByLabelText("Tenant-wide; scope does not apply.")).toBeInTheDocument();
  });
});
