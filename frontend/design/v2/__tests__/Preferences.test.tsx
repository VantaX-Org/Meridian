import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as adminApi from "@/lib/api/v2/admin";
import { resetAdminFixture } from "@/lib/api/v2/fixtures";
import { setFormatPrefs } from "@/lib/format";
import { readPrefs, resetPreferencesCache } from "@/lib/preferences";
import { f1, int, pct1 } from "@/lib/v2/score";
import { fixed, v2Locale, whole } from "@/lib/v2/format";
import { readKeyHints, readPersonaOverride } from "@/lib/v2/prefs";
import { V2Shell } from "../shell/V2Shell";
import { resetKeptOutcomes } from "../inspector/shared";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

function stubMatchMedia() {
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
}

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  window.localStorage.clear();
  resetPreferencesCache();
  setFormatPrefs({});
  resetAdminFixture();
  resetKeptOutcomes();
  stubMatchMedia();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.density;
  delete document.documentElement.dataset.m2Hints;
  setUrl("/?fixture=1&open=preferences");
});
afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetPreferencesCache();
  setFormatPrefs({});
  vi.restoreAllMocks();
});

const mount = () => renderWithQuery(<V2Shell><h1>Page</h1></V2Shell>);
const panel = async () => screen.findByRole("dialog", { name: "Preferences" });

describe("the v2 formatters read the locale", () => {
  it("write numbers the way en-US does until a locale is chosen, then the way that locale does", () => {
    expect(v2Locale()).toBe("en-US");
    expect([f1(71.8), int(1234567), pct1(0.974), fixed(3.5, 2), whole(12345)]).toEqual(["71.8", "1,234,567", "97.4%", "3.50", "12,345"]);
    setFormatPrefs({ locale: "de-DE" });
    expect([f1(71.8), int(1234567), pct1(0.974), fixed(3.5, 2), whole(12345)]).toEqual(["71,8", "1.234.567", "97,4%", "3,50", "12.345"]);
    setFormatPrefs({ locale: "not a locale" });
    expect(f1(71.8)).toBe("71.8");
  });
});

describe("the preferences panel", () => {
  it("changing the locale changes how the panel and the map write numbers, and is stored through /me/preferences", async () => {
    const patch = vi.spyOn(adminApi, "patchMyPreferences");
    mount();
    const dialog = await panel();
    expect(within(dialog).getByTestId("format-sample")).toHaveTextContent("scores 71.8, counts 1,234,567");
    await waitFor(() => expect(screen.getByRole("navigation", { name: "Places" })).toHaveTextContent("25,712"));
    fireEvent.change(within(dialog).getByLabelText("Number and date format"), { target: { value: "de-DE" } });
    // A German locale also turns the interface German (lib/v2/i18n): the same sample, in German words.
    await waitFor(() => expect(within(dialog).getByTestId("format-sample")).toHaveTextContent("Scores 71,8, Anzahlen 1.234.567"));
    await waitFor(() => expect(screen.getByRole("navigation", { name: "Orte" })).toHaveTextContent("25.712"));
    expect(readPrefs().locale).toBe("de-DE");
    expect(patch).toHaveBeenCalledWith({ locale: "de-DE" });
    fireEvent.change(within(dialog).getByLabelText("Zahlen- und Datumsformat"), { target: { value: "" } });
    await waitFor(() => expect(within(dialog).getByTestId("format-sample")).toHaveTextContent("scores 71.8, counts 1,234,567"));
    expect(readPrefs().locale).toBeUndefined();
  });

  it("sets the time zone the dates are read in", async () => {
    mount();
    const dialog = await panel();
    expect(within(dialog).getByTestId("format-sample")).toHaveTextContent("16 Oct 2026, 05:17");
    fireEvent.change(within(dialog).getByLabelText("Time zone"), { target: { value: "Africa/Johannesburg" } });
    await waitFor(() => expect(within(dialog).getByTestId("format-sample")).toHaveTextContent("16 Oct 2026, 07:17"));
    expect(readPrefs().timezone).toBe("Africa/Johannesburg");
  });

  it("theme and density are chosen with buttons that say which is on", async () => {
    mount();
    const dialog = await panel();
    const theme = within(dialog).getByRole("group", { name: "Theme" });
    fireEvent.click(within(theme).getByRole("button", { name: "Dark" }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(within(theme).getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    expect(within(theme).getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(within(theme).getByRole("button", { name: "System" }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBeUndefined());
    const density = within(dialog).getByRole("group", { name: "Row density" });
    fireEvent.click(within(density).getByRole("button", { name: "Compact" }));
    await waitFor(() => expect(document.documentElement.dataset.density).toBe("compact"));
  });

  it("the start screen is a persona that overrides the role's, and is kept for this browser", async () => {
    mount();
    const dialog = await panel();
    const select = within(dialog).getByLabelText("Open Meridian as");
    expect(select).toHaveValue("");
    fireEvent.change(select, { target: { value: "basis" } });
    expect(readPersonaOverride()).toBe("basis");
    await waitFor(() => expect(screen.getByRole("button", { name: "Account, SAP Basis" })).toBeInTheDocument());
    fireEvent.change(within(dialog).getByLabelText("Open Meridian as"), { target: { value: "" } });
    expect(readPersonaOverride()).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Account, Programme lead" })).toBeInTheDocument());
  });

  it("keyboard hints can be switched off, and the page says so for the stylesheet", async () => {
    mount();
    const dialog = await panel();
    const box = within(dialog).getByLabelText("Show keyboard hints beside menu items and places");
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(readKeyHints()).toBe(false);
    await waitFor(() => expect(document.documentElement.dataset.m2Hints).toBe("off"));
    fireEvent.click(box);
    await waitFor(() => expect(document.documentElement.dataset.m2Hints).toBeUndefined());
  });

  it("notification choices are saved, and the inbox and triage settings are one link away", async () => {
    const patch = vi.spyOn(adminApi, "patchMyPreferences");
    mount();
    const dialog = await panel();
    fireEvent.change(within(dialog).getByLabelText("Digest of your open items"), { target: { value: "daily" } });
    fireEvent.click(within(dialog).getByLabelText("Tell me at once about critical findings"));
    expect(readPrefs().notifications).toMatchObject({ digest: "daily", immediate_critical: true });
    expect(patch).toHaveBeenCalledWith({ notifications: { digest: "daily" } });
    expect(within(dialog).getByRole("link", { name: "Inbox and triage settings" })).toHaveAttribute("href", "/work?open=triage&fixture=1");
  });

  it("has no switch to a second interface", async () => {
    mount();
    const dialog = await panel();
    expect(within(dialog).queryByLabelText(/current interface/)).toBeNull();
  });

  it("opens from the account menu, and the menu has Preferences and Reports", async () => {
    setUrl("/?fixture=1");
    mount();
    fireEvent.click(screen.getByRole("button", { name: /^Account/ }));
    const menu = await screen.findByRole("menu", { name: "Account" });
    const prefs = within(menu).getByRole("menuitem", { name: "Preferences" });
    expect(prefs.getAttribute("href")).toContain("open=preferences");
    expect(within(menu).getByRole("menuitem", { name: "Reports" })).toHaveAttribute("href", "/reports?fixture=1");
    expect(within(menu).getByRole("menuitem", { name: "Administration" })).toHaveAttribute("href", "/admin?fixture=1");
  });
});
