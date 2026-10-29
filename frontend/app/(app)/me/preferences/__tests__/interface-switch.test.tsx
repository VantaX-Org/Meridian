import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as health from "@/lib/api/health";
import * as notifications from "@/lib/api/notifications";
import { resetPreferencesCache } from "@/lib/preferences";
import { readUiCookie } from "@/lib/v2/switch";
import PreferencesPage from "../page";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  window.localStorage.clear();
  document.cookie = "mn_ui=; Path=/; Max-Age=0";
  resetPreferencesCache();
  vi.spyOn(notifications, "getMyDeliveries").mockResolvedValue([]);
  vi.spyOn(health, "getHealth").mockResolvedValue({
    status: "ok", version: "1.0.0", llm_provider: "ollama", llm_connected: false, licence: { valid: true },
    email_backend: "smtp", timestamp: "2026-10-15T08:00:00+00:00",
  });
});
afterEach(() => vi.restoreAllMocks());

describe("Preferences: Try the new interface", () => {
  it("is off until chosen, and links to /v2 either way", () => {
    renderWithQuery(<PreferencesPage />);
    const toggle = screen.getByRole("switch", { name: "Try the new interface" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("link", { name: "Open the new interface" })).toHaveAttribute("href", "/v2");
    expect(readUiCookie()).toBeNull();
  });

  it("switching it on sets the mn_ui=v2 cookie, switching it off clears it", () => {
    renderWithQuery(<PreferencesPage />);
    const toggle = screen.getByRole("switch", { name: "Try the new interface" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(readUiCookie()).toBe("v2");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(readUiCookie()).toBeNull();
  });

  it("shows the switch on when the cookie is already set", () => {
    document.cookie = "mn_ui=v2; Path=/";
    renderWithQuery(<PreferencesPage />);
    expect(screen.getByRole("switch", { name: "Try the new interface" })).toHaveAttribute("aria-checked", "true");
  });
});
