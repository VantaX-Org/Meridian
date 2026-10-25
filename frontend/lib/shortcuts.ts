/**
 * The one registry of keyboard shortcuts. `ShortcutSheet` (the `?` sheet) and
 * the inbox read from here, so a key is documented in exactly one place.
 * Navigation shortcuts come from the `shortcut` fields in lib/nav.ts and are
 * handled by design/shell/CommandPalette.tsx's global key handler; the rest
 * are listed below next to the component that handles them.
 */
import { NAV_GROUPS, flattenNav } from "@/lib/nav";

export type ShortcutGroup = "Navigation" | "Fix work" | "Tables" | "Inbox" | "Global";

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ["Navigation", "Fix work", "Tables", "Inbox", "Global"];

export interface Shortcut {
  group: ShortcutGroup;
  /** Display string, for example "j / k". */
  keys: string;
  description: string;
}

/** design/table/DataTable.tsx `onGridKeyDown` and `onRegionKeyDown`. */
export const TABLE_SHORTCUTS: readonly Shortcut[] = [
  { group: "Tables", keys: "↑ / ↓", description: "Move between rows" },
  { group: "Tables", keys: "Home / End", description: "Jump to the first or last row" },
  { group: "Tables", keys: "Enter", description: "Open the focused row" },
  { group: "Tables", keys: "Space", description: "Select the focused row" },
  { group: "Tables", keys: "Escape", description: "Clear the selection" },
];

/** app/(app)/inbox/page.tsx key handler and lib/inbox-keys.ts. */
export const INBOX_SHORTCUTS: readonly Shortcut[] = [
  { group: "Inbox", keys: "j / k", description: "Next or previous task" },
  { group: "Inbox", keys: "Enter", description: "Open the record" },
  { group: "Inbox", keys: "a", description: "Claim" },
  { group: "Inbox", keys: "r", description: "Resolve (approve)" },
  { group: "Inbox", keys: "x", description: "Reject with a reason" },
  { group: "Inbox", keys: "Escape", description: "Close the panel" },
];

/** components/work/fix-work.tsx and the object page's Records to fix (app/(app)/objects/[object]/_fix.tsx). */
export const FIX_SHORTCUTS: readonly Shortcut[] = [
  { group: "Fix work", keys: "j / k", description: "Next or previous record" },
  { group: "Fix work", keys: "a", description: "Accept the record's suggested values" },
  { group: "Fix work", keys: "t", description: "Take the record" },
  { group: "Fix work", keys: "u", description: "Undo the record's decisions" },
  { group: "Fix work", keys: "Enter", description: "Open the full record" },
  { group: "Fix work", keys: "1 to 5", description: "Switch tabs on an object page" },
];

/** design/shell/CommandPalette.tsx and the sheet itself. */
export const GLOBAL_SHORTCUTS: readonly Shortcut[] = [
  { group: "Global", keys: "⌘K", description: "Search or jump to a page" },
  { group: "Global", keys: "?", description: "Show keyboard shortcuts" },
  { group: "Global", keys: "/", description: "Find a record by key or name" },
];

/** Navigation shortcuts, derived from `lib/nav.ts` so a new `shortcut` field shows up here with no second edit. */
export function navShortcuts(): Shortcut[] {
  return flattenNav(NAV_GROUPS.flatMap((g) => g.items))
    .filter((i): i is typeof i & { shortcut: string } => Boolean(i.shortcut))
    .map((i) => ({ group: "Navigation" as const, keys: i.shortcut, description: `Go to ${i.label}` }));
}

export function shortcutRegistry(): Shortcut[] {
  return [...navShortcuts(), ...FIX_SHORTCUTS, ...TABLE_SHORTCUTS, ...INBOX_SHORTCUTS, ...GLOBAL_SHORTCUTS];
}

export interface ShortcutSection {
  group: ShortcutGroup;
  items: Shortcut[];
}

/** The registry grouped in display order; empty groups are dropped. `first` moves one group to the top (the page's own). */
export function shortcutSections(first?: ShortcutGroup): ShortcutSection[] {
  const all = shortcutRegistry();
  const order = first ? [first, ...SHORTCUT_GROUPS.filter((g) => g !== first)] : SHORTCUT_GROUPS;
  return order
    .map((group) => ({ group, items: all.filter((s) => s.group === group) }))
    .filter((s) => s.items.length > 0);
}

/** True when the keydown target is somewhere the user is typing, where `?` must stay a character. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}
