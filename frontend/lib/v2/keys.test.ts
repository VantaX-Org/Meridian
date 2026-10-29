import { describe, expect, it, vi } from "vitest";
import { KEYS, SCOPE_TITLE, commandHints, createDispatcher, gridRegistry, isTyping, ledgerRegistry, matchKey, sheetGroups, type GridTarget, type KeyContext, type LedgerTarget } from "./keys";

const press = (key: string, extra: Partial<KeyboardEventInit> = {}, target?: EventTarget): KeyboardEvent => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra });
  if (target) Object.defineProperty(e, "target", { value: target });
  return e;
};

describe("key registry", () => {
  it("is one table: every key spec is unique within its scope and every row has a label and a display", () => {
    for (const k of KEYS) {
      expect(k.label.length).toBeGreaterThan(0);
      expect(k.display.length).toBeGreaterThan(0);
    }
    const seen = new Set<string>();
    for (const k of KEYS) {
      for (const spec of k.keys) {
        const id = `${k.scope}:${spec}`;
        expect(seen.has(id), id).toBe(false);
        seen.add(id);
      }
    }
    expect(new Set(KEYS.map((k) => k.id)).size).toBe(KEYS.length);
  });

  it("feeds the sheet: every scope with rows appears, with the table's own labels", () => {
    const groups = sheetGroups();
    expect(groups.map((g) => g.scope)).toEqual(["global", "go", "grid", "ledger", "inspector", "command"]);
    for (const g of groups) {
      expect(g.title).toBe(SCOPE_TITLE[g.scope]);
      expect(g.items).toEqual(KEYS.filter((k) => k.scope === g.scope));
    }
    const all = groups.flatMap((g) => g.items.map((i) => i.label));
    expect(all).toContain("Open the command line");
    expect(all).toContain("Select or clear the row");
  });

  it("feeds the command line's hints from the rows of scope command", () => {
    const hints = commandHints();
    expect(hints.map((h) => h.display)).toEqual(["↑ ↓", "Enter", "Esc"]);
    expect(hints.every((h) => h.scope === "command")).toBe(true);
  });

  it("lists no key that does nothing: every row with a key spec has a handler", () => {
    for (const k of KEYS) if (k.keys.length > 0) expect(typeof k.run, k.id).toBe("function");
  });
});

describe("matchKey", () => {
  it("matches the command line shortcut with Meta or Ctrl, and not without", () => {
    expect(matchKey("mod+k", press("k", { metaKey: true }))).toBe(true);
    expect(matchKey("mod+k", press("K", { ctrlKey: true }))).toBe(true);
    expect(matchKey("mod+k", press("k"))).toBe(false);
  });

  it("tells j from Shift+J and Enter from Shift+Enter", () => {
    expect(matchKey("j", press("j"))).toBe(true);
    expect(matchKey("j", press("J", { shiftKey: true }))).toBe(false);
    expect(matchKey("shift+j", press("J", { shiftKey: true }))).toBe(true);
    expect(matchKey("Enter", press("Enter", { shiftKey: true }))).toBe(false);
    expect(matchKey("shift+ArrowDown", press("ArrowDown", { shiftKey: true }))).toBe(true);
  });

  it("matches ? whichever way Shift is held, and ignores Alt", () => {
    expect(matchKey("?", press("?", { shiftKey: true }))).toBe(true);
    expect(matchKey("x", press("x", { altKey: true }))).toBe(false);
  });
});

