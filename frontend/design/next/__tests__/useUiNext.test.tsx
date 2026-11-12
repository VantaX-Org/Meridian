import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const prefs = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/hooks/use-preferences", () => ({ usePreferences: () => ({ prefs: prefs.value, update: vi.fn() }) }));
import { useUiNext } from "../useUiNext";

describe("useUiNext", () => {
  it("is off by default", () => { prefs.value = {}; expect(renderHook(() => useUiNext()).result.current).toBe(false); });
  it("is on only when ui_next is true", () => {
    prefs.value = { ui_next: true }; expect(renderHook(() => useUiNext()).result.current).toBe(true);
    prefs.value = { ui_next: false }; expect(renderHook(() => useUiNext()).result.current).toBe(false);
  });
});
