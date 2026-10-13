import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatDate, setFormatPrefs } from "../format";
import {
  PREFS_KEY, abandonPreferencesLoad, beginPreferencesLoad, clearLocalPreferences, composePatch, hydratePreferences,
  mergePrefs, readPrefs, removeMigratedLegacyViews, registerPreferencesSink, resetPreferencesCache, setPreferences, syncPreferencesUser,
} from "../preferences";

beforeEach(() => {
  window.localStorage.clear();
  resetPreferencesCache();
  registerPreferencesSink(null);
  abandonPreferencesLoad();
  hydratePreferences({}); // resets the module's load and carry flags
  window.localStorage.clear();
  resetPreferencesCache();
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

describe("changes made while the server copy loads", () => {
  it("are queued, not sent, then merged over the server copy and returned to upload", () => {
    const sink = vi.fn();
    registerPreferencesSink(sink);
    beginPreferencesLoad();
    setPreferences({ theme: "dark" });
    setPreferences({ notifications: { digest: "weekly" } });
    setPreferences({ locale: null });
    expect(sink).not.toHaveBeenCalled();
    expect(readPrefs().theme).toBe("dark"); // applied locally at once
    const upload = hydratePreferences({ theme: "light", locale: "de-DE", density: "compact", notifications: { immediate_critical: true } });
    expect(upload).toEqual({ theme: "dark", notifications: { digest: "weekly" }, locale: null });
    expect(readPrefs()).toEqual({ theme: "dark", density: "compact", notifications: { immediate_critical: true, digest: "weekly" } });
    // loaded: later changes go straight to the sink
    setPreferences({ density: "default" });
    expect(sink).toHaveBeenCalledWith({ density: "default" });
  });

  it("are uploaded as ordinary changes when the load fails", () => {
    const sink = vi.fn();
    registerPreferencesSink(sink);
    beginPreferencesLoad();
    setPreferences({ theme: "dark" });
    abandonPreferencesLoad();
    expect(sink).toHaveBeenCalledWith({ theme: "dark" });
  });

  it("composePatch keeps nulls", () => {
    expect(composePatch({ theme: "dark", notifications: { digest: "daily" } }, { theme: null, notifications: { digest: null } }))
      .toEqual({ theme: null, notifications: { digest: null } });
  });
});

describe("clearing on sign-out and user change", () => {
  it("clearLocalPreferences removes the document, legacy keys and saved views but keeps the theme applied", () => {
    setPreferences({ theme: "dark", locale: "de-DE", saved_views: { t: [{ name: "v" }] } });
    window.localStorage.setItem("aurora:density", "compact");
    window.localStorage.setItem("m-table-views:old", "[]");
    clearLocalPreferences();
    expect(window.localStorage.getItem(PREFS_KEY)).toBeNull();
    expect(window.localStorage.getItem("aurora:density")).toBeNull();
    expect(window.localStorage.getItem("m-table-views:old")).toBeNull();
    expect(readPrefs()).toEqual({ theme: "dark" });
  });

  it("a different user id clears the cache; the same id does not", () => {
    syncPreferencesUser("u1");
    setPreferences({ locale: "de-DE", density: "compact" });
    syncPreferencesUser("u1");
    expect(readPrefs().locale).toBe("de-DE");
    syncPreferencesUser("u2");
    expect(readPrefs().locale).toBeUndefined();
    expect(window.localStorage.getItem("meridian:prefs-user")).toBe("u2");
  });

  it("the next user with no server copy does not inherit the carried appearance", () => {
    syncPreferencesUser("u1");
    setPreferences({ theme: "dark" });
    syncPreferencesUser("u2");
    expect(readPrefs().theme).toBe("dark"); // still applied until their copy loads
    expect(hydratePreferences({})).toBeNull();
    expect(readPrefs()).toEqual({});
  });

  it("the next user's server copy replaces the carried theme", () => {
    syncPreferencesUser("u1");
    setPreferences({ theme: "dark" });
    syncPreferencesUser("u2");
    hydratePreferences({ theme: "light" });
    expect(readPrefs().theme).toBe("light");
  });

  it("the first sign-in after upgrade (no stored user) keeps existing local choices", () => {
    setPreferences({ density: "compact" });
    syncPreferencesUser("u1");
    expect(readPrefs().density).toBe("compact");
  });
});

describe("legacy saved views", () => {
  const view = { name: "Mine", visibility: {} };
  it("folds well-formed m-table-views keys into the migration upload, then removes them on request", () => {
    window.localStorage.setItem("m-table-views:findings", JSON.stringify([view, { nope: 1 }, "x"]));
    window.localStorage.setItem("m-table-views:bad", JSON.stringify({ name: "not an array" }));
    window.localStorage.setItem("m-table-views:junk", "{oops");
    window.localStorage.setItem("m-table-views:empty", JSON.stringify([{ nope: 1 }]));
    const upload = hydratePreferences({});
    expect(upload).toEqual({ saved_views: { findings: [view] } });
    expect(readPrefs().saved_views).toEqual({ findings: [view] });
    expect(window.localStorage.getItem("m-table-views:findings")).not.toBeNull(); // kept until the upload succeeds
    removeMigratedLegacyViews();
    expect(window.localStorage.getItem("m-table-views:findings")).toBeNull();
    expect(window.localStorage.getItem("m-table-views:bad")).not.toBeNull();
  });

  it("leaves legacy keys alone when the browser already has saved views or the server has data", () => {
    window.localStorage.setItem("m-table-views:findings", JSON.stringify([view]));
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ saved_views: { other: [view] } }));
    expect(hydratePreferences({})).toEqual({ saved_views: { other: [view] } });
    resetPreferencesCache();
    window.localStorage.removeItem(PREFS_KEY);
    expect(hydratePreferences({ theme: "dark" })).toBeNull();
    removeMigratedLegacyViews();
    expect(window.localStorage.getItem("m-table-views:findings")).not.toBeNull();
  });
});
