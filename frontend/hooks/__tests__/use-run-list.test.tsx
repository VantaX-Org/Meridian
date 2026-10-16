// The shared run list reads past the API's default page of 20, and a ?run= older than the list is read by id,
// so no label, lineage or "Compare with" ever falls back to a raw id or "the previous run".
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as versionsApi from "@/lib/api/versions";
import type { Version } from "@/types/api";
import { fetchRunList, RUN_LIST_LIMIT, useRunListWith, withRun } from "../use-run-list";

const run = (i: number, over: Partial<Version> = {}): Version => ({
  id: `v${i}`, label: `run ${i}`, status: "agents_complete", run_at: new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString(), dqs_summary: null, metadata: null, ...over,
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(() => vi.restoreAllMocks());

describe("fetchRunList", () => {
  it("pages under the API cap of 100 until the list is complete", async () => {
    const all = Array.from({ length: 231 }, (_, i) => run(i));
    const get = vi.spyOn(versionsApi, "getVersions").mockImplementation(async (p) => ({
      versions: all.slice(p?.offset ?? 0, (p?.offset ?? 0) + (p?.limit ?? 20)), total: all.length,
    }));
    const list = await fetchRunList();
    expect(list.versions).toHaveLength(231);
    expect(get.mock.calls.map(([p]) => p)).toEqual([{ limit: 100, offset: 0 }, { limit: 100, offset: 100 }, { limit: 100, offset: 200 }]);
  });

  it("stops at the shared limit", async () => {
    vi.spyOn(versionsApi, "getVersions").mockImplementation(async (p) => ({
      versions: Array.from({ length: p?.limit ?? 20 }, (_, i) => run((p?.offset ?? 0) + i)), total: 10_000,
    }));
    expect((await fetchRunList()).versions).toHaveLength(RUN_LIST_LIMIT);
  });

  it("stops after one short page when the API reports no total", async () => {
    const get = vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [run(1), run(2)] });
    expect((await fetchRunList()).versions).toHaveLength(2);
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe("useRunListWith", () => {
  it("reads a run outside the list by id and merges it in, newest first", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [run(5), run(4)] });
    const getVersion = vi.spyOn(versionsApi, "getVersion").mockResolvedValue(run(1, { id: "old-ap", label: "accounts_payable_p20" }));
    const { result } = renderHook(() => useRunListWith("old-ap"), { wrapper });
    await waitFor(() => expect(result.current.run?.label).toBe("accounts_payable_p20"));
    expect(getVersion).toHaveBeenCalledWith("old-ap");
    expect(result.current.versions.map((v) => v.id)).toEqual(["v5", "v4", "old-ap"]);
    expect(result.current.resolving).toBe(false);
  });

  it("never reads by id when the run is already in the list", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [run(5), run(4)] });
    const getVersion = vi.spyOn(versionsApi, "getVersion");
    const { result } = renderHook(() => useRunListWith("v4"), { wrapper });
    await waitFor(() => expect(result.current.run?.id).toBe("v4"));
    expect(getVersion).not.toHaveBeenCalled();
  });
});

describe("withRun", () => {
  it("adds a missing run once and keeps the list newest first", () => {
    const list = [run(3), run(1)];
    expect(withRun(list, run(2)).map((v) => v.id)).toEqual(["v3", "v2", "v1"]);
    expect(withRun(list, run(3))).toBe(list);
    expect(withRun(list, undefined)).toBe(list);
  });
});
