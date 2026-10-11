import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GrantsPicker } from "../grants-picker";
import { matrixDiff } from "../role-matrix";

const ROLE = { key: "viewer", name: "Viewer", description: null, built_in: true, legacy: true, cloned_from: null, updated_at: null, users: 0 };

describe("GrantsPicker", () => {
  it("adds a grant from a preset role and removes an existing one", () => {
    const onAdd = vi.fn(), onRemove = vi.fn();
    const g = { id: "g1", role_key: "viewer", system_id: null, module: null };
    render(<GrantsPicker grants={[g]} roles={[ROLE]} systems={[]} onAdd={onAdd} onRemove={onRemove} preset={{ role_key: "viewer" }} />);
    fireEvent.click(screen.getByRole("button", { name: /Add grant/ }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ role_key: "viewer" }));
    fireEvent.click(screen.getByRole("button", { name: /Remove viewer/ }));
    expect(onRemove).toHaveBeenCalledWith(g);
  });
  it("matrixDiff counts added and removed cells", () => {
    expect(matrixDiff({ a: { x: true, y: false } }, { a: { x: false, y: true } })).toEqual({ added: 1, removed: 1 });
  });
});
