import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as usersApi from "@/lib/api/users";
import * as rolesApi from "@/lib/api/roles";
import * as connectivityApi from "@/lib/api/connectivity";
import * as licenceApi from "@/lib/api/licence";
import type { User, UserStatus } from "@/types/api";
import AdminUsersPage from "../page";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts, Toaster: () => null }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true, loading: false }) }));
vi.mock("@/components/admin/settings-tabs", () => ({ SettingsTabs: () => null }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: { id: "me" } }) }));

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: nav.replace }),
  usePathname: () => "/admin/users",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const BASE: User = {
  id: "u0", tenant_id: "t1", clerk_user_id: null, email: "x@example.com", name: "X", role: "viewer", permissions: null,
  is_active: true, last_login: "2026-10-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z", grants: [],
};
const person = (id: string, name: string, status: UserStatus, extra: Partial<User> = {}): User => ({
  ...BASE, id, name, email: `${id}@example.com`, status, is_active: status !== "suspended",
  last_login: status === "invited" || status === "invite_expired" ? null : BASE.last_login, ...extra,
});

const ALL_STATUSES = [
  person("inv", "Ines Invited", "invited"),
  person("exp", "Eli Expired", "invite_expired"),
  person("act", "Ana Active", "active"),
  person("lock", "Lou Locked", "locked"),
  person("sus", "Sam Suspended", "suspended"),
];

