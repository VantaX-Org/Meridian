/**
 * The Meridian 2 keyboard registry: one table, three readers. The shell's key listener and the grid dispatch from
 * it, the "?" sheet is drawn from it, and the command line's footer hints are the rows of scope "command".
 * A key is added here once: its label, where it works and what it does.
 */

export type KeyScope = "global" | "go" | "grid" | "inspector" | "command";
export type GoDestination = "landscape" | "work" | "runs" | "people";

/** What a focused or registered grid lets the keyboard do. */
export interface GridTarget {
  move(dir: 1 | -1, extend: boolean): void;
  open(): void;
  toggle(): void;
}

/** What the key handlers may call. The shell supplies it; absent members make the key do nothing. */
export interface KeyContext {
  openCommand?(): void;
  openShortcuts?(): void;
  go?(destination: GoDestination): void;
  /** Closes the top layer (overlay, then menu, then inspector, then selection). Returns true when something closed. */
  escape?(): boolean;
  grid?: GridTarget | null;
  /** Moves to the previous or next row and opens it in the inspector. */
  stepInspector?(dir: 1 | -1): void;
}

export interface KeyDef {
  id: string;
  /** Key specs: "mod+k", "shift+j", "?", "Escape", or a two-key sequence "g l". */
  keys: readonly string[];
  /** How the key reads in the sheet and the hints. */
  display: string;
  scope: KeyScope;
  label: string;
  /** Shown in the command line's footer. */
  hint?: boolean;
  run?(ctx: KeyContext, e: KeyboardEvent): boolean;
}

const handled = (fn: () => void): boolean => {
  fn();
  return true;
};

export const KEYS: readonly KeyDef[] = [
  { id: "command.open", keys: ["mod+k", "/"], display: "⌘K or /", scope: "global", label: "Open the command line", run: (c) => handled(() => c.openCommand?.()) },
  { id: "sheet.open", keys: ["?"], display: "?", scope: "global", label: "Show this sheet", run: (c) => handled(() => c.openShortcuts?.()) },
  { id: "escape", keys: ["Escape"], display: "Esc", scope: "global", label: "Close the top layer: menu, then inspector, then the selection", run: (c) => Boolean(c.escape?.()) },

  { id: "go.landscape", keys: ["g l"], display: "g then l", scope: "go", label: "Landscape", run: (c) => handled(() => c.go?.("landscape")) },
  { id: "go.work", keys: ["g w"], display: "g then w", scope: "go", label: "Work", run: (c) => handled(() => c.go?.("work")) },
  { id: "go.runs", keys: ["g r"], display: "g then r", scope: "go", label: "Runs", run: (c) => handled(() => c.go?.("runs")) },
  { id: "go.people", keys: ["g p"], display: "g then p", scope: "go", label: "People", run: (c) => handled(() => c.go?.("people")) },

  { id: "grid.next", keys: ["j", "ArrowDown"], display: "j or ↓", scope: "grid", label: "Next row", run: (c) => handled(() => c.grid?.move(1, false)) },
  { id: "grid.prev", keys: ["k", "ArrowUp"], display: "k or ↑", scope: "grid", label: "Previous row", run: (c) => handled(() => c.grid?.move(-1, false)) },
  { id: "grid.extend-down", keys: ["shift+j", "shift+ArrowDown"], display: "Shift+J or Shift+↓", scope: "grid", label: "Extend the selection down", run: (c) => handled(() => c.grid?.move(1, true)) },
  { id: "grid.extend-up", keys: ["shift+k", "shift+ArrowUp"], display: "Shift+K or Shift+↑", scope: "grid", label: "Extend the selection up", run: (c) => handled(() => c.grid?.move(-1, true)) },
  { id: "grid.open", keys: ["Enter"], display: "Enter", scope: "grid", label: "Open the row in the inspector", run: (c) => handled(() => c.grid?.open()) },
  { id: "grid.toggle", keys: ["x"], display: "x", scope: "grid", label: "Select or clear the row", run: (c) => handled(() => c.grid?.toggle()) },

  { id: "inspector.next", keys: ["]"], display: "]", scope: "inspector", label: "Open the next row", run: (c) => handled(() => c.stepInspector?.(1)) },
  { id: "inspector.prev", keys: ["["], display: "[", scope: "inspector", label: "Open the previous row", run: (c) => handled(() => c.stepInspector?.(-1)) },
  { id: "inspector.tab", keys: [], display: "Tab", scope: "inspector", label: "Cycles inside the inspector" },
  { id: "inspector.close", keys: [], display: "Esc", scope: "inspector", label: "Close and return to where you were" },

  { id: "command.move", keys: [], display: "↑ ↓", scope: "command", label: "Move through the results", hint: true },
  { id: "command.run", keys: [], display: "Enter", scope: "command", label: "Open the result", hint: true },
  { id: "command.close", keys: [], display: "Esc", scope: "command", label: "Close", hint: true },
];

