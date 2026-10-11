import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as rolesApi from "@/lib/api/roles";
import * as connApi from "@/lib/api/connectivity";
import { EffectivePermissionsView } from "../effective-permissions";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(rolesApi, "getUserEffective").mockResolvedValue({ role: "viewer", roles: [], actions: [], resources: {}, scopes: [], home: "/" });
});

describe("EffectivePermissionsView modules", () => {
  it("loads the module list from the selected system, not a fixed list", async () => {
    const user = userEvent.setup();
    const mods = vi.spyOn(connApi, "getSystemModules").mockResolvedValue([{ module: "material", system_type: "ecc", enabled: true, last_synced_at: null, last_sync_status: null, row_count: 0, config_synced: false }]);
    renderWithQuery(<EffectivePermissionsView userId="u1" systems={[{ id: "s1", name: "Sys A" }]} />);
    expect(mods).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole("combobox")[0]);
    await user.click(await screen.findByRole("option", { name: "Sys A" }));
    await waitFor(() => expect(mods).toHaveBeenCalledWith("s1"));
    await user.click(screen.getAllByRole("combobox")[1]);
    expect(await screen.findByRole("option", { name: "material" })).toBeInTheDocument();
  });
});
