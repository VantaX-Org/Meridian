import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as client from "@/lib/api/v2/client";
import * as inbox from "@/lib/api/v2/inbox";
import { RoleChangeNotice, rolesNow } from "../shell/RoleChangeNotice";
import { t } from "@/lib/v2/i18n";

const note = { id: "n1", body: "Before: Viewer. Now: Steward, Approver." };

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("RoleChangeNotice", () => {
  it("reads the new roles out of the notification body", () => {
    expect(rolesNow(note.body)).toBe("Steward, Approver");
    expect(rolesNow("garbled")).toBe("");
  });

  it("shows the banner for an unread role_change notification and reloads", async () => {
    vi.spyOn(client, "v2Get").mockResolvedValue({ items: [note] });
    const read = vi.spyOn(inbox, "putRead").mockResolvedValue({ id: "n1", is_read: true });
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    renderWithQuery(<RoleChangeNotice />);
    const banner = await screen.findByTestId("role-change-notice");
    expect(banner.textContent).toContain("Your access changed: you now have Steward, Approver. Reload to update the menu.");
    fireEvent.click(screen.getByRole("button", { name: t("Reload") }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(read).toHaveBeenCalledWith("n1");
    vi.unstubAllGlobals();
  });

  it("shows nothing when no role change is waiting", async () => {
    const get = vi.spyOn(client, "v2Get").mockResolvedValue({ items: [] });
    renderWithQuery(<RoleChangeNotice />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByTestId("role-change-notice")).toBeNull();
  });
});
