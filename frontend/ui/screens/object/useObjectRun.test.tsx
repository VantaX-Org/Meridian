import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { isAnalysed, runStatusWord } from "@/lib/v2/run-label";
import { rememberRun } from "./format";
import { useObjectRun } from "./useObjectRun";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
vi.mock("@/lib/v2/queries", () => ({
  useLandscape: () => ({ data: { systems: [{ id: "sys1", name: "SF" }], objects: [], cells: [] } }),
}));
const versions = [
  { id: "new-extracted", status: "extracted", run_at: "2026-11-22" },
  { id: "analysed", status: "agents_complete", run_at: "2026-11-20" },
];
vi.mock("@/lib/api/next/runs", () => ({
  useRunsInfinite: () => ({ data: { pages: [{ versions }] }, isLoading: false }),
  useRun: () => ({ data: null }),
}));

beforeEach(async () => {
  window.localStorage.clear();
  (await import("@/ui/testing/nav-store")).setUrl("/o/sys1/benefits");
});

describe("run status", () => {
  it("treats extracted runs as not analysed", () => {
    expect(isAnalysed("extracted")).toBe(false);
    expect(isAnalysed("agents_complete")).toBe(true);
    expect(isAnalysed(undefined)).toBe(true);
    expect(runStatusWord("extracted")).toBe("Extracted, not analysed");
  });
});

describe("useObjectRun", () => {
  it("opens on the newest analysed run, not a newer extracted-only run", () => {
    const { result } = renderHook(() => useObjectRun("sys1", "benefits"));
    expect(result.current.runId).toBe("analysed");
  });

  it("ignores a remembered run that is not analysed", () => {
    rememberRun("sys1", "benefits", "new-extracted");
    const { result } = renderHook(() => useObjectRun("sys1", "benefits"));
    expect(result.current.runId).toBe("analysed");
  });
});
