import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { ToastProvider } from "../../kit";
import { SheetHost } from "../../shell/SheetHost";
import { isLastAdmin, removeBlock } from "../guard";
import { AdminHome, AdminSectionView } from "../Admin";
import { Users } from "../Users";
import { PersonSheet } from "../PersonSheet";
import { InviteFlow } from "../../flows/InviteFlow";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/design/v2/admin/Admin", () => ({ AdminCanvas: () => <div data-testid="legacy-admin" /> }));

const S = vi.hoisted(() => ({
  can: (): boolean => true,
  self: "u-self" as string | null,
  users: { data: undefined as unknown, isLoading: false, error: null as unknown, refetch: () => Promise.resolve() },
  roles: [{ key: "analyst", name: "Analyst", description: "" }],
  invite: vi.fn(),
}));
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: S.can, id: S.self, name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));
vi.mock("@/lib/v2/admin-queries", () => ({
  useUsers: () => S.users,
  useRoles: () => ({ data: S.roles }),
  useGrants: () => ({ data: [] }),
  useLicence: () => ({ data: undefined }),
  useScheduleOptions: () => ({ data: { modules: ["material_master"] } }),
  refreshAdmin: () => Promise.resolve(),
}));
vi.mock("@/lib/api/v2/admin", () => ({ inviteUser: S.invite, setUserActive: vi.fn(), removeGrant: vi.fn() }));

const u = (id: string, role: "analyst" | "admin" = "analyst", extra: object = {}) => ({ id, name: `Person ${id}`, email: `${id}@example.com`, role, is_active: true, ...extra });
const setUsers = (list: unknown[] | undefined, over: object = {}) => (S.users = { data: list ? { users: list } : undefined, isLoading: false, error: null, refetch: () => Promise.resolve(), ...over });

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  setUrl("/more/admin/users?fixture=1");
  S.can = () => true;
  S.self = "u-self";
  S.invite.mockReset();
  window.sessionStorage.clear();
  setUsers([u("a")]);
});
afterEach(() => undo());
const wrap = (ui: React.ReactElement) => renderWithQuery(<ToastProvider><SheetHost>{ui}</SheetHost></ToastProvider>);

describe("last administrator guard", () => {
  it("blocks yourself and the only active admin, and nobody else", () => {
    const admins = [u("x", "admin"), u("y", "analyst")];
    expect(isLastAdmin(admins[0], admins)).toBe(true);
    expect(removeBlock(admins[0], admins, "someone")).toBe("last-admin");
    expect(removeBlock(admins[1], admins, "y")).toBe("self");
    expect(removeBlock(admins[1], admins, "x")).toBeNull();
    const two = [...admins, u("z", "admin")];
    expect(removeBlock(two[0], two, "q")).toBeNull();
  });

  it("shows the block note and disables Deactivate on the person sheet", () => {
    setUsers([u("x", "admin"), u("y")]);
    wrap(<PersonSheet ctx={{ id: "x", step: 1, setStep: vi.fn(), close: vi.fn(), dismiss: vi.fn(), open: vi.fn(), under: false }} />);
    expect(screen.getByTestId("remove-block")).toHaveTextContent(/last active administrator/i);
    expect(screen.getByRole("button", { name: "Deactivate" })).toHaveAttribute("aria-disabled", "true");
  });

  it("blocks deactivating yourself", () => {
    setUsers([u("u-self"), u("y", "admin")]);
    wrap(<PersonSheet ctx={{ id: "u-self", step: 1, setStep: vi.fn(), close: vi.fn(), dismiss: vi.fn(), open: vi.fn(), under: false }} />);
    expect(screen.getByTestId("remove-block")).toHaveTextContent(/yourself/i);
  });
});

