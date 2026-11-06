import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as adminApi from "@/lib/api/v2/admin";
import { resetAdminFixture } from "@/lib/api/v2/fixtures";
import { ApiKeysSection } from "../admin/apikeys";
import { RolesSection } from "../admin/roles";
import { UsersSection } from "../admin/users";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetAdminFixture();
  undo = stubLayout();
  setUrl("/admin");
});
afterEach(() => {
  undo();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("Admin: empty lists say what to do first", () => {
  it("users: an empty tenant offers the first invitation", async () => {
    const real = await adminApi.listUsers();
    vi.spyOn(adminApi, "listUsers").mockResolvedValue({ ...real, users: [] } as typeof real);
    renderWithQuery(<UsersSection />);
    expect(await screen.findByText(/No users yet/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Invite a user" }).length).toBeGreaterThan(0);
  });

  it("roles: no roles and no open requests are each explained", async () => {
    vi.spyOn(adminApi, "listRoles").mockResolvedValue([]);
    vi.spyOn(adminApi, "listAccessRequests").mockResolvedValue([]);
    renderWithQuery(<RolesSection />);
    expect(await screen.findByText(/No roles yet/)).toBeInTheDocument();
    expect(await screen.findByText(/No open requests/)).toBeInTheDocument();
  });

  it("API keys: no keys says what a key is for", async () => {
    vi.spyOn(adminApi, "listApiKeys").mockResolvedValue([]);
    renderWithQuery(<ApiKeysSection />);
    expect(await screen.findByText(/No API keys yet/)).toBeInTheDocument();
  });
});
