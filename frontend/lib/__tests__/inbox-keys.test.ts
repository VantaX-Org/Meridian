import { describe, expect, it, vi } from "vitest";
import { inboxKeyHandler, keyBelongsElsewhere } from "../inbox-keys";

function fakeEvent(key: string) {
  return { key, preventDefault: vi.fn() } as unknown as KeyboardEvent;
}

describe("inboxKeyHandler", () => {
  it("moves focus down on j, clamped to rowCount - 1", () => {
    const setFocus = vi.fn();
    inboxKeyHandler(fakeEvent("j"), { focusedIndex: 2, rowCount: 3, setFocus, onOpen: vi.fn() });
    expect(setFocus).toHaveBeenCalledWith(2); // already last row
    inboxKeyHandler(fakeEvent("j"), { focusedIndex: 0, rowCount: 3, setFocus, onOpen: vi.fn() });
    expect(setFocus).toHaveBeenCalledWith(1);
  });
  it("moves focus up on k, clamped to 0", () => {
    const setFocus = vi.fn();
    inboxKeyHandler(fakeEvent("k"), { focusedIndex: 0, rowCount: 3, setFocus, onOpen: vi.fn() });
    expect(setFocus).toHaveBeenCalledWith(0);
  });
  it("opens the focused row on enter", () => {
    const onOpen = vi.fn();
    inboxKeyHandler(fakeEvent("Enter"), { focusedIndex: 1, rowCount: 3, setFocus: vi.fn(), onOpen });
    expect(onOpen).toHaveBeenCalledWith(1);
  });
  it("ignores keys it does not own", () => {
    const setFocus = vi.fn();
    inboxKeyHandler(fakeEvent("x"), { focusedIndex: 1, rowCount: 3, setFocus, onOpen: vi.fn() });
    expect(setFocus).not.toHaveBeenCalled();
  });
  it("keeps Enter's default when nothing opened", () => {
    const ev = fakeEvent("Enter");
    inboxKeyHandler(ev, { focusedIndex: 0, rowCount: 1, setFocus: vi.fn(), onOpen: () => false });
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });
});

describe("keyBelongsElsewhere", () => {
  const press = (target: Element, key: string) => {
    const ev = new KeyboardEvent("keydown", { key, bubbles: true });
    Object.defineProperty(ev, "target", { value: target });
    return ev;
  };
  const mount = (html: string) => {
    document.body.innerHTML = html;
    return (sel: string) => document.querySelector(sel) as Element;
  };

  it("keeps every key inside a dialog, menu or field", () => {
    const q = mount(`<div role="dialog"><button id="b">Reject</button></div><div role="menu"><div role="menuitem" id="m">Edit</div></div><input id="i" />`);
    expect(keyBelongsElsewhere(press(q("#b"), "Enter"))).toBe(true);
    expect(keyBelongsElsewhere(press(q("#b"), "a"))).toBe(true);
    expect(keyBelongsElsewhere(press(q("#m"), "j"))).toBe(true);
    expect(keyBelongsElsewhere(press(q("#i"), "x"))).toBe(true);
  });

  it("leaves Enter to a button or link that is not a list row, but not the letter keys", () => {
    const q = mount(`<button id="b">Claim</button><a href="/x" id="a">Open</a><ul data-rows><li><button id="r">Row</button></li></ul>`);
    expect(keyBelongsElsewhere(press(q("#b"), "Enter"), "[data-rows] li")).toBe(true);
    expect(keyBelongsElsewhere(press(q("#a"), "Enter"), "[data-rows] li")).toBe(true);
    expect(keyBelongsElsewhere(press(q("#b"), "j"), "[data-rows] li")).toBe(false);
    expect(keyBelongsElsewhere(press(q("#r"), "Enter"), "[data-rows] li")).toBe(false);
    expect(keyBelongsElsewhere(press(document.body, "Enter"), "[data-rows] li")).toBe(false);
  });
});
