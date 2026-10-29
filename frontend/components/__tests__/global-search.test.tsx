// The global search's record lookup: debounced search over failing records in the current run, as palette items.
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let pathname = "/objects";
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => search,
}));

const searchWork = vi.fn();
vi.mock("@/lib/api/work", () => ({ searchWork: (...args: unknown[]) => searchWork(...args) }));

import { RECORDS_GROUP, SEARCH_LIMIT, recordHref, useRecordItems } from "../global-search";

const item = (n: number, over: Record<string, unknown> = {}) => ({
  module: "material_master", record_key: `MATNR=M${n}`, name: `Bolt ${n}`, issues: 2, status: "to_fix", severity: "high", ...over,
});

function setup(initial: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(({ text }) => useRecordItems(text), { wrapper, initialProps: { text: initial } });
}

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(300); });

describe("useRecordItems", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    searchWork.mockReset();
    pathname = "/objects";
    search = new URLSearchParams();
  });
  afterEach(() => vi.useRealTimers());

  it("debounces and searches the run in the URL", async () => {
    search = new URLSearchParams("run=v1");
    searchWork.mockResolvedValue({ version_id: "v1", items: [item(1)] });
    const { result, rerender } = setup("");
    rerender({ text: "bo" });
    rerender({ text: "bol" });
    expect(searchWork).not.toHaveBeenCalled();
    await settle();
    expect(searchWork).toHaveBeenCalledTimes(1);
    expect(searchWork).toHaveBeenCalledWith("bol", "v1");
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]).toMatchObject({ group: RECORDS_GROUP, moduleId: "material_master", href: "/objects/material_master?record=MATNR%3DM1&run=v1" });
    expect(result.current[0].label).toContain("Bolt 1");
    expect(result.current[0].label).toContain("2 issues");
  });

  it("does not search under two characters", async () => {
    const { result } = setup("b");
    await settle();
    expect(searchWork).not.toHaveBeenCalled();
    expect(result.current).toEqual([]);
  });

  it("lists at most twenty records", async () => {
    searchWork.mockResolvedValue({ version_id: "v1", items: Array.from({ length: 25 }, (_, i) => item(i)) });
    const { result } = setup("bolt");
    await settle();
    expect(result.current).toHaveLength(SEARCH_LIMIT);
  });

  it("opens a record found without a run in the run it was found in, and names it by key when it has no name", async () => {
    searchWork.mockResolvedValue({ version_id: "v1", items: [item(7, { name: null, version_id: "v3" })] });
    const { result } = setup("M7");
    await settle();
    expect(result.current[0].href).toBe("/objects/material_master?record=MATNR%3DM7&run=v3");
    expect(result.current[0].label).toContain("Material M7");
  });

  it("ignores a process-discovery ?run=", async () => {
    pathname = "/process/ptp";
    search = new URLSearchParams("run=discovery-7");
    searchWork.mockResolvedValue({ version_id: "v1", items: [] });
    setup("bolt");
    await settle();
    expect(searchWork).toHaveBeenCalledWith("bolt", undefined);
  });
});

describe("recordHref", () => {
  it("encodes the module and key and keeps the run", () => {
    expect(recordHref({ module: "business_partner", record_key: "PARTNER=1|BUKRS=10" }, "r1")).toBe("/objects/business_partner?record=PARTNER%3D1%7CBUKRS%3D10&run=r1");
  });
});
