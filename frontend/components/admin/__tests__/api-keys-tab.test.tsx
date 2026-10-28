import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/render";
import type { ApiKey, ApiKeyCreated } from "@/lib/api/api-keys";

const KEY: ApiKey = {
  id: "k1", name: "Nightly extraction", key_prefix: "abc123def456", user_id: "u1", status: "active",
  grants: [{ id: "g1", role_key: "viewer", role_name: "Viewer", system_id: null, system_name: null, module: null }],
  created_by: "a1", created_by_name: "Ada", created_at: "2026-10-01T08:00:00Z", expires_at: null, last_used_at: null, revoked_at: null,
};
const REVOKED: ApiKey = { ...KEY, id: "k2", name: "Old script", key_prefix: "000111222333", status: "revoked", revoked_at: "2026-10-02T08:00:00Z" };
const FULL_KEY = "mk_newprefix0001.s3cr3t-value-that-is-shown-once";

const api = vi.hoisted(() => ({
  listApiKeys: vi.fn(), createApiKey: vi.fn(), revokeApiKey: vi.fn(), deleteApiKey: vi.fn(),
}));
vi.mock("@/lib/api/api-keys", () => api);
const ROLE = vi.hoisted(() => ({ description: null, built_in: true, legacy: false, cloned_from: null, updated_at: null, users: 0 }));
vi.mock("@/lib/api/roles", () => ({
  listRoles: vi.fn().mockResolvedValue([
    { ...ROLE, key: "platform_admin", name: "Platform admin" },
    { ...ROLE, key: "viewer", name: "Viewer" },
  ]),
}));
vi.mock("@/lib/api/connectivity", () => ({ getSystems: vi.fn().mockResolvedValue([]) }));
const copy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions", () => ({ copyToClipboard: copy }));
const seenRoles = vi.hoisted(() => ({ keys: [] as string[] }));
vi.mock("../grants-picker", () => ({
  GrantsPicker: ({ roles, grants, onAdd }: { roles: { key: string }[]; grants: { id: string; role_key: string }[]; onAdd: (g: { role_key: string }) => void }) => {
    seenRoles.keys = roles.map((r) => r.key);
    return (
      <div>
        <ul aria-label="Chosen roles">{grants.map((g) => <li key={g.id}>{g.role_key}</li>)}</ul>
        <button type="button" onClick={() => onAdd({ role_key: "viewer" })}>Add role</button>
      </div>
    );
  },
}));

import { ApiKeysTab } from "../api-keys-tab";

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  copy.mockReset();
  api.listApiKeys.mockResolvedValue([KEY, REVOKED]);
});

describe("ApiKeysTab", () => {
  it("lists each key with its prefix, roles, last use and status, and never a secret", async () => {
    renderWithQuery(<ApiKeysTab />);
    expect(await screen.findByText("Nightly extraction")).toBeInTheDocument();
    expect(screen.getByText("mk_abc123def456")).toBeInTheDocument();
    expect(screen.getAllByText("Viewer, All systems")).toHaveLength(2);
    expect(screen.getAllByText("Never used")).toHaveLength(2);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Revoked")).toBeInTheDocument();
  });

  it("shows a plain empty state before the first key", async () => {
    api.listApiKeys.mockResolvedValue([]);
    renderWithQuery(<ApiKeysTab />);
    expect(await screen.findByText("No API keys yet")).toBeInTheDocument();
  });

  it("creates a key, shows it once with a copy button, and forgets it on Done", async () => {
    const user = userEvent.setup();
    api.createApiKey.mockResolvedValue({ ...KEY, id: "k3", name: "Reports", key_prefix: "newprefix0001", key: FULL_KEY } satisfies ApiKeyCreated);
    renderWithQuery(<ApiKeysTab />);
    await screen.findByText("Nightly extraction");
    await user.click(screen.getByRole("button", { name: "Create API key" }));

    // administrator roles are not offered to a key
    expect(seenRoles.keys).toEqual(["viewer"]);
    const create = screen.getByRole("button", { name: "Create key" });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " Reports " } });
    expect(create).toBeDisabled(); // a key needs at least one role
    await user.click(screen.getByRole("button", { name: "Add role" }));
    await user.click(create);

    await waitFor(() => expect(api.createApiKey).toHaveBeenCalledWith({ name: "Reports", grants: [{ role_key: "viewer", system_id: null, module: null }] }));
    expect(await screen.findByTestId("new-api-key")).toHaveTextContent(FULL_KEY);
    expect(screen.getByText(/will not be shown again/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy key" }));
    expect(copy).toHaveBeenCalledWith(FULL_KEY, "Key copied");

    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByTestId("new-api-key")).not.toBeInTheDocument());
    expect(document.body).not.toHaveTextContent(FULL_KEY);
    await user.click(screen.getByRole("button", { name: "Create API key" }));
    expect(screen.queryByTestId("new-api-key")).not.toBeInTheDocument();
  });

  it("sends the chosen expiry as the end of that day", async () => {
    const user = userEvent.setup();
    api.createApiKey.mockResolvedValue({ ...KEY, key: FULL_KEY });
    renderWithQuery(<ApiKeysTab />);
    await screen.findByText("Nightly extraction");
    await user.click(screen.getByRole("button", { name: "Create API key" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Reports" } });
    await user.click(screen.getByRole("button", { name: "Add role" }));
    fireEvent.change(screen.getByLabelText("Expires (optional)"), { target: { value: "2099-01-31" } });
    await user.click(screen.getByRole("button", { name: "Create key" }));
    await waitFor(() => expect(api.createApiKey.mock.calls[0]?.[0]).toMatchObject({ expires_at: "2099-01-31T23:59:59Z" }));
  });

  it("revokes only after the confirmation, and offers no revoke for a revoked key", async () => {
    const user = userEvent.setup();
    api.revokeApiKey.mockResolvedValue({ ...KEY, status: "revoked" });
    renderWithQuery(<ApiKeysTab />);
    await screen.findByText("Nightly extraction");
    await user.click(screen.getByRole("button", { name: "Actions for Old script" }));
    expect(screen.queryByRole("menuitem", { name: "Revoke" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Actions for Nightly extraction" }));
    await user.click(await screen.findByRole("menuitem", { name: "Revoke" }));
    expect(api.revokeApiKey).not.toHaveBeenCalled();
    expect(screen.getByText(/stops working at once/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revoke key" }));
    await waitFor(() => expect(api.revokeApiKey).toHaveBeenCalledWith("k1"));
  });

  it("deletes after the confirmation", async () => {
    const user = userEvent.setup();
    api.deleteApiKey.mockResolvedValue({ id: "k2", status: "deleted" });
    renderWithQuery(<ApiKeysTab />);
    await screen.findByText("Old script");
    await user.click(screen.getByRole("button", { name: "Actions for Old script" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete key" }));
    await waitFor(() => expect(api.deleteApiKey).toHaveBeenCalledWith("k2"));
  });
});
