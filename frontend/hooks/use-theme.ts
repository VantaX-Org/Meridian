"use client";

import { useCallback, useEffect } from "react";
import { usePreferences } from "@/hooks/use-preferences";
import type { DensityTier, Theme } from "@/lib/preferences";
import { DEFAULT_THEME } from "@/lib/theme";

export type { DensityTier, Theme };

const DEFAULT_DENSITY: DensityTier = "default";

/**
 * Theme + density, applied to <html> as data-theme / data-density. They live in the user's preferences
 * (server-side, written through to localStorage so the first paint is right; see lib/preferences.ts).
 */
export function useAuroraPrefs() {
  const { prefs, update } = usePreferences();
  const theme: Theme = prefs.theme ?? DEFAULT_THEME;
  const density: DensityTier = prefs.density ?? DEFAULT_DENSITY;
  useEffect(() => {
    // Light unless dark was chosen; "system" from older builds reads as the light default.
    document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.density = density;
  }, [theme, density]);
  const setTheme = useCallback((t: Theme) => update({ theme: t }), [update]);
  const setDensity = useCallback((d: DensityTier) => update({ density: d }), [update]);
  return { theme, density, setTheme, setDensity };
}
