"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
/** Row density, kept here because the legacy token module is retired. */
export type DensityTier = "compact" | "default" | "comfortable";
const DENSITY_STORAGE_KEY = "meridian:density";
const DEFAULT_DENSITY: DensityTier = "default";

/** "system" clears data-theme so the tokens follow prefers-color-scheme. */
export type Theme = "dark" | "light" | "system";
const THEME_KEY = "meridian:theme";
const EVENT = "meridian:prefs";
/** Pre-rename keys; read once, copied to the new key and removed. */
const LEGACY_KEYS: Record<string, string> = { "meridian:theme": "aurora:theme", "meridian:density": "aurora:density" };

function read<T extends string>(key: string, fallback: T): T {
  try {
    const current = localStorage.getItem(key);
    if (current) return current as T;
    const legacy = LEGACY_KEYS[key];
    const old = legacy ? localStorage.getItem(legacy) : null;
    if (legacy && old) {
      localStorage.setItem(key, old);
      localStorage.removeItem(legacy);
      return old as T;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

/** Theme + density, persisted per browser and applied to <html> as data-theme / data-density. */
export function useAuroraPrefs() {
  const theme = useSyncExternalStore(subscribe, () => read<Theme>(THEME_KEY, "light"), () => "light" as Theme);
  const density = useSyncExternalStore(
    subscribe,
    () => read<DensityTier>(DENSITY_STORAGE_KEY, DEFAULT_DENSITY),
    () => DEFAULT_DENSITY,
  );
  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.density = density;
  }, [theme, density]);
  const set = useCallback((key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return {
    theme,
    density,
    setTheme: (t: Theme) => set(THEME_KEY, t),
    setDensity: (d: DensityTier) => set(DENSITY_STORAGE_KEY, d),
  };
}
