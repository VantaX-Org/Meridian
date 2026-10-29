import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as adminApi from "@/lib/api/v2/admin";
import { resetAdminFixture } from "@/lib/api/v2/fixtures";
import { Inspector } from "../Inspector";
import { ApiKeysSection } from "../admin/apikeys";
import { RolesSection } from "../admin/roles";
import { UsersSection } from "../admin/users";
import { resetKeptOutcomes } from "../inspector/shared";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetAdminFixture();
  resetKeptOutcomes();
  undo = stubLayout();
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const page = (ui: React.ReactElement) =>
  renderWithQuery(
    <>
      {ui}
      <Inspector />
    </>,
  );
const dataRows = (name: string) => within(screen.getByRole("grid", { name })).getAllByRole("row").slice(1);

describe("create, update and delete where the API has the verb", () => {
  it("roles: renames a custom role, then deletes it; a built-in role has neither", async () => {
    const update = vi.spyOn(adminApi, "updateRole");
    const remove = vi.spyOn(adminApi, "removeRole");
    setUrl("/v2/admin/roles?fixture=1&open=role:finance_reviewer");
    page(<RolesSection />);
    const dialog = await screen.findByRole("dialog", { name: "Finance reviewer" });
    fireEvent.change(await within(dialog).findByLabelText("Name"), { target: { value: "Finance approver" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save the name" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("finance_reviewer", { name: "Finance approver", description: "A copy of Viewer that can also export finance reports." }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Finance approver" })).getByRole("button", { name: "Delete the role" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete Finance approver" });
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete the role" }));
    expect(await screen.findByText("The API refuses until they are moved.", { exact: false })).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalledWith("viewer");
  });

  it("roles: a built-in role cannot be changed or deleted from its inspector", async () => {
    setUrl("/v2/admin/roles?fixture=1&open=role:viewer");
    page(<RolesSection />);
    const dialog = await screen.findByRole("dialog", { name: "Viewer" });
    await within(dialog).findByRole("table", { name: "Permissions by resource and action" });
    expect(within(dialog).queryByRole("button", { name: "Delete the role" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Save the name" })).toBeNull();
  });

  it("API keys: deletes a key after a confirmation", async () => {
    const spy = vi.spyOn(adminApi, "deleteApiKey");
    setUrl("/v2/admin/apikeys?fixture=1&open=apikey:key-3");
    page(<ApiKeysSection />);
    const dialog = await screen.findByRole("dialog", { name: "Old migration script" });
    expect(within(dialog).queryByRole("button", { name: "Revoke the key" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete the key" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete Old migration script" });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete the key" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("key-3"));
    await waitFor(() => expect(dataRows("API keys")).toHaveLength(2));
  });

  it("users: imports a CSV, checks it first, and invites only the rows that pass", async () => {
    const preview = vi.spyOn(adminApi, "previewUserImport");
    const imp = vi.spyOn(adminApi, "importUsers");
    setUrl("/v2/admin/users?fixture=1");
    page(<UsersSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Import users" }));
    const dialog = await screen.findByRole("dialog", { name: "Import users" });
    const csv = "email,name,role\nnew.one@demo-corp.example,New One,viewer\nnot-an-email,Bad Row,viewer";
    fireEvent.change(within(dialog).getByLabelText("CSV"), { target: { value: csv } });
    expect(within(dialog).getByRole("button", { name: "Invite" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Check the file" }));
    await waitFor(() => expect(preview).toHaveBeenCalledWith(csv));
    expect(await within(dialog).findByText("Not an email address")).toBeInTheDocument();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Invite 1" }));
    await waitFor(() => expect(imp).toHaveBeenCalledWith(csv));
    expect(await within(dialog).findByText("Invited 1 person")).toBeInTheDocument();
  });
});
