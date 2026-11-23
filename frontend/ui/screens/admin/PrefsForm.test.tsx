import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { PrefsForm } from "./PrefsForm";

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/api/v2/admin", () => ({ getMyPreferences: api.get, patchMyPreferences: api.patch }));
vi.mock("@/lib/preferences", async (orig) => ({ ...(await orig<object>()), setPreferences: api.set }));

const ui = () => renderWithQuery(<PrefsForm />);

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("PrefsForm", () => {
  it("shows an error with retry when the load fails", async () => {
    api.get.mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ theme: "dark" });
    ui();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("saves to the API then applies theme and density locally", async () => {
    api.get.mockResolvedValue({ theme: "light", density: "default" });
    api.patch.mockResolvedValue({});
    ui();
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.set).toHaveBeenCalledWith({ theme: "light", density: "default" }));
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it("does not apply locally when the save fails", async () => {
    api.get.mockResolvedValue({});
    api.patch.mockRejectedValue(new Error("no"));
    ui();
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(api.set).not.toHaveBeenCalled();
  });
});
