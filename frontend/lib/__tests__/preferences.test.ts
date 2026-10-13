import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatDate, setFormatPrefs } from "../format";
import {
  PREFS_KEY, hydratePreferences, mergePrefs, readPrefs, registerPreferencesSink, resetPreferencesCache, setPreferences,
} from "../preferences";

beforeEach(() => {
  window.localStorage.clear();
  resetPreferencesCache();
  registerPreferencesSink(null);
  setFormatPrefs({});
});

describe("mergePrefs", () => {
  it("merges objects, replaces arrays and scalars, and removes on null", () => {
    const base = { theme: "dark", tours_done: ["a"], notifications: { digest: "daily", immediate_critical: true } };
    expect(mergePrefs(base, { tours_done: ["b"], notifications: { digest: "weekly" } })).toEqual({
      theme: "dark", tours_done: ["b"], notifications: { digest: "weekly", immediate_critical: true },
    });
    expect(mergePrefs(base, { theme: null, notifications: { immediate_critical: null } })).toEqual({
      tours_done: ["a"], notifications: { digest: "daily" },
    });
  });

  it("does not mutate its input", () => {
    const base = { notifications: { digest: "daily" } };
    mergePrefs(base, { notifications: { digest: "off" } });
    expect(base.notifications.digest).toBe("daily");
  });
});

describe("setPreferences", () => {
  it("writes through to localStorage, including the per-key mirrors the first-paint script reads", () => {
    setPreferences({ theme: "dark", density: "compact", locale: "de-DE" });
    expect(JSON.parse(window.localStorage.getItem(PREFS_KEY)!)).toEqual({ theme: "dark", density: "compact", locale: "de-DE" });
    expect(window.localStorage.getItem("meridian:theme")).toBe("dark");
    expect(window.localStorage.getItem("meridian:density")).toBe("compact");
    expect(readPrefs().theme).toBe("dark");
  });

  it("notifies subscribers and forwards the patch to the server sink", () => {
    const sink = vi.fn();
    const listener = vi.fn();
    registerPreferencesSink(sink);
    window.addEventListener("meridian:prefs", listener);
    setPreferences({ seen_version: "1.2.0" });
    window.removeEventListener("meridian:prefs", listener);
    expect(sink).toHaveBeenCalledWith({ seen_version: "1.2.0" });
    expect(listener).toHaveBeenCalled();
  });

  it("returns a stable snapshot until something changes", () => {
    setPreferences({ theme: "light" });
    expect(readPrefs()).toBe(readPrefs());
  });

  it("pushes locale and time zone into the date formatter", () => {
    expect(formatDate("2026-10-02T23:30:00Z", "datetime")).toBe("2 Oct 2026, 23:30");
    setPreferences({ timezone: "Africa/Johannesburg" });
    expect(formatDate("2026-10-02T23:30:00Z", "datetime")).toBe("3 Oct 2026, 01:30");
  });

  it("survives blocked storage", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => setPreferences({ theme: "dark" })).not.toThrow();
    spy.mockRestore();
  });
});

describe("readPrefs", () => {
  it("reads values written before sync existed from the per-key mirrors", () => {
    window.localStorage.setItem("meridian:theme", "dark");
    window.localStorage.setItem("aurora:density", "comfortable");
    expect(readPrefs()).toEqual({ theme: "dark", density: "comfortable" });
  });

  it("ignores a corrupt document and an invalid mirror value", () => {
    window.localStorage.setItem(PREFS_KEY, "{not json");
    window.localStorage.setItem("meridian:theme", "neon");
    expect(readPrefs()).toEqual({});
  });
});

describe("hydratePreferences", () => {
  it("lets the server copy win", () => {
    setPreferences({ theme: "light", locale: "en-US" });
    expect(hydratePreferences({ theme: "dark" })).toBeNull();
    expect(readPrefs()).toEqual({ theme: "dark" });
    expect(window.localStorage.getItem("meridian:theme")).toBe("dark");
  });

  it("adopts this browser's choices when the server has none, and returns them to upload", () => {
    setPreferences({ density: "compact" });
    expect(hydratePreferences({})).toEqual({ density: "compact" });
    expect(readPrefs().density).toBe("compact");
  });

  it("returns nothing to upload when both sides are empty", () => {
    expect(hydratePreferences({})).toBeNull();
  });
});
