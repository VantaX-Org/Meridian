import { describe, expect, it, vi } from "vitest";
import { inboxKeyHandler } from "../inbox-keys";

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
});
