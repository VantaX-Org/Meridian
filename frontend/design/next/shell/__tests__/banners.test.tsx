// The shell bands ported from v2: Stop viewing as stays reachable under the sandbox band, and the role change
// notice reloads after marking itself read.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";

const h = vi.hoisted(() => ({
  sandbox: false,
  viewAs: null as string | null,
  stop: vi.fn(),
  get: vi.fn(),
  read: vi.fn(),
}));

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/v2/queries", async (orig) => ({ ...(await orig<object>()), useStatus: () => ({ data: { sandbox: h.sandbox } }) }));
vi.mock("@/lib/v2/step10-queries", async (orig) => ({ ...(await orig<object>()), useSandbox: () => ({ data: undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ viewAs: h.viewAs, shared: false, fixture: false }) }));
vi.mock("@/lib/api/v2/roles", async (orig) => ({ ...(await orig<object>()), stopViewAs: () => h.stop() }));
vi.mock("@/lib/api/v2/fixture", async (orig) => ({ ...(await orig<object>()), useFixture: () => false }));
vi.mock("@/lib/api/v2/client", async (orig) => ({ ...(await orig<object>()), v2Get: (...a: unknown[]) => h.get(...a) }));
vi.mock("@/lib/api/v2/inbox", async (orig) => ({ ...(await orig<object>()), putRead: (id: string) => h.read(id) }));

import { Banners, RoleChangeNotice, rolesNow } from "../Banners";

beforeEach(() => {
  h.sandbox = false;
  h.viewAs = null;
  h.stop.mockReset().mockResolvedValue(undefined);
  h.get.mockReset();
  h.read.mockReset().mockResolvedValue({ id: "n1", is_read: true });
});

describe("Banners", () => {
  it("keeps Stop viewing as under the sandbox band", () => {
    h.sandbox = true;
    h.viewAs = "viewer";
    renderWithQuery(<Banners />);
    expect(screen.getByTestId("sandbox-banner")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop viewing as" }));
    expect(h.stop).toHaveBeenCalled();
  });
  it("shows only the sandbox band when not viewing as a role", () => {
    h.sandbox = true;
    renderWithQuery(<Banners />);
    expect(screen.getByTestId("sandbox-banner")).toBeTruthy();
    expect(screen.queryByTestId("view-as-banner")).toBeNull();
  });
});

describe("RoleChangeNotice", () => {
  it("reads the new roles from the notification body", () => {
    expect(rolesNow("Before: Viewer. Now: Steward, Lead.")).toBe("Steward, Lead");
    expect(rolesNow("no roles here")).toBe("");
  });
  it("names the new roles and marks the notice read before reloading", async () => {
    h.get.mockResolvedValue({ items: [{ id: "n1", body: "Before: Viewer. Now: Steward." }] });
    const reload = vi.fn();
    const loc = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...loc, reload } });
    renderWithQuery(<RoleChangeNotice />);
    expect(await screen.findByText("Your access changed: you now have Steward. Reload to update the menu.")).toBeTruthy();
    expect(h.get).toHaveBeenCalledWith("/notifications", { type: "role_change", is_read: false, limit: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(h.read).toHaveBeenCalledWith("n1");
    Object.defineProperty(window, "location", { configurable: true, value: loc });
  });
  it("shows nothing when there is no unread change", async () => {
    h.get.mockResolvedValue({ items: [] });
    renderWithQuery(<RoleChangeNotice />);
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    expect(screen.queryByTestId("role-change-notice")).toBeNull();
  });
});
