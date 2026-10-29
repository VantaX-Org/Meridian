import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as adminApi from "@/lib/api/v2/admin";
import { resetAdminFixture } from "@/lib/api/v2/fixtures";
import { Inspector } from "../Inspector";
import { resetKeptOutcomes } from "../inspector/shared";
import { ApiKeysSection } from "../admin/apikeys";
import { RolesSection } from "../admin/roles";
import { SsoSection } from "../admin/signin";
import { UsersSection } from "../admin/users";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

const h = vi.hoisted(() => ({ allowed: "all" as "all" | string[] }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Programme lead", name: "Test", email: null, fixture: true, can: (a: string) => h.allowed === "all" || h.allowed.includes(a) }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetAdminFixture();
  resetKeptOutcomes();
  undo = stubLayout();
  h.allowed = "all";
  setUrl("/v2/admin/users?fixture=1");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const dataRows = (name: string) => within(screen.getByRole("grid", { name })).getAllByRole("row").slice(1);
const page = (ui: React.ReactElement) =>
  renderWithQuery(
    <>
      {ui}
      <Inspector />
    </>,
  );

describe("Admin: users", () => {
  it("lists everyone with roles, status words and last sign-in, and says how many seats are used", async () => {
    page(<UsersSection />);
    await screen.findByText("Nomsa Dlamini");
    const rows = dataRows("Users");
    expect(rows).toHaveLength(8);
    expect(norm(rows[0])).toContain("Platform admin");
    expect(norm(rows[0])).toContain("Active");
    expect(norm(rows[6])).toContain("Ines Fernandes");
    expect(norm(rows[6])).toContain("Invited");
    expect(norm(rows[6])).toContain("Never");
    expect(norm(rows[7])).toContain("Suspended");
    expect(screen.getByText(/7 of 25 seats/)).toBeInTheDocument();
    expect(screen.getByText(/1 invite older than 7 days/)).toBeInTheDocument();
  });

  it("filters by status through the API", async () => {
    const spy = vi.spyOn(adminApi, "listUsers");
    page(<UsersSection />);
    await screen.findByText("Nomsa Dlamini");
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "invited" } });
    await waitFor(() => expect(dataRows("Users")).toHaveLength(1));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ status: "invited" }));
    expect(norm(dataRows("Users")[0])).toContain("Ines Fernandes");
  });

  it("suspends the selected people after a confirmation, and the result is shown in the frame", async () => {
    const spy = vi.spyOn(adminApi, "bulkUsers");
    page(<UsersSection />);
    await screen.findByText("Nomsa Dlamini");
    fireEvent.click(screen.getByLabelText("Select row 3"));
    fireEvent.click(screen.getByLabelText("Select row 4"));
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    expect(bar).toHaveTextContent("2 people");
    fireEvent.click(within(bar).getByRole("button", { name: "Suspend" }));
    const dialog = await screen.findByRole("dialog", { name: "Suspend 2 people" });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspend" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(["u-3", "u-4"], "suspend"));
    expect(await screen.findByTestId("action-result")).toHaveTextContent("Suspended 2 people");
    await waitFor(() => expect(norm(dataRows("Users")[2])).toContain("Suspended"));
  });

  it("invites a user from the inspector with a first role, and answers in the frame", async () => {
    const spy = vi.spyOn(adminApi, "inviteUser");
    page(<UsersSection />);
    await screen.findByText("Nomsa Dlamini");
    fireEvent.click(screen.getByRole("button", { name: "Invite a user" }));
    const invite = await screen.findByRole("dialog", { name: "Invite a user" });
    const send = screen.getByRole("button", { name: "Send the invitation" });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new.person@demo-corp.example" } });
    await within(invite).findByRole("option", { name: "Analyst" });
    fireEvent.change(within(invite).getByLabelText("Role"), { target: { value: "analyst" } });
    fireEvent.click(send);
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ email: "new.person@demo-corp.example", name: undefined, grants: [{ role_key: "analyst", system_id: null, module: null }] }));
    expect(await screen.findByTestId("action-result")).toHaveTextContent("Invitation sent to new.person@demo-corp.example");
    await waitFor(() => expect(dataRows("Users")).toHaveLength(9));
  });

  it("without the manage users permission it offers nothing to change", async () => {
    h.allowed = ["view"];
    page(<UsersSection />);
    expect(await screen.findByTestId("needs-permission")).toHaveTextContent("Managing users needs the manage users permission");
    expect(screen.queryByRole("grid")).toBeNull();
    expect(screen.queryByRole("button", { name: "Invite a user" })).toBeNull();
  });
});