export const SCOPE_TITLE: Record<KeyScope, string> = {
  global: "Everywhere",
  go: "Go to",
  grid: "Tables and lists",
  inspector: "Inspector",
  command: "Command line",
};

/** The registry grouped for the "?" sheet, in scope order. */
export function sheetGroups(): { scope: KeyScope; title: string; items: KeyDef[] }[] {
  const order: KeyScope[] = ["global", "go", "grid", "inspector", "command"];
  return order.map((scope) => ({ scope, title: SCOPE_TITLE[scope], items: KEYS.filter((k) => k.scope === scope) })).filter((g) => g.items.length > 0);
}

/** The hints the command line shows under its results. */
export function commandHints(): KeyDef[] {
  return KEYS.filter((k) => k.scope === "command" && k.hint);
}

/** True when a key press is going into a text field and must not trigger a shortcut. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

/** Does one key spec ("mod+k", "shift+j", "?", "Escape") match this event? Sequences are handled by the dispatcher. */
export function matchKey(spec: string, e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): boolean {
  const parts = spec.split("+");
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  const mod = e.metaKey || e.ctrlKey;
  if (mods.has("mod") !== mod) return false;
  if (e.altKey) return false;
  const isLetter = /^[a-z]$/i.test(key);
  if (isLetter) {
    if (mods.has("shift") !== e.shiftKey) return false;
    return e.key.toLowerCase() === key.toLowerCase();
  }
  if (mods.has("shift") && !e.shiftKey) return false;
  if (!mods.has("shift") && e.shiftKey && key.length > 1) return false; // Shift+Enter is not Enter
  return e.key === key;
}

const SEQUENCE_WINDOW = 1200;

export interface Dispatcher {
  /** Returns true when the event was a shortcut and has been handled. */
  handle(e: KeyboardEvent, now?: number): boolean;
}

/**
 * The shell's key handler. `getContext` is read on every event so handlers always see the current page. Plain keys
 * are ignored while typing in a field; the command line shortcut and Escape work everywhere.
 */
export function createDispatcher(getContext: () => KeyContext): Dispatcher {
  let pending: { key: string; at: number } | null = null;
  return {
    handle(e, now = Date.now()) {
      const ctx = getContext();
      const typing = isTyping(e.target);
      const plain = !typing && !e.metaKey && !e.ctrlKey && !e.altKey;
      if (plain && pending && now - pending.at < SEQUENCE_WINDOW) {
        const seq = `${pending.key} ${e.key.toLowerCase()}`;
        pending = null;
        const def = KEYS.find((k) => k.scope === "go" && k.keys.includes(seq));
        if (def?.run?.(ctx, e)) {
          e.preventDefault();
          return true;
        }
      }
      if (plain && e.key === "g" && !e.shiftKey) {
        pending = { key: "g", at: now };
        return false;
      }
      pending = null;
      const scopes: KeyScope[] = ctx.grid ? ["global", "inspector", "grid"] : ["global", "inspector"];
      for (const def of KEYS) {
        if (!def.run || !scopes.includes(def.scope)) continue;
        for (const spec of def.keys) {
          if (spec.includes(" ")) continue;
          // The command line shortcut and Escape work everywhere; every other key only outside fields.
          const everywhere = spec.startsWith("mod+") || spec === "Escape";
          if (!everywhere && !plain) continue;
          if (matchKey(spec, e) && def.run(ctx, e)) {
            e.preventDefault();
            return true;
          }
        }
      }
      return false;
    },
  };
}

/** The grid that j, k, Enter and x act on when focus is on the page rather than in a table. The last grid mounted. */
let activeGrid: GridTarget | null = null;
export const gridRegistry = {
  set(target: GridTarget | null): void {
    activeGrid = target;
  },
  clear(target: GridTarget): void {
    if (activeGrid === target) activeGrid = null;
  },
  get(): GridTarget | null {
    return activeGrid;
  },
};
