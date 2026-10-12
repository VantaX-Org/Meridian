import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePulseOnce } from "../_components/use-pulse-once";

afterEach(() => vi.useRealTimers());

describe("usePulseOnce", () => {
  it("pulses on first load, then never again, even when the first key returns", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ k }) => usePulseOnce(k, true), { initialProps: { k: "a" } });
    expect(result.current).toBe(true);
    rerender({ k: "b" });
    expect(result.current).toBe(false);
    rerender({ k: "a" });
    expect(result.current).toBe(false);
  });
  it("clears after the pulse duration", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePulseOnce("a", true, 1000));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe(false);
  });
});
