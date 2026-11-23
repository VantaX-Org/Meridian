import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let search = "";
const replace = vi.fn((url: string) => { search = url.includes("?") ? url.split("?")[1] : ""; });
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/inbox",
  useSearchParams: () => new URLSearchParams(search),
}));
import { useGridState } from "./useGridState";

describe("useGridState", () => {
  beforeEach(() => { search = ""; replace.mockClear(); });
  it("writes sort, filter, group and open row to the URL and reads them back", () => {
    const { result, rerender } = renderHook(() => useGridState("g"));
    act(() => result.current.setSort({ key: "score", dir: "desc" }));
    rerender();
    act(() => result.current.setFilter("sev", ["high", "low"]));
    rerender();
    act(() => result.current.setGroupBy("module"));
    rerender();
    act(() => result.current.setOpen("r1"));
    rerender();
    expect(replace).toHaveBeenLastCalledWith(expect.stringContaining("g.open=r1"), { scroll: false });
    expect(result.current.sort).toEqual({ key: "score", dir: "desc" });
    expect(result.current.filters).toEqual({ sev: ["high", "low"] });
    expect(result.current.groupBy).toBe("module");
    expect(result.current.open).toBe("r1");
  });
  it("clears filters and removes empty params", () => {
    search = "g.f.sev=high&g.sort=a:asc";
    const { result, rerender } = renderHook(() => useGridState("g"));
    act(() => result.current.clearFilters());
    rerender();
    expect(search).toBe("g.sort=a%3Aasc");
    act(() => result.current.setSort(null));
    expect(replace).toHaveBeenLastCalledWith("/inbox", { scroll: false });
  });
});
