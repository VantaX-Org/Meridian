import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as retentionApi from "@/lib/api/retention";
import { PURGE_PHRASE, TenantPurge } from "../tenant-purge";

const perm = vi.hoisted(() => ({ held: ["manage_system", "manage_settings"] as string[] }));
vi.mock("@/lib/permissions", () => ({ usePermissions: () => ({ can: (a: string) => perm.held.includes(a) }) }));
vi.mock("@/design", async (orig) => {
  const actual = await orig<typeof import("@/design")>();
  return { ...actual, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) };
});

const STORE = "meridian:tenant-purge";
const NOW = Date.parse("2026-10-28T12:00:00Z");
const PENDING = { token: "tok", executes_after: "2026-10-29T12:00:00Z" };

beforeEach(() => { window.localStorage.clear(); perm.held = ["manage_system", "manage_settings"]; });
afterEach(() => vi.restoreAllMocks());

function typeAndConfirm(button: string) {
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Type to confirm"), { target: { value: PURGE_PHRASE } });
  fireEvent.click(within(dialog).getByRole("button", { name: button }));
}

describe("TenantPurge", () => {
  it("is hidden without both manage_system and manage_settings", () => {
    perm.held = ["manage_settings"];
    const { container } = renderWithQuery(<TenantPurge now={() => NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("needs the phrase typed before it requests, then keeps the token and waits", async () => {
    const req = vi.spyOn(retentionApi, "requestTenantPurge").mockResolvedValue(PENDING);
    renderWithQuery(<TenantPurge now={() => NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Request purge" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Request purge" })).toBeDisabled();
    typeAndConfirm("Request purge");
    await waitFor(() => expect(req).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/The purge can run after/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Purge now" })).toBeDisabled();
    expect(JSON.parse(window.localStorage.getItem(STORE) ?? "null")).toEqual(PENDING);
  });

  it("purges with the stored token once the delay has passed, and forgets it", async () => {
    window.localStorage.setItem(STORE, JSON.stringify(PENDING));
    const exec = vi.spyOn(retentionApi, "executeTenantPurge").mockResolvedValue();
    renderWithQuery(<TenantPurge now={() => Date.parse("2026-10-29T12:00:01Z")} />);
    expect(screen.getByText("The purge can run now.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Purge now" }));
    typeAndConfirm("Purge now");
    await waitFor(() => expect(exec).toHaveBeenCalledWith("tok"));
    await waitFor(() => expect(window.localStorage.getItem(STORE)).toBeNull());
    expect(await screen.findByRole("button", { name: "Request purge" })).toBeInTheDocument();
  });

  it("keeps the request when the API refuses the purge", async () => {
    window.localStorage.setItem(STORE, JSON.stringify(PENDING));
    vi.spyOn(retentionApi, "executeTenantPurge").mockRejectedValue(new Error("The purge token is not usable yet."));
    renderWithQuery(<TenantPurge now={() => Date.parse("2026-10-30T00:00:00Z")} />);
    fireEvent.click(screen.getByRole("button", { name: "Purge now" }));
    typeAndConfirm("Purge now");
    await waitFor(() => expect(retentionApi.executeTenantPurge).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(window.localStorage.getItem(STORE)).not.toBeNull();
  });

  it("lets the admin forget a pending request", () => {
    window.localStorage.setItem(STORE, JSON.stringify(PENDING));
    renderWithQuery(<TenantPurge now={() => NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Forget this request" }));
    expect(window.localStorage.getItem(STORE)).toBeNull();
    expect(screen.getByRole("button", { name: "Request purge" })).toBeInTheDocument();
  });
});
