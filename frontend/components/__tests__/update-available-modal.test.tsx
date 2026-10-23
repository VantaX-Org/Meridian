import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as updateApi from "@/lib/api/system-update";
import { UpdateAvailableModal } from "../update-available-modal";

const h = vi.hoisted(() => ({ user: { role: "platform_admin", permissions: ["view", "manage_system"] } }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/context/update-modal-context", () => ({ useUpdateModal: () => ({ openSignal: 0 }), UPDATE_SNOOZE_KEY: "k" }));

const STATUS = { current_version: "1.0.0", latest_version: "1.1.0", update_available: true, release_notes: "", updater_configured: true };

describe("UpdateAvailableModal", () => {
  it("shows the update to a platform_admin, who holds manage_system", async () => {
    h.user = { role: "platform_admin", permissions: ["view", "manage_system"] };
    vi.spyOn(updateApi, "getUpdateStatus").mockResolvedValue(STATUS);
    renderWithQuery(<UpdateAvailableModal />);
    await waitFor(() => expect(screen.getByText("A new version of Meridian is available")).toBeTruthy());
  });

  it("never asks for the status without manage_system", async () => {
    h.user = { role: "manager", permissions: ["view", "manage_systems"] };
    const spy = vi.spyOn(updateApi, "getUpdateStatus").mockResolvedValue(STATUS);
    spy.mockClear();
    renderWithQuery(<UpdateAvailableModal />);
    await new Promise((r) => setTimeout(r, 20));
    expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByText("A new version of Meridian is available")).toBeNull();
  });
});
