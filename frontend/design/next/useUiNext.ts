"use client";

import { usePreferences } from "@/hooks/use-preferences";

/** Whether this person chose "Try the new Meridian" in Preferences. Off until they do. */
export function useUiNext(): boolean {
  return usePreferences().prefs.ui_next === true;
}
