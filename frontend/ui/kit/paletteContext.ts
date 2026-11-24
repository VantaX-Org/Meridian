"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Command } from "./CommandPalette";

/**
 * The screen's own palette actions. A screen calls usePaletteContext(commands) and the one palette in the app frame
 * lists them first under the screen's name. The commands drop out when the screen unmounts.
 */
let current: { commands: Command[]; label: string } = { commands: [], label: "" };
const subs = new Set<() => void>();
const set = (next: typeof current) => { current = next; subs.forEach((f) => f()); };

export function usePaletteContext(label: string, commands: Command[]): void {
  useEffect(() => {
    set({ commands, label });
    return () => set({ commands: [], label: "" });
  }, [commands, label]);
}

export function useRegisteredCommands(): { commands: Command[]; label: string } {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => current, () => current);
}
