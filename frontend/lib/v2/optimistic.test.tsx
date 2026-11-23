import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ToastHost } from "@/ui/kit/Toast";

vi.mock("@/lib/api/v2/work", () => ({ postUndo: vi.fn(() => Promise.resolve({})) }));
import { useOptimistic } from "./optimistic";

const setup = (fn: () => Promise<{ action_id?: string | null }>) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["k"], 1);
  const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}><ToastHost>{children}</ToastHost></QueryClientProvider>;
  const hook = renderHook(() => useOptimistic<number, { action_id?: string | null }, number>({
    mutationFn: fn, queryKey: ["k"], patch: (c, v) => (c ?? 0) + v, label: () => "Done",
  }), { wrapper: wrap });
  return { qc, ...hook };
};

describe("useOptimistic", () => {
  it("patches the cache at once and rolls back on error", async () => {
    const { qc, result } = setup(() => new Promise((_, rej) => setTimeout(() => rej(new Error("x")), 300)));
    act(() => { result.current.mutate(5); });
    await waitFor(() => expect(qc.getQueryData(["k"])).toBe(6));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData(["k"])).toBe(1);
  });
  it("shows Undo when the response has an action id", async () => {
    const { result } = setup(() => Promise.resolve({ action_id: "a1" }));
    act(() => { result.current.mutate(1); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(document.body.textContent).toContain("Undo");
  });
});