function seed(users: User[], seats: { used: number; limit: number | null } | null = null) {
  vi.spyOn(usersApi, "getUsers").mockResolvedValue({ users });
  vi.spyOn(rolesApi, "listRoles").mockResolvedValue([
    { key: "data_steward", name: "Data steward", description: null, built_in: true, legacy: false, cloned_from: null, updated_at: null, users: 1 },
  ]);
  vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([{ id: "s1", name: "ECC prod" }] as Awaited<ReturnType<typeof connectivityApi.getSystems>>);
  vi.spyOn(licenceApi, "getLicenceManifest").mockResolvedValue({
    ...licenceApi.DEFAULT_MANIFEST, ...(seats ? { seats_used: seats.used, seats: seats.limit } : {}),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  nav.search = "";
  nav.replace.mockReset();
  toasts.success.mockReset();
  toasts.error.mockReset();
});

const openMenu = async (name: string) => fireEvent.click(await screen.findByRole("button", { name: `Actions for ${name}` }));

describe("status column", () => {
  it("draws a pill for every derived status, each in its own tone", async () => {
    seed(ALL_STATUSES);
    renderWithQuery(<AdminUsersPage />);
    await screen.findByText("Ines Invited");
    const rows = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;
    const pill = (name: string, label: string) => within(rows(name)).getByText(label).closest(".m-pill");
    expect(pill("Ines Invited", "Invited")).toHaveClass("m-pill-info");
    expect(pill("Eli Expired", "Invite expired")).toHaveClass("m-pill-at-risk");
    expect(pill("Ana Active", "Active")).toHaveClass("m-pill-go");
    expect(pill("Lou Locked", "Locked")).toHaveClass("m-pill-no-go");
    expect(pill("Sam Suspended", "Suspended")).toHaveClass("m-pill-neutral");
  });

  it("derives the status from the raw fields when the API sends none", async () => {
    seed([{ ...BASE, id: "u9", name: "Old Shape", email: "old@example.com", is_active: false }]);
    renderWithQuery(<AdminUsersPage />);
    const row = (await screen.findByText("Old Shape")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Suspended")).toBeInTheDocument();
  });
});

describe("filters are URL state", () => {
  it("reads status, role, system and search from the URL and asks the API for exactly those", async () => {
    nav.search = "status=locked&role=data_steward&system=s1&q=lou";
    seed(ALL_STATUSES);
    const search = vi.spyOn(usersApi, "searchUsers").mockResolvedValue({ users: [ALL_STATUSES[3]] });
    renderWithQuery(<AdminUsersPage />);
    await waitFor(() => expect(search).toHaveBeenCalledWith({ q: "lou", status: "locked", role: "data_steward", system_id: "s1" }));
    expect(await screen.findByRole("button", { name: "Locked", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("lou");
  });

  it("writes a chosen status to the URL, and clears it with All", async () => {
    seed(ALL_STATUSES);
    renderWithQuery(<AdminUsersPage />);
    await screen.findByText("Ana Active");
    fireEvent.click(screen.getByRole("button", { name: "Suspended" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/admin/users?status=suspended", { scroll: false });
    nav.search = "status=suspended";
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/admin/users", { scroll: false });
  });

  it("writes the search to the URL once typing pauses", async () => {
    seed(ALL_STATUSES);
    renderWithQuery(<AdminUsersPage />);
    await screen.findByText("Ana Active");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "ana" } });
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/admin/users?q=ana", { scroll: false }));
  });

  it("ignores a status the API does not know", async () => {
    nav.search = "status=bogus";
    seed(ALL_STATUSES);
    const search = vi.spyOn(usersApi, "searchUsers");
    renderWithQuery(<AdminUsersPage />);
    await screen.findByText("Ana Active");
    expect(search).not.toHaveBeenCalled();
  });
});

describe("row menu", () => {
  it("offers the invite actions on an invited person and copies a fresh link", async () => {
    seed(ALL_STATUSES);
    const link = vi.spyOn(usersApi, "createInviteLink").mockResolvedValue({ id: "inv", url: "https://app.test/accept-invite?token=t", expires_at: "2026-11-04T00:00:00Z" });
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    renderWithQuery(<AdminUsersPage />);
    await openMenu("Ines Invited");
    expect(screen.getByRole("menuitem", { name: "Resend invite" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Revoke invite" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Suspend" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy invite link" }));
    await waitFor(() => expect(write).toHaveBeenCalledWith("https://app.test/accept-invite?token=t"));
    expect(link).toHaveBeenCalledWith("inv");
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith(expect.stringContaining("Invite link for inv@example.com copied")));
  });

  it("resends an invite", async () => {
    seed(ALL_STATUSES);
    const resend = vi.spyOn(usersApi, "resendInvite").mockResolvedValue({ id: "exp", invite_status: "queued", invite_expires_at: "2026-11-04T00:00:00Z" });
    renderWithQuery(<AdminUsersPage />);
    await openMenu("Eli Expired");
    fireEvent.click(screen.getByRole("menuitem", { name: "Resend invite" }));
    await waitFor(() => expect(resend).toHaveBeenCalledWith("exp"));
    expect(toasts.success).toHaveBeenCalledWith("Invitation sent to exp@example.com");
  });

  it("revokes an invite only after confirming", async () => {
    seed(ALL_STATUSES);
    const del = vi.spyOn(usersApi, "deleteUser").mockResolvedValue({ id: "inv", status: "deleted" });
    renderWithQuery(<AdminUsersPage />);
    await openMenu("Ines Invited");
    fireEvent.click(screen.getByRole("menuitem", { name: "Revoke invite" }));
    expect(del).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog", { name: "Revoke the invite for inv@example.com" });
    expect(within(dialog).getByRole("button", { name: "Keep invite" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke invite" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("inv"));
  });

  it("resets a password by email or by a copied one-time link", async () => {
    seed(ALL_STATUSES);
    const reset = vi.spyOn(usersApi, "resetPassword")
      .mockResolvedValueOnce({ id: "act", must_change_password: true, emailed: true, link: null })
      .mockResolvedValueOnce({ id: "act", must_change_password: true, emailed: false, link: "https://app.test/reset-password?token=z" });
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    renderWithQuery(<AdminUsersPage />);
    await openMenu("Ana Active");
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset password" }));
    let dialog = await screen.findByRole("dialog", { name: "Reset the password for Ana Active" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Email the link" }));
    await waitFor(() => expect(reset).toHaveBeenCalledWith("act", true));
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith(expect.stringContaining("Reset email sent to act@example.com")));

    await openMenu("Ana Active");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Reset password" }));
    dialog = await screen.findByRole("dialog", { name: "Reset the password for Ana Active" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy a one-time link" }));
    await waitFor(() => expect(reset).toHaveBeenLastCalledWith("act", false));
    await waitFor(() => expect(write).toHaveBeenCalledWith("https://app.test/reset-password?token=z"));
  });

  it("reactivates a suspended person and suspends an active one after confirming", async () => {
    seed(ALL_STATUSES);
    const upd = vi.spyOn(usersApi, "updateUser").mockResolvedValue(ALL_STATUSES[2]);
    renderWithQuery(<AdminUsersPage />);
    await openMenu("Sam Suspended");
    fireEvent.click(screen.getByRole("menuitem", { name: "Reactivate" }));
    await waitFor(() => expect(upd).toHaveBeenCalledWith("sus", { is_active: true }));

    await openMenu("Ana Active");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Suspend" }));
    expect(upd).toHaveBeenCalledTimes(1);
    const dialog = await screen.findByRole("dialog", { name: "Suspend Ana Active" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspend" }));
    await waitFor(() => expect(upd).toHaveBeenLastCalledWith("act", { is_active: false }));
  });

  it("keeps the self-row locks: no suspend, reset or remove on your own row", async () => {
    seed([person("me", "Me Admin", "active"), ...ALL_STATUSES]);
    renderWithQuery(<AdminUsersPage />);
    await openMenu("Me Admin");
    for (const name of ["Reset password", "Suspend", "Remove"]) {
      expect(screen.getByRole("menuitem", { name })).toHaveAttribute("aria-disabled", "true");
    }
  });
});

describe("bulk bar", () => {
  it("reports each person the API refused and the ones it changed", async () => {
    seed(ALL_STATUSES);
    const bulk = vi.spyOn(usersApi, "bulkUsers").mockResolvedValue({
      action: "reset", succeeded: 1, failed: 2,
      results: [
        { id: "act", ok: true, error: null },
        { id: "lock", ok: false, error: "This user has not set a password yet. Resend the invite instead." },
        { id: "sus", ok: false, error: "This user is suspended. Reactivate them first." },
      ],
    });
    renderWithQuery(<AdminUsersPage />);
    await screen.findByText("Ana Active");
    for (const n of ["Ana Active", "Lou Locked", "Sam Suspended"]) fireEvent.click(screen.getByRole("checkbox", { name: `Select ${n}` }));
    expect(await screen.findByText("3 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset passwords" }));
    await waitFor(() => expect(bulk).toHaveBeenCalledWith(["act", "lock", "sus"], "reset"));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(2));
    expect(toasts.error).toHaveBeenCalledWith("Lou Locked: This user has not set a password yet. Resend the invite instead.");
    expect(toasts.error).toHaveBeenCalledWith("Sam Suspended: This user is suspended. Reactivate them first.");
    expect(toasts.success).toHaveBeenCalledWith("Password reset email sent to Ana Active");
    // The selection is cleared once the call returns.
    await waitFor(() => expect(screen.queryByText(/selected$/)).toBeNull());
  });

  it("confirms before suspending several people", async () => {
    seed(ALL_STATUSES);
    const bulk = vi.spyOn(usersApi, "bulkUsers").mockResolvedValue({ action: "suspend", succeeded: 2, failed: 0, results: [{ id: "act", ok: true, error: null }, { id: "lock", ok: true, error: null }] });
    renderWithQuery(<AdminUsersPage />);
    await screen.findByText("Ana Active");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ana Active" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Lou Locked" }));
    fireEvent.click(await screen.findByRole("button", { name: "Suspend" }));
    expect(bulk).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog", { name: "Suspend 2 users" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspend" }));
    await waitFor(() => expect(bulk).toHaveBeenCalledWith(["act", "lock"], "suspend"));
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("Suspended 2 people"));
    expect(toasts.error).not.toHaveBeenCalled();
  });
});

describe("seats and invitations", () => {
  it("shows the seat meter in the header and warns from 90 percent", async () => {
    seed(ALL_STATUSES, { used: 45, limit: 50 });
    renderWithQuery(<AdminUsersPage />);
    expect(await screen.findByTestId("seats-meta")).toHaveTextContent("45 of 50 seats");
    expect(await screen.findByText("Seats are nearly used up")).toBeInTheDocument();
  });

  it("says no seats are left at the limit, and stays quiet well under it", async () => {
    seed(ALL_STATUSES, { used: 50, limit: 50 });
    const { unmount } = renderWithQuery(<AdminUsersPage />);
    expect(await screen.findByText("No seats left")).toBeInTheDocument();
    unmount();
    seed(ALL_STATUSES, { used: 10, limit: 50 });
    renderWithQuery(<AdminUsersPage />);
    expect(await screen.findByTestId("seats-meta")).toHaveTextContent("10 of 50 seats");
    expect(screen.queryByText(/nearly used up|No seats left/)).toBeNull();
  });

  it("adds a notice row for stale invites and failed deliveries", async () => {
    seed([
      person("a", "Old Invite", "invite_expired", { invited_at: "2026-09-01T00:00:00Z" }),
      person("b", "Failed Mail", "invited", { invited_at: "2026-10-27T00:00:00Z", invite_status: "failed" }),
    ]);
    renderWithQuery(<AdminUsersPage />);
    expect(await screen.findByTestId("invite-attention")).toHaveTextContent("1 invite older than 7 days, 1 delivery failed");
  });

  it("opens the import drawer from the header", async () => {
    seed(ALL_STATUSES);
    renderWithQuery(<AdminUsersPage />);
    await screen.findByText("Ana Active");
    fireEvent.click(screen.getByRole("button", { name: "Import users" }));
    expect(await screen.findByRole("dialog", { name: "Import users" })).toBeInTheDocument();
  });
});
