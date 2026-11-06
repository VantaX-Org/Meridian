import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

const timeline = vi.fn();
const head = vi.fn();
vi.mock("@/lib/v2/runs-queries", () => ({ useTimeline: (...a: unknown[]) => timeline(...a), useVersionHead: (id: string) => head(id) }));
vi.mock("@/lib/v2/hooks", () => ({ useV2Href: () => (h: string) => h }));
vi.mock("@/lib/v2/queries", () => ({ useLandscape: () => ({ data: undefined }) }));

import { useObjectRun } from "@/lib/v2/scope";

const run = (id: string, n: number) => ({ id, run_number: n, status: "complete", run_at: "2026-01-01T00:00:00Z", label: null, system_id: "s", baseline: false, kind: "scheduled", objects: { material_master: {} }, records_checked: 1, duration_s: 1 });

beforeEach(() => {
  timeline.mockReset();
  head.mockReset();
  head.mockReturnValue({ data: undefined });
});

describe("useObjectRun", () => {
  it("asks for runs of this object with a wide window, so an object last run long ago still has a run", () => {
    setUrl("/o/s/material_master");
    timeline.mockReturnValue({ data: { runs: [run("a", 2), run("b", 5)] } });
    const { result } = renderHook(() => useObjectRun("s", "material_master"));
    expect(timeline).toHaveBeenCalledWith("s", 50, "material_master");
    expect(result.current).toMatchObject({ runId: "b", isLatest: true });
  });

  it("honours ?run= outside the list and never swaps it for the latest", () => {
    setUrl("/o/s/material_master?run=old");
    timeline.mockReturnValue({ data: { runs: [run("a", 2), run("b", 5)] } });
    const none = renderHook(() => useObjectRun("s", "material_master"));
    expect(none.result.current).toEqual({ runId: "old", isLatest: false, chip: null });
    head.mockReturnValue({ data: { id: "old", run_at: "2025-01-01T00:00:00Z", label: null, run_number: 1, status: "complete", dqs_summary: { material_master: { composite_score: 80 } }, metadata: { system_id: "s" } } });
    const one = renderHook(() => useObjectRun("s", "material_master"));
    expect(one.result.current).toMatchObject({ runId: "old", isLatest: false });
    expect(one.result.current.chip?.objects.material_master.score).toBe(80);
  });
});
