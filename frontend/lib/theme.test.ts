// One theme default for the first paint, the app and the error page, read from the keys the app writes.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME, themeBootScript } from "./theme";
import { PREFS_KEY, readPrefs, resetPreferencesCache, setPreferences } from "./preferences";

const ROOT = path.resolve(__dirname, "..");
const boot = () => new Function(themeBootScript())();
const dark = (matches: boolean) => vi.fn().mockReturnValue({ matches });

describe("DEFAULT_THEME", () => {
  it("is the light canvas", () => {
    expect(DEFAULT_THEME).toBe("light");
  });

  it("is the one default: the layout, the error page and the theme hook build on it, with no literal of their own", () => {
    const layout = readFileSync(path.join(ROOT, "app/layout.tsx"), "utf8");
    const globalError = readFileSync(path.join(ROOT, "app/global-error.tsx"), "utf8");
    const hook = readFileSync(path.join(ROOT, "hooks/use-theme.ts"), "utf8");
    expect(layout).toContain("themeBootScript()");
    expect(globalError).toContain("themeBootScript()");
    expect(hook).toContain("prefs.theme ?? DEFAULT_THEME");
    for (const src of [layout, globalError]) expect(src).not.toMatch(/localStorage\.getItem/);
  });
});

describe("themeBootScript", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    window.matchMedia = dark(true) as unknown as typeof window.matchMedia;
  });
  afterEach(() => vi.restoreAllMocks());

  it("paints the default for someone who never chose, even on a dark system", () => {
    boot();
    expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME);
  });

  it("reads the choice the app writes, so the first paint matches the app", () => {
    resetPreferencesCache();
    setPreferences({ theme: "dark" });
    expect(window.localStorage.getItem(PREFS_KEY)).toContain("dark");
    boot();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(readPrefs().theme).toBe("dark");
  });

  it("reads the preferences document when the mirror is missing", () => {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: "dark" }));
    boot();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("still reads the legacy key", () => {
    window.localStorage.setItem("aurora:theme", "dark");
    boot();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("resolves system against the colour scheme and ignores a value it does not know", () => {
    window.localStorage.setItem("meridian:theme", "system");
    boot();
    expect(document.documentElement.dataset.theme).toBe("dark");
    window.localStorage.setItem("meridian:theme", "sepia");
    boot();
    expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME);
  });
});
