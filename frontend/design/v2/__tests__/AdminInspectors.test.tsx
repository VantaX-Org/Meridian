import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as adminApi from "@/lib/api/v2/admin";
import { resetAdminFixture } from "@/lib/api/v2/fixtures";
import { resetActions } from "@/lib/v2/undo";
import { Inspector } from "../Inspector";
import { resetKeptOutcomes } from "../inspector/shared";
import { ToastProvider } from "../Toast";
import { setUrl } from "./nav-store";

const h = vi.hoisted(() => ({ allowed: "all" as "all" | string[] }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Programme lead", name: "Test", email: null, fixture: true, can: (a: string) => h.allowed === "all" || h.allowed.includes(a) }) };
});

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetAdminFixture();
  resetKeptOutcomes();
  resetActions();
  h.allowed = "all";
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const open = (id: string) => {
  setUrl(`/v2/admin/users?fixture=1&open=user:${id}`);
  return renderWithQuery(
    <ToastProvider>
      <Inspector />
    </ToastProvider>,
  );
};

describe("the user inspector", () => {
  it("shows who the person is, how they sign in and what they can do now", async () => {
    open("u-3");
    const dialog = await screen.findByRole("dialog", { name: "Aisha Khan" });
    await within(dialog).findByText("aisha.khan@demo-corp.example", { selector: "dd" });
    expect(norm(dialog)).toContain("Data steward, Data owner / approver");
    expect(norm(dialog)).toContain("Active");
    expect(norm(dialog)).toContain("Password changed");
    const list = await within(dialog).findByRole("list", { name: "Effective permissions" });
    expect(norm(list)).toContain("fixes");
    const grants = within(dialog).getByRole("list", { name: "Roles granted" });
    expect(within(grants).getAllByRole("listitem")).toHaveLength(2);
    expect(norm(grants)).toContain("ECC production, Material master, until");
  });

  it("previews a grant before it is added, adds it, and removes it again", async () => {
    const add = vi.spyOn(adminApi, "addGrant");
    const remove = vi.spyOn(adminApi, "removeGrant");
    open("u-3");
    const dialog = await screen.findByRole("dialog", { name: "Aisha Khan" });
    await within(dialog).findByRole("option", { name: "Auditor" });
    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "auditor" } });
    expect(await within(dialog).findByTestId("grant-preview")).toHaveTextContent("This lets Aisha Khan");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add the role" }));
    await waitFor(() => expect(add).toHaveBeenCalledWith("u-3", { role_key: "auditor", system_id: null, module: null }));
    await waitFor(() => expect(within(within(dialog).getByRole("list", { name: "Roles granted" })).getAllByRole("listitem")).toHaveLength(3));
    const newest = within(within(dialog).getByRole("list", { name: "Roles granted" })).getAllByRole("listitem")[2];
    fireEvent.click(within(newest).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("u-3", expect.stringMatching(/^g-/)));
    await waitFor(() => expect(within(within(dialog).getByRole("list", { name: "Roles granted" })).getAllByRole("listitem")).toHaveLength(2));
  });

  it("suspends after a confirmation, and Undo in the notice reactivates", async () => {
    const spy = vi.spyOn(adminApi, "setUserActive");
    open("u-3");
    const dialog = await screen.findByRole("dialog", { name: "Aisha Khan" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Suspend" }));
    const confirm = await screen.findByRole("dialog", { name: "Suspend Aisha Khan" });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Suspend" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("u-3", false));
    expect(await within(dialog).findByRole("button", { name: "Reactivate" })).toBeInTheDocument();
    const notice = await screen.findByText("Aisha Khan suspended");
    fireEvent.click(within(notice.closest(".m2-toast") as HTMLElement).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith("u-3", true));
    expect(await within(dialog).findByRole("button", { name: "Suspend" })).toBeInTheDocument();
  });

  it("resets a password by email, in the frame", async () => {
    const spy = vi.spyOn(adminApi, "resetUserPassword");
    open("u-3");
    const dialog = await screen.findByRole("dialog", { name: "Aisha Khan" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Reset the password" }));
    const confirm = await screen.findByRole("dialog", { name: "Reset the password for Aisha Khan" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Email the link" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("u-3", true));
    expect(await within(dialog).findByTestId("action-result")).toHaveTextContent("Reset email sent to aisha.khan@demo-corp.example");
  });

  it("removes a user only after a confirmation", async () => {
    const spy = vi.spyOn(adminApi, "removeUser");
    open("u-8");
    const dialog = await screen.findByRole("dialog", { name: "Jonas Weber" });
    expect(await within(dialog).findByRole("button", { name: "Reactivate" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove the user" }));
    const confirm = await screen.findByRole("dialog", { name: "Remove Jonas Weber" });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove the user" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("u-8"));
  });

  it("an invited person can be sent the invitation again", async () => {
    const spy = vi.spyOn(adminApi, "resendInvite");
    open("u-7");
    const dialog = await screen.findByRole("dialog", { name: "Ines Fernandes" });
    expect(await within(dialog).findByText(/Sent, expires/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Resend the invitation" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("u-7"));
    expect(await within(dialog).findByTestId("action-result")).toHaveTextContent("Invitation sent to ines.fernandes@demo-corp.example");
  });

  it("changes nothing without the manage users permission", async () => {
    h.allowed = ["view"];
    open("u-3");
    const dialog = await screen.findByRole("dialog", { name: "Aisha Khan" });
    expect(await within(dialog).findByRole("button", { name: "Suspend" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Remove the user" })).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: "Add the role" })).toBeNull();
    expect(within(dialog).getByText("Changing a user needs the manage users permission.")).toBeInTheDocument();
  });
});
