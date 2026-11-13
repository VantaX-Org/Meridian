import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as adminApi from "@/lib/api/v2/admin";
import { resetAdminFixture } from "@/lib/api/v2/fixtures";
import { ROLES } from "@/lib/roles";
import { actionsOf } from "@/lib/v2/view-as";
import { Inspector } from "../Inspector";
import { resetKeptOutcomes } from "../inspector/shared";
import { UsersSection } from "../admin/users";
import { destinations, kidsFor } from "../shell/menu";
import { ToastProvider } from "../Toast";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Programme lead", name: "Test", email: null, fixture: true, can: () => true }) };
});

describe("the menu per role", () => {
  const links = destinations().flatMap((d) => d.kids.map((k) => ({ d, k })));
  const gated = links.filter(({ k }) => k.need);

  it("has gated links to test", () => {
    expect(gated.length).toBeGreaterThan(0);
  });

  it.each(ROLES)("%s sees a gated link exactly when its permissions allow the action", (role) => {
    const can = (a: string) => actionsOf(role).includes(a);
    for (const d of destinations()) {
      const shown = new Set(kidsFor(d, can).map((k) => k.href));
      for (const k of d.kids) expect(shown.has(k.href), `${role} ${k.href}`).toBe(!k.need || can(k.need));
    }
  });

  it("every ungated link stays in the menu for every role", () => {
    for (const role of ROLES) {
      const can = (a: string) => actionsOf(role).includes(a);
      for (const d of destinations()) expect(kidsFor(d, can).length).toBeGreaterThanOrEqual(d.kids.filter((k) => !k.need).length);
    }
  });
});

describe("the users screen", () => {
  let undo: () => void = () => undefined;
  beforeEach(() => {
    window.sessionStorage.setItem("mn_v2_fixture", "1");
    resetAdminFixture();
    resetKeptOutcomes();
    undo = stubLayout();
    setUrl("/admin/users?fixture=1");
  });
  afterEach(() => {
    undo();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("invites a user with a first role, then changes the role of that person", async () => {
    const invite = vi.spyOn(adminApi, "inviteUser");
    const add = vi.spyOn(adminApi, "addGrant");
    renderWithQuery(
      <ToastProvider>
        <UsersSection />
        <Inspector />
      </ToastProvider>,
    );
    await screen.findByText("Nomsa Dlamini");
    fireEvent.click(screen.getByRole("button", { name: "Invite a user" }));
    const form = await screen.findByRole("dialog", { name: "Invite a user" });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "role.change@example.com" } });
    await within(form).findByRole("option", { name: "Analyst" });
    fireEvent.change(within(form).getByLabelText("Role"), { target: { value: "analyst" } });
    fireEvent.click(screen.getByRole("button", { name: "Send the invitation" }));
    await waitFor(() => expect(invite).toHaveBeenCalledWith(expect.objectContaining({ email: "role.change@example.com", grants: [{ role_key: "analyst", system_id: null, module: null }] })));
    fireEvent.click(await screen.findByRole("button", { name: "Open the new user" }));
    const person = await screen.findByRole("dialog", { name: /role\.change@example\.com|role\.change/i });
    await within(person).findByRole("option", { name: "Auditor" });
    fireEvent.change(within(person).getByLabelText("Role"), { target: { value: "auditor" } });
    fireEvent.click(within(person).getByRole("button", { name: "Add the role" }));
    await waitFor(() => expect(add).toHaveBeenCalledWith(expect.any(String), { role_key: "auditor", system_id: null, module: null }));
    await waitFor(() => expect(within(within(person).getByRole("list", { name: "Roles granted" })).getAllByRole("listitem")).toHaveLength(2));
  });
});
