import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { ToastProvider } from "../../kit";
import { SheetHost } from "../../shell/SheetHost";
import { PEOPLE_SECTIONS, ShareLinksSection } from "../people";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const ok = <T,>(data: T) => ({ data, isPending: false, isLoading: false, isError: false, error: null, refetch: () => Promise.resolve() });
const S = vi.hoisted(() => ({ can: (): boolean => true }));
const A = vi.hoisted(() => ({
  bulkUsers: vi.fn(),
  previewUserImport: vi.fn(),
  importUsers: vi.fn(),
  saveSso: vi.fn(),
  testSso: vi.fn(),
  removeSso: vi.fn(),
  decideAccessRequest: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  putRolePermissions: vi.fn(),
  removeRole: vi.fn(),
  createApiKey: vi.fn(),
  updateApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  inviteUser: vi.fn(),
  setUserActive: vi.fn(),
  removeGrant: vi.fn(),
  removeUser: vi.fn(),
}));
const E = vi.hoisted(() => ({ rotateScimToken: vi.fn(), revokeScimToken: vi.fn(), putScimGroupRoles: vi.fn() }));
const R = vi.hoisted(() => ({ getAllDelegations: vi.fn(), revokeDelegation: vi.fn(), revokeShareLink: vi.fn(), startViewAs: vi.fn() }));

const role = { key: "analyst", name: "Analyst", description: null, built_in: true, legacy: false, cloned_from: null, updated_at: null, users: 2 };
const sso = { configured: true, issuer: "https://idp.example.com", client_id: "meridian", has_secret: true, display_name: "Company login", allowed_domains: ["example.com"], default_role: "viewer", enforce: false, redirect_uri: "https://meridian.example.com/sso/callback" };
const key = { id: "k1", name: "BI export", key_prefix: "mk_ab12", user_id: "svc-1", status: "active", grants: [], created_by: "u-self", created_by_name: "Me", created_at: "2026-11-01T00:00:00Z", expires_at: null, last_used_at: null, revoked_at: null };

vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: S.can, id: "u-self", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));
vi.mock("@/lib/v2/admin-queries", () => ({
  useUsers: () => ok({ users: [{ id: "a", name: "Ada Lovelace", email: "ada@example.com", role: "analyst", is_active: true }] }),
  useRoles: () => ok([role]),
  useGrants: () => ok([]),
  useLicence: () => ok(undefined),
  useScheduleOptions: () => ok({ modules: [] }),
  useSso: () => ok(sso),
  useApiKeys: () => ok([key]),
  useAccessRequests: () => ok([{ id: "r1", user_id: "a", action: "edit", resource: "rules", reason: "Need to fix rules", created_at: "2026-11-10T00:00:00Z" }]),
  useAudit: () => ok({ entries: [] }),
  useRolePermissions: () => ok(undefined),
  useRolesMatrix: () => ok({ resources: ["rules"], actions: ["read"], roles: [{ key: "analyst", name: "Analyst", built_in: true, legacy: false, matrix: { rules: { read: true } }, legacy_actions: [] }] }),
  refreshAdmin: () => Promise.resolve(),
}));
vi.mock("@/lib/v2/enterprise-queries", () => ({
  useScimToken: () => ok({ configured: false, token_prefix: null, created_at: null, last_used_at: null, base_url: "https://meridian.example.com/scim/v2" }),
  useScimGroupRoles: () => ok({ mappings: [] }),
}));
vi.mock("@/lib/v2/roles-queries", async (orig) => ({
  ...(await orig<object>()),
  useShareLinks: () => ok({ links: [{ id: "l1", route: "/runs/42", state: {}, role: "viewer", label: "Run 42", created_by: "u-self", created_by_label: "Me", created_at: "2026-11-01T00:00:00Z", expires_at: "2026-12-01T00:00:00Z", revoked_at: null, last_opened_at: null, open_count: 3, state_word: "active" }] }),
  refreshRoles: () => Promise.resolve(),
}));
vi.mock("@/lib/v2/queries", async (orig) => ({ ...(await orig<object>()), useLandscape: () => ok({ objects: [] }) }));
vi.mock("@/lib/v2/runs-queries", async (orig) => ({ ...(await orig<object>()), useSystemsExtended: () => ok([]) }));
vi.mock("@/lib/api/v2/admin", () => A);
vi.mock("@/lib/api/v2/enterprise", () => E);
vi.mock("@/lib/api/v2/roles", async (orig) => ({ ...(await orig<object>()), ...R }));

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  setUrl("/more/admin/users?fixture=1");
  S.can = () => true;
  for (const f of [...Object.values(A), ...Object.values(E), ...Object.values(R)]) f.mockReset();
  R.getAllDelegations.mockResolvedValue({ delegations: [{ id: "d1", from_user_id: "a", to_user_id: "b", from_name: "Ada", to_name: "Grace", starts_on: "2026-11-01", ends_on: "2026-11-30", reason: null, state: "active" }] });
  window.sessionStorage.clear();
});
afterEach(() => undo());
const wrap = (ui: React.ReactElement) => renderWithQuery(<ToastProvider><SheetHost>{ui}</SheetHost></ToastProvider>);
const Section = (slug: string) => {
  const C = PEOPLE_SECTIONS[slug];
  return <C />;
};
const last = (name: string) => screen.getAllByRole("button", { name }).at(-1) as HTMLElement;