describe("Admin: roles and permissions", () => {
  it("lists the roles, the matrix of what each may do, the open requests and the history", async () => {
    setUrl("/v2/admin/roles?fixture=1");
    page(<RolesSection />);
    await screen.findByRole("grid", { name: "Roles" });
    await waitFor(() => expect(dataRows("Roles")).toHaveLength(9));
    const matrix = await screen.findByRole("table", { name: "Roles by resource" });
    expect(within(matrix).getByRole("columnheader", { name: "Viewer" })).toBeInTheDocument();
    expect(await screen.findByText("I cover approvals while Lerato is away.")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Role changes" })).toBeInTheDocument();
  });

  it("grants an access request with the role chosen", async () => {
    const spy = vi.spyOn(adminApi, "decideAccessRequest");
    setUrl("/v2/admin/roles?fixture=1");
    page(<RolesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Grant" }));
    const dialog = await screen.findByRole("dialog", { name: "Grant access" });
    const grant = within(dialog).getByRole("button", { name: "Grant access" });
    expect(grant).toBeDisabled();
    await within(dialog).findByRole("option", { name: "Data owner / approver" });
    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "data_owner" } });
    fireEvent.click(grant);
    await waitFor(() => expect(spy).toHaveBeenCalledWith("ar-1", { decision: "granted", role_key: "data_owner" }));
    expect(await screen.findByText("No open requests. A request appears here when someone asks for access they do not have.")).toBeInTheDocument();
  });

  it("a built-in role is read only; a custom role saves exactly the permissions ticked", async () => {
    const put = vi.spyOn(adminApi, "putRolePermissions");
    setUrl("/v2/admin/roles?fixture=1&open=role:viewer");
    const first = page(<RolesSection />);
    const dialog = await screen.findByRole("dialog", { name: "Viewer" });
    await within(dialog).findByRole("table", { name: "Permissions by resource and action" });
    expect(within(dialog).queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(dialog).queryByRole("button", { name: "Save permissions" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Copy to change it" })).toBeInTheDocument();
    first.unmount();

    setUrl("/v2/admin/roles?fixture=1&open=role:finance_reviewer");
    page(<RolesSection />);
    const custom = await screen.findByRole("dialog", { name: "Finance reviewer" });
    const box = await within(custom).findByRole("checkbox", { name: "glossary create" });
    expect(box).not.toBeChecked();
    const save = within(custom).getByRole("button", { name: "Save permissions" });
    expect(save).toBeDisabled();
    fireEvent.click(box);
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const pairs = put.mock.calls[0][1];
    expect(pairs).toContainEqual({ resource: "glossary", action: "create" });
    expect(pairs).toContainEqual({ resource: "reports", action: "export" });
    expect(await within(custom).findByText("Permissions saved")).toBeInTheDocument();
  });

  it("creates a role as a copy of another", async () => {
    const spy = vi.spyOn(adminApi, "createRole");
    setUrl("/v2/admin/roles?fixture=1&open=role:new");
    page(<RolesSection />);
    const dialog = await screen.findByRole("dialog", { name: "Create a role" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Audit liaison" } });
    await within(dialog).findByRole("option", { name: "Auditor" });
    fireEvent.change(within(dialog).getByLabelText("Start as a copy of"), { target: { value: "auditor" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create the role" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ name: "Audit liaison", cloned_from: "auditor", description: undefined }));
    await waitFor(() => expect(dataRows("Roles")).toHaveLength(10));
  });
});

describe("Admin: single sign-on and the sign-in page", () => {
  it("tests the issuer typed in the form, and says what the provider answered", async () => {
    const spy = vi.spyOn(adminApi, "testSso");
    setUrl("/v2/admin/sso?fixture=1");
    renderWithQuery(<SsoSection part="sso" />);
    const issuer = await screen.findByLabelText("Issuer address");
    expect(issuer).toHaveValue("https://login.demo-corp.example/tenant-4f2a/v2.0");
    fireEvent.change(issuer, { target: { value: "http://insecure.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Test sign-in" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("http://insecure.example"));
    expect(await screen.findByTestId("action-result")).toHaveTextContent("The issuer must start with https://");
  });

  it("keeps the stored secret when only the display name changes; asks for it again when the issuer changes", async () => {
    const spy = vi.spyOn(adminApi, "saveSso");
    setUrl("/v2/admin/sso?fixture=1");
    renderWithQuery(<SsoSection part="sso" />);
    const issuer = await screen.findByLabelText("Issuer address");
    expect(screen.getByLabelText(/Client secret/)).toHaveAttribute("placeholder", "Stored. Leave blank to keep it");
    fireEvent.change(screen.getByLabelText(/Button name/), { target: { value: "Demo login" } });
    fireEvent.click(screen.getByRole("button", { name: "Save sign-in settings" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0]).toEqual({ issuer: "https://login.demo-corp.example/tenant-4f2a/v2.0", client_id: "meridian-demo-client", display_name: "Demo login", allowed_domains: ["demo-corp.example"], default_role: "viewer", enforce: false });
    fireEvent.change(issuer, { target: { value: "https://other.example/v2.0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save sign-in settings" }));
    await waitFor(() => expect(screen.getAllByText("Enter the secret again when the issuer or client ID changes").length).toBeGreaterThan(0));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("requiring single sign-on is confirmed first", async () => {
    const spy = vi.spyOn(adminApi, "saveSso");
    setUrl("/v2/admin/signin?fixture=1");
    renderWithQuery(<SsoSection part="signin" />);
    fireEvent.click(await screen.findByLabelText(/Require single sign-on/));
    fireEvent.click(screen.getByRole("button", { name: "Save sign-in settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Require single sign-on" });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Require single sign-on" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ enforce: true })));
    await waitFor(() => expect(screen.getByText("Sign-in settings saved")).toBeInTheDocument());
  });

  it("turns single sign-on off after a confirmation", async () => {
    const spy = vi.spyOn(adminApi, "removeSso");
    setUrl("/v2/admin/sso?fixture=1");
    renderWithQuery(<SsoSection part="sso" />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn off single sign-on" }));
    const dialog = await screen.findByRole("dialog", { name: "Turn off single sign-on" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Turn off single sign-on" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("Single sign-on turned off")).toBeInTheDocument());
  });

  it("without the permission it shows nothing to edit", async () => {
    h.allowed = [];
    renderWithQuery(<SsoSection part="signin" />);
    expect(await screen.findByTestId("needs-permission")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Button name/)).toBeNull();
  });
});

describe("Admin: API keys", () => {
  it("lists keys with their roles, status and last use", async () => {
    setUrl("/v2/admin/apikeys?fixture=1");
    page(<ApiKeysSection />);
    await screen.findByText("BI export job");
    const rows = dataRows("API keys");
    expect(rows).toHaveLength(3);
    expect(norm(rows[0])).toContain("Analyst");
    expect(norm(rows[0])).toContain("Active");
    expect(norm(rows[1])).toContain("ECC production");
    expect(norm(rows[1])).toContain("Never used");
    expect(norm(rows[2])).toContain("Revoked");
  });

  it("creates a key with a scoped role and shows the secret once", async () => {
    const spy = vi.spyOn(adminApi, "createApiKey");
    setUrl("/v2/admin/apikeys?fixture=1&open=apikey:new");
    page(<ApiKeysSection />);
    const dialog = await screen.findByRole("dialog", { name: "Create an API key" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Nightly export" } });
    await within(dialog).findByRole("option", { name: "Analyst" });
    fireEvent.change(within(dialog).getAllByLabelText("Role")[0], { target: { value: "analyst" } });
    await within(dialog).findByRole("option", { name: "ECC production" });
    fireEvent.change(within(dialog).getAllByLabelText("System")[0], { target: { value: "a1b2c3d4-0001-4000-8000-000000000001" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create the key" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ name: "Nightly export", grants: [{ role_key: "analyst", system_id: "a1b2c3d4-0001-4000-8000-000000000001", module: null }], expires_at: null }));
    expect((await within(dialog).findByTestId("new-key")).textContent).toMatch(/^mk_[0-9a-f]+\./);
    expect(within(dialog).getByText("Your key. It is shown once.")).toBeInTheDocument();
    await waitFor(() => expect(dataRows("API keys")).toHaveLength(4));
  });

  it("revokes a key only after a confirmation", async () => {
    const spy = vi.spyOn(adminApi, "revokeApiKey");
    setUrl("/v2/admin/apikeys?fixture=1&open=apikey:key-2");
    page(<ApiKeysSection />);
    const dialog = await screen.findByRole("dialog", { name: "ERP monitor (read only)" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke the key" }));
    const confirm = await screen.findByRole("dialog", { name: "Revoke ERP monitor (read only)" });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Revoke the key" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("key-2"));
    await waitFor(() => expect(norm(dataRows("API keys")[1])).toContain("Revoked"));
  });
});
