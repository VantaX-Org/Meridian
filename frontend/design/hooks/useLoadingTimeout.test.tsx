// frontend/design/hooks/useLoadingTimeout.test.tsx
import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOADING_TIMEOUT_MS, useLoadingTimeout } from "./useLoadingTimeout";
import { ReportPage } from "../templates/ReportPage";
import { ExplorerPage } from "../templates/ExplorerPage";

afterEach(() => vi.useRealTimers());

describe("useLoadingTimeout", () => {
  it("is false until loading has lasted the timeout, then true, and resets when loading ends", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ loading }) => useLoadingTimeout(loading), { initialProps: { loading: true } });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(LOADING_TIMEOUT_MS - 1); });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(true);
    rerender({ loading: false });
    expect(result.current).toBe(false);
    // A new load starts the clock again.
    rerender({ loading: true });
    expect(result.current).toBe(false);
  });

  it("never fires when loading ends before the timeout", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ loading }) => useLoadingTimeout(loading, 1000), { initialProps: { loading: true } });
    act(() => { vi.advanceTimersByTime(500); });
    rerender({ loading: false });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe(false);
  });
});

describe("page frames give up on a skeleton after the timeout", () => {
  it("ReportPage swaps the skeleton for an error with Retry", () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    render(<ReportPage title="Trends" narrative="n" state="loading" charts={<p>chart</p>} errorProps={{ message: "x", onRetry }} />);
    expect(document.querySelector('[data-state="loading"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    act(() => { vi.advanceTimersByTime(LOADING_TIMEOUT_MS); });
    expect(screen.getByText("This is taking longer than expected.")).toBeInTheDocument();
    screen.getByRole("button", { name: /retry/i }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("ExplorerPage does the same", () => {
    vi.useFakeTimers();
    render(<ExplorerPage header={<h2>Rules</h2>} table={<table />} state="loading" errorProps={{ message: "x", onRetry: () => {} }} />);
    expect(screen.queryByText("This is taking longer than expected.")).toBeNull();
    act(() => { vi.advanceTimersByTime(LOADING_TIMEOUT_MS); });
    expect(screen.getByText("This is taking longer than expected.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
