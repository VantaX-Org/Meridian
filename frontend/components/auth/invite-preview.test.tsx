import { AxiosError, AxiosHeaders } from "axios";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as authApi from "@/lib/api/auth";
import { InvitePreview } from "./invite-preview";

let token = "tok";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(token ? `token=${token}` : "") }));

beforeEach(() => { token = "tok"; vi.restoreAllMocks(); });

describe("InvitePreview", () => {
  it("shows a busy skeleton while loading", () => {
    vi.spyOn(authApi, "getInvitePreview").mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQuery(<InvitePreview />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
  it("lists email and grants", async () => {
    vi.spyOn(authApi, "getInvitePreview").mockResolvedValue({ email: "a@example.com", grants: [{ role_key: "steward", role_label: "Steward", system_name: "Sys A", module: "material" }] });
    renderWithQuery(<InvitePreview />);
    expect(await screen.findByText("Invited as a@example.com")).toBeTruthy();
    expect(screen.getByText("Steward, Sys A, Material")).toBeTruthy();
  });
  it("says to wait, not expired, on a 429", async () => {
    vi.spyOn(authApi, "getInvitePreview").mockRejectedValue(new AxiosError("limited", "ERR_BAD_REQUEST", undefined, undefined, { status: 429, data: {}, statusText: "", headers: {}, config: { headers: new AxiosHeaders() } }));
    renderWithQuery(<InvitePreview />);
    expect(await screen.findByText("Too many attempts. Try again in a minute.")).toBeTruthy();
    expect(screen.queryByText(/expired/)).toBeNull();
  });
  it("shows a generic message when the link is invalid", async () => {
    vi.spyOn(authApi, "getInvitePreview").mockRejectedValue(new Error("404"));
    renderWithQuery(<InvitePreview />);
    expect(await screen.findByText("This invitation link is invalid or has expired.")).toBeTruthy();
  });
  it("hides the password form behind a dead invite and shows it under a live one", async () => {
    vi.spyOn(authApi, "getInvitePreview").mockRejectedValue(new Error("404"));
    const dead = renderWithQuery(<InvitePreview><form aria-label="Password form" /></InvitePreview>);
    await screen.findByText("This invitation link is invalid or has expired.");
    expect(screen.queryByRole("form", { name: "Password form" })).toBeNull();
    dead.unmount();
    vi.spyOn(authApi, "getInvitePreview").mockResolvedValue({ email: "a@example.com", grants: [{ role_key: "steward", role_label: "Steward", module: "material_master" }] });
    renderWithQuery(<InvitePreview><form aria-label="Password form" /></InvitePreview>);
    expect(await screen.findByRole("form", { name: "Password form" })).toBeTruthy();
    expect(screen.getByText("Steward, all systems, Material master")).toBeTruthy();
  });
});
