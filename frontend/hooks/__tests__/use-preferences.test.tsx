import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as api from "@/lib/api/preferences";
import { registerPreferencesSink, resetPreferencesCache } from "@/lib/preferences";
import { usePreferences, usePreferencesSync } from "../use-preferences";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return Wrapper;
}

beforeEach(() => {
  window.localStorage.clear();
  resetPreferencesCache();
  registerPreferencesSink(null);
  vi.restoreAllMocks();
});

describe("usePreferences", () => {
  it("reads the local copy and updates it at once", () => {
    window.localStorage.setItem("meridian:prefs", JSON.stringify({ theme: "dark" }));
    const { result } = renderHook(() => usePreferences());
    expect(result.current.prefs.theme).toBe("dark");
    act(() => result.current.update({ density: "compact" }));
    expect(result.current.prefs).toEqual({ theme: "dark", density: "compact" });
    expect(window.localStorage.getItem("meridian:density")).toBe("compact");
  });
});

describe("usePreferencesSync", () => {
  it("loads the server copy once and lets it win over the local copy", async () => {
    window.localStorage.setItem("meridian:prefs", JSON.stringify({ theme: "light" }));
    vi.spyOn(api, "getPreferences").mockResolvedValue({ theme: "dark", locale: "de-DE" });
    const patch = vi.spyOn(api, "patchPreferences").mockResolvedValue({});
    const { result } = renderHook(() => ({ sync: usePreferencesSync(), p: usePreferences() }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.p.prefs).toEqual({ theme: "dark", locale: "de-DE" }));
    expect(api.getPreferences).toHaveBeenCalledTimes(1);
    expect(patch).not.toHaveBeenCalled();
  });

  it("uploads this browser's choices when the server has none", async () => {
    window.localStorage.setItem("meridian:prefs", JSON.stringify({ density: "compact" }));
    vi.spyOn(api, "getPreferences").mockResolvedValue({});
    const patch = vi.spyOn(api, "patchPreferences").mockResolvedValue({ density: "compact" });
    renderHook(() => usePreferencesSync(), { wrapper: wrapper() });
    await waitFor(() => expect(patch).toHaveBeenCalledWith({ density: "compact" }));
  });

  it("forwards each later change to the server, in order, and stays quiet on failure", async () => {
    vi.spyOn(api, "getPreferences").mockResolvedValue({});
    const calls: unknown[] = [];
    vi.spyOn(api, "patchPreferences").mockImplementation(async (p) => {
      calls.push(p);
      if (calls.length === 1) throw new Error("offline");
      return {};
    });
    const { result } = renderHook(() => ({ sync: usePreferencesSync(), p: usePreferences() }), { wrapper: wrapper() });
    await waitFor(() => expect(api.getPreferences).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); }); // let the load reconcile first
    act(() => result.current.p.update({ theme: "dark" }));
    act(() => result.current.p.update({ density: "compact" }));
    await waitFor(() => expect(calls).toEqual([{ theme: "dark" }, { density: "compact", theme: "dark" }]));
    expect(result.current.p.prefs).toEqual({ theme: "dark", density: "compact" });
  });

  it("keeps a change made before the server copy arrived, over that copy, and uploads it", async () => {
    let release: (v: Record<string, unknown>) => void = () => {};
    vi.spyOn(api, "getPreferences").mockReturnValue(new Promise((r) => { release = r; }));
    const patch = vi.spyOn(api, "patchPreferences").mockResolvedValue({});
    const { result } = renderHook(() => ({ sync: usePreferencesSync("u1"), p: usePreferences() }), { wrapper: wrapper() });
    act(() => result.current.p.update({ theme: "dark" }));
    expect(patch).not.toHaveBeenCalled();
    await act(async () => { release({ theme: "light", density: "compact" }); });
    await waitFor(() => expect(patch).toHaveBeenCalledWith({ theme: "dark" }));
    expect(result.current.p.prefs).toEqual({ theme: "dark", density: "compact" });
  });

  it("after a failed save, the next save sends the whole local document", async () => {
    vi.spyOn(api, "getPreferences").mockResolvedValue({});
    const bodies: unknown[] = [];
    vi.spyOn(api, "patchPreferences").mockImplementation(async (p) => {
      bodies.push(p);
      if (bodies.length === 1) throw new Error("offline");
      return {};
    });
    const { result } = renderHook(() => ({ sync: usePreferencesSync(), p: usePreferences() }), { wrapper: wrapper() });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    act(() => result.current.p.update({ theme: "dark" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    act(() => result.current.p.update({ density: "compact" }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual({ theme: "dark", density: "compact" });
    act(() => result.current.p.update({ locale: "de-DE" }));
    await waitFor(() => expect(bodies).toHaveLength(3));
    expect(bodies[2]).toEqual({ locale: "de-DE" }); // recovered: back to patches
  });

  it("sends a user edit made right after hydration after the migration upload", async () => {
    window.localStorage.setItem("meridian:prefs", JSON.stringify({ theme: "light" }));
    vi.spyOn(api, "getPreferences").mockResolvedValue({});
    const bodies: unknown[] = [];
    const server: Record<string, unknown> = {};
    let releaseFirst: () => void = () => {};
    vi.spyOn(api, "patchPreferences").mockImplementation(async (p) => {
      bodies.push(p);
      if (bodies.length === 1) await new Promise<void>((r) => { releaseFirst = r; });
      Object.assign(server, p);
      return { ...server };
    });
    const { result } = renderHook(() => ({ sync: usePreferencesSync(), p: usePreferences() }), { wrapper: wrapper() });
    await waitFor(() => expect(bodies).toHaveLength(1)); // migration upload is in flight
    act(() => result.current.p.update({ theme: "dark" }));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(bodies).toHaveLength(1); // the edit waits its turn
    await act(async () => { releaseFirst(); });
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies).toEqual([{ theme: "light" }, { theme: "dark" }]);
    expect(server.theme).toBe("dark");
  });

  it("removes legacy saved-view keys only after the migration upload succeeds", async () => {
    window.localStorage.setItem("m-table-views:findings", JSON.stringify([{ name: "Mine" }]));
    vi.spyOn(api, "getPreferences").mockResolvedValue({});
    const patch = vi.spyOn(api, "patchPreferences").mockResolvedValue({});
    renderHook(() => usePreferencesSync(), { wrapper: wrapper() });
    await waitFor(() => expect(patch).toHaveBeenCalledWith({ saved_views: { findings: [{ name: "Mine" }] } }));
    await waitFor(() => expect(window.localStorage.getItem("m-table-views:findings")).toBeNull());
  });

  it("clears another user's cached choices when the signed-in user differs", async () => {
    window.localStorage.setItem("meridian:prefs-user", "u1");
    window.localStorage.setItem("meridian:prefs", JSON.stringify({ locale: "de-DE" }));
    vi.spyOn(api, "getPreferences").mockResolvedValue({ density: "compact" });
    vi.spyOn(api, "patchPreferences").mockResolvedValue({});
    const { result } = renderHook(() => ({ sync: usePreferencesSync("u2"), p: usePreferences() }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.p.prefs).toEqual({ density: "compact" }));
  });
});