describe("isTyping", () => {
  it("is true in fields and false elsewhere", () => {
    expect(isTyping(document.createElement("input"))).toBe(true);
    expect(isTyping(document.createElement("textarea"))).toBe(true);
    expect(isTyping(document.createElement("select"))).toBe(true);
    expect(isTyping(document.createElement("button"))).toBe(false);
    const box = document.createElement("input");
    box.type = "checkbox";
    expect(isTyping(box)).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});

describe("dispatcher", () => {
  const setup = (over: Partial<KeyContext> = {}) => {
    const ctx = { openCommand: vi.fn(), openShortcuts: vi.fn(), go: vi.fn(), escape: vi.fn(() => true), stepInspector: vi.fn(), ...over };
    return { ctx, d: createDispatcher(() => ctx) };
  };

  it("opens the command line with the shortcut, even while typing in a field", () => {
    const { ctx, d } = setup();
    expect(d.handle(press("k", { metaKey: true }, document.createElement("input")))).toBe(true);
    expect(ctx.openCommand).toHaveBeenCalledTimes(1);
  });

  it("opens the command line with / and the sheet with ?, but not while typing", () => {
    const { ctx, d } = setup();
    d.handle(press("/"));
    d.handle(press("?", { shiftKey: true }));
    expect(ctx.openCommand).toHaveBeenCalledTimes(1);
    expect(ctx.openShortcuts).toHaveBeenCalledTimes(1);
    d.handle(press("/", {}, document.createElement("input")));
    expect(ctx.openCommand).toHaveBeenCalledTimes(1);
  });

  it("goes to a place on g then a letter inside the window, and not after it", () => {
    const { ctx, d } = setup();
    d.handle(press("g"), 1_000);
    expect(d.handle(press("l"), 1_500)).toBe(true);
    expect(ctx.go).toHaveBeenLastCalledWith("landscape");
    d.handle(press("g"), 2_000);
    d.handle(press("w"), 2_100);
    expect(ctx.go).toHaveBeenLastCalledWith("work");
    d.handle(press("g"), 3_000);
    d.handle(press("r"), 3_100);
    expect(ctx.go).toHaveBeenLastCalledWith("runs");
    d.handle(press("g"), 4_000);
    d.handle(press("p"), 4_100);
    expect(ctx.go).toHaveBeenLastCalledWith("people");
    const calls = (ctx.go as ReturnType<typeof vi.fn>).mock.calls.length;
    d.handle(press("g"), 5_000);
    expect(d.handle(press("l"), 7_000)).toBe(false);
    expect((ctx.go as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
  });

  it("Escape closes the top layer, and says it did nothing when there is none", () => {
    const { ctx, d } = setup();
    expect(d.handle(press("Escape"))).toBe(true);
    expect(ctx.escape).toHaveBeenCalled();
    const none = setup({ escape: () => false });
    expect(none.d.handle(press("Escape"))).toBe(false);
  });

  it("routes j, k, Enter, x and Shift+J to the grid when there is one, and ignores them when there is none", () => {
    const grid: GridTarget = { move: vi.fn(), open: vi.fn(), toggle: vi.fn() };
    const { d } = setup({ grid });
    d.handle(press("j"));
    expect(grid.move).toHaveBeenLastCalledWith(1, false);
    d.handle(press("ArrowUp"));
    expect(grid.move).toHaveBeenLastCalledWith(-1, false);
    d.handle(press("J", { shiftKey: true }));
    expect(grid.move).toHaveBeenLastCalledWith(1, true);
    d.handle(press("Enter"));
    expect(grid.open).toHaveBeenCalledTimes(1);
    d.handle(press("x"));
    expect(grid.toggle).toHaveBeenCalledTimes(1);
    const bare = setup();
    expect(bare.d.handle(press("j"))).toBe(false);
  });

  it("steps the inspector with [ and ]", () => {
    const { ctx, d } = setup();
    d.handle(press("]"));
    d.handle(press("["));
    expect(ctx.stepInspector).toHaveBeenNthCalledWith(1, 1);
    expect(ctx.stepInspector).toHaveBeenNthCalledWith(2, -1);
  });

  it("leaves shortcuts alone while a field has focus", () => {
    const grid: GridTarget = { move: vi.fn(), open: vi.fn(), toggle: vi.fn() };
    const { d } = setup({ grid });
    expect(d.handle(press("j", {}, document.createElement("input")))).toBe(false);
    expect(grid.move).not.toHaveBeenCalled();
  });
});

describe("grid registry", () => {
  it("holds the last grid mounted and clears only its own", () => {
    const a: GridTarget = { move: vi.fn(), open: vi.fn(), toggle: vi.fn() };
    const b: GridTarget = { move: vi.fn(), open: vi.fn(), toggle: vi.fn() };
    gridRegistry.set(a);
    gridRegistry.set(b);
    gridRegistry.clear(a);
    expect(gridRegistry.get()).toBe(b);
    gridRegistry.clear(b);
    expect(gridRegistry.get()).toBeNull();
  });
});

describe("the ledger's keys", () => {
  const ledger = (): LedgerTarget => ({ accept: vi.fn(), notAnIssue: vi.fn(), acceptRisk: vi.fn(), exportSheet: vi.fn(), focusChips: vi.fn(), step: vi.fn(() => true) });
  const make = (l: LedgerTarget | null, extra: Partial<KeyContext> = {}) => createDispatcher(() => ({ ledger: l, ...extra }));

  it("a, n, r, e and f reach the ledger", () => {
    const l = ledger();
    const d = make(l);
    expect(d.handle(press("a"))).toBe(true);
    d.handle(press("n"));
    d.handle(press("r"));
    d.handle(press("e"));
    d.handle(press("f"));
    expect(l.accept).toHaveBeenCalledTimes(1);
    expect(l.notAnIssue).toHaveBeenCalledTimes(1);
    expect(l.acceptRisk).toHaveBeenCalledTimes(1);
    expect(l.exportSheet).toHaveBeenCalledTimes(1);
    expect(l.focusChips).toHaveBeenCalledTimes(1);
  });

  it("do nothing off the ledger, and nothing while typing in a field", () => {
    expect(make(null).handle(press("a"))).toBe(false);
    const l = ledger();
    const d = make(l);
    expect(d.handle(press("a", {}, document.createElement("textarea")))).toBe(false);
    expect(l.accept).not.toHaveBeenCalled();
    const box = document.createElement("input");
    box.type = "checkbox";
    expect(d.handle(press("a", {}, box))).toBe(true);
  });

  it("g then r is still Runs, not accept risk", () => {
    const l = ledger();
    const go = vi.fn();
    const d = make(l, { go });
    d.handle(press("g"), 1_000);
    d.handle(press("r"), 1_100);
    expect(go).toHaveBeenCalledWith("runs");
    expect(l.acceptRisk).not.toHaveBeenCalled();
  });

  it("⌘Z undoes, but not inside a field, where it stays the field's own undo", () => {
    const undoLast = vi.fn();
    const d = make(null, { undoLast });
    expect(d.handle(press("z", { metaKey: true }))).toBe(true);
    expect(undoLast).toHaveBeenCalledTimes(1);
    expect(d.handle(press("z", { ctrlKey: true }))).toBe(true);
    expect(d.handle(press("z", { metaKey: true }, document.createElement("input")))).toBe(false);
    expect(undoLast).toHaveBeenCalledTimes(2);
  });

  it("the registry holds the last ledger mounted and clears only its own", () => {
    const a = ledger();
    const b = ledger();
    ledgerRegistry.set(a);
    ledgerRegistry.set(b);
    ledgerRegistry.clear(a);
    expect(ledgerRegistry.get()).toBe(b);
    ledgerRegistry.clear(b);
    expect(ledgerRegistry.get()).toBeNull();
  });

  it("the sheet lists them, with the two that act inside a cell", () => {
    const ids = KEYS.filter((k) => k.scope === "ledger").map((k) => k.display);
    expect(ids).toEqual(["a", "n", "r", "e", "f", "⌘D", "Paste"]);
    expect(KEYS.find((k) => k.id === "undo")?.display).toBe("⌘Z");
  });
});
