"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { DEFAULT_DENSITY, DENSITY_STORAGE_KEY, type DensityTier } from "@/lib/aurora";

export type Theme = "dark" | "light";
const THEME_KEY = "aurora:theme";
const EVENT = "aurora:prefs";

function read<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
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
  const theme = useSyncExternalStore(subscribe, () => read<Theme>(THEME_KEY, "dark"), () => "dark" as Theme);
  const density = useSyncExternalStore(
    subscribe,
    () => read<DensityTier>(DENSITY_STORAGE_KEY, DEFAULT_DENSITY),
    () => DEFAULT_DENSITY,
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
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
