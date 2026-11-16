import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { ToastProvider } from "../../../kit";
import { PEOPLE_BODIES } from "../people";

const S = vi.hoisted(() => ({
  can: (): boolean => true,
  openItem: vi.fn(),
  close: vi.fn(),
  clip: vi.fn(() => Promise.resolve(true)),
  api: {
    inviteUser: vi.fn(),
    createRole: vi.fn(),
    createApiKey: vi.fn(),
    testChannel: vi.fn(),
    createChannel: vi.fn(),
    deleteChannel: vi.fn(),
  },
  audit: null as unknown,
  channels: [] as unknown[],
}));

vi.mock("@/lib/v2/hooks", async (orig) => ({
  ...(await orig<object>()),
  useV2Session: () => ({ can: S.can, id: "u-self", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }),
  useOpenItem: () => ({ open: null, openItem: S.openItem, close: S.close, hrefFor: () => "#" }),
}));
const ok = <T,>(data: T) => ({ data, isLoading: false, isError: false, error: null, refetch: () => Promise.resolve() });
vi.mock("@/lib/v2/admin-queries", () => ({
  useUsers: () => ok({ users: [] }),
  useRoles: () => ok([{ key: "viewer", name: "Viewer", description: "", built_in: true }]),
  useEffective: () => ok(undefined),
  useGrantPreview: () => ok(undefined),
  useRolePermissions: () => ok(undefined),
  useApiKeys: () => ok([]),
  useAuditEntry: () => ok(S.audit),
  useChannels: () => ok(S.channels),
  refreshAdmin: () => Promise.resolve(),
}));
vi.mock("@/lib/api/v2/admin", () => S.api);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: { id: "u-self" } }) }));
vi.mock("@/lib/v2/queries", () => ({ useLandscape: () => ok(undefined) }));
vi.mock("@/lib/v2/runs-queries", () => ({ useSystemsExtended: () => ok([]) }));
vi.mock("@/lib/browser", () => ({ writeClipboard: S.clip }));
vi.mock("@/lib/v2/audit-sentence", () => ({ auditSentence: () => "Me changed a rule" }));
vi.mock("@/lib/api/sso", () => ({ getOidcPublicConfig: () => Promise.resolve({ enabled: false, enforce: false }) }));
vi.mock("@/lib/api/v2/fixture", () => ({ fixtureActive: () => true }));

const show = (kind: string, id: string) => {
  const Body = PEOPLE_BODIES[kind];
  return renderWithQuery(
    <ToastProvider>
      <Body id={id} onClose={vi.fn()} />
    </ToastProvider>,
  );
};
const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  S.can = () => true;
  Object.values(S.api).forEach((f) => f.mockReset());
  S.openItem.mockReset();
  S.close.mockReset();
  S.clip.mockClear();
  S.audit = null;
  S.channels = [];
});

describe("registry", () => {
  it("holds the five people kinds", () => {
    expect(Object.keys(PEOPLE_BODIES).sort()).toEqual(["apikey", "audit", "channel", "role", "user"]);
  });
});

describe("user", () => {
  it("sends an invitation with the first role", async () => {
    S.api.inviteUser.mockResolvedValue({ id: "u1", email: "a@b.co" });
    show("user", "new");
    type(/^Email/, "a@b.co");
    fireEvent.click(screen.getByRole("button", { name: "Send the invitation" }));
    await waitFor(() => expect(S.api.inviteUser).toHaveBeenCalledWith({ email: "a@b.co", name: undefined, grants: [{ role_key: "viewer", system_id: null, module: null }] }));
    expect(await screen.findByTestId("action-result")).toHaveTextContent("a@b.co");
  });
});

describe("role", () => {
  it("creates a role as a copy", async () => {
    S.api.createRole.mockResolvedValue({ key: "steward", name: "Steward" });
    show("role", "new");
    type(/^Name/, "Steward");
    fireEvent.click(screen.getByRole("button", { name: "Create the role" }));
    await waitFor(() => expect(S.api.createRole).toHaveBeenCalledWith({ name: "Steward", cloned_from: "viewer", description: undefined }));
    fireEvent.click(await screen.findByRole("button", { name: "Open the role" }));
    expect(S.openItem).toHaveBeenCalledWith({ kind: "role", id: "steward" });
  });
});

describe("apikey", () => {
  it("creates a key and shows the secret once", async () => {
    S.api.createApiKey.mockResolvedValue({ id: "k1", key: "mk_secret", name: "BI" });
    show("apikey", "new");
    type(/^Name/, "BI");
    fireEvent.click(screen.getByRole("button", { name: "Create the key" }));
    await waitFor(() => expect(S.api.createApiKey).toHaveBeenCalledWith({ name: "BI", grants: [{ role_key: "viewer", system_id: null, module: null }], expires_at: null }));
    expect(await screen.findByTestId("new-key")).toHaveTextContent("mk_secret");
  });
});

describe("audit", () => {
  it("shows the entry and copies its id", async () => {
    S.audit = { id: "a1", action: "rule.update", status_code: 200, method: "PATCH", path: "/rules/x", created_at: "2026-11-16T10:00:00Z", actor_email: "me@example.com", before_json: { on: true }, after_json: null };
    show("audit", "a1");
    expect(screen.getByText("Done, 200")).toBeInTheDocument();
    expect(screen.getByLabelText("Before")).toHaveTextContent('"on": true');
    fireEvent.click(screen.getByRole("button", { name: "Copy the entry id" }));
    await waitFor(() => expect(S.clip).toHaveBeenCalledWith("a1"));
  });

  it("says when the entry is not among the recent ones", () => {
    show("audit", "zz");
    expect(screen.getByText(/not among the most recent ones/)).toBeInTheDocument();
  });
});

describe("channel", () => {
  const c = { id: "c1", kind: "slack", target: "https://hooks.slack.com/x", digest: "daily", immediate_critical: true, enabled: true, created_at: "2026-11-01T00:00:00Z", has_secret: false };

  it("sends a test message and reports a refusal", async () => {
    S.channels = [c];
    S.api.testChannel.mockResolvedValue({ delivered: false });
    show("channel", "c1");
    fireEvent.click(screen.getByRole("button", { name: "Send a test message" }));
    await waitFor(() => expect(S.api.testChannel).toHaveBeenCalledWith("c1"));
    expect(await screen.findByTestId("action-result")).toHaveTextContent("The channel did not accept the test message");
  });

  it("removes the channel after the confirmation", async () => {
    S.channels = [c];
    S.api.deleteChannel.mockResolvedValue(undefined);
    show("channel", "c1");
    fireEvent.click(screen.getByRole("button", { name: "Remove the channel" }));
    const buttons = await screen.findAllByRole("button", { name: "Remove the channel" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(S.api.deleteChannel).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(S.close).toHaveBeenCalled());
  });

  it("adds an email channel with a valid address", async () => {
    S.api.createChannel.mockResolvedValue({ id: "c9" });
    show("channel", "new");
    type(/^Address/, "dq@company.com");
    fireEvent.click(screen.getByRole("button", { name: "Add the channel" }));
    await waitFor(() => expect(S.api.createChannel).toHaveBeenCalledWith({ kind: "email", target: "dq@company.com", digest: "daily", immediate_critical: true }));
  });
});