describe("people sections", () => {
  it("registers every slug", () => {
    expect(Object.keys(PEOPLE_SECTIONS)).toEqual(["users", "roles", "sso", "signin", "apikeys", "viewas", "sharelinks", "delegations"]);
    expect(PEOPLE_SECTIONS.sharelinks).toBe(ShareLinksSection);
  });

  it("users: lists people, keeps the roles link, creates a SCIM token shown once", async () => {
    E.rotateScimToken.mockResolvedValue({ configured: true, token_prefix: "mscim_a1", created_at: null, last_used_at: null, base_url: "x", token: "mscim_secret_value" });
    wrap(Section("users"));
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Roles and permissions" }).getAttribute("href")).toContain("/more/admin/roles");
    fireEvent.click(screen.getByRole("button", { name: "Create a token" }));
    await waitFor(() => expect(E.rotateScimToken).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId("scim-secret")).toBeInTheDocument();
  });

  it("roles: shows the roles, the matrix and a request, and declines it with a reason", async () => {
    A.decideAccessRequest.mockResolvedValue({});
    wrap(Section("roles"));
    expect(screen.getAllByText("Analyst").length).toBeGreaterThan(0);
    expect(screen.getByRole("table", { name: "Roles by resource" })).toBeInTheDocument();
    const req = screen.getByTestId("access-requests");
    expect(within(req).getByText("Ada Lovelace")).toBeInTheDocument();
    fireEvent.click(within(req).getByRole("button", { name: "Decline" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Not needed" } });
    fireEvent.click(last("Decline"));
    await waitFor(() => expect(A.decideAccessRequest).toHaveBeenCalledWith("r1", { decision: "declined", reason: "Not needed" }));
  });

  it("sso: tests the provider with the issuer", async () => {
    A.testSso.mockResolvedValue({ ok: true, message: null });
    wrap(Section("sso"));
    expect(screen.getByDisplayValue("https://idp.example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Test sign-in" }));
    await waitFor(() => expect(A.testSso).toHaveBeenCalledWith("https://idp.example.com"));
  });

  it("signin: saves without sending any secret or password", async () => {
    A.saveSso.mockResolvedValue({ ...sso });
    wrap(Section("signin"));
    expect(screen.getByText("Password sign-in")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save sign-in settings" }));
    await waitFor(() => expect(A.saveSso).toHaveBeenCalledTimes(1));
    const body = A.saveSso.mock.calls[0][0] as Record<string, unknown>;
    expect(body).not.toHaveProperty("client_secret");
    expect(JSON.stringify(body)).not.toMatch(/password/i);
  });

  it("apikeys: lists keys and revokes one behind a confirm", async () => {
    A.revokeApiKey.mockResolvedValue({});
    wrap(Section("apikeys"));
    fireEvent.click(screen.getByText("BI export"));
    fireEvent.click(await screen.findByRole("button", { name: "Revoke the key" }));
    fireEvent.click(last("Revoke the key"));
    await waitFor(() => expect(A.revokeApiKey).toHaveBeenCalledWith("k1"));
  });

  it("viewas: starts a read-only view as the chosen role", async () => {
    R.startViewAs.mockResolvedValue({});
    wrap(Section("viewas"));
    fireEvent.click(screen.getByRole("button", { name: "View as this role" }));
    await waitFor(() => expect(R.startViewAs).toHaveBeenCalledTimes(1));
  });

  it("sharelinks: lists a link and revokes it", async () => {
    R.revokeShareLink.mockResolvedValue({});
    wrap(Section("sharelinks"));
    const list = screen.getByTestId("share-links");
    expect(within(list).getByText("Run 42")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Revoke" }));
    fireEvent.click(last("Revoke"));
    await waitFor(() => expect(R.revokeShareLink).toHaveBeenCalledWith("l1"));
  });

  it("delegations: lists the tenant's delegations and ends one", async () => {
    R.revokeDelegation.mockResolvedValue({});
    wrap(Section("delegations"));
    const list = await screen.findByTestId("all-delegations");
    expect(within(list).getByText("Ada to Grace")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "End it" }));
    fireEvent.click(last("End it"));
    await waitFor(() => expect(R.revokeDelegation).toHaveBeenCalledWith("d1"));
  });

  it("denies every section without manage_users", () => {
    S.can = () => false;
    for (const slug of Object.keys(PEOPLE_SECTIONS)) {
      const { unmount } = wrap(Section(slug));
      expect(screen.getByTestId("denied")).toBeInTheDocument();
      unmount();
    }
  });
});
