import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as admin from "@/lib/api/v2/admin";
import type { Role } from "@/lib/api/v2/admin";
import { InviteSheet } from "./sheets";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

const role = (key: string, name: string, legacy: boolean): Role =>
  ({ key, name, description: null, built_in: true, legacy, cloned_from: null, updated_at: null, users: 0 });

describe("invite sheet role picker", () => {
  it("defaults to Viewer and never offers a legacy role", async () => {
    vi.spyOn(admin, "listRoles").mockResolvedValue([
      role("admin", "Admin (legacy)", true), role("data_steward", "Data steward", false),
      role("steward", "Steward (legacy)", true), role("viewer", "Viewer", false),
    ]);
    renderWithQuery(<InviteSheet />);
    const select = await screen.findByRole("combobox");
    await vi.waitFor(() => expect((select as HTMLSelectElement).value).toBe("viewer"));
    const keys = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    expect(keys).toEqual(["data_steward", "viewer"]);
  });
});
