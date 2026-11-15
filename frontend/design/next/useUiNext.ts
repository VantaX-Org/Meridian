"use client";

import { usePreferences } from "@/hooks/use-preferences";

/** Whether the new Meridian is on for this person. On unless they turned it off in Preferences. */
export function useUiNext(): boolean {
  return usePreferences().prefs.ui_next !== false;
}
