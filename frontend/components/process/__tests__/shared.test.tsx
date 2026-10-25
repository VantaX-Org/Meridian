import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as findingsApi from "@/lib/api/findings";
import { readinessHref, useFindingHref } from "../shared";

afterEach(() => vi.restoreAllMocks());

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useFindingHref", () => {
  it("opens the failing check's records on its object in that run, never the old finding link that lost them", async () => {
    vi.spyOn(findingsApi, "getFindings").mockResolvedValue({
      findings: [{ id: "f1", version_id: "v1", module: "material_master", check_id: "MM045" }],
    } as never);
    const { result } = renderHook(() => useFindingHref("v1"), { wrapper });
    await waitFor(() => expect(result.current("material_master", "MM045")).toBeDefined());
    const href = result.current("material_master", "MM045") ?? "";
    expect(href.startsWith("/objects/material_master?")).toBe(true);
    expect(href).not.toContain("/analyse/");
    const q = new URLSearchParams(href.split("?")[1]);
    expect(q.get("run")).toBe("v1");
    expect(q.get("tab")).toBe("records");
    expect(q.get("check_id")).toBe("MM045");
    // A check that did not fail on that object gives no link, so a caller can try the next object.
    expect(result.current("fi_gl", "MM045")).toBeUndefined();
  });
});

describe("readinessHref", () => {
  it("names the L1, an object of that L1 and the run, so the readiness page never opens another L1", () => {
    expect(readinessHref({ l1: "OTC", object: "sd_sales_orders", run: "v1" })).toBe("/insights/process?l1=OTC&object=sd_sales_orders&run=v1");
    // An object of another L1 is replaced by the L1's first object.
    expect(readinessHref({ l1: "OTC", object: "accounts_payable" })).toBe("/insights/process?l1=OTC&object=accounts_receivable");
    // An L1 with no readiness definition has no readiness page.
    expect(readinessHref({ l1: "R2R", run: "v1" })).toBeUndefined();
  });
});