describe("states of users and roles", () => {
  it("denied for a person without manage_users", () => {
    S.can = () => false;
    wrap(<Users />);
    expect(screen.getByTestId("denied")).toBeInTheDocument();
  });

  it("denied on the admin landing and on a section", () => {
    S.can = () => false;
    const a = wrap(<AdminHome />);
    expect(screen.getByTestId("denied")).toBeInTheDocument();
    a.unmount();
    wrap(<AdminSectionView slug="users" />);
    expect(screen.getByTestId("denied")).toBeInTheDocument();
  });

  it("unknown section is an empty screen, known legacy section mounts", () => {
    const a = wrap(<AdminSectionView slug="nope" />);
    expect(screen.getByText("Nothing at this address")).toBeInTheDocument();
    a.unmount();
    wrap(<AdminSectionView slug="audit" />);
    expect(screen.getByTestId("legacy-admin")).toBeInTheDocument();
  });

  it("loading shows a skeleton", () => {
    setUsers(undefined, { isLoading: true });
    wrap(<Users />);
    expect(screen.getByText("Loading users")).toBeInTheDocument();
  });

  it("error shows a retry", () => {
    setUsers(undefined, { error: new Error("boom") });
    wrap(<Users />);
    expect(screen.getByRole("button", { name: /retry|try again/i })).toBeInTheDocument();
  });

  it("empty has its own screen with an invite action", () => {
    setUsers([]);
    wrap(<Users />);
    expect(screen.getByText("No users yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Invite a person" }).length).toBeGreaterThan(0);
  });

  it("long names keep the whole text in a tooltip", () => {
    const long = "A".repeat(120);
    setUsers([u("a", "analyst", { name: long, email: `${"b".repeat(100)}@example.com` })]);
    wrap(<Users />);
    expect(screen.getByTitle(long)).toHaveClass("nx-long");
  });

  it("a very large list is windowed and searchable", () => {
    setUsers(Array.from({ length: 5000 }, (_, i) => u(`p${i}`)));
    wrap(<Users />);
    expect(document.querySelectorAll("[role=listitem]").length).toBeLessThan(40);
    fireEvent.change(screen.getByLabelText("Search users"), { target: { value: "p4999@" } });
    expect(document.querySelectorAll("[role=listitem]")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Search users"), { target: { value: "zzz" } });
    expect(screen.getByText("No user matches this search.")).toBeInTheDocument();
  });
});

describe("invite flow", () => {
  const ctx = (step: number, setStep = vi.fn()) => ({ id: "new", step, setStep, close: vi.fn(), dismiss: vi.fn(), open: vi.fn(), under: false });

  it("steps: Next is disabled until the email is valid", () => {
    const c = ctx(1);
    wrap(<InviteFlow ctx={c} />);
    expect(screen.getByRole("button", { name: "Next" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
    expect(screen.getByRole("button", { name: "Next" })).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(c.setStep).toHaveBeenCalledWith(2);
  });

  it("blocks an email that already has an account", () => {
    setUsers([u("a")]);
    wrap(<InviteFlow ctx={ctx(1)} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "A@example.com" } });
    expect(screen.getByRole("alert")).toHaveTextContent("already has an account");
  });

  it("drops a second click while the first send is in flight", async () => {
    let release: () => void = () => undefined;
    S.invite.mockReturnValue(new Promise<void>((r) => (release = r)));
    window.sessionStorage.setItem("nx_draft:invite", JSON.stringify({ email: "new@example.com", name: "", role: "analyst", picked: [] }));
    wrap(<InviteFlow ctx={ctx(3)} />);
    const send = await screen.findByRole("button", { name: "Send invite" });
    await waitFor(() => expect(window.sessionStorage.getItem("nx_draft:invite")).toBeTruthy());
    await act(async () => { fireEvent.click(send); fireEvent.click(send); });
    expect(S.invite).toHaveBeenCalledTimes(1);
    await act(async () => release());
  });

  it("keeps the draft and says so when the session ended mid-form", async () => {
    S.invite.mockRejectedValue(Object.assign(new Error("401"), { isAxiosError: true, response: { status: 401 } }));
    window.sessionStorage.setItem("nx_draft:invite", JSON.stringify({ email: "new@example.com", name: "", role: "analyst", picked: [] }));
    wrap(<InviteFlow ctx={ctx(3)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Send invite" }));
    expect(await screen.findByTestId("draft-note")).toHaveTextContent(/session ended/i);
    expect(JSON.parse(window.sessionStorage.getItem("nx_draft:invite")!).email).toBe("new@example.com");
  });
});

describe("admin landing", () => {
  it("shows cards for an administrator", () => {
    wrap(<AdminHome />);
    expect(screen.getByTestId("admin-cards").children.length).toBeGreaterThan(0);
  });
});
